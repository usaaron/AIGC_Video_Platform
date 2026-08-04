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
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'
import { AppError } from '../../core/errors.js'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { ProjectRepository } from './repository.js'

type ScriptBillingMode = 'direct' | 'prepaid'
type ProjectVisualStyle = Exclude<ScriptCreativeDirection['style'], 'auto'>

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly textProvider: TextGenerationProvider | null = null,
    private readonly creditLedger: CreditLedger | null = null,
  ) {}

  list(principal: Principal) {
    return this.repository.list(principal)
  }

  async workspace(projectId: string, principal: Principal) {
    const workspace = await this.repository.workspace(projectId, principal)
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
    model: ScriptModel = DEFAULT_SCRIPT_MODEL,
  ) {
    const workspace = await this.workspace(projectId, principal)
    const source = script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本内容')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n项目视觉风格：${projectVisualStyleLabel(workspace.project.visualStyle)}（后续所有资产必须继承，不要让用户再次选择）\n画面比例：${workspace.project.aspectRatio}\n创作方向（必须落地）：${directionSummary(direction)}\n已有资产：${assetSummary(workspace.assets)}`
    const fallbackResult = fallbackAssetSuggestions(
      source,
      direction,
      workspace.project.visualStyle ?? 'cinematic-cg',
    )
    let warnings: string[] = []
    let result: { summary: string; assets: ScriptAssetSuggestion[] }

    if (!this.textProvider) {
      warnings = ['文本服务未配置，已根据剧本文本做基础资产建议']
      result = fallbackResult
    } else {
      try {
        const response = await this.textProvider.generate({
          systemPrompt: SCRIPT_ASSET_SUGGESTIONS_SYSTEM_PROMPT,
          userPrompt: `${projectContext}\n\n剧本：\n${headExcerpt(source, 30_000)}`,
          maxOutputTokens: SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS,
          responseFormat: 'json',
          model,
        })
        result = parseProviderJson(
          response,
          scriptAssetSuggestionsContentSchema,
          '资产建议结果格式错误',
          normalizeScriptAssetSuggestionPayload,
        )
      } catch (error) {
        warnings = [assetSuggestionWarning(error)]
        result = fallbackResult
      }
    }

    const sourceNames = extractScriptAssetNameIndex(source)
    const normalizedAssets = result.assets.flatMap((suggestion) => {
      const normalized = normalizeScriptAssetSuggestion(
        suggestion,
        sourceNames,
        source,
        workspace.project.visualStyle ?? 'cinematic-cg',
      )
      return normalized ? [normalized] : []
    })
    const normalizedFallbackAssets = fallbackResult.assets.flatMap((suggestion) => {
      const normalized = normalizeScriptAssetSuggestion(
        suggestion,
        sourceNames,
        source,
        workspace.project.visualStyle ?? 'cinematic-cg',
      )
      return normalized ? [normalized] : []
    })
    const representedKinds = new Set(normalizedAssets.map((suggestion) => suggestion.kind))

    return {
      summary: result.summary,
      assets: deduplicateAssetSuggestions(
        [
          ...normalizedAssets,
          ...normalizedFallbackAssets.filter((suggestion) => !representedKinds.has(suggestion.kind)),
        ],
        workspace.assets,
      ).slice(0, 16),
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
    episodeDurationSeconds = episodeMinutes * 60,
  ) {
    const workspace = await this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source =
      draft.trim() ||
      workspace.project.synopsis.trim() ||
      `用户尚未提供完整剧本正文。请根据项目《${workspace.project.name}》和已有资产构思一个可制作的故事。`
    const sourceLength = contentLength(source)
    const episodeSeconds = normalizeEpisodeDurationSeconds(episodeDurationSeconds, episodeMinutes * 60)

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n项目简介：${workspace.project.synopsis.trim() || '未填写'}\n画面比例：${workspace.project.aspectRatio}\n制作模式：${productionMode === 'web-series' ? `网剧模式，每集${formatDuration(episodeSeconds)}` : '短视频模式'}\n当前选择模型：${model}\n创作方向（兼容已有设置）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}\n本次改写要求：${revisionNote.trim() || '无，按默认制作规范处理'}`
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
        ? `当前内容仅 ${sourceLength} 字。请根据用户想法、项目简介和已有资产，生成约 1800 到 2600 字的高信息密度制作剧本；如果原始内容是系统提示语，也要把它转化为具体剧情，不要原样复述。每个场次必须有明确角色、空间、动作拍点、对白类型、视觉执行和上下场衔接。`
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
          const segmentSeconds = segment.targetSeconds ?? segment.targetMinutes * 60
          const segmentText = normalizeExpandedScript(
            await this.textProvider!.generate({
              systemPrompt:
                productionMode === 'web-series'
                  ? WEB_SERIES_SEGMENT_SYSTEM_PROMPT
                  : SCRIPT_SEGMENT_SYSTEM_PROMPT,
              userPrompt: `${projectContext}\n\n已有剧本或故事上下文：\n${scriptSegmentContext(source)}\n\n本段目标：${segment.goal || '顺着现有剧情自然推进下一段'}\n本段预计时长：${formatDuration(segmentSeconds)}\n\n请只生成下一段剧本正文，不要重写已有内容。`,
              maxOutputTokens: segmentMaxOutputTokens(segmentSeconds),
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
                ? webSeriesMaxOutputTokens(episodeSeconds)
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
    episodeDurationSeconds = episodeMinutes * 60,
  ) {
    const workspace = await this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source = script.trim() || workspace.project.script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先生成或填写快速剧本')
    const episodeSeconds = normalizeEpisodeDurationSeconds(episodeDurationSeconds, episodeMinutes * 60)

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n项目简介：${workspace.project.synopsis.trim() || '未填写'}\n画面比例：${workspace.project.aspectRatio}\n制作模式：${productionMode === 'web-series' ? `网剧模式，每集${formatDuration(episodeSeconds)}` : '短视频模式'}\n当前选择模型：${model}\n创作方向（兼容已有设置）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}\n本次改写要求：${revisionNote.trim() || '无，按默认制作规范处理'}`
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
    const workspace = await this.workspace(projectId, principal)
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
    await this.assertShotDurationForProject(projectId, input.duration, principal)
    const shot = await this.repository.createShot(projectId, input, principal)
    if (!shot) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return shot
  }

  async updateShot(projectId: string, shotId: string, input: UpdateShot, principal: Principal) {
    if (input.duration !== undefined) {
      await this.assertShotDurationForProject(projectId, input.duration, principal)
    }
    const shot = await this.repository.updateShot(projectId, shotId, input, principal)
    if (!shot) throw new AppError(404, 'SHOT_NOT_FOUND', '分镜不存在或无权修改')
    return shot
  }

  private async assertShotDurationForProject(projectId: string, duration: number, principal: Principal) {
    const workspace = await this.workspace(projectId, principal)
    if (workspace.project.contentType !== 'short-drama' && duration < 4) {
      throw new AppError(
        400,
        'SHOT_DURATION_INVALID',
        '3 秒分镜仅适用于网剧项目，短视频、广告和动画项目至少为 4 秒',
      )
    }
  }

  async generateShots(projectId: string, input: GenerateShotsRequest, principal: Principal) {
    const workspace = await this.workspace(projectId, principal)
    const source = workspace.project.script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本')

    const paragraphs = splitScriptParagraphs(source)
    const isWebSeries = workspace.project.contentType === 'short-drama'
    const shots =
      input.mode === 'beat'
        ? splitScriptIntoBeatShots(paragraphs, input.maxShots, isWebSeries)
        : splitScriptIntoSceneShots(paragraphs, input.maxShots, isWebSeries)
    return this.repository.replaceShots(
      projectId,
      assignShotEpisodes(shots, input.episodeDurationSeconds),
      principal,
    )
  }

  async autoSplitShotEpisodes(projectId: string, input: AutoSplitShotsRequest, principal: Principal) {
    const workspace = await this.workspace(projectId, principal)
    const assigned = assignShotEpisodes(workspace.shots, input.episodeDurationSeconds)
    const updated = await this.repository.updateShotEpisodes(
      projectId,
      assigned.map(({ id, episodeNumber, episodeTitle, episodeKind, continuityMode }) => ({
        id,
        episodeNumber,
        episodeTitle,
        episodeKind,
        continuityMode,
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
    continuityMode?: 'independent' | 'continue'
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

    const isFirstShotInEpisode = episodeDuration === 0
    episodeDuration += input.duration
    breakAfterHook = isHook

    return {
      ...input,
      episodeNumber,
      episodeTitle: `第 ${episodeNumber} 集`,
      episodeKind: isHook ? ('hook' as const) : ('standard' as const),
      // Episodes are separate production units and never inherit a prior episode's tail frame.
      continuityMode: isFirstShotInEpisode ? ('independent' as const) : (input.continuityMode ?? 'continue'),
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
8. name 只能写稳定、可复用的资产实体名称，长度建议 2 到 16 个中文字符；动作、情绪、时间、天气、对白、镜头描述和完整句子只能写进 description 或 prompt，绝不能写进 name。
9. 人物 name 只能使用剧本中的明确姓名或稳定身份称呼，例如“林川”“青云宗长老”“女剑客”“老船夫”；禁止使用“先神情紧张”“低头缩肩”“随后强装镇定”“站在”“走向”“看向”“等待”“说道”等动作或状态，也不要把一次性群众写成人物资产。
10. 场景 name 只能使用稳定地点，例如“青云宗山门广场”“边城药铺”“旧火车站三号站台”；禁止使用“清晨冷雾未散”“四周站满等待试炼的弟子”“石阶尽头立着测灵石”等时间、天气、人物活动或陈设描述。地点的空间、陈设、氛围和光线写进 description 或 prompt。
11. prompt 必须是可直接进入资产生成的完整中文视觉描述，不能只是几个关键词。人物必须继承用户选择的项目视觉风格，并使用 1:1 面部大头照、头肩完整、正面平视、中性表情、透明 Alpha 背景和均匀平光，不出现手部、文字或饰边；动物不得出现青年、男性、女性等人类年龄和性别词。场景必须是无人空场并预留表演和运镜空间；物品必须是单个物品独立展示；服装只描述服装本身，不写脸和人体。
12. 所有 attributes 必须严格使用下列枚举：
character.subjectType human/animal；gender male/female/unspecified；ageGroup child/teen/young/middle/senior；ethnicity unspecified/east-asian/south-asian/southeast-asian/white/black/latino/middle-eastern/mixed/other；skinTone unspecified/fair/light/medium/tan/deep/dark；eyeColor unspecified/black/dark-brown/brown/hazel/green/blue/gray/amber；hairColor unspecified/black/dark-brown/brown/blonde/red/gray/white/other；visualStyle photorealistic/cinematic-cg/chinese-3d/chinese-2d/anime/storybook；framing portrait/half/full；bodyType slim/balanced/athletic/full；background solid/transparent/environment；faceStatus pending；bodyStatus pending；portraitSource ai-virtual；turnaroundLayout sheet/separate。
scene.space interior/exterior；sceneType city/street/residential/commercial/nature/ancient/industrial/fantasy；era ancient/recent/modern/future；time dawn/day/sunset/night；weather clear/cloudy/rain/snow/fog；mood warm/tense/mystery/romantic/epic/desolate；camera eye-level/overhead/low-angle/aerial/wide。
prop.category weapon/vehicle/furniture/electronics/jewelry/food/daily/other；material wood/metal/glass/fabric/leather/ceramic/mixed；condition new/used/aged/damaged；view front/side/turnaround；background solid/transparent/environment。
costume.audience male/female/unisex；category daily/formal/professional/uniform/ancient/ceremonial/fantasy/armor；season spring-summer/autumn-winter/all-season；design minimal/luxury/retro/future/chinese；presentation flat/model/worn。
返回示例：
{"summary":"建议先建立主角、核心场景、关键物品和主服装，保障后续分镜一致性。","assets":[{"kind":"character","name":"女剑客","description":"贯穿主线的退隐女剑客。","prompt":"人物角色，女性，青年，退隐女剑客，古风武侠，影视 CG 风格，透明背景，Alpha 通道，人物面部大头照，头部和肩部完整入镜，正面平视，自然中性表情，均匀平光，画面比例 1:1。","negativePrompt":"不要手部、文字、水印、边框、投影、环境反射、面部畸形。","reason":"主角多次出现，需要保持身份和面部一致。","priority":5,"attributes":{"type":"character","subjectType":"human","gender":"female","ageGroup":"young","exactAge":null,"ethnicity":"unspecified","skinTone":"unspecified","eyeColor":"unspecified","hairColor":"unspecified","species":"","anthropomorphic":false,"visualStyle":"cinematic-cg","framing":"portrait","bodyType":"balanced","background":"transparent","faceStatus":"pending","bodyStatus":"pending","faceReference":null,"bodyReference":null,"portraitSource":"ai-virtual","trustedPortrait":null,"legStretch":false,"turnaround":false,"turnaroundLayout":"sheet"}}]}`

const SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS = 6_000

const SCENE_PRODUCTION_RULES = `每个场次是一条可以直接交给分镜师和视频模型的制作记录，不要只写镜头语言，也不要用“氛围感”“人物展开”“镜头表现”等空泛占位语。
- 每个场次必须写清“谁想做什么→遇到什么阻力→发生什么可见变化→场尾留下什么结果或悬念”，剧情字段不能只复述故事梗概。
- 场景字段必须同时写稳定地点、时间、天气、空间布局、前中后景、可复用陈设和主光源；关键物件要写名称、所在位置、当前状态和由谁使用。
- 角色字段必须列出所有画面内角色，并为每个人写清主次、画面位置、朝向、视线、服装、当前表情、起始姿态和本镜反应；配角与背景角色不能只作为名单，必须有符合场景的动作或表情变化。
- 动作字段必须拆成 2 到 3 个可被摄像机看见的节拍，用“动作1：…；动作2：…；动作3：…”分开。每个动作节拍只能有一个主动作，写清主角起势、执行、一次表情或视线变化和结束姿态；配角、群演只能做同步反应，禁止在同一节拍塞入第二个串行动作。
- 核心人物每 2 到 3 秒必须有一次可见的表情、视线、姿态或情绪状态变化；配角和背景角色也必须在对应节拍发生至少一次反应，这些变化必须落到动作或角色字段中，不能只写“情绪升级”。
- 对白字段按实际情况明确标记“[对白]角色：内容”“[画外音]内容”“[内心独白]角色：内容”或“[音效]内容”；台词要短但推进冲突，没有台词时也要写至少两种现场声音和人物反应，不能返回空白或“无声”。
- 风格字段写材质、色彩、角色与场景的统一规则；构图字段写景别、主体位置、视线方向、前中后景和画面重心；光影字段写主光方向、软硬、色温、阴影落点；运镜字段写机位、运动方式、速度、跟随对象和结束画面。
- 每个场次都必须额外写清“目标：”“阻力：”“变化：”“入场状态：”“出场状态：”。目标是本场角色要完成的事；阻力是画面中实际发生的阻碍；变化是本场结束后不可逆的新信息、关系或情绪状态；入场状态必须可作为本场第一镜首帧，出场状态必须可作为本场最后一镜尾帧。
- 衔接字段必须同时写上一镜头尾帧如何接入本场，以及本场结尾把哪个人物位置、动作方向、视线、服装、物件状态或光线交给下一镜，禁止让每个镜头像独立照片。
- 不要凭空添加原稿没有的主要角色、关键道具或新空间规则；保持服装、位置、视线、光线和关键物件连续。
- 每一行都必须同时包含场次、剧情、目标、阻力、变化、场景、角色、入场状态、动作、对白、出场状态、风格、构图、光影、运镜、衔接，场次值使用 S01、S02 这样的稳定编号；每个场次尽量保持 320 到 560 个中文字符的信息密度，不能为了凑字数重复形容词。`

const QUICK_SCRIPT_SYSTEM_PROMPT = `你是中文漫剧的快速编剧。你的任务不是写长篇小说，而是把用户素材整理成 15 到 30 秒视频可以直接进入分镜的故事骨架。

硬性规格：
1. 输出 4 到 6 个场景，总长度约 1800 到 2600 个中文字符；每场都要成为可以继续拆成 2 到 3 个动作镜头的完整制作单元，不能用空泛描写凑字数。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
4. 剧情必须有明确目标、阻力、变化和结果；不要写空泛的“氛围感”“电影感”。
5. 动作必须是可以被摄像机看见的连续动作，明确谁在什么位置做什么，并包含至少 2 个动作拍点和一个结束姿态；不要只写心理活动。
6. 对白要短、口语化并推动冲突；按“对白/画外音/内心独白/音效”标记表达方式，没有台词时写“无台词”，同时写清人物反应和现场声音。
7. 场景之间必须保持人物、地点、时间、服装和关键物件连续；每一场都要推动主线。
8. 结尾留下一个清晰的悬念、决定或下一步动作，方便后续补齐专业视觉细节。
9. ${SCENE_PRODUCTION_RULES}

只输出 4 到 6 行剧本正文。`

const SCRIPT_REWRITE_SYSTEM_PROMPT = `你是中文漫剧的剧本整理编剧。输入是一份已经包含剧情信息的中文剧本或故事稿，长度在 1500 到 10000 字之间。你的任务是按原有逻辑重写成可直接进入资产设计和分镜的制作稿，而不是另写一个新故事。

硬性规格：
1. 保留原稿的核心剧情、人物关系、场景数量、时间地点、关键物件、对白和因果顺序；不得为了缩短输出而删除重要情节，也不得把一个场景压成一句话。
2. 场景数量以原稿为准，可以合并明显重复的段落，但不得把完整剧情压缩成提纲；每个场景单独占一行。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；缺失字段要根据原稿上下文补齐，不要凭空新增角色或道具。
4. 剧情写清本场目标、阻力、变化和结果；角色写清画面位置、表情和姿态；动作写成至少 2 个摄像机能看见的连续动作；对白短而有信息量并标记对白类型。
5. 保留原稿已有的悬念、转折和结尾方向；原稿有“【强制下一集】”时必须独占一行并原样保留。
6. ${SCENE_PRODUCTION_RULES}
7. 只输出重写后的剧本正文，不要标题、解释、Markdown 或分析。`

const WEB_SERIES_SCRIPT_SYSTEM_PROMPT = `你是中文网剧漫剧的主编剧和短视频导演。请把用户素材写成一集可以直接进入分镜制作的网剧剧本，不要写成长篇小说或提纲。

硬性规格：
1. 本集目标时长由用户提供，约 1 到 5 分钟；按每个 3 到 4 秒动作镜头倒推数量，60 秒至少写 15 个动作单元，120 秒至少 30 个；只有必要的情绪停留、反应或动作完成镜头可以延长到 15 秒，不要用空镜填充时长。
2. 输出不少于 8 个、并尽量接近目标时长所需数量的连续场次或动作单元，每行一个场次；每行必须使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
3. 每场都要有可拍摄的目标、阻力、变化和结果，动作明确到人物位置、视线、表情、手部或关键物件状态；每个动作单元都要能单独生成一个有起承转收的短视频，并明确主角、配角、背景角色各自做什么。
4. 保持人物身份、服装、时间、地点、光线和关键物件连续；每场都写清场内角色与物件的相对位置，不要突然新增人物、道具或空间规则。
5. 前段快速建立冲突，中段持续升级，后段制造明显波动；最后一行的场次值必须写“剧情钩子”，且不直接解决。
6. 钩子可以是秘密即将揭示、主角受辱后即将反击、关键物件即将启动、敌人误判实力或即将进入反转/装逼时刻；必须停在动作或悬念接点。
7. 对白短而有信息量，没有对白时写“无台词”，并写出人物反应。
8. ${SCENE_PRODUCTION_RULES}
9. 只输出剧本正文，不要标题、解释、Markdown 或分析。`

const WEB_SERIES_REWRITE_SYSTEM_PROMPT = `你是中文网剧漫剧的连续剧编剧和分镜前置统筹。输入是一份 1500 到 10000 字的已有剧本，必须在不改变原剧情的前提下重写整理为可制作的网剧剧本。

硬性规格：
1. 保留原稿的场景顺序、人物关系、对白、地点、时间、服装、关键物件和剧情因果；不得压缩成提纲或删除重要情节，不得把动作和对白合并成一句概括。
2. 场景数量以原稿为准，每个场景或动作单元单独占一行；网剧分镜以 3 到 4 秒快切为主，必要时才延长到 15 秒。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；缺失字段根据已有上下文补齐，不要任意新增人物、道具或空间规则。
4. 每场都要有目标、阻力、变化和结果，动作明确到人物位置、视线、表情、手部或关键物件状态，并保持镜头之间的连续性；缺失信息要从原稿上下文恢复，不要用“沿用上一场”代替具体状态。
5. 结尾保留并强化原稿的高波动钩子；如果原稿存在“【强制下一集】”，必须独占一行并原样保留。
6. ${SCENE_PRODUCTION_RULES}
7. 只输出重写后的剧本正文，不要标题、解释、Markdown 或分析。`

const SCRIPT_DETAIL_SYSTEM_PROMPT = `你是中文漫剧的视觉导演和分镜前置编剧。请把快速剧本补齐为可直接用于资产设计、分镜和视频生成的制作级剧本。

硬性规格：
1. 保留原剧本的场景数量、人物、地点、关键物件、剧情因果和对白，不要另起炉灶，不要扩展成新的长故事；优先补齐能被摄像机执行的信息。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 在每个场次内完整保留并补齐：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；禁止只返回风格、构图、光影或运镜。
4. 剧情写清本场目标、阻力、转折和结果；动作拆成 2 到 3 个可见拍点，写清起势、过程、结束姿态、表情变化以及与环境或物件的互动。
5. 风格必须落实项目选择的视觉类型、材质和色彩；构图必须写景别、主体位置、前中后景和画面重心。
6. 光影必须写主光来源、方向、软硬、色温和明暗关系；运镜必须写机位、运动方式、速度、运动对象和结束画面。
7. 衔接必须说明承接上一场的时间、动作、视线、人物位置或物件状态，并给下一场留下明确动作接点。
8. 所有视觉内容必须服务于原剧情，禁止添加新的角色、道具、回忆、梦境或突然转场；原稿中的“【强制下一集】”必须独占一行并原样保留。
9. ${SCENE_PRODUCTION_RULES}

只输出补齐后的剧本正文。`

const WEB_SERIES_DETAIL_SYSTEM_PROMPT = `你是中文网剧漫剧的视觉导演、分镜导演和连续性统筹。请在不改变原剧情的前提下，把剧本补齐为可制作的网剧分镜前置稿。

硬性规格：
1. 保留原有场次、人物、对白、地点、关键物件和剧情因果，不压缩长稿，不另起新故事；每个动作单元都必须提供足够的角色和空间状态。
2. 每个场次完整输出：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；禁止只输出镜头语言字段。网剧分镜以 3 到 4 秒快切为主，必要时才延长到 15 秒；每行都要写清可见动作和动作终点。
3. 风格写明材质、色彩和角色/场景的一致性；构图写景别、主体位置、前中后景和视线方向；光影写光源、方向、色温和明暗关系；运镜写机位、移动方式、速度、运动对象和落点。
4. 衔接必须写清上一镜尾帧如何接入本镜，以及本镜如何把人物位置、动作、视线、服装、物件和光线交给下一镜，避免镜头像独立照片。
5. 最后一个场次保留并强化高波动钩子，不提前揭示结果；原稿中的“【强制下一集】”必须独占一行并原样保留；不要增加拍摄设备、文字、水印或无关人物。
6. ${SCENE_PRODUCTION_RULES}
只输出补齐后的剧本正文。`

const SCRIPT_INITIAL_EXPANSION_THRESHOLD = 1_500
const SINGLE_REWRITE_MAX_LENGTH = 10_000
const INITIAL_SCRIPT_MAX_TOKENS = 4_800
const SCRIPT_DETAIL_MAX_TOKENS = 4_000
const LONG_SCRIPT_MAX_TOKENS = 16_000

function webSeriesMaxOutputTokens(episodeSeconds: number): number {
  return Math.min(24_000, Math.max(7_000, Math.ceil(episodeSeconds / 60) * 6_500))
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
1. 输出连续、可制作的场次，每个动作单元以 3 到 4 秒快切为主，必要时才延长到 15 秒；本段时长约为用户指定分钟数。
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

function segmentMaxOutputTokens(targetSeconds: number): number {
  return Math.min(5_500, Math.max(2_400, Math.ceil(targetSeconds / 60) * 650))
}

function normalizeEpisodeDurationSeconds(value: number, fallback = 60): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(300, Math.max(30, Math.round(value)))
}

function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(value / 60)
  const remainder = value % 60
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`
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

const HUMAN_PORTRAIT_REQUIREMENTS =
  '影视 CG 风格，透明背景，Alpha 通道，无背景色，无光影效果，无投影，无高光，无环境反射，均匀平光，主体边缘清晰，人物面部大头照，头部和肩部完整入镜，五官清晰可调整，正面平视镜头，自然中性表情，不出现手部、文字和饰边，画面比例 1:1'
const ANIMAL_PORTRAIT_REQUIREMENTS =
  '影视 CG 风格，保留明确物种特征，透明背景，Alpha 通道，无背景色，无光影效果，无投影，无高光，无环境反射，均匀平光，主体边缘清晰，动物面部大头照，头部和肩颈完整入镜，正面平视镜头，自然中性表情，不出现前爪、文字和饰边，画面比例 1:1'
const CHARACTER_ASSET_NEGATIVE_PROMPT =
  '不要真人摄影感、卡通动漫、塑料皮肤、蜡像脸、过度磨皮、玻璃眼、空洞眼神、无瞳孔、斜视、眼睛不对称、面部漂移、五官融化、歪嘴、缺牙、畸形、解剖错误、多余肢体、手部、手指、文字、水印、logo、二维码、边框、背景色、投影、强高光、环境反射、低分辨率、模糊和压缩痕迹'
const ANIMAL_ASSET_NEGATIVE_PROMPT =
  '不要人类面孔、人类皮肤、人类身体、真人摄影感、物种混杂、额外头部、额外耳朵、额外眼睛、额外肢体、前爪入镜、解剖错误、塑料材质、文字、水印、logo、二维码、边框、背景色、投影、强高光、环境反射、低分辨率和模糊'
const SCENE_ASSET_NEGATIVE_PROMPT =
  '不要人物、动物、拥挤道具、悬浮物体、断开物体、穿帮接缝、重复纹理、贴图拉伸、抠像边、漂浮阴影、色温跳变、文字、水印、logo、二维码、UI、边框、低分辨率、像素化、过曝炸白和暗部死黑'
const PROP_ASSET_NEGATIVE_PROMPT =
  '不要人物、手部、多个重复物品、额外零件、悬浮部件、断裂、变形、比例错误、材质塑料感、复杂场景、文字、水印、logo、二维码、边框、投影、强反射、低分辨率和模糊'
const COSTUME_ASSET_NEGATIVE_PROMPT =
  '不要人物、模特、人体、脸、手部、衣架、多个重复服装、缺失部件、布料粘连、材质塑料感、复杂场景、文字、水印、logo、二维码、边框、投影、强反射、低分辨率和模糊'

type ScriptAssetKind = ScriptAssetSuggestion['kind']
type ScriptAssetNameIndex = Record<ScriptAssetKind, string[]>

function normalizeScriptAssetSuggestion(
  suggestion: ScriptAssetSuggestion,
  sourceNames: ScriptAssetNameIndex,
  sourceContext = '',
  projectVisualStyle: ProjectVisualStyle = 'cinematic-cg',
): ScriptAssetSuggestion | null {
  const name = resolveAssetSuggestionName(suggestion, sourceNames)
  if (!name) return null

  const namedSuggestion: ScriptAssetSuggestion =
    name === suggestion.name.trim()
      ? suggestion
      : {
          ...suggestion,
          name,
          description: replaceAssetName(suggestion.description, suggestion.name, name),
          prompt: replaceAssetName(suggestion.prompt, suggestion.name, name),
          reason: replaceAssetName(suggestion.reason, suggestion.name, name),
        }
  const stylePrompt = `项目统一视觉风格：${projectVisualStyleLabel(projectVisualStyle)}，后续资产和视频必须保持这一风格，不要自行切换风格`

  if (namedSuggestion.kind === 'character') {
    const animal = namedSuggestion.attributes.subjectType === 'animal'
    const evidence = [
      namedSuggestion.name,
      namedSuggestion.description,
      namedSuggestion.prompt,
      namedSuggestion.reason,
    ].join('，')
    const nearbyScriptEvidence = characterEvidenceWindow(namedSuggestion.name, sourceContext)
    const profileEvidence = [evidence, nearbyScriptEvidence].filter(Boolean).join('，')
    const inferredGender = inferScriptCharacterGender(profileEvidence)
    const gender = animal
      ? 'unspecified'
      : inferredGender === 'unspecified'
        ? namedSuggestion.attributes.gender
        : inferredGender
    const exactAge = animal
      ? null
      : inferScriptCharacterExactAge(namedSuggestion.name, sourceContext) ||
        namedSuggestion.attributes.exactAge
    const ageSignal = inferScriptCharacterAgeSignal(profileEvidence)
    const ageGroup = animal
      ? namedSuggestion.attributes.ageGroup
      : exactAge
        ? ageGroupFromExactAge(exactAge)
        : ageSignal || namedSuggestion.attributes.ageGroup
    const identityTags = inferScriptCharacterIdentityTags(profileEvidence)
    const profileFacts = animal
      ? identityTags
      : [
          gender === 'male' ? '男性' : gender === 'female' ? '女性' : '',
          exactAge ? `${exactAge}岁` : scriptAgeLabel(ageGroup),
          ...identityTags,
        ].filter(Boolean)
    const profileSummary = profileFacts.length ? `角色背景：${profileFacts.join('，')}。` : ''
    const basePrompt = animal ? stripHumanProfileTerms(namedSuggestion.prompt) : namedSuggestion.prompt
    const description = namedSuggestion.description.includes(namedSuggestion.name)
      ? namedSuggestion.description
      : `${namedSuggestion.name}；${namedSuggestion.description}`
    const subjectProfile = animal
      ? [
          '动物角色',
          namedSuggestion.attributes.species || namedSuggestion.name,
          namedSuggestion.attributes.anthropomorphic ? '拟人化动物造型，保留物种面部特征' : '自然动物形态',
        ]
      : [
          '人物角色',
          namedSuggestion.attributes.gender === 'male'
            ? '男性'
            : namedSuggestion.attributes.gender === 'female'
              ? '女性'
              : '性别未指定',
          namedSuggestion.attributes.exactAge
            ? `${namedSuggestion.attributes.exactAge}岁`
            : scriptAgeLabel(namedSuggestion.attributes.ageGroup),
        ]
    return {
      ...namedSuggestion,
      description: appendAssetProfile(description, profileSummary),
      prompt: composeAssetPrompt([
        stylePrompt,
        ...subjectProfile,
        namedSuggestion.name,
        profileSummary,
        basePrompt,
        animal ? ANIMAL_PORTRAIT_REQUIREMENTS : HUMAN_PORTRAIT_REQUIREMENTS,
      ]),
      negativePrompt: composeAssetNegativePrompt(
        namedSuggestion.negativePrompt,
        animal ? ANIMAL_ASSET_NEGATIVE_PROMPT : CHARACTER_ASSET_NEGATIVE_PROMPT,
      ),
      attributes: {
        ...namedSuggestion.attributes,
        gender,
        ageGroup,
        exactAge,
        visualStyle: projectVisualStyle || 'cinematic-cg',
        framing: 'portrait',
        background: 'transparent',
      },
    }
  }

  if (namedSuggestion.kind === 'scene') {
    const sceneContext = [
      sourceContext,
      namedSuggestion.name,
      namedSuggestion.description,
      namedSuggestion.prompt,
    ].join('，')
    return {
      ...namedSuggestion,
      prompt: composeAssetPrompt([
        stylePrompt,
        namedSuggestion.name,
        namedSuggestion.prompt,
        '统一项目视觉风格的场景概念设计，空场景，无人物和动物，空间结构与前中后景关系清楚，关键出入口和动线明确，预留角色表演、动作和运镜空间，材质尺度统一，光照方向稳定，宽幅环境全景，适合后续多镜头复用',
      ]),
      negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, SCENE_ASSET_NEGATIVE_PROMPT),
      attributes: {
        ...namedSuggestion.attributes,
        sceneType: inferSceneType(sceneContext, namedSuggestion.attributes.sceneType),
        era: inferEra(sceneContext, namedSuggestion.attributes.era),
        visualStyle: projectVisualStyle || 'cinematic-cg',
        emptyScene: true,
        activitySpace: true,
      },
    }
  }

  if (namedSuggestion.kind === 'prop') {
    const propContext = [
      namedSuggestion.name,
      namedSuggestion.description,
      namedSuggestion.prompt,
      sourceContext,
    ].join('，')
    return {
      ...namedSuggestion,
      prompt: composeAssetPrompt([
        stylePrompt,
        namedSuggestion.name,
        namedSuggestion.prompt,
        '统一项目视觉风格的物品资产，单个物品独立展示，完整轮廓，正面主视图，结构和尺寸关系准确，材质、颜色、磨损与剧情状态明确，透明背景，Alpha 通道，无背景色，无投影，均匀平光，主体边缘清晰，适合跨镜头保持一致',
      ]),
      negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, PROP_ASSET_NEGATIVE_PROMPT),
      attributes: {
        ...namedSuggestion.attributes,
        condition: inferPropCondition(propContext, namedSuggestion.attributes.condition),
        visualStyle: projectVisualStyle || 'cinematic-cg',
        background: 'transparent',
      },
    }
  }

  return {
    ...namedSuggestion,
    prompt: composeAssetPrompt([
      stylePrompt,
      namedSuggestion.name,
      namedSuggestion.prompt,
      '统一项目视觉风格的服装资产，单套服装平铺独立展示，完整呈现上装、下装和必要配件，版型、材质、纹理、配色与磨损状态清楚，不出现人物、人体、脸和衣架，透明背景，Alpha 通道，无背景色，无投影，均匀平光，边缘清晰，适合角色跨镜头造型一致',
    ]),
    negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, COSTUME_ASSET_NEGATIVE_PROMPT),
    attributes: {
      ...namedSuggestion.attributes,
      visualStyle: projectVisualStyle || 'cinematic-cg',
      presentation: 'flat',
    },
  }
}

function replaceAssetName(value: string, originalName: string, replacementName: string): string {
  const original = originalName.trim()
  return original && original !== replacementName ? value.replaceAll(original, replacementName) : value
}

function appendAssetProfile(description: string, profile: string): string {
  if (!profile || description.includes(profile)) return description
  return `${description.replace(/[。.!！?？\s]+$/u, '')}；${profile}`.slice(0, 500)
}

function composeAssetPrompt(fragments: readonly string[]): string {
  const prompt = fragments
    .map((fragment) => fragment.trim().replace(/[，。；;,]+$/u, ''))
    .filter(Boolean)
    .filter((fragment, index, values) => values.indexOf(fragment) === index)
    .join('，')
  return `${prompt.slice(0, 4_999)}。`
}

function composeAssetNegativePrompt(current: string, required: string): string {
  return composeAssetPrompt([current, required]).slice(0, 2_000)
}

function stripHumanProfileTerms(value: string): string {
  return value
    .replace(/\d{1,3}\s*岁/gu, '')
    .replace(/男性|女性|男人|女人|男孩|女孩|少年|少女|青年|中年|老年|儿童|婴儿/gu, '')
    .replace(/\b(?:male|female|boy|girl|young|middle-aged|senior)\b/giu, '')
    .replace(/[，,]{2,}/gu, '，')
    .trim()
}

function fallbackAssetSuggestions(
  script: string,
  direction: ScriptCreativeDirection,
  projectVisualStyle: ProjectVisualStyle = 'cinematic-cg',
): { summary: string; assets: ScriptAssetSuggestion[] } {
  const visualStyle = projectVisualStyle || suggestionVisualStyle(direction)
  const characters = extractAssetNames(script, ['角色', '人物', '主角'], [], 4, 'character')
  const scenes = extractAssetNames(script, ['场景', '地点'], [], 4, 'scene')
  const props = extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 5, 'prop')
  const costumes = extractAssetNames(script, ['服装', '衣装', '外观'], [], 4, 'costume')
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
          ethnicity: 'unspecified',
          skinTone: 'unspecified',
          eyeColor: 'unspecified',
          hairColor: 'unspecified',
          species: subjectType === 'animal' ? name : '',
          anthropomorphic: false,
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
          appearanceVariants: [],
          activeAppearanceVariantId: null,
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

function extractScriptAssetNameIndex(script: string): ScriptAssetNameIndex {
  return {
    character: extractAssetNames(script, ['角色', '人物', '主角'], [], 8, 'character'),
    scene: extractAssetNames(script, ['场景', '地点'], [], 8, 'scene'),
    prop: extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 10, 'prop'),
    costume: extractAssetNames(script, ['服装', '衣装', '外观'], [], 8, 'costume'),
  }
}

function resolveAssetSuggestionName(
  suggestion: ScriptAssetSuggestion,
  sourceNames: ScriptAssetNameIndex,
): string | null {
  const direct = cleanAssetName(suggestion.name, suggestion.kind)
  if (isPlausibleAssetName(direct, suggestion.kind)) return direct

  const evidence = [suggestion.description, suggestion.prompt, suggestion.reason].join('\n')
  const evidenceMatch = [...sourceNames[suggestion.kind]]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => evidence.includes(candidate))
  if (evidenceMatch) return evidenceMatch

  return sourceNames[suggestion.kind].length === 1 ? sourceNames[suggestion.kind][0]! : null
}

function extractAssetNames(
  script: string,
  fields: string[],
  fallback: string[],
  limit: number,
  kind: ScriptAssetKind,
): string[] {
  const values = extractScriptFieldValues(script, fields).flatMap((value) => splitAssetNameList(value, kind))
  const cleanedValues = values
    .map((value) => cleanAssetName(value, kind))
    .filter((value) => isPlausibleAssetName(value, kind))
    .filter((value) => !SCRIPT_ASSET_STOP_WORDS.has(value))
  const uniqueValues = deduplicateExtractedAssetNames(cleanedValues, kind)
  return (uniqueValues.length ? uniqueValues : fallback).slice(0, limit)
}

function extractScriptFieldValues(script: string, fields: string[]): string[] {
  const normalized = script
    .replace(/\*\*/gu, '')
    .replace(/\r/gu, '')
    .replace(/(^|\n)\s*(?:[-*]\s+|#{1,6}\s*)/gu, '$1')
  const targets = fields.map(escapeRegExp).join('|')
  const boundaries = SCRIPT_ASSET_FIELD_BOUNDARIES.map(escapeRegExp).join('|')
  const pattern = new RegExp(
    `(?:^|[\\n|｜])\\s*(?:${targets})\\s*[：:]\\s*([\\s\\S]*?)(?=(?:[\\n|｜])\\s*(?:${boundaries})\\s*[：:]|$)`,
    'gu',
  )
  return [...normalized.matchAll(pattern)].map((match) => (match[1] || '').trim()).filter(Boolean)
}

function splitAssetNameList(value: string, kind: ScriptAssetKind): string[] {
  if (kind === 'character') return splitCharacterNameList(value)
  if (kind === 'scene') return splitSceneNameList(value)
  return value
    .split(/[、，,；;]|(?:和|与)/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitCharacterNameList(value: string): string[] {
  const names: string[] = []
  for (const rawSection of value.replace(/\s+/gu, ' ').split(/[；;]/u)) {
    const section = rawSection.trim()
    if (
      !section ||
      /^(?:无)?背景角色/u.test(section) ||
      /^(?:无配角|无人物|无角色|无主角)(?:[，,]|$)/u.test(section)
    )
      continue

    const hasRoleLabel = /^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u.test(section)
    const withoutRoleLabel = section.replace(
      /^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u,
      '',
    )
    if (!withoutRoleLabel || /^(?:无配角|无人物|无人)$/u.test(withoutRoleLabel)) continue

    const identityClause = withoutRoleLabel.split(/[，,]/u)[0] || ''
    const candidates = identityClause
      .split(/[、]|(?:和|与)/u)
      .map((item) => item.trim())
      .filter(Boolean)
    names.push(
      ...(!hasRoleLabel &&
      /身穿|穿着|佩戴|戴着|跟随|跟在|穿(?:黑|白|红|橙|黄|绿|蓝|紫|灰|旧|新|深|浅|褪色)/u.test(identityClause)
        ? candidates.slice(0, 1)
        : candidates),
    )
  }
  return names
}

function splitSceneNameList(value: string): string[] {
  for (const segment of value.replace(/\s+/gu, ' ').split(/[，,；;]/u)) {
    const candidate = cleanSceneName(segment)
    if (isPlausibleAssetName(candidate, 'scene')) return [candidate]
  }
  return []
}

function cleanAssetName(value: string, kind: ScriptAssetKind): string {
  if (kind === 'character') return cleanCharacterName(value)
  if (kind === 'scene') return cleanSceneName(value)
  return cleanAssetNameBase(value)
}

function cleanAssetNameBase(value: string): string {
  const cleaned = value
    .replace(/^[\s·\-—]+/u, '')
    .replace(/^(?:资产|名称|物品|物件|道具|服装|衣装)[：:]\s*/u, '')
    .replace(
      /^(?:一位|一名|一个|这位|那位|该|某)?(?:[零〇一二三四五六七八九十百两\d]+岁(?:的)?|年迈的|年老的|老年的|少年的|少女的|年轻的|中年的|儿童的)/u,
      '',
    )
    .split(/[（(。.!！?？]/u)[0]!
    .split(/——|--|：|:/u)[0]!
    .trim()
  if (cleaned.length < 2) return ''
  return cleaned.length > 32 ? cleaned.slice(0, 32) : cleaned
}

function cleanCharacterName(value: string): string {
  return cleanAssetNameBase(value)
    .replace(/^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u, '')
    .split(
      /(?:身穿|穿着|佩戴|戴着|跟随|跟在|站在|位于|坐在|躲在|手持|拿着|抱着|先神情|随后|然后|低头|抬头|缩肩|强装)/u,
    )[0]!
    .split(/穿(?=(?:黑|白|红|橙|黄|绿|蓝|紫|灰|旧|新|深|浅|褪色))/u)[0]!
    .trim()
}

function cleanSceneName(value: string): string {
  return cleanAssetNameBase(value)
    .replace(/^(?:内景|外景|室内|室外)[：:]?\s*/u, '')
    .replace(
      /^(?:次日|当天|清晨|黎明|上午|中午|下午|傍晚|黄昏|夜晚|深夜|午夜|雨夜|雪夜)(?:前|后|时)?(?:的)?\s*/u,
      '',
    )
    .replace(/[，,；;].*$/u, '')
    .replace(/(?:内景|外景)$/u, '')
    .trim()
}

function isPlausibleAssetName(value: string, kind: ScriptAssetKind): boolean {
  if (!value || value.length < 2 || value.length > (kind === 'scene' ? 28 : 24)) return false
  if (kind === 'character') {
    if (
      /神情|表情|情绪|眼神|视线|瞳孔|紧张|镇定|惊慌|错愕|赔笑|皱眉|低头|抬头|缩肩|随后|然后|开始|继续|正在|站在|走向|看向|等待|说道|抬手|伸手|转身|位于|强装|抱臂|探头|交头接耳|寻找|声音/u.test(
        value,
      )
    )
      return false
    if (
      /^(?:无|未指定|主角|主要角色|配角|无配角|背景角色|角色|人物|众人|人群)$/u.test(value) ||
      /^(?:数名|多名|若干|一群|众多|所有|其余|围观|等待)?(?:弟子|群众|路人|村民|工作人员|士兵|侍卫|学生|乘客|客人|观众|人群|众人|人们)(?:们|[甲乙丙丁一二三四\d])?$/u.test(
        value,
      ) ||
      /^(?:数名|多名|若干|一群|众多|所有|其余|围观|等待).{0,8}(?:弟子|群众|路人|村民|工作人员|士兵|侍卫|学生|乘客|客人|观众|人群|众人|人们)(?:们)?$/u.test(
        value,
      )
    )
      return false
  }
  if (kind === 'scene') {
    if (
      /神情|表情|冷雾未散|晨雾未散|雾气未散|站满|立着|等待|位于|穿着|身穿|挂着|抱着|拿着|出现|翻涌|笼罩|散去|亮起|裂开|覆盖|坐着|站着|走向|看向|弟子|人物|角色/u.test(
        value,
      )
    )
      return false
    if (/^(?:清晨|黎明|上午|中午|下午|傍晚|黄昏|夜晚|深夜|午夜|阴天|晴天|冷雾|晨雾|黑雾|金光)$/u.test(value))
      return false
  }
  return true
}

function deduplicateExtractedAssetNames(values: string[], kind: ScriptAssetKind): string[] {
  const result: string[] = []
  for (const value of values) {
    const exactIndex = result.findIndex((existing) => existing === value)
    if (exactIndex >= 0) continue
    if (kind === 'scene') {
      const containingIndex = result.findIndex(
        (existing) =>
          Math.abs(existing.length - value.length) <= 8 &&
          (existing.startsWith(value) || value.startsWith(existing)),
      )
      if (containingIndex >= 0) {
        if (value.length < result[containingIndex]!.length) result[containingIndex] = value
        continue
      }
    }
    result.push(value)
  }
  return result
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function inferScriptCharacterSubjectType(text: string): 'human' | 'animal' {
  return /狗|猫|牛|马|羊|猪|鸡|鸭|鹅|鸟|鱼|狼|虎|熊|鹿|猴|犬|妖兽|灵兽/u.test(text) ? 'animal' : 'human'
}

function inferScriptCharacterGender(text: string): 'male' | 'female' | 'unspecified' {
  if (/老船夫|船夫|祖父|爷爷|爷|父亲|男人|男性|哥哥|弟弟|少爷|他\b/u.test(text)) return 'male'
  if (/翠翠|孙女|外孙女|女性|少女|姑娘|女孩|母亲|娘|妻|小姐|她\b/u.test(text)) return 'female'
  return 'unspecified'
}

function inferScriptCharacterAge(text: string): 'child' | 'teen' | 'young' | 'middle' | 'senior' {
  return inferScriptCharacterAgeSignal(text) || 'young'
}

function inferScriptCharacterAgeSignal(
  text: string,
): 'child' | 'teen' | 'young' | 'middle' | 'senior' | null {
  if (/老船夫|船夫|年迈|祖父|爷爷|老人|老年|晚年|七十|六十|五十/u.test(text)) return 'senior'
  if (/儿童|孩子|小孩|幼/u.test(text)) return 'child'
  if (/翠翠|少年|少女|十几|十三|十四|十五|十六|十七|十八/u.test(text)) return 'teen'
  if (/中年|三十|四十/u.test(text)) return 'middle'
  if (/青年|年轻|二十|十九/u.test(text)) return 'young'
  return null
}

function inferScriptCharacterExactAge(name: string, script: string): number | null {
  const exactFromContext = exactAgeNearCharacterName(name, script)
  if (exactFromContext) return exactFromContext
  return exactAgeFromText(name)
}

function exactAgeNearCharacterName(name: string, script: string): number | null {
  const nearby = characterEvidenceWindow(name, script)
  const nearbyAge = exactAgeFromText(nearby)
  if (nearbyAge) return nearbyAge

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

function characterEvidenceWindow(name: string, script: string): string {
  if (!name || !script) return ''
  const occurrences: string[] = []
  let searchFrom = 0
  while (searchFrom < script.length) {
    const index = script.indexOf(name, searchFrom)
    if (index < 0) break
    const lineStart = Math.max(
      script.lastIndexOf('\n', index),
      script.lastIndexOf('｜', index),
      script.lastIndexOf('|', index),
    )
    const lineEndCandidates = [
      script.indexOf('\n', index),
      script.indexOf('｜', index),
      script.indexOf('|', index),
    ].filter((boundary) => boundary >= 0)
    const lineEnd = lineEndCandidates.length ? Math.min(...lineEndCandidates) : script.length
    const line = script.slice(lineStart + 1, lineEnd)
    const listPart = line.split(/[、；;]/u).find((part) => part.includes(name))
    occurrences.push((listPart || line).trim())
    searchFrom = index + name.length
  }
  return (
    occurrences.find((value) =>
      /\d{1,3}\s*岁|男性|女性|男|女|老年|中年|青年|少年|少女|儿童|镖师|剑客|长老|导演|医生|将军/u.test(value),
    ) ||
    occurrences[0] ||
    ''
  )
}

function ageGroupFromExactAge(age: number): 'child' | 'teen' | 'young' | 'middle' | 'senior' {
  if (age < 13) return 'child'
  if (age <= 18) return 'teen'
  if (age < 30) return 'young'
  if (age < 50) return 'middle'
  return 'senior'
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
    /镖师|镖客/u.test(text) ? '镖师' : '',
    /剑客|剑士|女剑客/u.test(text) ? '剑客' : '',
    /长老|宗主|掌门|弟子/u.test(text) ? '宗门身份' : '',
    /导演|摄影师|记者/u.test(text) ? '影像从业者' : '',
    /医生|医师|药师/u.test(text) ? '医者' : '',
    /将军|士兵|军人|校尉/u.test(text) ? '军旅身份' : '',
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

function projectVisualStyleLabel(value: string | undefined): string {
  return (
    (
      {
        photorealistic: '仿真人',
        'cinematic-cg': 'CG风',
        'chinese-2d': '2D风',
        'chinese-3d': '3D国漫风',
        anime: '日漫风',
        storybook: '绘本风',
      } as Record<string, string>
    )[value || 'cinematic-cg'] || 'CG风'
  )
}

function inferSceneSpace(name: string): 'interior' | 'exterior' {
  return /室内|屋|房|店|铺|工厂|车厢|房间|大厅|暗房|药铺/u.test(name) ? 'interior' : 'exterior'
}

function inferSceneType(
  name: string,
  fallback:
    | 'city'
    | 'street'
    | 'residential'
    | 'commercial'
    | 'nature'
    | 'ancient'
    | 'industrial'
    | 'fantasy' = 'city',
): 'city' | 'street' | 'residential' | 'commercial' | 'nature' | 'ancient' | 'industrial' | 'fantasy' {
  if (/修仙|仙侠|仙门|宗门|山门|青云宗|灵石|灵脉|妖兽|秘境|玄幻|奇幻|神殿|魔法|浮空|天穹/u.test(name))
    return 'fantasy'
  if (/古|宫|城门|边城|药铺|江湖|门派/u.test(name)) return 'ancient'
  if (/工厂|车间|管线|工业|暗房/u.test(name)) return 'industrial'
  if (/森林|山|河|雪坡|荒野/u.test(name)) return 'nature'
  if (/商店|市场|餐厅|药铺/u.test(name)) return 'commercial'
  if (/街|路|站台|车站/u.test(name)) return 'street'
  if (/住宅|家|卧室/u.test(name)) return 'residential'
  if (/浮空|魔法|神殿/u.test(name)) return 'fantasy'
  return fallback
}

function inferEra(
  name: string,
  fallback: 'ancient' | 'recent' | 'modern' | 'future' = 'modern',
): 'ancient' | 'recent' | 'modern' | 'future' {
  if (
    /修仙|仙侠|仙门|宗门|山门|青云宗|灵石|灵脉|妖兽|秘境|玄幻|奇幻|古|剑|宫|江湖|门派|药铺|古门/u.test(name)
  )
    return 'ancient'
  if (/未来|赛博|浮空|企业霓虹|机器人/u.test(name)) return 'future'
  if (/民国|旧式|老式/u.test(name)) return 'recent'
  return fallback
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

function inferPropCondition(
  text: string,
  fallback: 'new' | 'used' | 'aged' | 'damaged',
): 'new' | 'used' | 'aged' | 'damaged' {
  if (/破损|损坏|断裂|残缺|碎裂/u.test(text)) return 'damaged'
  if (/年久|陈旧|老旧|锈蚀|腐朽/u.test(text)) return 'aged'
  if (/旧|使用痕迹|磨损|划痕/u.test(text)) return 'used'
  return fallback
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
  const maximumScenes = isWebSeries ? 120 : 6

  if (characterCount < 1_800)
    issues.push(`内容仅 ${characterCount} 字，建议补充到 1800 字以上，确保每场有足够的可执行动作和衔接信息`)
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

const SCENE_DIRECTION_FIELD_NAMES = ['目标', '阻力', '变化', '入场状态', '出场状态'] as const
type SceneDirectionFields = Partial<Record<(typeof SCENE_DIRECTION_FIELD_NAMES)[number], string>>

type ShotDraft = Omit<CreateShot, 'episodeNumber' | 'episodeTitle' | 'episodeKind'> & {
  episodeKind?: 'standard' | 'hook'
}

function splitScriptIntoBeatShots(
  paragraphs: ScriptParagraph[],
  maxShots: number,
  isWebSeries = false,
): ShotDraft[] {
  const shots: ShotDraft[] = []
  for (const [sceneIndex, scriptParagraph] of paragraphs.entries()) {
    const paragraph = scriptParagraph.text
    const fields = parseShotFields(paragraph)
    const direction = parseSceneDirectionFields(paragraph)
    const beats = ensureActionBeatDensity(
      splitFieldBeats(fields.动作 || fields.剧情 || paragraph, true),
      fields,
      isWebSeries,
    ).slice(0, 4)
    const dialogueBeats = splitFieldBeats(fields.对白 || '')
    const sceneNumber = fields.场次 || String(sceneIndex + 1)
    for (const [beatIndex, beat] of beats.entries()) {
      if (shots.length >= maxShots) return shots
      const dialogue = dialogueBeats[beatIndex]
      const duration = estimateShotDuration(beat, dialogue, fields, isWebSeries)
      shots.push({
        title: `场次 ${sceneNumber} · 动作 ${beatIndex + 1}`,
        framing: beatFraming(fields.构图, beatIndex, beats.length),
        duration,
        prompt: compactShotPrompt(fields, direction, beat, dialogue, duration, beatIndex, beats.length),
        negativePrompt: '',
        imageUrl: null,
        episodeBreakBefore: beatIndex === 0 && scriptParagraph.forceEpisodeBreakBefore,
        episodeKind: isHookParagraph(paragraph) && beatIndex === beats.length - 1 ? 'hook' : 'standard',
        continuityMode: shots.length === 0 ? 'independent' : 'continue',
        continuityNote: continuityNoteFor(
          beatIndex > 0 ? beats[beatIndex - 1] || '' : paragraphs[sceneIndex - 1]?.text || '',
          beatIndex > 0 ? '上一镜' : '上一场',
          {
            entryState: beatIndex === 0 ? direction.入场状态 : undefined,
            exitState: beatIndex === beats.length - 1 ? direction.出场状态 : undefined,
          },
        ),
      })
    }
  }
  return shots
}

function splitScriptIntoSceneShots(
  paragraphs: ScriptParagraph[],
  maxShots: number,
  isWebSeries = false,
): ShotDraft[] {
  // 用户按场次生成时，网剧内部仍拆成动作镜头，避免整场只生成一个主角动作。
  if (isWebSeries) return splitScriptIntoBeatShots(paragraphs, maxShots, true)

  return paragraphs.slice(0, maxShots).map((scriptParagraph, index) => {
    const paragraph = scriptParagraph.text
    const fields = parseShotFields(paragraph)
    const direction = parseSceneDirectionFields(paragraph)
    const structured = Object.keys(fields).length > 1
    return {
      title: `镜头 ${String(index + 1).padStart(2, '0')}`,
      framing: index === 0 ? '大全景' : index % 3 === 0 ? '特写' : '中景',
      duration: isWebSeries ? 4 : Math.min(15, Math.max(4, Math.ceil(paragraph.length / 18))),
      prompt: structured
        ? compactShotPrompt(
            fields,
            direction,
            fields.动作 || fields.剧情 || paragraph,
            fields.对白,
            undefined,
            0,
            1,
          )
        : paragraph,
      negativePrompt: '',
      imageUrl: null,
      episodeBreakBefore: scriptParagraph.forceEpisodeBreakBefore,
      episodeKind: isHookParagraph(paragraph) ? ('hook' as const) : ('standard' as const),
      continuityMode: index === 0 ? ('independent' as const) : ('continue' as const),
      continuityNote: continuityNoteFor(paragraphs[index - 1]?.text || '', '上一场', {
        entryState: direction.入场状态,
        exitState: direction.出场状态,
      }),
    }
  })
}

function isHookParagraph(paragraph: string): boolean {
  const fields = parseShotFields(paragraph)
  return /剧情钩子|悬念钩子|结尾钩子/u.test(fields.场次 || '') || /^【?剧情钩子】?/u.test(paragraph)
}

function continuityNoteFor(
  previous: string,
  previousLabel: '上一场' | '上一镜',
  sceneState: { entryState?: string | undefined; exitState?: string | undefined } = {},
): string {
  if (!previous.trim()) return ''
  const previousDirection = parseSceneDirectionFields(previous)
  return [
    `${previousLabel}已完成；首帧直接承接该镜真实尾帧，不得重演、解释或复述上一镜已经完成的事件。`,
    previousDirection.出场状态 ? `已形成状态：${tailExcerpt(previousDirection.出场状态, 220)}` : '',
    sceneState.entryState ? `本镜入场状态：${headExcerpt(sceneState.entryState, 220)}` : '',
    '人物位置、视线、动作方向、服装、关键物品和光线保持连续；本镜直接执行自己的主动作。',
    '本镜结束时保留清晰的结束姿态、视线落点和物件状态，供下一镜真实尾帧直接承接。',
    sceneState.exitState ? `本镜所在场次的最终出场状态：${tailExcerpt(sceneState.exitState, 220)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
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

function parseSceneDirectionFields(paragraph: string): SceneDirectionFields {
  const fields: SceneDirectionFields = {}
  for (const segment of paragraph.split('｜')) {
    const match = segment.trim().match(/^([^：:]+)[：:]([\s\S]*)$/)
    const key = match?.[1]?.trim() as (typeof SCENE_DIRECTION_FIELD_NAMES)[number] | undefined
    if (key && SCENE_DIRECTION_FIELD_NAMES.includes(key)) fields[key] = match?.[2]?.trim() || ''
  }
  return fields
}

function splitFieldBeats(value: string, splitCommas = false): string[] {
  const text = value.trim()
  if (!text) return []
  const explicitActionBeats = text
    .split(/(?=动作\s*[1-9][0-9]*\s*[：:])/u)
    .map((item) => item.trim())
    .filter(Boolean)
  // `动作1/动作2` is the production contract. Commas inside one labelled action
  // describe its performance details and must never create extra video shots.
  if (explicitActionBeats.some((item) => /^动作\s*[1-9][0-9]*\s*[：:]/u.test(item))) {
    return explicitActionBeats
  }
  const semicolonBeats = text
    .split(
      splitCommas ? /[；;，,]+|(?=动作\s*[1-9][0-9]*\s*[：:])/u : /[；;]+|(?=动作\s*[1-9][0-9]*\s*[：:])/u,
    )
    .map((item) => item.trim())
    .filter(Boolean)
  if (semicolonBeats.length > 1) return semicolonBeats
  return text
    .split(/(?<=[。！？!?])/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function ensureActionBeatDensity(
  beats: string[],
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  isWebSeries: boolean,
): string[] {
  if (!isWebSeries || beats.length >= 2 || Object.keys(fields).length < 2) return beats
  const base = beats[0] || fields.剧情 || '角色推进当前目标'
  const roles = namedRolesForDirector(fields.角色)
  const lead = roles[0] || '主要角色'
  const supporting = roles.slice(1).join('、') || '配角和背景角色'
  return [
    `${base}；${lead}的表情从当前状态转为警觉，视线明确转向阻力来源`,
    `${lead}改变站位或与关键物件发生可见互动；${supporting}同步转头、停步、交换视线或调整姿态`,
    `${lead}停在下一步行动前并保持结束姿态；${supporting}留下紧张、疑惑或戒备的表情反应`,
  ]
}

function compactShotPrompt(
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  direction: SceneDirectionFields,
  beat: string,
  dialogue?: string,
  duration?: number,
  beatIndex = 0,
  beatCount = 1,
): string {
  const action = beat.trim() || fields.动作 || '角色保持当前状态并产生可见变化'
  return [
    fieldPart('场次', fields.场次 || '未编号场次', 24),
    fieldPart('剧情', fields.剧情 || '本场继续推进当前冲突', 260),
    fieldPart('目标', direction.目标 || '角色完成当前可见行动', 180),
    fieldPart('阻力', direction.阻力 || '当前环境或对手阻碍角色推进', 180),
    fieldPart('变化', direction.变化 || '动作结束后角色状态发生可见变化', 180),
    fieldPart('场景', fields.场景 || '沿用上一场空间与时间', 320),
    fieldPart('角色', fields.角色 || '沿用上一场所有角色；每位画面内人物都必须有动作、表情或视线变化', 420),
    ...(beatIndex === 0 ? [fieldPart('入场状态', direction.入场状态, 240)] : []),
    fieldPart('动作', action, 520),
    fieldPart('对白', dialogue || fields.对白 || '无台词，角色通过表情和动作传达变化', 280),
    fieldPart('风格', fields.风格 || '沿用项目视觉风格，角色与场景材质统一', 180),
    fieldPart('构图', fields.构图 || '中景，主体位于画面重心，前中后景清晰', 220),
    fieldPart('光影', fields.光影 || '沿用上一场光源方向和色温，避免跳变', 200),
    fieldPart('运镜', fields.运镜 || '稳定跟随动作，结尾停在下一动作起点', 240),
    fieldPart('衔接', fields.衔接 || '承接上一场人物位置、视线、动作、服装、物件和光线状态', 300),
    ...(beatIndex === beatCount - 1 ? [fieldPart('出场状态', direction.出场状态, 240)] : []),
    fieldPart('导演节拍', directorBeatFor(action, fields.角色, dialogue || fields.对白, duration), 480),
  ]
    .filter(Boolean)
    .join('｜')
}

function estimateShotDuration(
  beat: string,
  dialogue: string | undefined,
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  isWebSeries: boolean,
): number {
  const action = String(beat || fields.动作 || fields.剧情 || '').trim()
  const spokenCharacters = dialogueTextForTiming(dialogue).length
  const dialogueSeconds = spokenCharacters ? Math.ceil(spokenCharacters / 4) + 1 : 0
  const reactionOnly =
    /(?:抬眼|抬头|回头|转头|对视|凝视|停住|停步|皱眉|屏住呼吸|吸气|惊愕|错愕|警觉|眼神)/u.test(action) &&
    !/(?:走|跑|冲|进入|离开|打开|关上|拿起|放下|递|接|抓|推|拉|击|躲|拥抱|贴近|划过|投出|操作|按住|伸手|抬手|举起|拨开|握住)/u.test(
      action,
    )
  const movementOrInteraction =
    /(?:走|跑|冲|进入|离开|打开|关上|拿起|放下|递|接|抓|推|拉|击|躲|转身|跪|起身|坐下|贴近|划过|投出|操作|按住|伸手|抬手|举起|拨开|握住)/u.test(
      action,
    )
  const actionSeconds = reactionOnly ? 3 : movementOrInteraction ? 5 : 4
  const baseDuration = Math.max(actionSeconds, dialogueSeconds)

  // 网剧允许少量 3 秒反应镜，其余镜头至少留出一个完整动作和一次表情变化。
  const minimum = isWebSeries && reactionOnly && !dialogueSeconds ? 3 : 4
  return Math.min(15, Math.max(minimum, baseDuration || minimum))
}

function dialogueTextForTiming(dialogue: string | undefined): string {
  return String(dialogue || '')
    .replace(/\[(?:台词|画外音|内心独白)\]/gu, '')
    .replace(/^[^：:\n]{1,16}[：:]/u, '')
    .replace(/[\s，。！？、；;“”"'（）()——-]/gu, '')
    .trim()
}

function directorBeatFor(
  action: string,
  roleField: string | undefined,
  dialogue: string | undefined,
  duration: number | undefined,
): string {
  const roles = namedRolesForDirector(roleField)
  const lead = roles[0] || '主角'
  const supporting = roles.slice(1).join('、')
  const hasDialogue = dialogueTextForTiming(dialogue).length > 0 && !/无台词/u.test(String(dialogue || ''))
  const endSecond = Math.max(2, Number(duration || 4) - 1)
  return [
    `本镜只完成一个主动作：${headExcerpt(action, 180)}`,
    `0-1 秒承接既有状态，1-${endSecond} 秒完整表现动作起势、执行与一次表情或视线变化，最后 1 秒停在可被下一镜承接的结束姿态`,
    supporting
      ? `主角 ${lead} 推进主动作；配角 ${supporting} 只做同步的转头、视线、停步或姿态反应，不新增第二个剧情动作`
      : `主角 ${lead} 推进主动作；其他画内人物只做同步的视线、表情或姿态反应，不新增第二个剧情动作`,
    hasDialogue
      ? '对白在动作进行中自然说完，口型与听者反应同步，不为念完长台词而另起动作'
      : '无对白时用表情、视线、环境声和动作音效推进信息，不留空镜填时长',
  ].join('；')
}

function namedRolesForDirector(roleField: string | undefined): string[] {
  const raw = String(roleField || '').trim()
  if (!raw) return []
  const profiledRoles = [...raw.matchAll(/(?:^|[；;])\s*([^（(；;]{1,40})[（(]/gu)]
    .map((match) => match[1]?.trim())
    .filter((name): name is string => Boolean(name))
  if (profiledRoles.length) return profiledRoles
  return raw
    .split(/[、，,；;]/u)
    .map((role) => role.replace(/[（(].*$/u, '').trim())
    .filter(Boolean)
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
    .slice(0, 16)
    .map((asset) => {
      const parts = [
        `${asset.kind}:${asset.name}`,
        asset.description ? `说明：${headExcerpt(asset.description, 220)}` : '',
        asset.prompt ? `生成提示词：${headExcerpt(asset.prompt, 260)}` : '',
        assetAttributeSummary(asset),
      ].filter(Boolean)
      return parts.join('；')
    })
    .join('；')
}

function assetAttributeSummary(asset: Asset): string {
  const attributes = asset.attributes
  if (attributes.type === 'character') {
    return `结构化身份：${[
      attributes.subjectType,
      attributes.gender,
      attributes.exactAge ? `${attributes.exactAge}岁` : attributes.ageGroup,
      attributes.species,
      attributes.visualStyle,
      attributes.bodyType,
      attributes.background,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'scene') {
    return `结构化场景：${[
      attributes.space,
      attributes.sceneType,
      attributes.era,
      attributes.time,
      attributes.weather,
      attributes.mood,
      attributes.camera,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'prop') {
    return `结构化物品：${[
      attributes.category,
      attributes.material,
      attributes.condition,
      attributes.view,
      attributes.background,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'costume') {
    return `结构化服装：${[
      attributes.audience,
      attributes.category,
      attributes.season,
      attributes.design,
      attributes.presentation,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  return ''
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
  for (const candidate of providerJsonCandidates(raw)) {
    try {
      const result = schema.safeParse(normalize(parseJsonCandidate(candidate)))
      if (result.success) return result.data
    } catch {
      // Continue through the remaining fenced, balanced, and repaired candidates.
    }
  }
  throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
}

function providerJsonCandidates(raw: string): string[] {
  const text = raw
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
  const candidates: string[] = [text]
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.push(match[1].trim())
  }

  for (const source of [...candidates]) {
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== '{' && source[index] !== '[') continue
      const balanced = balancedJsonSlice(source, index)
      if (balanced) candidates.push(balanced)
      candidates.push(source.slice(index).trim())
      if (candidates.length >= 24) break
    }
    if (candidates.length >= 24) break
  }

  return [...new Set(candidates.filter(Boolean))]
}

function balancedJsonSlice(text: string, start: number): string | null {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{' || character === '[') stack.push(character)
    if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '['
      if (stack.pop() !== expected) return null
      if (!stack.length) return text.slice(start, index + 1)
    }
  }
  return null
}

function parseJsonCandidate(candidate: string): unknown {
  let value: unknown = JSON.parse(jsonrepair(candidate))
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
    const nested = value.trim()
    if (!nested.startsWith('{') && !nested.startsWith('[')) break
    value = JSON.parse(jsonrepair(nested))
  }
  return value
}

function normalizeScriptAssetSuggestionPayload(value: unknown): unknown {
  let root: unknown = value
  let inheritedSummary: unknown
  for (let depth = 0; depth < 5; depth += 1) {
    const record = asRecord(root)
    inheritedSummary ??= record?.summary ?? record?.['总结'] ?? record?.['概述'] ?? record?.['资产概述']
    if (record && hasAssetCollection(record)) break
    const nested =
      record &&
      ['data', 'result', 'output', 'response', 'payload', 'content']
        .map((key) => record[key])
        .find((candidate) => candidate !== undefined && candidate !== null)
    if (nested !== undefined) {
      root = nested
      continue
    }
    break
  }

  if (Array.isArray(root)) root = { assets: root }
  const rootRecord = asRecord(root)
  if (!rootRecord) return value

  const assetValue =
    rootRecord.assets ??
    rootRecord.suggestions ??
    rootRecord['资产'] ??
    rootRecord['资产建议'] ??
    rootRecord['建议资产']
  const assetContainer = asRecord(assetValue)
  const categorizedEntries = Object.entries(assetContainer || rootRecord).filter(
    ([key, entry]) => normalizeScriptAssetKind(key) && Array.isArray(entry),
  )
  const rawAssets: unknown[] = Array.isArray(assetValue)
    ? assetValue
    : categorizedEntries.flatMap(([key, entry]) =>
        (entry as unknown[]).map((item) => {
          const itemRecord = asRecord(item)
          return itemRecord ? { ...itemRecord, kind: itemRecord.kind || key } : { kind: key, name: item }
        }),
      )
  const assets = rawAssets
    .map((item) => normalizeProviderAssetSuggestion(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .slice(0, 16)

  return {
    summary: textValue(
      rootRecord.summary ??
        rootRecord['总结'] ??
        rootRecord['概述'] ??
        rootRecord['资产概述'] ??
        inheritedSummary,
      '已根据剧本提取可复用的人物、场景、物品和服装。',
      700,
    ),
    assets,
  }
}

function normalizeProviderAssetSuggestion(value: unknown): Record<string, unknown> | null {
  const source = asRecord(value)
  if (!source) return null
  const kind = normalizeScriptAssetKind(
    source.kind ?? source.type ?? source.assetType ?? source.category ?? source['类型'] ?? source['资产类型'],
  )
  if (!kind) return null
  const attributes = asRecord(source.attributes ?? source.properties ?? source.details)
  const read = (key: string) => attributes?.[key] ?? source[key]
  const name = textValue(
    source.name ??
      source.title ??
      source.label ??
      source.assetName ??
      source['资产名'] ??
      source['名称'] ??
      source['角色名'] ??
      source['场景名'],
    '',
    120,
  ).trim()
  if (!name) return null

  return {
    kind,
    name,
    description: textValue(
      source.description ?? source.summary ?? source.profile ?? source['设定'],
      name,
      500,
    ),
    prompt: textValue(
      source.prompt ??
        source.visualPrompt ??
        source.generationPrompt ??
        source.visual_prompt ??
        source.generation_prompt ??
        source['提示词'] ??
        source.description,
      name,
      5_000,
    ),
    negativePrompt: textValue(
      source.negativePrompt ?? source.negative_prompt ?? source['负面提示词'],
      '',
      2_000,
    ),
    reason: textValue(source.reason ?? source.why ?? source['原因'], '根据剧本核心实体建立可复用资产。', 500),
    priority: normalizePriority(source.priority ?? source.importance ?? source['优先级']),
    attributes: normalizeScriptAssetAttributes(kind, read),
  }
}

function hasAssetCategory(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => normalizeScriptAssetKind(key) && Array.isArray(value[key]))
}

function hasAssetCollection(value: Record<string, unknown>): boolean {
  return (
    ['assets', 'suggestions', '资产', '资产建议', '建议资产'].some((key) => key in value) ||
    hasAssetCategory(value)
  )
}

function assetSuggestionWarning(error: unknown): string {
  if (error instanceof AppError && error.code === 'PROVIDER_RESPONSE_INVALID') {
    return '模型返回格式异常，资产结构无法解析，已根据剧本文本做基础资产建议；可检查模型输出格式后重试'
  }
  if (error instanceof Error && error.message) {
    return `资产建议调用失败：${error.message}；已根据剧本文本做基础资产建议`
  }
  return '资产建议生成失败，已根据剧本文本做基础资产建议'
}

function normalizeScriptAssetKind(value: unknown): ScriptAssetKind | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  if (
    [
      'character',
      'characters',
      'person',
      'people',
      '人物',
      '角色',
      '人物角色',
      '人物资产',
      '角色资产',
    ].includes(normalized)
  )
    return 'character'
  if (['scene', 'scenes', 'location', 'locations', '场景', '地点', '地方', '场景资产'].includes(normalized))
    return 'scene'
  if (['prop', 'props', 'item', 'items', '物品', '道具', '物品资产', '道具资产'].includes(normalized))
    return 'prop'
  if (['costume', 'costumes', 'outfit', 'outfits', '服装', '衣装', '服装资产'].includes(normalized))
    return 'costume'
  return null
}

function normalizeScriptAssetAttributes(
  kind: ScriptAssetKind,
  read: (key: string) => unknown,
): Record<string, unknown> {
  const visualStyles = [
    'photorealistic',
    'cinematic-cg',
    'chinese-3d',
    'chinese-2d',
    'anime',
    'storybook',
  ] as const
  if (kind === 'character') {
    const subjectType = pickEnum(read('subjectType'), ['human', 'animal'] as const, 'human')
    return {
      type: 'character',
      subjectType,
      gender:
        subjectType === 'animal'
          ? 'unspecified'
          : pickEnum(read('gender'), ['male', 'female', 'unspecified'] as const, 'unspecified'),
      ageGroup: pickEnum(read('ageGroup'), ['child', 'teen', 'young', 'middle', 'senior'] as const, 'young'),
      exactAge: normalizeExactAge(read('exactAge')),
      ethnicity: pickEnum(
        read('ethnicity'),
        [
          'unspecified',
          'east-asian',
          'south-asian',
          'southeast-asian',
          'white',
          'black',
          'latino',
          'middle-eastern',
          'mixed',
          'other',
        ] as const,
        'unspecified',
      ),
      skinTone: pickEnum(
        read('skinTone'),
        ['unspecified', 'fair', 'light', 'medium', 'tan', 'deep', 'dark'] as const,
        'unspecified',
      ),
      eyeColor: pickEnum(
        read('eyeColor'),
        ['unspecified', 'black', 'dark-brown', 'brown', 'hazel', 'green', 'blue', 'gray', 'amber'] as const,
        'unspecified',
      ),
      hairColor: pickEnum(
        read('hairColor'),
        ['unspecified', 'black', 'dark-brown', 'brown', 'blonde', 'red', 'gray', 'white', 'other'] as const,
        'unspecified',
      ),
      species: textValue(read('species'), '', 80),
      anthropomorphic: Boolean(read('anthropomorphic')),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
      framing: pickEnum(read('framing'), ['portrait', 'half', 'full'] as const, 'portrait'),
      bodyType: pickEnum(read('bodyType'), ['slim', 'balanced', 'athletic', 'full'] as const, 'balanced'),
      background: pickEnum(
        read('background'),
        ['solid', 'transparent', 'environment'] as const,
        'transparent',
      ),
      faceStatus: pickEnum(read('faceStatus'), ['pending', 'approved'] as const, 'pending'),
      bodyStatus: pickEnum(read('bodyStatus'), ['pending', 'approved'] as const, 'pending'),
      faceReference: normalizeMediaReference(read('faceReference')),
      bodyReference: normalizeMediaReference(read('bodyReference')),
      portraitSource: pickEnum(
        read('portraitSource'),
        ['ai-virtual', 'authorized-real'] as const,
        'ai-virtual',
      ),
      trustedPortrait: null,
      legStretch: Boolean(read('legStretch')),
      turnaround: Boolean(read('turnaround')),
      turnaroundLayout: pickEnum(read('turnaroundLayout'), ['sheet', 'separate'] as const, 'sheet'),
      appearanceVariants: [],
      activeAppearanceVariantId: null,
    }
  }
  if (kind === 'scene') {
    return {
      type: 'scene',
      space: pickEnum(read('space'), ['interior', 'exterior'] as const, 'exterior'),
      sceneType: pickEnum(
        read('sceneType'),
        [
          'city',
          'street',
          'residential',
          'commercial',
          'nature',
          'ancient',
          'industrial',
          'fantasy',
        ] as const,
        'city',
      ),
      era: pickEnum(read('era'), ['ancient', 'recent', 'modern', 'future'] as const, 'modern'),
      time: pickEnum(read('time'), ['dawn', 'day', 'sunset', 'night'] as const, 'day'),
      weather: pickEnum(read('weather'), ['clear', 'cloudy', 'rain', 'snow', 'fog'] as const, 'clear'),
      mood: pickEnum(
        read('mood'),
        ['warm', 'tense', 'mystery', 'romantic', 'epic', 'desolate'] as const,
        'warm',
      ),
      camera: pickEnum(
        read('camera'),
        ['eye-level', 'overhead', 'low-angle', 'aerial', 'wide'] as const,
        'wide',
      ),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
      emptyScene: read('emptyScene') === undefined ? true : Boolean(read('emptyScene')),
      activitySpace: read('activitySpace') === undefined ? true : Boolean(read('activitySpace')),
    }
  }
  if (kind === 'prop') {
    return {
      type: 'prop',
      category: pickEnum(
        read('category'),
        ['weapon', 'vehicle', 'furniture', 'electronics', 'jewelry', 'food', 'daily', 'other'] as const,
        'other',
      ),
      material: pickEnum(
        read('material'),
        ['wood', 'metal', 'glass', 'fabric', 'leather', 'ceramic', 'mixed'] as const,
        'mixed',
      ),
      condition: pickEnum(read('condition'), ['new', 'used', 'aged', 'damaged'] as const, 'new'),
      view: pickEnum(read('view'), ['front', 'side', 'turnaround'] as const, 'front'),
      background: pickEnum(read('background'), ['solid', 'transparent', 'environment'] as const, 'solid'),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
    }
  }
  return {
    type: 'costume',
    audience: pickEnum(read('audience'), ['male', 'female', 'unisex'] as const, 'unisex'),
    category: pickEnum(
      read('category'),
      ['daily', 'formal', 'professional', 'uniform', 'ancient', 'ceremonial', 'fantasy', 'armor'] as const,
      'daily',
    ),
    season: pickEnum(read('season'), ['spring-summer', 'autumn-winter', 'all-season'] as const, 'all-season'),
    design: pickEnum(read('design'), ['minimal', 'luxury', 'retro', 'future', 'chinese'] as const, 'minimal'),
    presentation: pickEnum(read('presentation'), ['flat', 'model', 'worn'] as const, 'flat'),
    visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
    turnaround: Boolean(read('turnaround')),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function textValue(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

function normalizePriority(value: unknown): number {
  const priority = Number(value)
  if (!Number.isFinite(priority)) return 3
  return Math.min(5, Math.max(1, Math.round(priority)))
}

function normalizeExactAge(value: unknown): number | null {
  const age = Number(value)
  return Number.isInteger(age) && age >= 1 && age <= 120 ? age : null
}

function normalizeMediaReference(value: unknown): Record<string, string> | null {
  const reference = asRecord(value)
  if (!reference) return null
  const id = textValue(reference.id, '', 128)
  const url = textValue(reference.url, '', 2_000)
  const name = textValue(reference.name, '', 255)
  return id && url && name ? { id, url, name } : null
}

function pickEnum<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback
}
