export const QUALITY_RULE_VERSION = 'quality-floor-v1'

export type QualityRuleInput = {
  mediaKind: 'image' | 'video'
  assetKind?: 'character' | 'scene' | 'prop' | 'costume' | 'storyboard'
  contentType?: 'short-drama' | 'advertisement' | 'animation'
  visualStyles?: string[]
  emptyScene?: boolean
  weather?: string
  sourcePrompt?: string
  customNegativePrompt?: string
}

export type CompiledQualityRules = {
  negativePrompt: string
  presetIds: string[]
  version: typeof QUALITY_RULE_VERSION
}

const IMAGE_BASE =
  '不要模糊、低分辨率、像素化、压缩痕迹；不要水印、未经指定的文字、logo、UI、二维码和边框；不要畸形、扭曲、断裂和结构错误；不要刺眼爆闪、过曝炸白和暗部死黑'

const VIDEO_BASE =
  '不要闪烁、频闪、跳帧、卡顿和意外镜头抖动；不要变形、扭曲、畸形和解剖错误；不要多余肢体、缺少肢体、手指畸形和手指粘连；不要运动模糊过重、残影和重影；不要低分辨率、像素化和压缩痕迹；不要水印、未经指定的文字、logo、UI和字幕；不要刺眼爆闪和过曝炸白；不要面部漂移、换脸或不同角度变成不同人物；不要衣服穿帮或材质变塑料'

const PHOTOREAL_VIDEO =
  '画面里不要出现机械臂、摄影机、轨道、云台、灯架、反光板、工作人员、麦克风等拍摄设备；不要背景穿帮，包括接缝线、折痕、拼接、贴图拉伸、重复纹理、抠像边、漂浮阴影、地面反光断裂和背景色温跳变；不要多余人物和道具；不要广角畸变拉脸；保持真实皮肤、面部、肢体、服装和材质跨帧稳定'

const CHARACTER_BASE =
  '不要玻璃眼、空洞眼神、无瞳孔、斜视和眼睛不对称；不要歪鼻子、鼻子融化和缺眉毛；不要歪嘴、缺牙和不对称笑容；不要多余手指、手指粘连、手部扭曲、身体扭曲、关节断裂、长脖子和双躯干'

const PHOTOREAL_CHARACTER =
  '不要磨皮过度、塑料皮肤、假人感、娃娃脸和蜡像脸；不要卡通、动漫、低质量3D渲染和塑料材质感'

const SCENE_BASE = '不要悬浮物体、断开物体、穿帮接缝和无意重复纹理；不要色彩不自然、饱和度溢出和色温跳变'

const PHOTOREAL_SCENE = '不要卡通、动漫、低质量3D渲染和塑料感'
const EMPTY_SCENE = '不要乱入人物、人类或与剧情无关的生物'
const CLEAR_ATMOSPHERE = '不要无需求的烟雾、薄雾和尘埃效果，保持空气通透'

const PRODUCT_ADVERTISEMENT =
  '不要塑料感、油腻反光和假材质；不要未经指定的水印、文字、logo、签名、二维码和边框；不要悬浮物体、物体断开和错误重叠；不要多余道具和多余人物；有人手时不要手指畸形；保持产品结构、包装、材质和指定品牌标识准确'

export function compileQualityRules(input: QualityRuleInput): CompiledQualityRules {
  const presets: Array<[string, string]> = []
  const styles = new Set(input.visualStyles ?? [])
  const photorealistic = styles.has('photorealistic')
  const source = input.sourcePrompt ?? ''

  presets.push([
    input.mediaKind === 'video' ? 'video-base' : 'image-base',
    input.mediaKind === 'video' ? VIDEO_BASE : IMAGE_BASE,
  ])

  if (input.mediaKind === 'video' && photorealistic) {
    presets.push(['photoreal-video', PHOTOREAL_VIDEO])
  }
  if (input.assetKind === 'character') {
    presets.push(['character-anatomy', CHARACTER_BASE])
    if (photorealistic) presets.push(['photoreal-character', PHOTOREAL_CHARACTER])
  }
  if (input.assetKind === 'scene' || input.assetKind === 'storyboard') {
    presets.push(['scene-integrity', SCENE_BASE])
    if (photorealistic) presets.push(['photoreal-scene', PHOTOREAL_SCENE])
    if (input.emptyScene) presets.push(['empty-scene', EMPTY_SCENE])
    if (shouldKeepAtmosphereClear(input.weather, source)) {
      presets.push(['clear-atmosphere', CLEAR_ATMOSPHERE])
    }
  }
  if (input.contentType === 'advertisement') {
    presets.push(['product-advertisement', PRODUCT_ADVERTISEMENT])
  }

  const clauses = uniqueClauses([...presets.map(([, value]) => value), input.customNegativePrompt ?? ''])
  return {
    negativePrompt: clauses.join('；').slice(0, 5_000),
    presetIds: presets.map(([id]) => id),
    version: QUALITY_RULE_VERSION,
  }
}

function shouldKeepAtmosphereClear(weather: string | undefined, sourcePrompt: string): boolean {
  if (weather === 'fog') return false
  return !/烟|雾|霾|尘|沙|蒸汽|云海/.test(sourcePrompt)
}

function uniqueClauses(groups: string[]): string[] {
  const seen = new Set<string>()
  const clauses: string[] = []
  for (const group of groups) {
    for (const raw of group.split(/[；;\n]+/)) {
      const clause = raw.trim().replace(/[。；;]+$/g, '')
      const key = clause.replace(/[，、\s]/g, '')
      if (!clause || seen.has(key)) continue
      seen.add(key)
      clauses.push(clause)
    }
  }
  return clauses
}
