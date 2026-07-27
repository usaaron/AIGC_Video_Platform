import type {
  Asset,
  CreateAsset,
  CreateProject,
  CreateShot,
  GenerateShotsRequest,
  Principal,
  ScriptAssetSuggestion,
  ScriptCreativeDirection,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import {
  SCRIPT_OPERATION_CREDITS,
  scriptAssetSuggestionsContentSchema,
  scriptReviewContentSchema,
} from '@seqora/contracts'
import { z } from 'zod'
import { AppError } from '../../core/errors.js'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { ProjectRepository } from './repository.js'

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

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n创作方向（必须落实）：${directionSummary(direction)}\n已有资产：${assetSummary(workspace.assets)}`
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
        result = parseProviderJson(
          response,
          scriptAssetSuggestionsContentSchema,
          '资产建议结果格式错误',
          (value) => normalizeScriptAssetSuggestionsContent(value, source, direction),
        )
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
    clientRequestId: string,
    principal: Principal,
  ) {
    const workspace = this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source = draft.trim() || workspace.project.synopsis.trim()
    if (!source) throw new AppError(400, 'SCRIPT_SOURCE_REQUIRED', '请先填写故事梗概或剧本草稿')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n创作方向（必须落实）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}`
    return this.runBillableScriptOperation(
      principal,
      `script-generate-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.generate,
      '快速生成剧本',
      async () => {
        const preserveLongSource = isLongScript(source)
        const candidate = normalizeExpandedScript(
          await this.textProvider!.generate({
            systemPrompt: preserveLongSource ? LONG_SCRIPT_SYSTEM_PROMPT : QUICK_SCRIPT_SYSTEM_PROMPT,
            userPrompt: preserveLongSource
              ? `${projectContext}\n\n这是长篇原稿。请在不删减、不合并、不改写剧情事实的前提下，逐场保留全部内容，只补齐缺失的视觉字段；原稿有多少场就保留多少场，不要压缩成 4 到 6 场，也不要为了适配短视频而删掉段落。\n\n原稿：\n${source}`
              : `${projectContext}\n\n请把以下素材改编成 15 到 30 秒视频可以直接使用的快速剧本骨架：\n${source}`,
            maxOutputTokens: preserveLongSource ? longScriptMaxOutputTokens(source) : QUICK_SCRIPT_MAX_TOKENS,
          }),
        )
        const preserved = preserveLongSource && candidateIsTooShort(source, candidate)
        const script = preserved ? source : candidate
        const warnings = preserved
          ? ['检测到长篇原稿，AI 输出过短，系统已自动保留原稿，避免剧情被压缩。']
          : quickScriptIssues(script)
        const updated = await this.repository.update(projectId, { script }, principal)
        if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
        return { script: updated.script, mode: 'quick' as const, warnings }
      },
    )
  }

  async enrichScript(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    clientRequestId: string,
    principal: Principal,
  ) {
    const workspace = this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source = script.trim() || workspace.project.script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先生成或填写快速剧本')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n创作方向（必须落实）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}`
    return this.runBillableScriptOperation(
      principal,
      `script-enrich-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.enrich,
      '补齐剧本专业视觉细节',
      async () => {
        const candidate = normalizeExpandedScript(
          await this.textProvider!.generate({
            systemPrompt: SCRIPT_DETAIL_SYSTEM_PROMPT,
            userPrompt: `${projectContext}\n\n请在保留原有场景数量、剧情因果和对白的前提下，补齐以下快速剧本的专业视觉细节：\n${source}`,
            maxOutputTokens: isLongScript(source)
              ? longScriptMaxOutputTokens(source)
              : SCRIPT_DETAIL_MAX_TOKENS,
          }),
        )
        const preserved = isLongScript(source) && candidateIsTooShort(source, candidate)
        const enriched = preserved ? source : candidate
        const warnings = preserved
          ? ['检测到长篇原稿，AI 输出过短，系统已自动保留原稿，避免剧情被压缩。']
          : detailedScriptIssues(enriched)
        const updated = await this.repository.update(projectId, { script: enriched }, principal)
        if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
        return { script: updated.script, mode: 'detailed' as const, warnings }
      },
    )
  }

  async reviewScript(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    clientRequestId: string,
    principal: Principal,
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
          userPrompt: `项目：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n创作方向：${directionSummary(direction)}\n\n待审核剧本：\n${source}`,
          maxOutputTokens: 4_000,
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
  ): Promise<T> {
    if (!this.creditLedger) return operation()
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

    const paragraphs = source
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
    const shots =
      input.mode === 'beat'
        ? splitScriptIntoBeatShots(paragraphs, input.maxShots)
        : splitScriptIntoSceneShots(paragraphs, input.maxShots)
    return this.repository.replaceShots(projectId, shots, principal)
  }
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
8. prompt 必须是可直接进入资产生成的中文视觉描述；场景 prompt 必须是空场景并预留表演空间；服装 prompt 只描述服装本身，不写脸；道具 prompt 只描述物件本身。`

const SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS = 6_000

const QUICK_SCRIPT_SYSTEM_PROMPT = `你是中文漫剧的快速编剧。你的任务不是写长篇小说，而是把用户素材整理成 15 到 30 秒视频可以直接进入分镜的故事骨架。

硬性规格：
1. 输出 4 到 6 个场景，总长度约 800 到 1600 个中文字符。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 每行只使用这 6 个基础字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：。
4. 剧情必须有明确目标、阻力、变化和结果；不要写空泛的“氛围感”“电影感”。
5. 动作必须是可以被摄像机看见的连续动作，明确谁在什么位置做什么；不要只写心理活动。
6. 对白要短、口语化并推动冲突；没有对白时写“无台词”，同时写清人物反应。
7. 场景之间必须保持人物、地点、时间、服装和关键物件连续；每一场都要推动主线。
8. 结尾留下一个清晰的悬念、决定或下一步动作，方便后续补齐专业视觉细节。

只输出 4 到 6 行剧本正文。`

const SCRIPT_DETAIL_SYSTEM_PROMPT = `你是中文漫剧的视觉导演和分镜前置编剧。请把快速剧本补齐为可直接用于资产设计、分镜和视频生成的制作级剧本。

硬性规格：
1. 保留原剧本的场景数量、人物、地点、关键物件、剧情因果和对白，不要另起炉灶，不要扩展成新的长故事。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 在原有基础字段后补齐：风格：｜构图：｜光影：｜运镜：｜衔接：。
4. 剧情写清本场目标、阻力、转折和结果；动作写清起势、过程、结束姿态以及与环境或物件的互动。
5. 风格必须落实项目选择的视觉类型、材质和色彩；构图必须写景别、主体位置、前中后景和画面重心。
6. 光影必须写主光来源、方向、软硬、色温和明暗关系；运镜必须写机位、运动方式、速度、运动对象和结束画面。
7. 衔接必须说明承接上一场的时间、动作、视线、人物位置或物件状态，并给下一场留下明确动作接点。
8. 所有视觉内容必须服务于原剧情，禁止添加新的角色、道具、回忆、梦境或突然转场。

只输出补齐后的剧本正文。`

const QUICK_SCRIPT_MAX_TOKENS = 2_400
const SCRIPT_DETAIL_MAX_TOKENS = 4_000
const LONG_SCRIPT_PRESERVE_THRESHOLD = 2_000
const LONG_SCRIPT_MAX_TOKENS = 16_000

const LONG_SCRIPT_SYSTEM_PROMPT = `你是中文漫剧的长篇剧本整理编辑和视觉导演。你的首要规则是保留原稿，不得为了追求短小而删减内容。

硬性规则：
1. 保留原稿的全部场景、人物、对白、动作、剧情因果、时间顺序和结局，不合并场景，不概括段落，不把长稿改成 4 到 6 场。
2. 可以在每个原有场景内部补齐风格、构图、光影、运镜和衔接字段，但这些字段必须服务原剧情，不能替换原文。
3. 如果输出长度受到限制，优先原样输出原稿，不要只输出摘要或前后片段。
4. 只输出剧本文本，不要标题、解释、Markdown 或分析。`

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

function normalizeExpandedScript(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function isLongScript(script: string): boolean {
  return contentLength(script) > LONG_SCRIPT_PRESERVE_THRESHOLD
}

function candidateIsTooShort(source: string, candidate: string): boolean {
  return contentLength(candidate) < Math.floor(contentLength(source) * 0.85)
}

function longScriptMaxOutputTokens(source: string): number {
  return Math.min(LONG_SCRIPT_MAX_TOKENS, Math.max(6_000, Math.ceil(contentLength(source) * 1.6)))
}

function contentLength(value: string): number {
  return value.replace(/\s/g, '').length
}

function scriptScenes(script: string): string[] {
  return script
    .split(/\n+/)
    .map((scene) => scene.trim())
    .filter(Boolean)
}

function quickScriptIssues(script: string): string[] {
  const issues: string[] = []
  const characterCount = script.replace(/\s/g, '').length
  const scenes = scriptScenes(script)

  if (characterCount < 700) issues.push(`内容仅 ${characterCount} 字，建议补充到 800 字左右`)
  if (scenes.length < 4 || scenes.length > 6) issues.push(`当前 ${scenes.length} 个场景，建议保持 4 到 6 个`)
  for (const field of QUICK_SCRIPT_FIELDS) {
    const missing = scenes.filter((scene) => !new RegExp(`${field}[：:]`).test(scene)).length
    if (missing) issues.push(`${missing} 个场景缺少“${field}”字段`)
  }
  const shortScenes = scenes.filter((scene) => scene.replace(/\s/g, '').length < 90).length
  if (shortScenes) issues.push(`${shortScenes} 个场景内容过短`)
  return issues
}

function detailedScriptIssues(script: string): string[] {
  const issues: string[] = []
  const scenes = scriptScenes(script)
  if (scenes.length < 4 || scenes.length > 6)
    issues.push(`当前 ${scenes.length} 个场景，建议保持与快速剧本一致`)
  for (const field of SCRIPT_SCENE_FIELDS) {
    const missing = scenes.filter((scene) => !new RegExp(`${field}[：:]`).test(scene)).length
    if (missing) issues.push(`${missing} 个场景缺少“${field}”字段`)
  }
  return issues
}

const SCRIPT_ASSET_FIELD_BOUNDARIES = [
  '场次',
  '剧情',
  '场景',
  '地点',
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
const SCRIPT_ASSET_KINDS = ['character', 'scene', 'prop', 'costume'] as const
const VISUAL_STYLE_VALUES = [
  'photorealistic',
  'cinematic-cg',
  'chinese-3d',
  'chinese-2d',
  'anime',
  'storybook',
] as const
const CHARACTER_SUBJECT_TYPES = ['human', 'animal'] as const
const CHARACTER_GENDERS = ['male', 'female', 'unspecified'] as const
const CHARACTER_AGE_GROUPS = ['child', 'teen', 'young', 'middle', 'senior'] as const
const CHARACTER_FRAMINGS = ['portrait', 'half', 'full'] as const
const CHARACTER_BODY_TYPES = ['slim', 'balanced', 'athletic', 'full'] as const
const ASSET_BACKGROUNDS = ['solid', 'transparent', 'environment'] as const
const SCENE_SPACES = ['interior', 'exterior'] as const
const SCENE_TYPES = [
  'city',
  'street',
  'residential',
  'commercial',
  'nature',
  'ancient',
  'industrial',
  'fantasy',
] as const
const SCENE_ERAS = ['ancient', 'recent', 'modern', 'future'] as const
const SCENE_TIMES = ['dawn', 'day', 'sunset', 'night'] as const
const SCENE_WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'fog'] as const
const SCENE_MOODS = ['warm', 'tense', 'mystery', 'romantic', 'epic', 'desolate'] as const
const SCENE_CAMERAS = ['eye-level', 'overhead', 'low-angle', 'aerial', 'wide'] as const
const PROP_CATEGORIES = [
  'weapon',
  'vehicle',
  'furniture',
  'electronics',
  'jewelry',
  'food',
  'daily',
  'other',
] as const
const PROP_MATERIALS = ['wood', 'metal', 'glass', 'fabric', 'leather', 'ceramic', 'mixed'] as const
const PROP_CONDITIONS = ['new', 'used', 'aged', 'damaged'] as const
const PROP_VIEWS = ['front', 'side', 'turnaround'] as const
const COSTUME_AUDIENCES = ['male', 'female', 'unisex'] as const
const COSTUME_CATEGORIES = [
  'daily',
  'formal',
  'professional',
  'uniform',
  'ancient',
  'ceremonial',
  'fantasy',
  'armor',
] as const
const COSTUME_SEASONS = ['spring-summer', 'autumn-winter', 'all-season'] as const
const COSTUME_DESIGNS = ['minimal', 'luxury', 'retro', 'future', 'chinese'] as const
const COSTUME_PRESENTATIONS = ['flat', 'model', 'worn'] as const
type CharacterAssetSuggestion = Extract<ScriptAssetSuggestion, { kind: 'character' }>
type SceneAssetSuggestion = Extract<ScriptAssetSuggestion, { kind: 'scene' }>
type PropAssetSuggestion = Extract<ScriptAssetSuggestion, { kind: 'prop' }>
type CostumeAssetSuggestion = Extract<ScriptAssetSuggestion, { kind: 'costume' }>
type ScriptAssetKind = (typeof SCRIPT_ASSET_KINDS)[number]

function normalizeScriptAssetSuggestionsContent(
  value: unknown,
  script: string,
  direction: ScriptCreativeDirection,
): unknown {
  if (!isRecord(value)) return value
  const fallback = fallbackAssetSuggestions(script, direction)
  const assets = (Array.isArray(value.assets) ? value.assets : [])
    .map((asset) => normalizeProviderAssetSuggestion(asset, script, direction))
    .filter((asset): asset is ScriptAssetSuggestion => asset !== null)

  return {
    summary: normalizedString(value.summary) || fallback.summary,
    assets: assets.length ? assets : fallback.assets,
  }
}

function normalizeProviderAssetSuggestion(
  value: unknown,
  script: string,
  direction: ScriptCreativeDirection,
): ScriptAssetSuggestion | null {
  if (!isRecord(value)) return null
  const kind = normalizedString(value.kind)
  if (!isScriptAssetKind(kind)) return null
  const name = normalizedString(value.name)
  if (!name) return null
  const attributes = isRecord(value.attributes) ? value.attributes : {}
  const base = {
    name,
    description:
      normalizedString(value.description) || `从剧本中提取的${scriptAssetKindLabel(kind)}资产：${name}`,
    prompt: normalizedString(value.prompt) || `${name}，中文 AI 视频资产设定，造型清晰，适合后续多镜头复用。`,
    negativePrompt: normalizedString(value.negativePrompt),
    reason: normalizedString(value.reason) || '该资产会在后续分镜或视频生成中复用，需要保持一致。',
    priority: normalizedPriority(value.priority),
  }

  if (kind === 'character') {
    return {
      kind,
      ...base,
      description: normalizedString(value.description) || characterDescription(name, script),
      prompt: normalizedString(value.prompt) || characterPrompt(name, script, direction),
      attributes: normalizeCharacterAttributes(attributes, name, script, direction),
    }
  }
  if (kind === 'scene') {
    return {
      kind,
      ...base,
      attributes: normalizeSceneAttributes(attributes, name, direction),
    }
  }
  if (kind === 'prop') {
    return {
      kind,
      ...base,
      attributes: normalizePropAttributes(attributes, name, direction),
    }
  }
  return {
    kind,
    ...base,
    attributes: normalizeCostumeAttributes(attributes, name, direction),
  }
}

function fallbackAssetSuggestions(
  script: string,
  direction: ScriptCreativeDirection,
): { summary: string; assets: ScriptAssetSuggestion[] } {
  const characters = uniqueValues([
    ...knownBianchengCharacters(script),
    ...extractAssetNames(script, ['角色', '人物', '主角'], ['主角'], 4),
  ]).slice(0, 4)
  const scenes = uniqueValues([
    ...knownBianchengScenes(script),
    ...extractAssetNames(script, ['场景', '地点'], ['核心场景'], 4),
  ]).slice(0, 4)
  const props = uniqueValues([
    ...knownBianchengProps(script),
    ...extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 5),
  ]).slice(0, 5)
  const costumes = uniqueValues([
    ...knownBianchengCostumes(script),
    ...extractAssetNames(script, ['服装', '衣装', '外观'], [], 4),
  ]).slice(0, 4)

  const assets: ScriptAssetSuggestion[] = [
    ...characters.map((name): ScriptAssetSuggestion => ({
      kind: 'character',
      name,
      description: characterDescription(name, script),
      prompt: characterPrompt(name, script, direction),
      negativePrompt: '',
      reason: '角色在剧本中出现，需要在资产设计阶段人工确认后保持一致。',
      priority: ['翠翠', '老船夫', '主角'].includes(name) ? 5 : 4,
      attributes: normalizeCharacterAttributes({}, name, script, direction),
    })),
    ...scenes.map((name): ScriptAssetSuggestion => ({
      kind: 'scene',
      name,
      description: sceneDescription(name),
      prompt: scenePrompt(name, direction),
      negativePrompt: '',
      reason: '该地点会承载多个镜头，建议提前建立可复用空场景。',
      priority: name.includes('渡口') ? 5 : 3,
      attributes: normalizeSceneAttributes({}, name, direction),
    })),
    ...props.map((name): ScriptAssetSuggestion => ({
      kind: 'prop',
      name,
      description: propDescription(name),
      prompt: propPrompt(name, direction),
      negativePrompt: '',
      reason: '该物件会影响镜头动作或剧情识别，建议作为独立道具管理。',
      priority: ['渡船', '白塔'].includes(name) ? 4 : 3,
      attributes: normalizePropAttributes({}, name, direction),
    })),
    ...costumes.map((name): ScriptAssetSuggestion => ({
      kind: 'costume',
      name,
      description: costumeDescription(name),
      prompt: costumePrompt(name, direction),
      negativePrompt: '',
      reason: '服装决定角色跨镜头一致性，建议人工确认后写入资产。',
      priority: name.includes('翠翠') ? 4 : 3,
      attributes: normalizeCostumeAttributes({}, name, direction),
    })),
  ]

  return {
    summary: '已根据剧本文本提取角色、场景、道具和服装建议；请在资产设计中逐项人工确认后再生成。',
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
  const uniqueNames = uniqueValues(values.map(cleanAssetName).filter(Boolean)).filter(
    (value) => !SCRIPT_ASSET_STOP_WORDS.has(value),
  )
  return (uniqueNames.length ? uniqueNames : fallback).slice(0, limit)
}

function splitAssetNameList(value: string): string[] {
  return value
    .split(/[、，,；;和与]/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function cleanAssetName(value: string): string {
  return value
    .replace(/[。.!！?？].*$/u, '')
    .replace(/^(?:\d{1,3}|[一二三四五六七八九十百]+)岁(?:的)?/u, '')
    .replace(/^(一个|一位|一名|若干|多个|几名|核心|重要|关键)/u, '')
    .replace(/(等人|等等|等|们)$/u, '')
    .trim()
}

function knownBianchengCharacters(script: string): string[] {
  const names: string[] = []
  if (/老船夫|祖父|爷爷|摆渡老人/u.test(script)) names.push('老船夫')
  if (/翠翠|十三岁/u.test(script)) names.push('翠翠')
  if (/黄狗|家犬/u.test(script)) names.push('黄狗')
  return names
}

function knownBianchengScenes(script: string): string[] {
  return /茶峒|渡口|溪边|河岸/u.test(script) ? ['茶峒渡口'] : []
}

function knownBianchengProps(script: string): string[] {
  const props: string[] = []
  if (/渡船|摆渡|撑船/u.test(script)) props.push('渡船')
  if (/白塔/u.test(script)) props.push('白塔')
  return props
}

function knownBianchengCostumes(script: string): string[] {
  const costumes: string[] = []
  if (/翠翠/u.test(script)) costumes.push('翠翠日常衣装')
  if (/老船夫|祖父|摆渡老人/u.test(script)) costumes.push('老船夫日常衣装')
  return costumes
}

function normalizeCharacterAttributes(
  value: Record<string, unknown>,
  name: string,
  script: string,
  direction: ScriptCreativeDirection,
): CharacterAssetSuggestion['attributes'] {
  const inferred = inferCharacterProfile(name, script)
  return {
    type: 'character',
    subjectType: pickEnum(value.subjectType, CHARACTER_SUBJECT_TYPES, inferred.subjectType),
    gender: pickEnum(value.gender, CHARACTER_GENDERS, inferred.gender),
    ageGroup: pickEnum(value.ageGroup, CHARACTER_AGE_GROUPS, inferred.ageGroup),
    exactAge: nullableInteger(value.exactAge, 1, 120, inferred.exactAge),
    species: normalizedString(value.species) || inferred.species,
    anthropomorphic: typeof value.anthropomorphic === 'boolean' ? value.anthropomorphic : false,
    visualStyle: pickEnum(value.visualStyle, VISUAL_STYLE_VALUES, suggestionVisualStyle(direction)),
    framing: pickEnum(value.framing, CHARACTER_FRAMINGS, 'full'),
    bodyType: pickEnum(value.bodyType, CHARACTER_BODY_TYPES, 'balanced'),
    background: pickEnum(value.background, ASSET_BACKGROUNDS, 'solid'),
    faceStatus: 'pending',
    bodyStatus: 'pending',
    faceReference: null,
    bodyReference: null,
    portraitSource: 'ai-virtual',
    trustedPortrait: null,
    legStretch: typeof value.legStretch === 'boolean' ? value.legStretch : false,
    turnaround: typeof value.turnaround === 'boolean' ? value.turnaround : false,
    turnaroundLayout: value.turnaroundLayout === 'separate' ? 'separate' : 'sheet',
  }
}

function normalizeSceneAttributes(
  value: Record<string, unknown>,
  name: string,
  direction: ScriptCreativeDirection,
): SceneAssetSuggestion['attributes'] {
  return {
    type: 'scene',
    space: pickEnum(value.space, SCENE_SPACES, 'exterior'),
    sceneType: pickEnum(value.sceneType, SCENE_TYPES, inferSceneType(name)),
    era: pickEnum(value.era, SCENE_ERAS, inferEra(name)),
    time: pickEnum(value.time, SCENE_TIMES, 'day'),
    weather: pickEnum(value.weather, SCENE_WEATHERS, 'clear'),
    mood: pickEnum(value.mood, SCENE_MOODS, 'warm'),
    camera: pickEnum(value.camera, SCENE_CAMERAS, 'wide'),
    visualStyle: pickEnum(value.visualStyle, VISUAL_STYLE_VALUES, suggestionVisualStyle(direction)),
    emptyScene: typeof value.emptyScene === 'boolean' ? value.emptyScene : true,
    activitySpace: typeof value.activitySpace === 'boolean' ? value.activitySpace : true,
  }
}

function normalizePropAttributes(
  value: Record<string, unknown>,
  name: string,
  direction: ScriptCreativeDirection,
): PropAssetSuggestion['attributes'] {
  return {
    type: 'prop',
    category: pickEnum(value.category, PROP_CATEGORIES, inferPropCategory(name)),
    material: pickEnum(value.material, PROP_MATERIALS, inferPropMaterial(name)),
    condition: pickEnum(value.condition, PROP_CONDITIONS, 'used'),
    view: pickEnum(value.view, PROP_VIEWS, 'front'),
    background: pickEnum(value.background, ASSET_BACKGROUNDS, 'solid'),
    visualStyle: pickEnum(value.visualStyle, VISUAL_STYLE_VALUES, suggestionVisualStyle(direction)),
  }
}

function normalizeCostumeAttributes(
  value: Record<string, unknown>,
  name: string,
  direction: ScriptCreativeDirection,
): CostumeAssetSuggestion['attributes'] {
  return {
    type: 'costume',
    audience: pickEnum(value.audience, COSTUME_AUDIENCES, inferCostumeAudience(name)),
    category: pickEnum(value.category, COSTUME_CATEGORIES, 'daily'),
    season: pickEnum(value.season, COSTUME_SEASONS, 'all-season'),
    design: pickEnum(value.design, COSTUME_DESIGNS, 'chinese'),
    presentation: pickEnum(value.presentation, COSTUME_PRESENTATIONS, 'flat'),
    visualStyle: pickEnum(value.visualStyle, VISUAL_STYLE_VALUES, suggestionVisualStyle(direction)),
    turnaround: typeof value.turnaround === 'boolean' ? value.turnaround : false,
  }
}

function inferCharacterProfile(name: string, script: string) {
  const animal = /狗|犬|马|猫|鸟|兽/u.test(name)
  const localContext = localCharacterContext(name, script)
  const exactAge = animal
    ? null
    : name.includes('翠翠')
      ? 13
      : name.includes('老船夫')
        ? 70
        : (inferExactAge(name) ?? inferExactAge(localContext))
  return {
    subjectType: animal ? ('animal' as const) : ('human' as const),
    gender: animal
      ? ('unspecified' as const)
      : name.includes('翠翠')
        ? ('female' as const)
        : name.includes('老船夫')
          ? ('male' as const)
          : /女性|少女|女孩|女/u.test(localContext)
            ? ('female' as const)
            : /男性|男/u.test(localContext)
              ? ('male' as const)
              : ('unspecified' as const),
    ageGroup: animal
      ? ('young' as const)
      : exactAge && exactAge <= 12
        ? ('child' as const)
        : exactAge && exactAge <= 17
          ? ('teen' as const)
          : /老船夫|祖父|爷爷|七十|老人|老年/u.test(`${name}\n${localContext}`)
            ? ('senior' as const)
            : /中年/u.test(`${name}\n${localContext}`)
              ? ('middle' as const)
              : ('young' as const),
    exactAge,
    species: animal ? (name.includes('黄狗') ? '黄狗' : name) : '',
  }
}

function localCharacterContext(name: string, script: string): string {
  const normalizedName = name.replace(/^(?:\d{1,3}|[一二三四五六七八九十百]+)岁(?:的)?/u, '')
  const index = script.indexOf(normalizedName || name)
  if (index < 0) return ''
  return script.slice(Math.max(0, index - 40), index + normalizedName.length + 80)
}

function inferExactAge(value: string): number | null {
  const numeric = value.match(/(\d{1,3})\s*岁/u)
  if (numeric) return Math.min(120, Math.max(1, Number(numeric[1])))
  if (/十三岁|十三岁的/u.test(value)) return 13
  if (/七十岁|七十岁的/u.test(value)) return 70
  return null
}

function characterDescription(name: string, script: string): string {
  const profile = inferCharacterProfile(name, script)
  if (profile.subjectType === 'animal')
    return `动物角色，${profile.species || name}，陪伴主要人物并参与场景动作。`
  if (name.includes('翠翠')) return '女性，少年，精确年龄 13，老船夫抚养的湘西少女，渡口长大。'
  if (name.includes('老船夫')) return '男性，老年，精确年龄 70，茶峒渡口船夫/摆渡人，翠翠的祖父。'
  const gender = profile.gender === 'female' ? '女性' : profile.gender === 'male' ? '男性' : '性别未指定'
  const age = profile.exactAge ? `精确年龄 ${profile.exactAge}` : ageGroupLabel(profile.ageGroup)
  return `${gender}，${age}，从剧本中提取的核心角色。`
}

function characterPrompt(name: string, script: string, direction: ScriptCreativeDirection): string {
  const profile = inferCharacterProfile(name, script)
  const style = suggestionVisualStyleLabel(direction)
  if (name.includes('翠翠')) {
    return `${name}，十三岁湘西少女，天真敏捷，青山绿水间长大，朴素衣着，清澈眼神，带一点戒备感，${style}。`
  }
  if (name.includes('老船夫')) {
    return `七十岁湘西男性船夫/摆渡人，长期风吹日晒的面部纹理，朴素旧衣，沉稳慈和，${style}。`
  }
  if (profile.subjectType === 'animal') {
    return `${profile.species || name}/家犬，自然动物形态，毛色清晰，适合乡土场景，多镜头一致，${style}。`
  }
  return `${name}，中文 AI 视频人物资产，面部特征清晰，服装身份明确，多镜头一致，${style}。`
}

function sceneDescription(name: string): string {
  if (name.includes('渡口')) return '翠翠与老船夫生活的核心外景，包含溪水、渡船、岸边木屋和白塔方向。'
  return `从剧本中提取的复用场景：${name}。`
}

function scenePrompt(name: string, direction: ScriptCreativeDirection): string {
  const style = suggestionVisualStyleLabel(direction)
  if (name.includes('渡口')) {
    return `湘西茶峒渡口空场景，溪水、渡船停靠处、岸边木屋、青山和白塔方向，预留人物表演空间，${style}。`
  }
  return `${name}空场景，空间层次清晰，预留人物表演和镜头运动空间，${style}。`
}

function propDescription(name: string): string {
  if (name === '渡船') return '老船夫日常摆渡使用的小船，是动作和场景调度核心道具。'
  if (name === '白塔') return '渡口附近反复出现的地标，承载地方记忆和空间识别。'
  return `从剧本中提取的重要道具：${name}。`
}

function propPrompt(name: string, direction: ScriptCreativeDirection): string {
  const style = suggestionVisualStyleLabel(direction)
  if (name === '渡船') return `旧木渡船道具，木纹清晰，使用痕迹自然，正面展示，${style}。`
  if (name === '白塔') return `湘西渡口附近白塔地标，石质或灰白材质，细节清晰，独立道具/地标参考，${style}。`
  return `${name}道具，主体完整，材质清晰，适合影视资产复用，${style}。`
}

function costumeDescription(name: string): string {
  if (name.includes('翠翠')) return '翠翠在渡口生活的朴素日常服装，用于保持角色跨镜头一致。'
  if (name.includes('老船夫')) return '老船夫日常摆渡服装，朴素、旧而干净，便于动作表演。'
  return `从剧本中提取的核心服装：${name}。`
}

function costumePrompt(name: string, direction: ScriptCreativeDirection): string {
  const style = suggestionVisualStyleLabel(direction)
  if (name.includes('翠翠'))
    return `十三岁湘西少女朴素日常衣装，布料自然，便于山水渡口活动，完整平铺展示，${style}。`
  if (name.includes('老船夫'))
    return `湘西老年船夫朴素旧衣装，耐磨布料，适合撑船劳作，完整平铺展示，${style}。`
  return `${name}服装设定，结构完整，材质清晰，不包含面部，${style}。`
}

function deduplicateAssetSuggestions(
  suggestions: ScriptAssetSuggestion[],
  existingAssets: Asset[],
): ScriptAssetSuggestion[] {
  const existing = new Set(existingAssets.map((asset) => assetSuggestionIdentity(asset.kind, asset.name)))
  const seen = new Set<string>()
  return suggestions.filter((asset) => {
    const key = assetSuggestionIdentity(asset.kind, asset.name)
    if (existing.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function assetSuggestionIdentity(kind: string, name: string): string {
  return `${kind}:${name.trim().toLocaleLowerCase('zh-CN')}`
}

function scriptAssetKindLabel(kind: string): string {
  return kind === 'character' ? '角色' : kind === 'scene' ? '场景' : kind === 'prop' ? '道具' : '服装'
}

function suggestionVisualStyle(direction: ScriptCreativeDirection): (typeof VISUAL_STYLE_VALUES)[number] {
  return direction.style === 'auto'
    ? 'cinematic-cg'
    : pickEnum(direction.style, VISUAL_STYLE_VALUES, 'cinematic-cg')
}

function suggestionVisualStyleLabel(direction: ScriptCreativeDirection): string {
  return directionLabels.style[suggestionVisualStyle(direction)] || '影视 CG'
}

function inferSceneType(name: string): (typeof SCENE_TYPES)[number] {
  if (/山|水|河|溪|渡口|森林|自然/u.test(name)) return 'nature'
  if (/街|路/u.test(name)) return 'street'
  if (/家|屋|宅|房/u.test(name)) return 'residential'
  if (/古|塔|城/u.test(name)) return 'ancient'
  return 'street'
}

function inferEra(name: string): (typeof SCENE_ERAS)[number] {
  if (/古|塔|城/u.test(name)) return 'recent'
  return 'modern'
}

function inferPropCategory(name: string): (typeof PROP_CATEGORIES)[number] {
  if (/船|车|马车/u.test(name)) return 'vehicle'
  if (/剑|刀|枪/u.test(name)) return 'weapon'
  if (/塔/u.test(name)) return 'other'
  return 'daily'
}

function inferPropMaterial(name: string): (typeof PROP_MATERIALS)[number] {
  if (/船|木/u.test(name)) return 'wood'
  if (/塔|石/u.test(name)) return 'ceramic'
  if (/布|衣/u.test(name)) return 'fabric'
  return 'mixed'
}

function inferCostumeAudience(name: string): (typeof COSTUME_AUDIENCES)[number] {
  if (/翠翠|女|少女/u.test(name)) return 'female'
  if (/老船夫|男|男性/u.test(name)) return 'male'
  return 'unisex'
}

function ageGroupLabel(value: (typeof CHARACTER_AGE_GROUPS)[number]): string {
  return value === 'child'
    ? '儿童'
    : value === 'teen'
      ? '少年'
      : value === 'middle'
        ? '中年'
        : value === 'senior'
          ? '老年'
          : '青年'
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = cleanAssetName(value)
    const key = normalized.toLocaleLowerCase('zh-CN')
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedPriority(value: unknown): number {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(5, Math.max(1, parsed)) : 3
}

function nullableInteger(value: unknown, min: number, max: number, fallback: number | null): number | null {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function pickEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  const normalized = normalizedString(value)
  return values.includes(normalized as T) ? (normalized as T) : fallback
}

function isScriptAssetKind(value: string): value is ScriptAssetKind {
  return SCRIPT_ASSET_KINDS.includes(value as ScriptAssetKind)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

function splitScriptIntoBeatShots(paragraphs: string[], maxShots: number): CreateShot[] {
  const shots: CreateShot[] = []
  for (const [sceneIndex, paragraph] of paragraphs.entries()) {
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
        continuityMode: beatIndex === 0 ? 'independent' : 'continue',
        continuityNote: continuityNoteFor(
          beatIndex > 0 ? beats[beatIndex - 1] || '' : paragraphs[sceneIndex - 1] || '',
          beat,
          beatIndex > 0 ? '上一镜' : '上一场',
        ),
      })
    }
  }
  return shots
}

function splitScriptIntoSceneShots(paragraphs: string[], maxShots: number): CreateShot[] {
  return paragraphs.slice(0, Math.min(8, maxShots)).map((paragraph, index) => ({
    title: `镜头 ${String(index + 1).padStart(2, '0')}`,
    framing: index === 0 ? '大全景' : index % 3 === 0 ? '特写' : '中景',
    duration: Math.min(8, Math.max(4, Math.ceil(paragraph.length / 18))),
    prompt: paragraph,
    negativePrompt: '',
    imageUrl: null,
    continuityMode: 'independent' as const,
    continuityNote: continuityNoteFor(paragraphs[index - 1] || '', paragraph, '上一场'),
  }))
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
  return [
    fieldPart('场次', fields.场次, 24),
    fieldPart('场景', fields.场景, 180),
    fieldPart('角色', fields.角色, 180),
    fieldPart('动作', beat, 240),
    fieldPart('对白', dialogue, 140),
    fieldPart('风格', fields.风格, 120),
    fieldPart('构图', fields.构图, 140),
    fieldPart('光影', fields.光影, 120),
    fieldPart('运镜', fields.运镜, 120),
    fieldPart('衔接', fields.衔接, 120),
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
