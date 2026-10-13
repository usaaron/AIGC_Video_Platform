import { mapShotReferenceTokens } from './shotReferences.js'
import { cleanShotContinuityNote, cleanStoryboardPrompt } from './storyboardPrompt.js'
import { prioritizeShotExecution, referenceVisualDetail } from './videoShotExecution.js'
import { RIGID_OBJECT_VIDEO_RULE, SCENE_EXECUTION_VIDEO_RULE } from './sceneExecution.js'
import { deriveRigidPhysicsContract } from './rigidPhysicsContract.js'

export const VIDEO_PROMPT_VERSION = 'seedance-storyboard-v22'

export type PromptProject = {
  aspectRatio: string
  contentType?: string
  visualStyle?: string
  script?: string
}

export type PromptShot = {
  id: string
  title?: string
  framing?: string
  duration?: number
  prompt?: string
  continuityNote?: string
}

export type PromptAsset = {
  id: string
  kind: string
  name: string
  description?: string
  prompt?: string
  attributes?: unknown
}

export type PromptReference = { id: string; appearance?: { name: string; description: string }; imageBindings?: { number: number; purpose: string; view?: string }[] }

const ASSET_KIND_LABELS: Record<string, string> = {
  character: '人物',
  scene: '场景',
  prop: '物品',
  costume: '服装',
  brand: '品牌',
}

export function compileStoryboardVideoPrompt(input: {
  project: PromptProject
  shot: PromptShot
  shots?: PromptShot[]
  assets?: PromptAsset[]
  references?: PromptReference[]
  continuityMode?: 'independent' | 'continue'
  manualReferenceCount?: number
}): string {
  const { project, shot, assets = [], references = [], continuityMode = 'independent' } = input
  const duration = normalizedVideoDuration(shot.duration, project.contentType === 'short-drama' ? 3 : 4)
  const source = normalizeRigidObjectContradictions(cleanStoryboardPrompt(shot.prompt))
  const mapped =
    input.manualReferenceCount === undefined
      ? source
      : mapShotReferenceTokens(source, input.manualReferenceCount, continuityMode === 'continue')
  const focused = prioritizeShotExecution(mapped, references.some((reference) => reference.imageBindings?.length))
  const prompt = project.contentType === 'advertisement' ? removeScreenTextInstructions(focused) : focused
  const rigidContract = deriveRigidPhysicsContract({ prompt: source })
  const rigidObjectMotion = Boolean(rigidContract?.objects.length)
    && /推|拉|撞|挤|挤压|施压|攀爬|承重|打开|关闭|移动|滑动|倾斜|受力|固定/.test(prompt)
  const singleContinuousShot = /单一连续镜头|连续镜头|不在镜内切换|固定镜头完全静止/.test(source)
  const continuity = cleanShotContinuityNote(shot.continuityNote, continuityMode)
  const referenceAssets = references
    .map((reference) => assets.find((asset) => asset.id === reference.id))
    .filter((asset): asset is PromptAsset => Boolean(asset))
  const identities = referenceAssets.map((asset) =>
    referenceRuleFor(
      asset,
      referenceAssets,
      references.find((reference) => reference.id === asset.id),
    ),
  )
  const silent = /(?:^|[：:，,。；;\n])\s*(?:静音|无声|无音频|不生成声音)(?:[。；;\n]|$)/u.test(prompt)
  return [
    `${duration}秒，${project.aspectRatio}，${visualStyleLabel(project.visualStyle)}。景别：${shot.framing || '中景'}。`,
    input.manualReferenceCount
      ? `参考图按输入顺序编号。${continuityMode === 'continue' ? '图1是上一镜尾帧，' : ''}本镜选择的参考图为图${continuityMode === 'continue' ? 2 : 1}至图${input.manualReferenceCount + (continuityMode === 'continue' ? 1 : 0)}；按正文指定用途使用。`
      : '',
    continuityMode === 'continue'
      ? '接镜：以输入图1（上一镜尾帧）作为开场，继续本镜动作，不重演前镜事件；其他参考图用于外观，不替换开场画面。'
      : '',
    continuity && !(continuity.startsWith('开场：') && prompt.includes(continuity.slice(3)))
      ? `补充说明：${continuity}`
      : '',
    identities.length ? `参考资产：${identities.join('；')}。` : '',
    references.some((reference) => reference.imageBindings?.length)
      ? '身份图不规定景别或动作；视角与造型图只补充对应人物的结构和衣着，不复制背景、站姿或多视图排版。参考中的伤势、湿痕和持物服从本镜明确起止状态，不把其他场次状态带入。'
      : '',
    prompt,
    SCENE_EXECUTION_VIDEO_RULE,
    rigidObjectMotion ? RIGID_OBJECT_VIDEO_RULE : '',
    rigidObjectMotion ? rigidPhysicsExecutionRule(rigidContract) : '',
    singleContinuousShot ? '连续性执行：本镜是一段连续时间流，镜内禁止硬切、跳切、黑场重启、空间重置或无提示换机位；硬切只允许发生在本镜结束后的镜间编辑边界，由后期处理。' : '',
    '执行：保持本镜动作先后、左右手与道具交接；运镜和焦点变化分开执行。按给定秒数完成原文对白与动作，不用异常加速、删词或新增事件填补时长。',
    silent
      ? ''
      : '声音：按正文生成对白和现场声。对白原文只说一次，口型同步；画外音不对口型。未写台词时只生成动作声和环境声，不额外编写对白、旁白或字幕。',
    project.contentType === 'advertisement'
      ? '广告画面不生成汉字、字母、数字、Logo、字幕、招牌或包装文字；文字区域留白，交给后期。'
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function referenceRuleFor(asset: PromptAsset, assets: PromptAsset[], reference?: PromptReference): string {
  const bindings = reference?.imageBindings
  if (bindings && !bindings.length) {
    return `${ASSET_KIND_LABELS[asset.kind] || '资产'}“${asset.name}”本次未附图片，仅按已给文字设定${reference?.appearance ? `；当前造型：${reference.appearance.name}，${referenceVisualDetail(reference.appearance.description)}` : asset.description ? `：${referenceVisualDetail(asset.description)}` : ''}`
  }
  const mapping = bindings?.map((item) => `图${item.number}用于${item.purpose}${item.view && !['body', 'unspecified', 'face'].includes(item.view) ? `（${{ front: '正面', side: '侧面', back: '背面' }[item.view] || item.view}）` : ''}`).join('，')
  return `${mapping ? `“${asset.name}”：${mapping}；` : ''}${identityRuleFor(asset, assets, reference?.appearance)}`
}

function identityRuleFor(
  asset: PromptAsset,
  assets: PromptAsset[],
  appearance?: PromptReference['appearance'],
): string {
  const label = ASSET_KIND_LABELS[asset.kind] || '资产'
  const visualDetail = referenceVisualDetail(asset.description)
  const detail = visualDetail ? `；制作细节：${visualDetail.slice(0, 2_000)}` : ''
  if (asset.kind === 'character') {
    const costume = assets.find(
      (candidate) =>
        candidate.kind === 'costume' && costumeCharacterAssetId(candidate.attributes) === asset.id,
    )
    const appearanceDetail = referenceVisualDetail(appearance?.description)
    const look = appearance
      ? `，服装采用“${appearance.name}”${appearanceDetail ? `（${appearanceDetail}）` : ''}`
      : costume
        ? `，服装采用“${costume.name}”`
        : '，服装与对应参考图一致'
    // A selected wardrobe description is authoritative for this shot. Do not
    // append the base character's clothing summary and accidentally override
    // the chosen appearance; use the base detail only for the default look.
    return `${label}“${asset.name}”沿用对应参考图的面部、发型和体型${look}${appearance ? '' : detail}`
  }
  if (asset.kind === 'costume') {
    const owner = assets.find((candidate) => candidate.id === costumeCharacterAssetId(asset.attributes))
    return `服装“${asset.name}”${owner ? `穿在“${owner.name}”身上，` : ''}采用对应参考图的款式和颜色${detail}`
  }
  return `${label}“${asset.name}”采用对应参考图的外观${detail}`
}

function costumeCharacterAssetId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = (value as Record<string, unknown>).characterAssetId
  return typeof id === 'string' && id ? id : null
}

export function extractScreenText(value: string | undefined): string {
  return [...String(value || '').matchAll(/(?:屏幕文字|画面文字|字幕)\s*[：:]\s*([^｜\n。；;]+)/gu)]
    .map((match) => match[1]?.trim().replace(/[。；;]+$/gu, '') || '')
    .filter((text) => text && !/^(无|无文字|无屏幕文字)$/u.test(text))
    .join('\n')
}

function removeScreenTextInstructions(value: string): string {
  return value
    .replace(/(?:屏幕文字|画面文字|字幕)\s*[：:]\s*[^｜\n。；;]+[。；;]?/gu, '')
    .replace(/[；;]\s*[；;]/gu, '；')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function visualStyleLabel(value: string | undefined): string {
  const labels: Record<string, string> = {
    photorealistic: '仿真人风格',
    'cinematic-cg': '影视CG风格',
    'chinese-2d': '2D风格',
    'chinese-3d': '3D国漫风格',
    anime: '日漫风格',
    storybook: '绘本风格',
  }
  return labels[value || 'cinematic-cg'] || '统一项目视觉风格'
}

export function normalizedVideoDuration(value: unknown, minimum = 4): number {
  const parsed = Number(value)
  const min = Math.min(15, Math.max(1, Math.round(minimum)))
  return Number.isFinite(parsed) ? Math.min(15, Math.max(min, Math.round(parsed))) : Math.max(5, min)
}

function normalizeRigidObjectContradictions(value: string): string {
  if (!/(?:固定隔离栏|螺栓固定|底板[^\n。；]{0,20}固定)/u.test(value)) return value
  return value
    .replace(/压力使栏片弯曲震颤/gu, '人群压力通过前排身体接触和固定栏片的整体受力表现，栏片保持刚性不弯曲')
    .replace(/栏片(?:可|受压)?弯曲震颤/gu, '固定栏片保持刚性，受力时保持结构完整并承受整体压力')
    .replace(/栏片受压弯曲/gu, '固定栏片保持刚性并承受整体压力')
    .replace(/栏片震颤/gu, '固定栏片保持刚性并承受整体压力')
}

function rigidPhysicsExecutionRule(contract: ReturnType<typeof deriveRigidPhysicsContract>): string {
  if (!contract) return ''
  const rules = contract.objects.map((object) => {
    if (object.id === 'barrier') {
      return object.motion === 'fixed'
        ? '固定隔离栏逐帧锚点：画面应持续看见左右两处底脚/螺栓底板与混凝土地面的接触关系；前排压力只表现为栏体整体受力，底脚、杆件数量、间距和连接点不漂移、不弯曲。'
        : '受力隔离栏逐帧锚点：同时保持左右两处底脚或稳定连接点可追踪；允许栏体按接触和摩擦整体平移、倾斜或滑移，禁止局部拉伸、断裂或底脚与栏体分离。'
    }
    if (object.id === 'gate') {
      return '滑动闸门逐帧连接点：轨道与门体连接点保持可见并沿轨道方向运动；禁止横向跳变、脱轨、门体与轨道分离或连接点在硬切后重置。'
    }
    return `${object.label}保持结构、底座和连接点连续，受力只允许合同规定的整体运动。`
  })
  return rules.length ? `物理连续性执行：${rules.join(' ')}` : ''
}
