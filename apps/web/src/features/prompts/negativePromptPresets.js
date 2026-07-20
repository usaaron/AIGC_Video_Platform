export const NEGATIVE_PROMPT_PRESETS = {
  realisticVideo: [
    '画面里不要出现机械臂、摄影机、轨道、云台、灯架、反光板、工作人员、麦克风等任何拍摄设备',
    '不要烟雾/薄雾/尘埃效果',
    '不要背景穿帮(接缝线、折痕、拼接、贴图拉伸、重复纹理、抠像边、漂浮阴影、地面反光断裂、背景色温跳变)',
    '不要任何文字/字幕/歌词、水印、logo、UI、二维码、边框',
    '不要多余人物与道具',
    '不要刺眼爆闪与过曝炸白',
    '不要面部漂移/换脸/不同角度不同人',
    '不要广角畸变拉脸',
    '不要手指畸形、肢体错误、衣服穿帮或材质变塑料',
  ].join('；'),
  character: [
    '不要磨皮过度、塑料皮肤、假人感、娃娃脸蜡像脸',
    '不要玻璃眼、空洞眼神、无瞳孔斜视、眼睛不对称',
    '不要歪鼻子、鼻子融化、缺眉毛',
    '不要歪嘴、缺牙、不对称笑容',
    '不要畸形、解剖错误、多余手指、手指粘连、手部扭曲',
    '不要身体扭曲、关节断裂、长脖子、双躯干',
    '不要卡通动漫、3D渲染低分辨率、模糊、水印、文字、logo',
  ].join('；'),
  scene: [
    '不要模糊、低分辨率、像素化、压缩痕迹',
    '不要水印、文字、logo、UI、边框',
    '不要悬浮物体、断开物体、穿帮接缝、重复纹理',
    '不要色彩不自然、饱和度溢出、色温跳变',
    '不要卡通、动漫、3D渲染、塑料感',
    '不要乱入人物、人类(如需纯风景)',
    '不要烟雾/薄雾/尘埃效果(如需通透)',
    '不要刺眼爆闪、过曝炸白、暗部死黑',
  ].join('；'),
  video: [
    '不要闪烁、频闪、跳帧、卡顿、镜头不稳',
    '不要变形、扭曲、畸形、解剖错误',
    '不要多余肢体、缺少肢体、手指畸形、手指粘连',
    '不要运动模糊过重、残影、重影',
    '不要低分辨率、像素化、压缩痕迹',
    '不要水印、文字、logo、UI、字幕',
    '不要刺眼爆闪、过曝炸白',
    '不要面部漂移、换脸、不同角度不同人',
    '不要衣服穿帮、材质变塑料',
  ].join('；'),
  productAd: [
    '不要塑料感、油腻反光、假材质',
    '不要水印文字、logo、签名、二维码、边框',
    '不要畸形、扭曲、断裂、解剖错误',
    '不要低分辨率、模糊、像素化、压缩痕迹',
    '不要卡通动漫、3D渲染',
    '不要悬浮物体、物体断开重叠',
    '不要多余道具、多余人物、手指畸形(如有人手)',
    '不要刺眼爆闪、过曝炸白',
  ].join('；'),
}

export function negativePromptForAsset(asset) {
  const type = asset?.attributes?.type || asset?.kind
  if (type === 'character') return NEGATIVE_PROMPT_PRESETS.character
  if (type === 'scene') return NEGATIVE_PROMPT_PRESETS.scene
  if (type === 'prop' || type === 'costume') return NEGATIVE_PROMPT_PRESETS.productAd
  return ''
}

export function negativePromptForVideoProject(project) {
  const primary =
    project?.contentType === 'advertisement'
      ? NEGATIVE_PROMPT_PRESETS.productAd
      : NEGATIVE_PROMPT_PRESETS.realisticVideo
  return joinNegativePrompts([primary, NEGATIVE_PROMPT_PRESETS.video])
}

export function negativeTermsFromPrompt(prompt) {
  return prompt
    .split(/[；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinNegativePrompts(prompts) {
  return prompts
    .flatMap((prompt) => negativeTermsFromPrompt(prompt))
    .filter((item, index, items) => items.indexOf(item) === index)
    .join('；')
}
