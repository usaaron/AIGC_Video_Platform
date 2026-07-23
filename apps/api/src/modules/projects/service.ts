import type {
  Asset,
  CreateAsset,
  CreateProject,
  CreateShot,
  GenerateShotsRequest,
  Principal,
  ScriptCreativeDirection,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import { SCRIPT_OPERATION_CREDITS, scriptReviewContentSchema } from '@seqora/contracts'
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

function parseProviderJson<T>(raw: string, schema: z.ZodType<T>, errorMessage: string): T {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0)
  const start = starts.length ? Math.min(...starts) : -1
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (start < 0 || end < start) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
  try {
    return schema.parse(JSON.parse(text.slice(start, end + 1)))
  } catch {
    throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
  }
}
