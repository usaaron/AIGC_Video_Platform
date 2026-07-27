import type {
  Asset,
  AutoSplitShotsRequest,
  CreateAsset,
  CreateProject,
  CreateShot,
  GenerateScriptRequest,
  GenerateShotsRequest,
  Principal,
  ScriptCreativeDirection,
  ScriptAssetSuggestion,
  ScriptModel,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import {
  DEFAULT_SCRIPT_MODEL,
  FORCE_EPISODE_BREAK_MARKER,
  FORCE_SHOT_BREAK_MARKER,
  SCRIPT_OPERATION_CREDITS,
  scriptAssetSuggestionsContentSchema,
  scriptReviewContentSchema,
} from '@seqora/contracts'
import { z } from 'zod'
import { AppError } from '../../core/errors.js'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { ProjectRepository } from './repository.js'

type ScriptBillingMode = 'direct' | 'prepaid'

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly textProvider: TextGenerationProvider | null = null,
    private readonly creditLedger: CreditLedger | null = null,
  ) {}

  list(principal: Principal) {
    return this.repository.list(principal)
  }

  workspace(projectId: string, principal: Principal) {
    const workspace = this.repository.workspace(projectId, principal)
    if (!workspace) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问')
    return workspace
  }

  create(input: CreateProject, principal: Principal) {
    return this.repository.create(input, principal)
  }

  async update(projectId: string, input: UpdateProject, principal: Principal) {
    const project = await this.repository.update(projectId, input, principal)
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return project
  }

  async archive(projectId: string, principal: Principal) {
    if (!(await this.repository.archive(projectId, principal))) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权删除')
    }
  }

  async saveVersion(projectId: string, principal: Principal) {
    const project = await this.repository.saveVersion(projectId, principal)
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return project
  }

  async suggestScriptAssets(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    principal: Principal,
  ) {
    const workspace = this.workspace(projectId, principal)
    const source = script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本内容')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n创作方向（必须落地）：${directionSummary(direction)}\n已有资产：${assetSummary(workspace.assets)}`
    let warnings: string[] = []
    let result: { summary: string; assets: ScriptAssetSuggestion[] }

    if (!this.textProvider) {
      warnings = ['文本服务未配置，已根据剧本文本做基础资产建议']
      result = fallbackAssetSuggestions(source, direction)
    } else {
      try {
        const response = await this.textProvider.generate({
          systemPrompt: SCRIPT_ASSET_SUGGESTIONS_SYSTEM_PROMPT,
          userPrompt: `${projectContext}\n\n剧本：\n${headExcerpt(source, 30_000)}`,
          maxOutputTokens: SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS,
        })
        result = parseProviderJson(response, scriptAssetSuggestionsContentSchema, '资产建议结果格式错误')
      } catch {
        warnings = ['文本服务返回格式异常，已根据剧本文本做基础资产建议']
        result = fallbackAssetSuggestions(source, direction)
      }
    }

    return {
      summary: result.summary,
      assets: deduplicateAssetSuggestions(result.assets, workspace.assets).slice(0, 16),
      generatedAt: new Date().toISOString(),
      warnings,
    }
  }

  async generateScript(
    projectId: string,
    draft: string,
    direction: ScriptCreativeDirection,
    mode: GenerateScriptRequest['mode'],
    segment: GenerateScriptRequest['segment'],
    productionMode: GenerateScriptRequest['productionMode'],
    episodeMinutes: GenerateScriptRequest['episodeMinutes'],
    clientRequestId: string,
    principal: Principal,
    model: ScriptModel = DEFAULT_SCRIPT_MODEL,
    revisionNote = '',
    billingMode: ScriptBillingMode = 'direct',
  ) {
    const workspace = this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source =
      draft.trim() ||
      workspace.project.synopsis.trim() ||
      `用户尚未提供完整剧本正文。请根据项目《${workspace.project.name}》和已有资产构思一个可制作的故事。`
    const sourceLength = contentLength(source)

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n项目简介：${workspace.project.synopsis.trim() || '未填写'}\n画面比例：${workspace.project.aspectRatio}\n制作模式：${productionMode === 'web-series' ? `网剧模式，每集约 ${episodeMinutes} 分钟` : '短视频模式'}\n当前选择模型：${model}\n创作方向（兼容已有设置）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}\n本次改写要求：${revisionNote.trim() || '无，按默认制作规范处理'}`
    if (mode === 'quick' && sourceLength >= SINGLE_REWRITE_MAX_LENGTH) {
      const updated = await this.repository.update(projectId, { script: source }, principal)
      if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
      return {
        script: updated.script,
        mode: 'quick' as const,
        warnings: ['检测到超过 1 万字的长篇内容，已保护原稿；请使用“生成下一段”按段续写或进入小说模块。'],
      }
    }
    const generationInstruction =
      sourceLength < SCRIPT_INITIAL_EXPANSION_THRESHOLD
        ? `当前内容仅 ${sourceLength} 字。请根据用户想法、项目简介和已有资产，生成约 1500 字的可制作剧本；如果原始内容是系统提示语，也要把它转化为具体剧情，不要原样复述。`
        : `当前内容约 ${sourceLength} 字。请在保留核心剧情、人物关系、场景因果、关键物件和对白信息的前提下，按原有逻辑重写整理为制作级剧本；不要把内容压缩成提纲，不要任意删减重要情节。`
    const generationSystemPrompt =
      sourceLength < SCRIPT_INITIAL_EXPANSION_THRESHOLD
        ? productionMode === 'web-series'
          ? WEB_SERIES_SCRIPT_SYSTEM_PROMPT
          : QUICK_SCRIPT_SYSTEM_PROMPT
        : productionMode === 'web-series'
          ? WEB_SERIES_REWRITE_SYSTEM_PROMPT
          : SCRIPT_REWRITE_SYSTEM_PROMPT
    return this.runBillableScriptOperation(
      principal,
      `script-generate-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.generate,
      mode === 'segment' ? '生成长剧分段' : '快速生成剧本',
      async () => {
        if (mode === 'segment') {
          const segmentText = normalizeExpandedScript(
            await this.textProvider!.generate({
              systemPrompt:
                productionMode === 'web-series'
                  ? WEB_SERIES_SEGMENT_SYSTEM_PROMPT
                  : SCRIPT_SEGMENT_SYSTEM_PROMPT,
              userPrompt: `${projectContext}\n\n已有剧本或故事上下文：\n${scriptSegmentContext(source)}\n\n本段目标：${segment.goal || '顺着现有剧情自然推进下一段'}\n本段预计时长：约 ${segment.targetMinutes} 分钟\n\n请只生成下一段剧本正文，不要重写已有内容。`,
              maxOutputTokens: segmentMaxOutputTokens(segment.targetMinutes),
              model,
            }),
          )
          if (!segmentText) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', '分段剧本为空')
          const script = appendScriptSegment(draft.trim() || workspace.project.script.trim(), segmentText)
          const updated = await this.repository.update(projectId, { script }, principal)
          if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
          return {
            script: updated.script,
            segment: segmentText,
            mode: 'segment' as const,
            warnings: segmentScriptIssues(segmentText),
          }
        }
        const candidate = normalizeExpandedScript(
          await this.textProvider!.generate({
            systemPrompt: generationSystemPrompt,
            userPrompt:
              productionMode === 'web-series'
                ? `${projectContext}\n\n${generationInstruction}\n请把以下素材改编成一集可制作的网剧剧本：\n${source}`
                : `${projectContext}\n\n${generationInstruction}\n请把以下素材改编成可直接进入分镜的快速剧本：\n${source}`,
            maxOutputTokens:
              productionMode === 'web-series'
                ? webSeriesMaxOutputTokens(episodeMinutes)
                : sourceLength < SCRIPT_INITIAL_EXPANSION_THRESHOLD
                  ? INITIAL_SCRIPT_MAX_TOKENS
                  : longScriptMaxOutputTokens(source),
            model,
          }),
        )
        const script = candidate
        const warnings = quickScriptIssues(script, productionMode)
        const updated = await this.repository.update(projectId, { script }, principal)
        if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
        return { script: updated.script, mode: 'quick' as const, warnings }
      },
      billingMode,
    )
  }

  async enrichScript(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    productionMode: GenerateScriptRequest['productionMode'],
    episodeMinutes: GenerateScriptRequest['episodeMinutes'],
    clientRequestId: string,
    principal: Principal,
    model: ScriptModel = DEFAULT_SCRIPT_MODEL,
    revisionNote = '',
    billingMode: ScriptBillingMode = 'direct',
  ) {
    const workspace = this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source = script.trim() || workspace.project.script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先生成或填写快速剧本')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n项目简介：${workspace.project.synopsis.trim() || '未填写'}\n画面比例：${workspace.project.aspectRatio}\n制作模式：${productionMode === 'web-series' ? `网剧模式，每集约 ${episodeMinutes} 分钟` : '短视频模式'}\n当前选择模型：${model}\n创作方向（兼容已有设置）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}\n本次改写要求：${revisionNote.trim() || '无，按默认制作规范处理'}`
    return this.runBillableScriptOperation(
      principal,
      `script-enrich-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.enrich,
      '补齐剧本专业视觉细节',
      async () => {
        const candidate = normalizeExpandedScript(
          await this.textProvider!.generate({
            systemPrompt:
              productionMode === 'web-series' ? WEB_SERIES_DETAIL_SYSTEM_PROMPT : SCRIPT_DETAIL_SYSTEM_PROMPT,
            userPrompt: `${projectContext}\n\n请在保留原有场景数量、剧情因果、人物关系和对白的前提下，补齐以下剧本的制作字段与镜头衔接；本次改写要求必须优先执行：\n${source}`,
            maxOutputTokens: isProtectedLongScript(source)
              ? longScriptMaxOutputTokens(source)
              : SCRIPT_DETAIL_MAX_TOKENS,
            model,
          }),
        )
        const candidateWithBreaks = preserveScriptBreakMarkers(source, candidate)
        const sceneAlignedCandidate = alignEnrichedSceneRows(source, candidateWithBreaks)
        const preserved = isProtectedLongScript(source) && candidateIsTooShort(source, sceneAlignedCandidate)
        const enriched = preserved ? source : sceneAlignedCandidate
        const warnings = preserved
          ? ['检测到长篇原稿，AI 输出过短，系统已自动保留原稿，避免剧情被压缩。']
          : detailedScriptIssues(enriched, productionMode)
        const updated = await this.repository.update(projectId, { script: enriched }, principal)
        if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
        return { script: updated.script, mode: 'detailed' as const, warnings }
      },
      billingMode,
    )
  }

  async reviewScript(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    clientRequestId: string,
    principal: Principal,
    model: ScriptModel = DEFAULT_SCRIPT_MODEL,
  ) {
    const workspace = this.workspace(projectId, principal)
    if (this.repository.planFor(principal) !== 'member') {
      throw new AppError(403, 'MEMBERSHIP_REQUIRED', '专业剧本审核仅对创作会员开放')
    }
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source = script.trim() || workspace.project.script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本后再进行专业审核')

    return this.runBillableScriptOperation(
      principal,
      `script-review-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.review,
      '专业审核剧本',
      async () => {
        const response = await this.textProvider!.generate({
          systemPrompt:
            '你是漫剧公司的编导总监、摄影指导和剪辑指导。请只返回严格 JSON，不要 Markdown，不要代码块。必须包含 score（0到100整数）、verdict、dimensions、priorityActions。dimensions 必须覆盖 plot、character、dialogue、style、composition、lighting、camera，每项包含 key、score、finding、suggestion。评价要具体到可执行的剧本修改和画面执行，不要泛泛而谈。',
          userPrompt: `项目：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n当前选择模型：${model}\n创作方向：${directionSummary(direction)}\n\n待审核剧本：\n${source}`,
          maxOutputTokens: 4_000,
          model,
        })
        const review = parseProviderJson(response, scriptReviewContentSchema, '专业审核结果格式错误')
        return { ...review, generatedAt: new Date().toISOString() }
      },
    )
  }

  private async runBillableScriptOperation<T>(
    principal: Principal,
    referenceId: string,
    credits: number,
    description: string,
    operation: () => Promise<T>,
    billingMode: ScriptBillingMode = 'direct',
  ): Promise<T> {
    if (!this.creditLedger || billingMode === 'prepaid') return operation()
    const reserved = await this.creditLedger.reserve(principal, credits, referenceId, description)
    if (!reserved) {
      throw new AppError(409, 'DUPLICATE_REQUEST', '该请求已处理，请勿重复提交')
    }
    try {
      return await operation()
    } catch (error) {
      await this.creditLedger.refundReservation(principal, referenceId, `${description} · 失败退款`)
      throw error
    }
  }

  async createAsset(projectId: string, input: CreateAsset, principal: Principal) {
    const asset = await this.repository.createAsset(projectId, input, principal)
    if (!asset) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return asset
  }

  async updateAsset(projectId: string, assetId: string, input: UpdateAsset, principal: Principal) {
    const asset = await this.repository.updateAsset(projectId, assetId, input, principal)
    if (!asset) throw new AppError(404, 'ASSET_NOT_FOUND', '资产不存在或无权修改')
    return asset
  }

  async deleteAsset(projectId: string, assetId: string, principal: Principal) {
    if (!(await this.repository.deleteAsset(projectId, assetId, principal))) {
      throw new AppError(404, 'ASSET_NOT_FOUND', '资产不存在或无权删除')
    }
  }

  async createShot(projectId: string, input: CreateShot, principal: Principal) {
    const shot = await this.repository.createShot(projectId, input, principal)
    if (!shot) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return shot
  }

  async updateShot(projectId: string, shotId: string, input: UpdateShot, principal: Principal) {
    const shot = await this.repository.updateShot(projectId, shotId, input, principal)
    if (!shot) throw new AppError(404, 'SHOT_NOT_FOUND', '分镜不存在或无权修改')
    return shot
  }

  async generateShots(projectId: string, input: GenerateShotsRequest, principal: Principal) {
    const workspace = this.workspace(projectId, principal)
    const source = workspace.project.script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本')

    const paragraphs = splitScriptParagraphs(source)
    const shots =
      input.mode === 'beat'
        ? splitScriptIntoBeatShots(paragraphs, input.maxShots)
        : splitScriptIntoSceneShots(paragraphs, input.maxShots)
    return this.repository.replaceShots(
      projectId,
      assignShotEpisodes(shots, input.episodeDurationSeconds),
      principal,
    )
  }

  async autoSplitShotEpisodes(projectId: string, input: AutoSplitShotsRequest, principal: Principal) {
    const workspace = this.workspace(projectId, principal)
    const assigned = assignShotEpisodes(workspace.shots, input.episodeDurationSeconds)
    const updated = await this.repository.updateShotEpisodes(
      projectId,
      assigned.map(({ id, episodeNumber, episodeTitle, episodeKind }) => ({
        id,
        episodeNumber,
        episodeTitle,
        episodeKind,
      })),
      principal,
    )
    if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return updated
  }
}

export function assignShotEpisodes<
  T extends {
    duration: number
    episodeKind?: 'standard' | 'hook'
    episodeBreakBefore?: boolean
  },
>(
  shots: T[],
  targetDurationSeconds: GenerateShotsRequest['episodeDurationSeconds'],
): Array<
  T & {
    episodeNumber: number
    episodeTitle: string
    episodeKind: 'standard' | 'hook'
  }
> {
  let episodeNumber = 1
  let episodeDuration = 0
  let breakAfterHook = false

  return shots.map((input) => {
    const isHook = input.episodeKind === 'hook'
    const startsNewEpisode = (input.episodeBreakBefore || breakAfterHook) && episodeDuration > 0
    const exceedsDuration =
      !isHook && episodeDuration > 0 && episodeDuration + input.duration > targetDurationSeconds

    if (startsNewEpisode || exceedsDuration) {
      episodeNumber += 1
      episodeDuration = 0
    }

    episodeDuration += input.duration
    breakAfterHook = isHook

    return {
      ...input,
      episodeNumber,
      episodeTitle: `第 ${episodeNumber} 集`,
      episodeKind: isHook ? ('hook' as const) : ('standard' as const),
    }
  })
}

const SCRIPT_ASSET_SUGGESTIONS_SYSTEM_PROMPT = `你是中文 AI 视频项目的资产制片和美术统筹，负责从剧本中提取后续生成必须保持一致的核心资产。
硬性规格：
1. 只返回严格 JSON，不要 Markdown，不要代码块，不要解释。
2. 顶层对象必须包含 summary、assets。
3. assets 只允许包含 character、scene、prop、costume 四类，不要包含 audio。
4. 每个资产必须包含 kind、name、description、prompt、negativePrompt、reason、priority、attributes。
5. priority 是 1 到 5 的整数，5 表示最高优先级。
6. 角色只保留推动主线或多次出现的人物，建议 1 到 4 个；场景只保留复用率高或制作成本高的地点，建议 1 到 4 个；道具只保留重要且会多次出现或承载剧情转折的物件，建议 1 到 5 个；服装只保留角色一致性需要的核心服装，建议 1 到 4 个。
7. 不要把一次性群众、背景摆件、普通环境装饰列成资产；不要重复已有资产。
8. prompt 必须是可直接进入资产生成的中文视觉描述；场景 prompt 必须是空场景并预留表演空间；服装 prompt 只描述服装本身，不写脸；道具 prompt 只描述物件本身。
9. 所有 attributes 必须严格使用下列枚举：
character.subjectType human/animal；gender male/female/unspecified；ageGroup child/teen/young/middle/senior；visualStyle photorealistic/cinematic-cg/chinese-3d/chinese-2d/anime/storybook；framing portrait/half/full；bodyType slim/balanced/athletic/full；background solid/transparent/environment；faceStatus pending；bodyStatus pending；portraitSource ai-virtual；turnaroundLayout sheet/separate。
scene.space interior/exterior；sceneType city/street/residential/commercial/nature/ancient/industrial/fantasy；era ancient/recent/modern/future；time dawn/day/sunset/night；weather clear/cloudy/rain/snow/fog；mood warm/tense/mystery/romantic/epic/desolate；camera eye-level/overhead/low-angle/aerial/wide。
prop.category weapon/vehicle/furniture/electronics/jewelry/food/daily/other；material wood/metal/glass/fabric/leather/ceramic/mixed；condition new/used/aged/damaged；view front/side/turnaround；background solid/transparent/environment。
costume.audience male/female/unisex；category daily/formal/professional/uniform/ancient/ceremonial/fantasy/armor；season spring-summer/autumn-winter/all-season；design minimal/luxury/retro/future/chinese；presentation flat/model/worn。
返回示例：
{"summary":"建议先建立主角、核心场景、关键道具和主服装，保障后续分镜一致性。","assets":[{"kind":"character","name":"女剑客","description":"贯穿主线的退隐女剑客。","prompt":"退隐女剑客，清晰五官，古风武侠，全身造型统一。","negativePrompt":"","reason":"主角多次出现，需要保持身份和面部一致。","priority":5,"attributes":{"type":"character","subjectType":"human","gender":"female","ageGroup":"young","exactAge":null,"species":"","anthropomorphic":false,"visualStyle":"cinematic-cg","framing":"full","bodyType":"balanced","background":"solid","faceStatus":"pending","bodyStatus":"pending","faceReference":null,"bodyReference":null,"portraitSource":"ai-virtual","trustedPortrait":null,"legStretch":false,"turnaround":false,"turnaroundLayout":"sheet"}}]}`

const SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS = 6_000

const SCENE_PRODUCTION_RULES = `每个场次是一条可以直接拆成分镜的制作记录，不要只写镜头语言。
- 每个场次至少包含 2 到 3 个可被摄像机看见的连续动作，动作之间用“；”分开，写清起势、过程和结果。
- 核心人物每 2 到 3 秒必须有一次可见的表情、视线、姿态或情绪状态变化；把变化写进动作或角色字段。
- 除主要角色外，配角和背景角色也必须有符合场景的动作或表情变化；没有配角时写“无配角，环境保持静态”。
- 角色字段写清本场出现的主要角色、配角和背景角色；对白字段没有台词时写“无台词，角色通过表情和动作传达”。
- 不要凭空添加原稿没有的主要角色、关键道具或新空间规则；保持服装、位置、视线、光线和关键物件连续。
- 每一行都必须同时包含剧情、场景、角色、动作、对白、风格、构图、光影、运镜、衔接，场次值使用 S01、S02 这样的稳定编号。`

const QUICK_SCRIPT_SYSTEM_PROMPT = `你是中文漫剧的快速编剧。你的任务不是写长篇小说，而是把用户素材整理成 15 到 30 秒视频可以直接进入分镜的故事骨架。

硬性规格：
1. 输出 4 到 6 个场景，总长度约 1500 个中文字符；内容必须足够支撑后续资产和分镜制作。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
4. 剧情必须有明确目标、阻力、变化和结果；不要写空泛的“氛围感”“电影感”。
5. 动作必须是可以被摄像机看见的连续动作，明确谁在什么位置做什么；不要只写心理活动。
6. 对白要短、口语化并推动冲突；没有对白时写“无台词”，同时写清人物反应。
7. 场景之间必须保持人物、地点、时间、服装和关键物件连续；每一场都要推动主线。
8. 结尾留下一个清晰的悬念、决定或下一步动作，方便后续补齐专业视觉细节。
9. ${SCENE_PRODUCTION_RULES}

只输出 4 到 6 行剧本正文。`

const SCRIPT_REWRITE_SYSTEM_PROMPT = `你是中文漫剧的剧本整理编剧。输入是一份已经包含剧情信息的中文剧本或故事稿，长度在 1500 到 10000 字之间。你的任务是按原有逻辑重写成可直接进入资产设计和分镜的制作稿，而不是另写一个新故事。

硬性规格：
1. 保留原稿的核心剧情、人物关系、场景数量、时间地点、关键物件、对白和因果顺序；不得为了缩短输出而删除重要情节。
2. 场景数量以原稿为准，可以合并明显重复的段落，但不得把完整剧情压缩成提纲；每个场景单独占一行。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；缺失字段要根据原稿上下文补齐，不要凭空新增角色或道具。
4. 剧情写清本场目标、阻力、变化和结果；动作写成摄像机能看见的连续动作；对白短而有信息量。
5. 保留原稿已有的悬念、转折和结尾方向；原稿有“【强制下一集】”时必须独占一行并原样保留。
6. ${SCENE_PRODUCTION_RULES}
7. 只输出重写后的剧本正文，不要标题、解释、Markdown 或分析。`

const WEB_SERIES_SCRIPT_SYSTEM_PROMPT = `你是中文网剧漫剧的主编剧和短视频导演。请把用户素材写成一集可以直接进入分镜制作的网剧剧本，不要写成长篇小说或提纲。

硬性规格：
1. 本集目标时长由用户提供，约 1 到 5 分钟；每个可拆分动作单元适合 4 到 15 秒视频。
2. 输出 8 到 30 个连续场次或动作单元，每行一个场次；每行必须使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
3. 每场都要有可拍摄的目标、阻力、变化和结果，动作明确到人物位置、视线、手部或关键物件状态。
4. 保持人物身份、服装、时间、地点、光线和关键物件连续；不要突然新增人物、道具或空间规则。
5. 前段快速建立冲突，中段持续升级，后段制造明显波动；最后一行的场次值必须写“剧情钩子”，且不直接解决。
6. 钩子可以是秘密即将揭示、主角受辱后即将反击、关键物件即将启动、敌人误判实力或即将进入反转/装逼时刻；必须停在动作或悬念接点。
7. 对白短而有信息量，没有对白时写“无台词”，并写出人物反应。
8. ${SCENE_PRODUCTION_RULES}
9. 只输出剧本正文，不要标题、解释、Markdown 或分析。`

const WEB_SERIES_REWRITE_SYSTEM_PROMPT = `你是中文网剧漫剧的连续剧编剧和分镜前置统筹。输入是一份 1500 到 10000 字的已有剧本，必须在不改变原剧情的前提下重写整理为可制作的网剧剧本。

硬性规格：
1. 保留原稿的场景顺序、人物关系、对白、地点、时间、服装、关键物件和剧情因果；不得压缩成提纲或删除重要情节。
2. 场景数量以原稿为准，每个场景或动作单元单独占一行；每个动作单元适合 4 到 15 秒视频。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；缺失字段根据已有上下文补齐，不要任意新增人物、道具或空间规则。
4. 每场都要有目标、阻力、变化和结果，动作明确到人物位置、视线、手部或关键物件状态，并保持镜头之间的连续性。
5. 结尾保留并强化原稿的高波动钩子；如果原稿存在“【强制下一集】”，必须独占一行并原样保留。
6. ${SCENE_PRODUCTION_RULES}
7. 只输出重写后的剧本正文，不要标题、解释、Markdown 或分析。`

const SCRIPT_DETAIL_SYSTEM_PROMPT = `你是中文漫剧的视觉导演和分镜前置编剧。请把快速剧本补齐为可直接用于资产设计、分镜和视频生成的制作级剧本。

硬性规格：
1. 保留原剧本的场景数量、人物、地点、关键物件、剧情因果和对白，不要另起炉灶，不要扩展成新的长故事。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 在每个场次内完整保留并补齐：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；禁止只返回风格、构图、光影或运镜。
4. 剧情写清本场目标、阻力、转折和结果；动作写清起势、过程、结束姿态以及与环境或物件的互动。
5. 风格必须落实项目选择的视觉类型、材质和色彩；构图必须写景别、主体位置、前中后景和画面重心。
6. 光影必须写主光来源、方向、软硬、色温和明暗关系；运镜必须写机位、运动方式、速度、运动对象和结束画面。
7. 衔接必须说明承接上一场的时间、动作、视线、人物位置或物件状态，并给下一场留下明确动作接点。
8. 所有视觉内容必须服务于原剧情，禁止添加新的角色、道具、回忆、梦境或突然转场；原稿中的“【强制下一集】”必须独占一行并原样保留。
9. ${SCENE_PRODUCTION_RULES}

只输出补齐后的剧本正文。`

const WEB_SERIES_DETAIL_SYSTEM_PROMPT = `你是中文网剧漫剧的视觉导演、分镜导演和连续性统筹。请在不改变原剧情的前提下，把剧本补齐为可制作的网剧分镜前置稿。

硬性规格：
1. 保留原有场次、人物、对白、地点、关键物件和剧情因果，不压缩长稿，不另起新故事。
2. 每个场次完整输出：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；禁止只输出镜头语言字段。每个动作单元适合 4 到 15 秒视频。
3. 风格写明材质、色彩和角色/场景的一致性；构图写景别、主体位置、前中后景和视线方向；光影写光源、方向、色温和明暗关系；运镜写机位、移动方式、速度、运动对象和落点。
4. 衔接必须写清上一镜尾帧如何接入本镜，以及本镜如何把人物位置、动作、视线、服装、物件和光线交给下一镜，避免镜头像独立照片。
5. 最后一个场次保留并强化高波动钩子，不提前揭示结果；原稿中的“【强制下一集】”必须独占一行并原样保留；不要增加拍摄设备、文字、水印或无关人物。
6. ${SCENE_PRODUCTION_RULES}
只输出补齐后的剧本正文。`

const SCRIPT_INITIAL_EXPANSION_THRESHOLD = 1_500
const SINGLE_REWRITE_MAX_LENGTH = 10_000
const INITIAL_SCRIPT_MAX_TOKENS = 3_200
const SCRIPT_DETAIL_MAX_TOKENS = 4_000
const LONG_SCRIPT_MAX_TOKENS = 16_000

function webSeriesMaxOutputTokens(episodeMinutes: number): number {
  return Math.min(16_000, Math.max(4_000, episodeMinutes * 2_200))
}

const SCRIPT_SEGMENT_SYSTEM_PROMPT = `你是中文长剧和漫剧的分段编剧。你的任务是基于已有剧本继续写下一段，而不是一次性生成整部长篇。
硬性规则：
1. 只输出“下一段剧本正文”，不要标题解释、Markdown、JSON 或分析。
2. 不要重写、总结、改写已有剧本；只顺着已有内容继续推进。
3. 输出 2 到 6 个连续场次，每个场次单独一行。
4. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
5. 剧情必须承接上一段的时间、地点、人物状态和关键物件；本段结尾留下清晰的下一步动作或悬念。
6. 不要为了拉长篇幅写空泛氛围；每个场次都要有目标、阻力、变化和结果。
7. 不要在本段一次性解决全剧大结局，除非本段目标明确要求收尾。
8. ${SCENE_PRODUCTION_RULES}`

const WEB_SERIES_SEGMENT_SYSTEM_PROMPT = `你是中文网剧漫剧的连续剧编剧。请基于已有剧本只续写下一集或下一段，严禁重写已有内容。
1. 输出连续、可制作的场次，每个动作单元适合 4 到 15 秒；本段时长约为用户指定分钟数。
2. 承接上一段最后的时间、地点、人物状态、服装、视线、动作和关键物件，前两场要明确接住上一段尾部动作。
3. 每场使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；每场都有目标、阻力、变化和结果。
4. 本段末尾保留高波动钩子：悬念、受辱后反击前一秒、身份/实力即将揭示、关键物件启动或敌人误判；最后一行的场次值写“剧情钩子”，不要直接解决。
5. ${SCENE_PRODUCTION_RULES}
6. 只输出下一段剧本正文，不要标题、解释、Markdown、JSON 或分析。`

const QUICK_SCRIPT_FIELDS = ['场次', '剧情', '场景', '角色', '动作', '对白']
const SCRIPT_SCENE_FIELDS = [
  '场次',
  '剧情',
  '场景',
  '角色',
  '动作',
  '对白',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
]
const SCRIPT_ASSET_FIELD_BOUNDARIES = [
  '场次',
  '剧情',
  '场景',
  '角色',
  '人物',
  '主角',
  '动作',
  '对白',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
  '关键物件',
  '关键道具',
  '物件',
  '道具',
  '服装',
  '衣装',
  '外观',
]
const SCRIPT_ASSET_STOP_WORDS = new Set(SCRIPT_ASSET_FIELD_BOUNDARIES)

const COMPLETE_SCENE_FIELDS = [
  '场次',
  '剧情',
  '场景',
  '角色',
  '动作',
  '对白',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
] as const

function normalizeExpandedScript(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function isProtectedLongScript(script: string): boolean {
  return contentLength(script) >= SINGLE_REWRITE_MAX_LENGTH
}

function candidateIsTooShort(source: string, candidate: string): boolean {
  return contentLength(candidate) < Math.floor(contentLength(source) * 0.85)
}

function longScriptMaxOutputTokens(source: string): number {
  return Math.min(LONG_SCRIPT_MAX_TOKENS, Math.max(6_000, Math.ceil(contentLength(source) * 1.6)))
}

function segmentMaxOutputTokens(targetMinutes: number): number {
  return Math.min(5_500, Math.max(2_400, targetMinutes * 650))
}

function contentLength(value: string): number {
  return value.replace(/\s/g, '').length
}

function scriptSegmentContext(source: string): string {
  if (source.length <= 8_000) return source
  return [
    source.slice(0, 2_500),
    '',
    '[中间已有剧本已省略，生成下一段时不得改写前文]',
    '',
    source.slice(-5_500),
  ].join('\n')
}

function appendScriptSegment(currentScript: string, segment: string): string {
  if (!currentScript.trim()) return segment.trim()
  return `${currentScript.trim()}\n\n${segment.trim()}`
}

function segmentScriptIssues(segment: string): string[] {
  const issues: string[] = []
  const scenes = scriptScenes(segment)
  if (scenes.length < 2 || scenes.length > 6)
    issues.push(`本段生成 ${scenes.length} 个场次，建议保持 2 到 6 个`)
  for (const field of QUICK_SCRIPT_FIELDS) {
    const missing = scenes.filter((scene) => !new RegExp(`${field}[：:]`).test(scene)).length
    if (missing) issues.push(`${missing} 个场次缺少“${field}”字段`)
  }
  if (contentLength(segment) < 500) issues.push('本段内容偏短，可继续生成下一段或补充段落目标')
  return issues
}

function fallbackAssetSuggestions(
  script: string,
  direction: ScriptCreativeDirection,
): { summary: string; assets: ScriptAssetSuggestion[] } {
  const visualStyle = suggestionVisualStyle(direction)
  const characters = extractAssetNames(script, ['角色', '人物', '主角'], ['主角'], 4)
  const scenes = extractAssetNames(script, ['场景', '地点'], ['核心场景'], 4)
  const props = extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 5)
  const costumes = extractAssetNames(script, ['服装', '衣装', '外观'], [], 4)
  const assets: ScriptAssetSuggestion[] = [
    ...characters.map((name): ScriptAssetSuggestion => {
      const subjectType = inferScriptCharacterSubjectType(name)
      const gender = subjectType === 'animal' ? 'unspecified' : inferScriptCharacterGender(name)
      const ageGroup = inferScriptCharacterAge(name)
      const exactAge = inferScriptCharacterExactAge(name, script)
      const identityTags = inferScriptCharacterIdentityTags(name)
      const profile = [
        gender === 'male' ? '男性' : gender === 'female' ? '女性' : '',
        scriptAgeLabel(ageGroup),
        exactAge ? `${exactAge}岁` : '',
        ...identityTags,
      ].filter(Boolean)
      const profileText = profile.length ? profile.join('，') : '中文 AI 视频人物设定'
      return {
        kind: 'character',
        name,
        description: `从剧本中提取的主要角色：${name}${profile.length ? `（${profileText}）` : ''}`,
        prompt: `${name}，${profileText}，中文 AI 视频人物设定，面部清晰，造型统一，符合剧本风格，适合后续保持角色一致性。`,
        negativePrompt: '',
        reason: '角色在剧本中出现，需要先建立可复用的人物资产。',
        priority: 5,
        attributes: {
          type: 'character',
          subjectType,
          gender,
          ageGroup,
          exactAge,
          species: subjectType === 'animal' ? name : '',
          anthropomorphic: subjectType === 'animal',
          visualStyle,
          framing: 'full',
          bodyType: ageGroup === 'senior' ? 'balanced' : 'balanced',
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
        },
      }
    }),
    ...scenes.map((name): ScriptAssetSuggestion => ({
      kind: 'scene',
      name,
      description: `从剧本中提取的核心场景：${name}`,
      prompt: `${name}，空场景，中文 AI 视频美术设定，空间层次清晰，预留人物表演和运镜空间，不出现人物。`,
      negativePrompt: '',
      reason: '场景会承载多个镜头，需要先统一空间和美术设定。',
      priority: 4,
      attributes: {
        type: 'scene',
        space: inferSceneSpace(name),
        sceneType: inferSceneType(name),
        era: inferEra(name),
        time: inferSceneTime(name),
        weather: inferWeather(script),
        mood: 'mystery',
        camera: 'wide',
        visualStyle,
        emptyScene: true,
        activitySpace: true,
      },
    })),
    ...props.map((name): ScriptAssetSuggestion => ({
      kind: 'prop',
      name,
      description: `从剧本中提取的关键道具：${name}`,
      prompt: `${name}，关键道具单品展示，材质细节清晰，形状稳定，纯色背景，适合后续多镜头复用。`,
      negativePrompt: '',
      reason: '该物件承载剧情信息或多次出现，需要保持外观连续。',
      priority: 4,
      attributes: {
        type: 'prop',
        category: inferPropCategory(name),
        material: inferPropMaterial(name),
        condition: 'used',
        view: 'front',
        background: 'solid',
        visualStyle,
      },
    })),
    ...costumes.map((name): ScriptAssetSuggestion => ({
      kind: 'costume',
      name,
      description: `从剧本中提取的核心服装：${name}`,
      prompt: `${name}，服装平铺展示，完整轮廓，材质和配色清晰，不出现人物脸部，适合保持角色造型一致。`,
      negativePrompt: '',
      reason: '服装影响角色跨镜头一致性，需要作为独立资产确认。',
      priority: 4,
      attributes: {
        type: 'costume',
        audience: 'unisex',
        category: inferCostumeCategory(name),
        season: inferCostumeSeason(name),
        design: inferCostumeDesign(name),
        presentation: 'flat',
        visualStyle,
        turnaround: false,
      },
    })),
  ]
  return {
    summary: '已根据剧本文本提取角色、场景、关键道具和核心服装建议，建议先确认高优先级资产。',
    assets,
  }
}

function extractAssetNames(script: string, fields: string[], fallback: string[], limit: number): string[] {
  const values: string[] = []
  const fieldBoundaries = SCRIPT_ASSET_FIELD_BOUNDARIES.map(escapeRegExp).join('|')
  for (const field of fields) {
    const pattern = new RegExp(
      `${escapeRegExp(field)}[：:]([\\s\\S]*?)(?=(?:${fieldBoundaries})[：:]|\\n|\\||｜|$)`,
      'gu',
    )
    for (const match of script.matchAll(pattern)) {
      values.push(...splitAssetNameList(match[1] || ''))
    }
  }
  const uniqueValues = [...new Set(values.map(cleanAssetName).filter(Boolean))].filter(
    (value) => !SCRIPT_ASSET_STOP_WORDS.has(value),
  )
  return (uniqueValues.length ? uniqueValues : fallback).slice(0, limit)
}

function splitAssetNameList(value: string): string[] {
  return value
    .split(/[、，,；;和与]/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function cleanAssetName(value: string): string {
  const cleaned = value
    .replace(/^[\s·\-—]+/u, '')
    .replace(
      /^(?:一位|一名|一个|这位|那位|该|某)?(?:[零〇一二三四五六七八九十百两\d]+岁(?:的)?|年迈的|年老的|老年的|少年的|少女的|年轻的|中年的|儿童的)/u,
      '',
    )
    .split(/[（(。.!！?？]/u)[0]!
    .split(/——|--|：|:/u)[0]!
    .trim()
  if (cleaned.length < 2) return ''
  return cleaned.length > 24 ? cleaned.slice(0, 24) : cleaned
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function inferScriptCharacterSubjectType(text: string): 'human' | 'animal' {
  return /狗|猫|牛|马|羊|猪|鸡|鸭|鹅|鸟|鱼|狼|虎|熊|鹿|猴|犬/u.test(text) ? 'animal' : 'human'
}

function inferScriptCharacterGender(text: string): 'male' | 'female' | 'unspecified' {
  if (/老船夫|船夫|祖父|爷爷|爷|父亲|男人|男性|哥哥|弟弟|少爷|他\b/u.test(text)) return 'male'
  if (/翠翠|孙女|外孙女|女性|少女|姑娘|女孩|母亲|娘|妻|小姐|她\b/u.test(text)) return 'female'
  return 'unspecified'
}

function inferScriptCharacterAge(text: string): 'child' | 'teen' | 'young' | 'middle' | 'senior' {
  if (/老船夫|船夫|年迈|祖父|爷爷|老人|老年|晚年|七十|六十|五十/u.test(text)) return 'senior'
  if (/儿童|孩子|小孩|幼/u.test(text)) return 'child'
  if (/翠翠|少年|少女|十几|十三|十四|十五|十六|十七|十八/u.test(text)) return 'teen'
  if (/中年|三十|四十/u.test(text)) return 'middle'
  return 'young'
}

function inferScriptCharacterExactAge(name: string, script: string): number | null {
  const exactFromContext = exactAgeNearCharacterName(name, script)
  if (exactFromContext) return exactFromContext
  return exactAgeFromText(name)
}

function exactAgeNearCharacterName(name: string, script: string): number | null {
  const escapedName = escapeRegExp(name)
  const ageToken = '[0-9零〇一二三四五六七八九十百两]{1,4}'
  const patterns = [
    new RegExp(`(${ageToken})岁(?:的)?[^\\n|｜。；;，,、]{0,12}${escapedName}`, 'u'),
    new RegExp(`${escapedName}[^\\n|｜。；;，,、]{0,12}(${ageToken})岁`, 'u'),
  ]
  for (const pattern of patterns) {
    const match = script.match(pattern)
    const parsed = match ? parseAgeToken(match[1] || '') : null
    if (parsed) return parsed
  }
  return null
}

function exactAgeFromText(text: string): number | null {
  const digitMatch = text.match(/(\d{1,3})岁/u)
  if (digitMatch) return parseAgeToken(digitMatch[1] || '')
  const chineseMatch = text.match(/([零〇一二三四五六七八九十百两]+)岁/u)
  if (!chineseMatch) return null
  return parseAgeToken(chineseMatch[1] || '')
}

function parseAgeToken(value: string): number | null {
  const parsed = /^\d+$/u.test(value) ? Number(value) : parseChineseAge(value)
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 120 ? parsed : null
}

function parseChineseAge(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return NaN
  const digitMap: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  let total = 0
  let current = 0
  let hasUnit = false
  for (const char of trimmed) {
    if (char === '百') {
      total += (current || 1) * 100
      current = 0
      hasUnit = true
      continue
    }
    if (char === '十') {
      total += (current || 1) * 10
      current = 0
      hasUnit = true
      continue
    }
    const digit = digitMap[char]
    if (digit === undefined) return NaN
    current = digit
  }
  return hasUnit ? total + current : current
}

function inferScriptCharacterIdentityTags(text: string): string[] {
  const tags = [
    /船夫|摆渡|渡船/u.test(text) ? '船夫/摆渡人' : '',
    /翠翠|少女|姑娘|女孩/u.test(text) ? '湘西少女' : '',
    /祖父|爷爷|老人/u.test(text) ? '长辈' : '',
    /黄狗|狗|犬/u.test(text) ? '家犬' : '',
  ].filter(Boolean)
  return [...new Set(tags)]
}

function scriptAgeLabel(ageGroup: 'child' | 'teen' | 'young' | 'middle' | 'senior'): string {
  return {
    child: '儿童',
    teen: '少年/少女',
    young: '青年',
    middle: '中年',
    senior: '老年',
  }[ageGroup]
}

function suggestionVisualStyle(
  direction: ScriptCreativeDirection,
): Exclude<ScriptCreativeDirection['style'], 'auto'> {
  return direction.style === 'auto' ? 'cinematic-cg' : direction.style
}

function inferSceneSpace(name: string): 'interior' | 'exterior' {
  return /室内|屋|房|店|铺|工厂|车厢|房间|大厅|暗房|药铺/u.test(name) ? 'interior' : 'exterior'
}

function inferSceneType(
  name: string,
): 'city' | 'street' | 'residential' | 'commercial' | 'nature' | 'ancient' | 'industrial' | 'fantasy' {
  if (/古|宫|城门|边城|药铺|江湖|门派/u.test(name)) return 'ancient'
  if (/工厂|车间|管线|工业|暗房/u.test(name)) return 'industrial'
  if (/森林|山|河|雪坡|荒野/u.test(name)) return 'nature'
  if (/商店|市场|餐厅|药铺/u.test(name)) return 'commercial'
  if (/街|路|站台|车站/u.test(name)) return 'street'
  if (/住宅|家|卧室/u.test(name)) return 'residential'
  if (/浮空|魔法|神殿/u.test(name)) return 'fantasy'
  return 'city'
}

function inferEra(name: string): 'ancient' | 'recent' | 'modern' | 'future' {
  if (/古|剑|宫|江湖|门派|药铺/u.test(name)) return 'ancient'
  if (/未来|赛博|浮空|企业霓虹|机器人/u.test(name)) return 'future'
  if (/民国|旧式|老式/u.test(name)) return 'recent'
  return 'modern'
}

function inferSceneTime(name: string): 'dawn' | 'day' | 'sunset' | 'night' {
  if (/黎明|清晨|晨/u.test(name)) return 'dawn'
  if (/黄昏|傍晚|日落/u.test(name)) return 'sunset'
  if (/夜|午夜|暗/u.test(name)) return 'night'
  return 'day'
}

function inferWeather(script: string): 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog' {
  if (/雪/u.test(script)) return 'snow'
  if (/雨/u.test(script)) return 'rain'
  if (/雾|霾/u.test(script)) return 'fog'
  if (/阴|云/u.test(script)) return 'cloudy'
  return 'clear'
}

function inferPropCategory(
  name: string,
): 'weapon' | 'vehicle' | 'furniture' | 'electronics' | 'jewelry' | 'food' | 'daily' | 'other' {
  if (/刀|剑|枪|弓|矛|武器/u.test(name)) return 'weapon'
  if (/车|船|机/u.test(name)) return 'vehicle'
  if (/桌|椅|柜|床/u.test(name)) return 'furniture'
  if (/手机|电脑|芯片|相机|胶片|屏/u.test(name)) return 'electronics'
  if (/戒指|项链|玉|首饰/u.test(name)) return 'jewelry'
  if (/饭|茶|酒|食物/u.test(name)) return 'food'
  return 'daily'
}

function inferPropMaterial(
  name: string,
): 'wood' | 'metal' | 'glass' | 'fabric' | 'leather' | 'ceramic' | 'mixed' {
  if (/刀|剑|枪|金属|铁|铜|银/u.test(name)) return 'metal'
  if (/木|桌|椅|柜/u.test(name)) return 'wood'
  if (/玻璃|镜/u.test(name)) return 'glass'
  if (/布|帕|衣/u.test(name)) return 'fabric'
  if (/皮|革/u.test(name)) return 'leather'
  if (/瓷|碗|杯/u.test(name)) return 'ceramic'
  return 'mixed'
}

function inferCostumeCategory(
  name: string,
): 'daily' | 'formal' | 'professional' | 'uniform' | 'ancient' | 'ceremonial' | 'fantasy' | 'armor' {
  if (/战甲|盔甲|护甲/u.test(name)) return 'armor'
  if (/古|剑客|侠|汉服|衣装/u.test(name)) return 'ancient'
  if (/制服|校服|军装/u.test(name)) return 'uniform'
  if (/礼服|婚服/u.test(name)) return 'ceremonial'
  if (/职业|工装/u.test(name)) return 'professional'
  if (/魔法|奇幻/u.test(name)) return 'fantasy'
  return 'daily'
}

function inferCostumeSeason(name: string): 'spring-summer' | 'autumn-winter' | 'all-season' {
  if (/雪|冬|厚|披风|风衣/u.test(name)) return 'autumn-winter'
  if (/夏|薄|短袖/u.test(name)) return 'spring-summer'
  return 'all-season'
}

function inferCostumeDesign(name: string): 'minimal' | 'luxury' | 'retro' | 'future' | 'chinese' {
  if (/古|国风|汉服|剑客|侠/u.test(name)) return 'chinese'
  if (/未来|赛博|机能/u.test(name)) return 'future'
  if (/旧|复古|民国/u.test(name)) return 'retro'
  if (/华丽|礼服|宫廷/u.test(name)) return 'luxury'
  return 'minimal'
}

function deduplicateAssetSuggestions(
  suggestions: ScriptAssetSuggestion[],
  existingAssets: readonly Pick<Asset, 'kind' | 'name'>[],
): ScriptAssetSuggestion[] {
  const seen = new Set(existingAssets.map(assetSuggestionKey))
  const result: ScriptAssetSuggestion[] = []
  for (const suggestion of [...suggestions].sort((left, right) => right.priority - left.priority)) {
    const key = assetSuggestionKey(suggestion)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(suggestion)
  }
  return result
}

function assetSuggestionKey(asset: Pick<Asset, 'kind' | 'name'>): string {
  return `${asset.kind}:${asset.name.trim().toLocaleLowerCase('zh-CN')}`
}

type ScriptParagraph = {
  text: string
  forceEpisodeBreakBefore: boolean
  forceShotBreakBefore?: boolean
}

export function splitScriptParagraphs(script: string): ScriptParagraph[] {
  const lines = script
    .replaceAll(FORCE_EPISODE_BREAK_MARKER, `\n${FORCE_EPISODE_BREAK_MARKER}\n`)
    .replaceAll(FORCE_SHOT_BREAK_MARKER, `\n${FORCE_SHOT_BREAK_MARKER}\n`)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const paragraphs: ScriptParagraph[] = []
  let forceEpisodeBreakBefore = false
  let forceShotBreakBefore = false

  for (const line of lines) {
    if (line === FORCE_EPISODE_BREAK_MARKER) {
      forceEpisodeBreakBefore = true
      continue
    }
    if (line === FORCE_SHOT_BREAK_MARKER) {
      forceShotBreakBefore = true
      continue
    }
    paragraphs.push({
      text: line,
      forceEpisodeBreakBefore,
      ...(forceShotBreakBefore ? { forceShotBreakBefore: true } : {}),
    })
    forceEpisodeBreakBefore = false
    forceShotBreakBefore = false
  }

  return paragraphs
}

function preserveScriptBreakMarkers(source: string, candidate: string): string {
  const sourceParagraphs = splitScriptParagraphs(source)
  const sourceEpisodeBreaks = new Set(
    sourceParagraphs.flatMap((paragraph, index) => (paragraph.forceEpisodeBreakBefore ? [index] : [])),
  )
  const sourceShotBreaks = new Set(
    sourceParagraphs.flatMap((paragraph, index) => (paragraph.forceShotBreakBefore ? [index] : [])),
  )
  if (!sourceEpisodeBreaks.size && !sourceShotBreaks.size) return candidate

  return splitScriptParagraphs(candidate)
    .flatMap((paragraph, index) => [
      ...(sourceEpisodeBreaks.has(index) || paragraph.forceEpisodeBreakBefore
        ? [FORCE_EPISODE_BREAK_MARKER]
        : []),
      ...(sourceShotBreaks.has(index) || paragraph.forceShotBreakBefore ? [FORCE_SHOT_BREAK_MARKER] : []),
      paragraph.text,
    ])
    .join('\n')
}

function alignEnrichedSceneRows(source: string, candidate: string): string {
  const sourceParagraphs = splitScriptParagraphs(source)
  const candidateParagraphs = splitScriptParagraphs(candidate)
  if (!sourceParagraphs.length || !candidateParagraphs.length) return candidate

  const candidateFields = candidateParagraphs.map((paragraph) => parseShotFields(paragraph.text))
  const isComplete = candidateFields.every((fields) =>
    COMPLETE_SCENE_FIELDS.every((field) => Boolean(fields[field])),
  )
  if (isComplete) return candidate

  const sourceFields = sourceParagraphs.map((paragraph) => parseShotFields(paragraph.text))
  const candidateByScene = new Map(
    candidateFields
      .map((fields, index) => [sceneNumberKey(fields.场次, index), fields] as const)
      .filter(([key]) => key),
  )

  return sourceParagraphs
    .map((paragraph, index) => {
      const original = sourceFields[index] || {}
      const generated =
        candidateByScene.get(sceneNumberKey(original.场次, index)) || candidateFields[index] || {}
      const merged = {
        场次: generated.场次 || original.场次 || `S${String(index + 1).padStart(2, '0')}`,
        剧情: generated.剧情 || original.剧情 || '本场继续推进当前冲突，并产生明确变化。',
        场景: generated.场景 || original.场景 || '沿用上一场空间与时间',
        角色: generated.角色 || original.角色 || '沿用上一场角色；无配角，环境保持静态',
        动作:
          generated.动作 ||
          original.动作 ||
          '动作1：角色保持上一场结束姿态并确认目标；动作2：角色根据阻力改变位置或视线；动作3：角色停在下一步行动前。',
        对白: generated.对白 || original.对白 || '无台词，角色通过表情和动作传达变化',
        风格: generated.风格 || original.风格 || '沿用项目视觉风格，角色和场景材质保持统一',
        构图: generated.构图 || original.构图 || '中景，主体位于画面重心，前中后景关系清晰',
        光影: generated.光影 || original.光影 || '沿用上一场光源方向和色温，避免跳变',
        运镜: generated.运镜 || original.运镜 || '稳定跟随动作，结尾停在下一动作的起始位置',
        衔接:
          generated.衔接 ||
          original.衔接 ||
          '承接上一场最后人物位置、视线、动作、服装、物件和光线；本场结尾为下一场留下动作接点',
      }
      const row = COMPLETE_SCENE_FIELDS.map((field) => `${field}：${merged[field]}`).join('｜')
      return [
        paragraph.forceEpisodeBreakBefore ? FORCE_EPISODE_BREAK_MARKER : '',
        paragraph.forceShotBreakBefore ? FORCE_SHOT_BREAK_MARKER : '',
        row,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')
}

function sceneNumberKey(value: string | undefined, index: number): string {
  const text = String(value || '').trim()
  const match = text.match(/(?:S|场次\s*)?(\d+)/iu)
  return match?.[1] ? String(Number(match[1])) : String(index + 1)
}

function scriptScenes(script: string): string[] {
  return splitScriptParagraphs(script).map((paragraph) => paragraph.text)
}

function quickScriptIssues(
  script: string,
  productionMode: GenerateScriptRequest['productionMode'] = 'short-video',
): string[] {
  const issues: string[] = []
  const characterCount = script.replace(/\s/g, '').length
  const scenes = scriptScenes(script)
  const isWebSeries = productionMode === 'web-series'
  const minimumScenes = isWebSeries ? 8 : 4
  const maximumScenes = isWebSeries ? 30 : 6

  if (characterCount < SCRIPT_INITIAL_EXPANSION_THRESHOLD)
    issues.push(`内容仅 ${characterCount} 字，建议补充到 ${SCRIPT_INITIAL_EXPANSION_THRESHOLD} 字左右`)
  if (scenes.length < minimumScenes || scenes.length > maximumScenes)
    issues.push(`当前 ${scenes.length} 个场景，建议保持 ${minimumScenes} 到 ${maximumScenes} 个`)
  for (const field of QUICK_SCRIPT_FIELDS) {
    const missing = scenes.filter((scene) => !new RegExp(`${field}[：:]`).test(scene)).length
    if (missing) issues.push(`${missing} 个场景缺少“${field}”字段`)
  }
  const shortScenes = scenes.filter((scene) => scene.replace(/\s/g, '').length < 90).length
  if (shortScenes) issues.push(`${shortScenes} 个场景内容过短`)
  return issues
}

function detailedScriptIssues(
  script: string,
  productionMode: GenerateScriptRequest['productionMode'] = 'short-video',
): string[] {
  const issues: string[] = []
  const scenes = scriptScenes(script)
  if (productionMode === 'short-video' && (scenes.length < 4 || scenes.length > 6))
    issues.push(`当前 ${scenes.length} 个场景，建议保持与快速剧本一致`)
  for (const field of SCRIPT_SCENE_FIELDS) {
    const missing = scenes.filter((scene) => !new RegExp(`${field}[：:]`).test(scene)).length
    if (missing) issues.push(`${missing} 个场景缺少“${field}”字段`)
  }
  return issues
}

const SHOT_FIELD_NAMES = [
  '场次',
  '剧情',
  '场景',
  '角色',
  '动作',
  '对白',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
] as const

type ShotDraft = Omit<CreateShot, 'episodeNumber' | 'episodeTitle' | 'episodeKind'> & {
  episodeKind?: 'standard' | 'hook'
}

function splitScriptIntoBeatShots(paragraphs: ScriptParagraph[], maxShots: number): ShotDraft[] {
  const shots: ShotDraft[] = []
  for (const [sceneIndex, scriptParagraph] of paragraphs.entries()) {
    const paragraph = scriptParagraph.text
    const fields = parseShotFields(paragraph)
    const beats = splitFieldBeats(fields.动作 || fields.剧情 || paragraph).slice(0, 4)
    const dialogueBeats = splitFieldBeats(fields.对白 || '')
    const sceneNumber = fields.场次 || String(sceneIndex + 1)
    for (const [beatIndex, beat] of beats.entries()) {
      if (shots.length >= maxShots) return shots
      shots.push({
        title: `场次 ${sceneNumber} · 动作 ${beatIndex + 1}`,
        framing: beatFraming(fields.构图, beatIndex, beats.length),
        duration: beat.length > 90 ? 6 : 5,
        prompt: compactShotPrompt(fields, beat, dialogueBeats[beatIndex]),
        negativePrompt: '',
        imageUrl: null,
        episodeBreakBefore: beatIndex === 0 && scriptParagraph.forceEpisodeBreakBefore,
        episodeKind: isHookParagraph(paragraph) && beatIndex === beats.length - 1 ? 'hook' : 'standard',
        continuityMode: shots.length === 0 ? 'independent' : 'continue',
        continuityNote: continuityNoteFor(
          beatIndex > 0 ? beats[beatIndex - 1] || '' : paragraphs[sceneIndex - 1]?.text || '',
          beat,
          beatIndex > 0 ? '上一镜' : '上一场',
        ),
      })
    }
  }
  return shots
}

function splitScriptIntoSceneShots(paragraphs: ScriptParagraph[], maxShots: number): ShotDraft[] {
  return paragraphs.slice(0, maxShots).map((scriptParagraph, index) => {
    const paragraph = scriptParagraph.text
    const fields = parseShotFields(paragraph)
    const structured = Object.keys(fields).length > 1
    return {
      title: `镜头 ${String(index + 1).padStart(2, '0')}`,
      framing: index === 0 ? '大全景' : index % 3 === 0 ? '特写' : '中景',
      duration: Math.min(15, Math.max(4, Math.ceil(paragraph.length / 18))),
      prompt: structured
        ? compactShotPrompt(fields, fields.动作 || fields.剧情 || paragraph, fields.对白)
        : paragraph,
      negativePrompt: '',
      imageUrl: null,
      episodeBreakBefore: scriptParagraph.forceEpisodeBreakBefore,
      episodeKind: isHookParagraph(paragraph) ? ('hook' as const) : ('standard' as const),
      continuityMode: index === 0 ? ('independent' as const) : ('continue' as const),
      continuityNote: continuityNoteFor(paragraphs[index - 1]?.text || '', paragraph, '上一场'),
    }
  })
}

function isHookParagraph(paragraph: string): boolean {
  const fields = parseShotFields(paragraph)
  return /剧情钩子|悬念钩子|结尾钩子/u.test(fields.场次 || '') || /^【?剧情钩子】?/u.test(paragraph)
}

function continuityNoteFor(previous: string, current: string, previousLabel: '上一场' | '上一镜'): string {
  if (!previous.trim()) return ''
  const previousFields = parseShotFields(previous)
  const currentFields = parseShotFields(current)
  const previousSource = [previousFields.动作, previousFields.对白, previousFields.衔接]
    .filter(Boolean)
    .join('；')
  const currentSource = currentFields.动作 || currentFields.剧情 || current
  return [
    `${previousLabel}收束：${tailExcerpt(previousSource || previous, 320)}`,
    `本镜开场：${headExcerpt(currentSource, 180)}`,
    '保持人物位置、动作方向、服装、关键物品和光线状态连续；只承接已发生内容，不重复演上一场。',
  ].join('\n')
}

function tailExcerpt(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : normalized.slice(-limit)
}

function headExcerpt(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : normalized.slice(0, limit)
}

function parseShotFields(paragraph: string): Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>> {
  const fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>> = {}
  for (const segment of paragraph.split('｜')) {
    const match = segment.trim().match(/^([^：:]+)[：:]([\s\S]*)$/)
    const key = match?.[1]?.trim() as (typeof SHOT_FIELD_NAMES)[number] | undefined
    if (key && SHOT_FIELD_NAMES.includes(key)) fields[key] = match?.[2]?.trim() || ''
  }
  return fields
}

function splitFieldBeats(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  const semicolonBeats = text
    .split(/[；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (semicolonBeats.length > 1) return semicolonBeats
  return text
    .split(/(?<=[。！？!?])/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function compactShotPrompt(
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  beat: string,
  dialogue?: string,
): string {
  const action = beat.trim() || fields.动作 || '角色保持当前状态并产生可见变化'
  return [
    fieldPart('场次', fields.场次 || '未编号场次', 24),
    fieldPart('剧情', fields.剧情 || '本场继续推进当前冲突', 180),
    fieldPart('场景', fields.场景 || '沿用上一场空间与时间', 180),
    fieldPart('角色', fields.角色 || '沿用上一场角色；无配角，环境保持静态', 180),
    fieldPart('动作', action, 300),
    fieldPart('对白', dialogue || fields.对白 || '无台词，角色通过表情和动作传达变化', 160),
    fieldPart('风格', fields.风格 || '沿用项目视觉风格，角色与场景材质统一', 140),
    fieldPart('构图', fields.构图 || '中景，主体位于画面重心，前中后景清晰', 160),
    fieldPart('光影', fields.光影 || '沿用上一场光源方向和色温，避免跳变', 140),
    fieldPart('运镜', fields.运镜 || '稳定跟随动作，结尾停在下一动作起点', 160),
    fieldPart('衔接', fields.衔接 || '承接上一场人物位置、视线、动作、服装、物件和光线状态', 160),
  ]
    .filter(Boolean)
    .join('｜')
}

function fieldPart(label: string, value: string | undefined, limit: number): string {
  const text = String(value || '').trim()
  return text ? `${label}：${text.slice(0, limit)}` : ''
}

function beatFraming(composition: string | undefined, beatIndex: number, beatCount: number): string {
  if (beatIndex === 0) {
    return (
      ['大全景', '全景', '广角', '俯拍', '中景', '中近景', '近景', '特写'].find((framing) =>
        composition?.includes(framing),
      ) || '大全景'
    )
  }
  if (beatIndex === beatCount - 1) return '特写'
  return '中景'
}

function assetSummary(assets: Asset[]): string {
  if (!assets.length) return '暂无，请根据原始素材建立一致的人物、场景和道具设定'
  return assets
    .slice(0, 20)
    .map((asset) => `${asset.kind}:${asset.name}${asset.description ? `（${asset.description}）` : ''}`)
    .join('；')
}

const directionLabels: Record<keyof ScriptCreativeDirection, Record<string, string>> = {
  style: {
    auto: '由 AI 根据题材自动选择',
    photorealistic: '仿真人电影感',
    'cinematic-cg': '电影级 CG',
    'chinese-3d': '国漫三维',
    'chinese-2d': '国漫二维',
    anime: '日系动画',
    storybook: '绘本风格',
  },
  composition: {
    auto: '由 AI 根据题材自动选择',
    'rule-of-thirds': '三分法构图',
    centered: '中心构图',
    symmetry: '对称构图',
    'negative-space': '留白构图',
    dynamic: '动态斜线构图',
  },
  lighting: {
    auto: '由 AI 根据题材自动选择',
    'natural-soft': '自然柔光',
    'high-contrast': '高反差硬光',
    'low-key': '低调暗光',
    backlight: '逆光轮廓光',
    neon: '霓虹彩光',
  },
  camera: {
    auto: '由 AI 根据题材自动选择',
    restrained: '克制稳定运镜',
    immersive: '沉浸跟随运镜',
    dynamic: '动态动作运镜',
    documentary: '纪录片手持感',
    suspense: '悬疑压迫运镜',
  },
  focus: {
    balanced: '剧情、人物和对白均衡',
    scene: '优先展开场景与空间',
    character: '优先展开人物动作与情绪',
    dialogue: '优先展开对白与表演反应',
  },
}

function directionSummary(direction: ScriptCreativeDirection): string {
  return [
    `风格：${directionLabels.style[direction.style] || direction.style}`,
    `构图：${directionLabels.composition[direction.composition] || direction.composition}`,
    `光影：${directionLabels.lighting[direction.lighting] || direction.lighting}`,
    `运镜：${directionLabels.camera[direction.camera] || direction.camera}`,
    `扩写重点：${directionLabels.focus[direction.focus] || direction.focus}`,
  ].join('；')
}

function parseProviderJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  errorMessage: string,
  normalize: (value: unknown) => unknown = (value) => value,
): T {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0)
  const start = starts.length ? Math.min(...starts) : -1
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (start < 0 || end < start) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
  try {
    return schema.parse(normalize(JSON.parse(text.slice(start, end + 1))))
  } catch {
    throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
  }
}
