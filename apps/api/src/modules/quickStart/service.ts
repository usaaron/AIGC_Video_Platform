import type {
  Asset,
  ExecuteQuickStartRequest,
  GenerationTask,
  Principal,
  QuickStartAssetProposal,
  QuickStartEstimate,
  QuickStartExecutionResult,
  QuickStartPlan,
  ScriptModel,
} from '@seqora/contracts'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../core/errors.js'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import { traceIdFromGenerationTask, traceMetadata } from '../../core/observability/trace.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import { normalizeGenerationTaskLifecycle } from '../../core/jobs/taskLease.js'
import type { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../billing/creditLedger.js'

const quickStartStyleSchema = z.enum(['cinematic-cg', 'chinese-3d', 'chinese-2d', 'anime', 'storybook'])

const providerAnalysisSchema = z.object({
  summary: z.string().min(1).max(500),
  visualStyle: quickStartStyleSchema,
  characters: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().min(1).max(500),
        prompt: z.string().min(1).max(5_000),
        subjectType: z.enum(['human', 'animal']),
        gender: z.enum(['male', 'female', 'unspecified']),
        ageGroup: z.enum(['child', 'teen', 'young', 'middle', 'senior']),
        species: z.string().max(80).default(''),
        anthropomorphic: z.boolean().default(false),
        bodyType: z.enum(['slim', 'balanced', 'athletic', 'full']).default('balanced'),
      }),
    )
    .min(1)
    .max(2),
  costumes: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().min(1).max(500),
        prompt: z.string().min(1).max(5_000),
        audience: z.enum(['male', 'female', 'unisex']),
        category: z.enum([
          'daily',
          'formal',
          'professional',
          'uniform',
          'ancient',
          'ceremonial',
          'fantasy',
          'armor',
        ]),
        season: z.enum(['spring-summer', 'autumn-winter', 'all-season']),
        design: z.enum(['minimal', 'luxury', 'retro', 'future', 'chinese']),
      }),
    )
    .min(1)
    .max(2),
  scenes: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().min(1).max(500),
        prompt: z.string().min(1).max(5_000),
        space: z.enum(['interior', 'exterior']),
        sceneType: z.enum([
          'city',
          'street',
          'residential',
          'commercial',
          'nature',
          'ancient',
          'industrial',
          'fantasy',
        ]),
        era: z.enum(['ancient', 'recent', 'modern', 'future']),
        time: z.enum(['dawn', 'day', 'sunset', 'night']),
        weather: z.enum(['clear', 'cloudy', 'rain', 'snow', 'fog']),
        mood: z.enum(['warm', 'tense', 'mystery', 'romantic', 'epic', 'desolate']),
        camera: z.enum(['eye-level', 'overhead', 'low-angle', 'aerial', 'wide']),
      }),
    )
    .min(1)
    .max(2),
})

type ProviderAnalysis = z.infer<typeof providerAnalysisSchema>

const QUICK_START_SYSTEM_PROMPT = `你是中文漫剧公司的资产制片和美术总监。请分析剧本，为第一次体验生成最小但可用的资产闭环。只返回严格 JSON，不要 Markdown、代码块或解释。

JSON 必须包含：summary、visualStyle、characters、costumes、scenes。
1. characters 只保留推动主线的 1 到 2 个主要角色；字段：name、description、prompt、subjectType、gender、ageGroup、species、anthropomorphic、bodyType。
2. costumes 只保留 1 到 2 套辨识度最高且能覆盖主线的服装；字段：name、description、prompt、audience、category、season、design。服装 prompt 只描述服装本身，不出现人物脸部。
3. scenes 只保留 1 到 2 个复用率最高的核心场景；字段：name、description、prompt、space、sceneType、era、time、weather、mood、camera。场景 prompt 必须为空场景，预留表演空间。
4. visualStyle 只能是 cinematic-cg、chinese-3d、chinese-2d、anime、storybook。尝鲜流程不选择 photorealistic，避免真人授权阻塞。
5. 所有枚举值必须严格使用英文值。prompt 使用具体中文画面描述，保持人物、服装、时代和场景统一。
6. 不创建物品和音频，不重复已有资产，不把次要群演列为主角。`

export class QuickStartService {
  constructor(
    private readonly store: AppStore,
    private readonly textProvider: TextGenerationProvider | null,
    private readonly dispatcher: TaskDispatcher,
    private readonly imageProviderAvailable: boolean,
    private readonly creditLedger: CreditLedger | null = null,
  ) {}

  async plan(
    projectId: string,
    principal: Principal,
    model: ScriptModel = 'glm-5.2',
  ): Promise<QuickStartPlan> {
    const context = this.projectContext(projectId, principal)
    const script = context.project.script.trim()
    if (!script) throw new AppError(400, 'SCRIPT_REQUIRED', '请先保存剧本再使用一键尝鲜')
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '剧本分析服务尚未配置')

    const userPrompt = [
      `项目：${context.project.name}`,
      `内容类型：${context.project.contentType}`,
      `画面比例：${context.project.aspectRatio}`,
      `已有资产：${context.assets.length ? context.assets.map((asset) => `${asset.kind}:${asset.name}`).join('；') : '无'}`,
      `剧本：\n${boundedScript(script)}`,
    ].join('\n')
    const analysis = await this.generateAnalysis(userPrompt, script, model)
    const assets = deduplicateProposals(proposalsFor(analysis), context.assets)
    const estimate = estimateFor(assets, context.user.plan === 'member' ? 3 : 1, context.queueAhead)
    return {
      summary: analysis.summary,
      sourceScriptHash: scriptHash(script),
      generatedAt: new Date().toISOString(),
      assets,
      estimate,
    }
  }

  async execute(
    projectId: string,
    input: ExecuteQuickStartRequest,
    principal: Principal,
    traceId?: string | null,
  ): Promise<QuickStartExecutionResult> {
    if (!this.imageProviderAvailable) {
      throw new AppError(503, 'IMAGE_PROVIDER_NOT_CONFIGURED', '图片生成服务尚未配置')
    }

    const result = await this.store.mutate(async (state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权生成')
      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')

      const replayedTasks = state.tasks.filter(
        (task) =>
          task.projectId === projectId &&
          task.userId === principal.userId &&
          task.metadata.quickStartRequestId === input.clientRequestId,
      )
      if (replayedTasks.length) {
        const replayedAssetIds = new Set(
          replayedTasks
            .map((task) => task.metadata.assetId)
            .filter((value): value is string => typeof value === 'string'),
        )
        const replayedAssets = state.assets.filter((asset) => replayedAssetIds.has(asset.id))
        return {
          batchId: String(replayedTasks[0]!.metadata.quickStartBatchId || input.clientRequestId),
          createdAssets: replayedAssets,
          tasks: replayedTasks,
          skippedAssets: [],
          estimate: estimateForTasks(
            replayedTasks,
            user.plan === 'member' ? 3 : 1,
            activeQueueCount(state.tasks, principal.userId, replayedTasks),
          ),
          replayed: true,
        }
      }

      const currentScript = project.script.trim()
      if (!currentScript || scriptHash(currentScript) !== input.sourceScriptHash) {
        throw new AppError(409, 'QUICK_START_PLAN_STALE', '剧本已变化，请重新分析后再开始生成')
      }

      const projectAssets = state.assets.filter(
        (asset) => asset.projectId === projectId && asset.tenantId === principal.tenantId,
      )
      const proposals = deduplicateProposals(input.assets, projectAssets)
      const proposalKeys = new Set(proposals.map(assetKey))
      const skippedAssets = input.assets
        .filter((asset) => !proposalKeys.has(assetKey(asset)))
        .map((asset) => asset.name)
      const concurrency = user.plan === 'member' ? 3 : 1
      const queueAhead = activeQueueCount(state.tasks, principal.userId)
      const estimate = estimateFor(proposals, concurrency, queueAhead)
      if (user.credits < estimate.credits) {
        throw new AppError(
          402,
          'INSUFFICIENT_CREDITS',
          `一键尝鲜需要 ${estimate.credits} 积分，当前剩余 ${user.credits} 积分`,
        )
      }

      const now = new Date().toISOString()
      const batchId = randomUUID()
      const createdAssets: Asset[] = []
      const tasks: GenerationTask[] = []
      for (const [index, proposal] of proposals.entries()) {
        const asset: Asset = {
          id: randomUUID(),
          projectId,
          tenantId: principal.tenantId,
          kind: proposal.kind,
          sourceMode: 'generate',
          name: proposal.name,
          description: proposal.description,
          prompt: proposal.prompt,
          promptMode: 'standard',
          customPromptMode: 'append',
          customPrompt: '',
          negativePrompt: proposal.negativePrompt,
          references: [],
          attributes: proposal.attributes,
          imageUrl: null,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        }
        const cost = creditsFor(proposal.kind)
        const clientRequestId = `${input.clientRequestId.slice(0, 100)}-${index + 1}`
        const task: GenerationTask = normalizeGenerationTaskLifecycle({
          id: randomUUID(),
          clientRequestId,
          projectId,
          tenantId: principal.tenantId,
          userId: principal.userId,
          kind: 'image',
          label: `${asset.name} · ${asset.kind === 'character' ? '面部大头照' : '尝鲜资产'}`,
          prompt: generationPrompt(asset, project.aspectRatio),
          negativePrompt: asset.negativePrompt,
          provider: 'img2',
          model: 'img2-default',
          metadata: traceMetadata(
            {
              assetId: asset.id,
              assetKind: asset.kind,
              generationStage: asset.kind === 'character' ? 'face' : 'asset',
              aspectRatio: asset.kind === 'character' ? '1:1' : project.aspectRatio,
              sourceMode: 'generate',
              references: [],
              attributes: asset.attributes,
              turnaround: false,
              quickStartBatchId: batchId,
              quickStartRequestId: input.clientRequestId,
            },
            traceId,
          ),
          status: 'queued',
          progress: 0,
          estimatedCredits: cost,
          createdAt: now,
          updatedAt: now,
          resultUrl: null,
          outputs: [],
          error: null,
        })

        if (this.creditLedger) {
          await this.creditLedger.reserveCreditsInState(state, principal, cost, clientRequestId, task.label)
        } else {
          user.credits -= cost
          state.ledger.unshift({
            id: `generation-${clientRequestId}`,
            userId: user.id,
            tenantId: user.tenantId,
            amount: -cost,
            balance: user.credits,
            type: 'generation',
            description: task.label,
            createdAt: now,
          })
        }
        state.assets.push(asset)
        state.tasks.unshift(task)
        createdAssets.push(asset)
        tasks.push(task)
      }
      project.status = 'producing'
      project.updatedAt = now
      return {
        batchId,
        createdAssets,
        tasks,
        skippedAssets,
        estimate,
        replayed: false,
      }
    })

    await Promise.allSettled(
      result.tasks.map((task) =>
        this.dispatcher.dispatch(task, { traceId: traceId ?? traceIdFromGenerationTask(task) }),
      ),
    )
    return result
  }

  private projectContext(projectId: string, principal: Principal) {
    return this.store.read((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权分析')
      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')
      return {
        project,
        user,
        assets: state.assets.filter(
          (asset) => asset.projectId === projectId && asset.tenantId === principal.tenantId,
        ),
        queueAhead: activeQueueCount(state.tasks, principal.userId),
      }
    })
  }

  private async generateAnalysis(
    userPrompt: string,
    sourceScript: string,
    model: ScriptModel,
  ): Promise<ProviderAnalysis> {
    const first = await this.textProvider!.generate({
      systemPrompt: QUICK_START_SYSTEM_PROMPT,
      userPrompt,
      maxOutputTokens: 3_000,
      model,
    })
    try {
      return parseProviderAnalysis(first)
    } catch {
      try {
        const repaired = await this.textProvider!.generate({
          systemPrompt: `${QUICK_START_SYSTEM_PROMPT}\n上一版格式不合格。请修复为完全符合字段和枚举约束的 JSON。`,
          userPrompt: `${userPrompt}\n\n待修复输出：\n${first.slice(0, 12_000)}`,
          maxOutputTokens: 3_000,
          model,
        })
        return parseProviderAnalysis(repaired)
      } catch {
        return fallbackProviderAnalysis(sourceScript)
      }
    }
  }
}

function fallbackProviderAnalysis(script: string): ProviderAnalysis {
  const characters = extractFieldValues(script, '角色', ['主角']).slice(0, 2)
  const scenes = extractFieldValues(script, '场景', ['核心场景']).slice(0, 2)
  const costumes = extractFieldValues(script, '服装', ['主角核心服装']).slice(0, 1)
  return {
    summary: 'AI 返回格式异常，系统已根据剧本中的角色、场景和服装字段生成最小资产计划，可直接继续尝鲜。',
    visualStyle: 'cinematic-cg',
    characters: characters.map((name) => ({
      name,
      description: `剧本中反复出现的主要角色：${name}`,
      prompt: `中文漫剧电影级 CG 角色，${name}，面部清晰，造型统一，适合生成角色面部大头照`,
      subjectType: 'human',
      gender: 'unspecified',
      ageGroup: 'young',
      species: '',
      anthropomorphic: false,
      bodyType: 'balanced',
    })),
    costumes: costumes.map((name) => ({
      name,
      description: `从剧本提取的核心服装：${name}`,
      prompt: `中文漫剧电影级 CG 服装平铺展示，${name}，完整轮廓，材质细节清楚，不出现人物和脸部`,
      audience: 'unisex',
      category: 'daily',
      season: 'all-season',
      design: 'minimal',
    })),
    scenes: scenes.map((name) => ({
      name,
      description: `从剧本提取的高复用核心场景：${name}`,
      prompt: `中文漫剧电影级 CG 空场景，${name}，不出现人物，预留表演空间，空间层次清楚`,
      space: 'exterior',
      sceneType: 'street',
      era: 'modern',
      time: 'day',
      weather: 'clear',
      mood: 'warm',
      camera: 'wide',
    })),
  }
}

function extractFieldValues(script: string, field: string, fallback: string[]): string[] {
  const values = [...script.matchAll(new RegExp(`${field}[：:]([^\\n|｜]+)`, 'g'))]
    .flatMap((match) => match[1]!.split(/[、,，;；和]/))
    .map((value) => value.replace(/[。.!！?？：:]$/u, '').trim())
    .filter((value) => value.length > 0 && value.length <= 80)
  const uniqueValues = [...new Set(values)]
  return uniqueValues.length ? uniqueValues : fallback
}

function proposalsFor(analysis: ProviderAnalysis): QuickStartAssetProposal[] {
  const visualStyle = analysis.visualStyle
  return [
    ...analysis.characters.map((character): QuickStartAssetProposal => ({
      kind: 'character',
      name: character.name.trim(),
      description: character.description.trim(),
      prompt: character.prompt.trim(),
      negativePrompt: '',
      attributes: {
        type: 'character',
        subjectType: character.subjectType,
        gender: character.gender,
        ageGroup: character.ageGroup,
        exactAge: null,
        ethnicity: 'unspecified',
        skinTone: 'unspecified',
        eyeColor: 'unspecified',
        hairColor: 'unspecified',
        species: character.subjectType === 'animal' ? character.species : '',
        anthropomorphic: character.subjectType === 'animal' && character.anthropomorphic,
        visualStyle,
        framing: 'portrait',
        bodyType: character.bodyType,
        background: 'solid',
        faceStatus: 'pending',
        bodyStatus: 'pending',
        faceReference: null,
        bodyReference: null,
        portraitSource: 'ai-virtual',
        trustedPortrait: null,
        legStretch: false,
        turnaround: false,
        turnaroundLayout: 'sheet',
        appearanceVariants: [],
        activeAppearanceVariantId: null,
      },
    })),
    ...analysis.costumes.map((costume): QuickStartAssetProposal => ({
      kind: 'costume',
      name: costume.name.trim(),
      description: costume.description.trim(),
      prompt: costume.prompt.trim(),
      negativePrompt: '',
      attributes: {
        type: 'costume',
        audience: costume.audience,
        category: costume.category,
        season: costume.season,
        design: costume.design,
        presentation: 'flat',
        visualStyle,
        turnaround: false,
      },
    })),
    ...analysis.scenes.map((scene): QuickStartAssetProposal => ({
      kind: 'scene',
      name: scene.name.trim(),
      description: scene.description.trim(),
      prompt: scene.prompt.trim(),
      negativePrompt: '',
      attributes: {
        type: 'scene',
        space: scene.space,
        sceneType: scene.sceneType,
        era: scene.era,
        time: scene.time,
        weather: scene.weather,
        mood: scene.mood,
        camera: scene.camera,
        visualStyle,
        emptyScene: true,
        activitySpace: true,
      },
    })),
  ]
}

function estimateFor(
  proposals: QuickStartAssetProposal[],
  concurrency: number,
  queueAhead: number,
): QuickStartEstimate {
  const taskCount = proposals.length
  const waves = taskCount ? Math.ceil((queueAhead + taskCount) / concurrency) : 0
  return {
    assetCount: proposals.length,
    taskCount,
    credits: proposals.reduce((total, proposal) => total + creditsFor(proposal.kind), 0),
    concurrency,
    queueAhead,
    minSeconds: waves * 45,
    maxSeconds: waves * 180,
  }
}

function estimateForTasks(
  tasks: GenerationTask[],
  concurrency: number,
  queueAhead: number,
): QuickStartEstimate {
  const waves = tasks.length ? Math.ceil((queueAhead + tasks.length) / concurrency) : 0
  return {
    assetCount: tasks.length,
    taskCount: tasks.length,
    credits: tasks.reduce((total, task) => total + task.estimatedCredits, 0),
    concurrency,
    queueAhead,
    minSeconds: waves * 45,
    maxSeconds: waves * 180,
  }
}

function activeQueueCount(
  tasks: readonly GenerationTask[],
  userId: string,
  excluded: readonly GenerationTask[] = [],
): number {
  const excludedIds = new Set(excluded.map((task) => task.id))
  return tasks.filter(
    (task) =>
      task.userId === userId &&
      !excludedIds.has(task.id) &&
      (task.status === 'queued' || task.status === 'running') &&
      typeof task.metadata.queueHiddenAt !== 'string',
  ).length
}

function creditsFor(kind: QuickStartAssetProposal['kind']): number {
  return kind === 'character' ? 4 : 6
}

function generationPrompt(asset: Asset, aspectRatio: string): string {
  if (asset.kind === 'character') {
    return `${asset.prompt}，人物面部大头照，正面平视，头部和肩部完整入镜，中性表情，纯色背景，五官清晰，画面比例1:1`
  }
  if (asset.kind === 'costume') {
    return `${asset.prompt}，服装平铺展示，完整轮廓和材质细节，纯净背景，不出现人物和脸部，画面比例${aspectRatio}`
  }
  return `${asset.prompt}，空场景，不出现人物，空间层次清楚，预留角色表演和运镜空间，画面比例${aspectRatio}`
}

function deduplicateProposals(
  proposals: QuickStartAssetProposal[],
  existingAssets: readonly Pick<Asset, 'kind' | 'name'>[],
): QuickStartAssetProposal[] {
  const seen = new Set(existingAssets.map(assetKey))
  const result: QuickStartAssetProposal[] = []
  for (const proposal of proposals) {
    const key = assetKey(proposal)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(proposal)
  }
  return result
}

function assetKey(asset: Pick<Asset, 'kind' | 'name'>): string {
  return `${asset.kind}:${asset.name.trim().toLocaleLowerCase('zh-CN')}`
}

function scriptHash(script: string): string {
  return createHash('sha256').update(script.trim(), 'utf8').digest('hex')
}

function boundedScript(script: string): string {
  if (script.length <= 30_000) return script
  return `${script.slice(0, 20_000)}\n\n[中间内容已压缩]\n\n${script.slice(-10_000)}`
}

function parseProviderAnalysis(raw: string): ProviderAnalysis {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Missing JSON object')
  return providerAnalysisSchema.parse(JSON.parse(text.slice(start, end + 1)))
}
