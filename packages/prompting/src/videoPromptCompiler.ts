import { mapShotReferenceTokens } from './shotReferences.js'
import { cleanShotContinuityNote, cleanStoryboardPrompt } from './storyboardPrompt.js'

export const VIDEO_PROMPT_VERSION = 'seedance-storyboard-v17'

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

export type PromptReference = { id: string; appearance?: { name: string; description: string } }

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
  const source = cleanStoryboardPrompt(shot.prompt)
  const mapped =
    input.manualReferenceCount === undefined
      ? source
      : mapShotReferenceTokens(source, input.manualReferenceCount, continuityMode === 'continue')
  const prompt = project.contentType === 'advertisement' ? removeScreenTextInstructions(mapped) : mapped
  const continuity = cleanShotContinuityNote(shot.continuityNote, continuityMode)
  const referenceAssets = references
    .map((reference) => assets.find((asset) => asset.id === reference.id))
    .filter((asset): asset is PromptAsset => Boolean(asset))
  const identities = referenceAssets.map((asset) =>
    identityRuleFor(
      asset,
      referenceAssets,
      references.find((reference) => reference.id === asset.id)?.appearance,
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
    prompt,
    identities.length ? `参考资产：${identities.join('；')}。` : '',
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

function identityRuleFor(
  asset: PromptAsset,
  assets: PromptAsset[],
  appearance?: PromptReference['appearance'],
): string {
  const label = ASSET_KIND_LABELS[asset.kind] || '资产'
  if (asset.kind === 'character') {
    const costume = assets.find(
      (candidate) =>
        candidate.kind === 'costume' && costumeCharacterAssetId(candidate.attributes) === asset.id,
    )
    const look = appearance
      ? `，服装采用“${appearance.name}”${appearance.description ? `（${appearance.description}）` : ''}`
      : costume
        ? `，服装采用“${costume.name}”`
        : '，服装与对应参考图一致'
    return `${label}“${asset.name}”沿用对应参考图的面部、发型和体型${look}`
  }
  if (asset.kind === 'costume') {
    const owner = assets.find((candidate) => candidate.id === costumeCharacterAssetId(asset.attributes))
    return `服装“${asset.name}”${owner ? `穿在“${owner.name}”身上，` : ''}采用对应参考图的款式和颜色`
  }
  return `${label}“${asset.name}”采用对应参考图的外观`
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
