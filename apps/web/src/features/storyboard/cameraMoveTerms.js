export const CAMERA_MOVE_TERMS = [
  {
    id: 'push-in',
    name: '推镜',
    prompt: '镜头缓慢向前推进，聚焦主体，增强压迫与沉浸感',
    scene: '人物觉醒、发现线索',
  },
  {
    id: 'pull-out',
    name: '拉镜',
    prompt: '镜头平稳后拉，逐渐揭示环境与关系',
    scene: '结局揭晓、孤独收尾',
  },
  {
    id: 'pan',
    name: '摇镜',
    prompt: '镜头水平摇动，跟随视线或展示空间',
    scene: '场景介绍、角色对峙',
  },
  {
    id: 'tilt',
    name: '俯仰镜头',
    prompt: '镜头垂直上仰或下俯，强化高低关系',
    scene: '权力压制、情绪失落',
  },
  {
    id: 'truck',
    name: '移镜',
    prompt: '机位横向移动，保持主体并拓展空间',
    scene: '人物出场、走位调度',
  },
  {
    id: 'tracking',
    name: '跟镜',
    prompt: '镜头持续跟随主体运动，制造临场感',
    scene: '奔跑追逐、行动戏',
  },
  {
    id: 'pedestal',
    name: '升降镜头',
    prompt: '机位上升或下降，形成空间层次变化',
    scene: '气势建立、环境揭示',
  },
  {
    id: 'orbit',
    name: '环绕镜头',
    prompt: '镜头围绕主体旋转运动，突出情绪张力',
    scene: '告白时刻、心理波动',
  },
  {
    id: 'zoom',
    name: '变焦镜头',
    prompt: '焦距连续变化，压缩或拉伸空间感',
    scene: '惊讶反应、信息聚焦',
  },
  {
    id: 'handheld',
    name: '手持镜头',
    prompt: '轻微晃动的纪实感画面，增强真实与紧张',
    scene: '冲突现场、危机时刻',
  },
  {
    id: 'aerial',
    name: '航拍镜头',
    prompt: '高空俯瞰大场景，建立宏大空间关系',
    scene: '开场建景、转场过渡',
  },
  {
    id: 'whip-pan',
    name: '甩镜',
    prompt: '快速摆动形成动势与切换感',
    scene: '激烈打斗、情绪爆发',
  },
  {
    id: 'dolly',
    name: '滑轨镜头',
    prompt: '平滑直线位移，画面稳定细腻',
    scene: '产品展示、空间介绍',
  },
  {
    id: 'stabilized-follow',
    name: '稳定器跟拍',
    prompt: '低抖动跟随移动，兼顾流畅与速度',
    scene: '穿行场景、长镜头调度',
  },
  {
    id: 'speed-ramp',
    name: '变速运镜',
    prompt: '镜头运动速度由慢到快或由快到慢',
    scene: '情绪递进、高潮铺垫',
  },
  {
    id: 'foreground-wipe',
    name: '前景遮挡运镜',
    prompt: '利用前景掠过制造层次与转场感',
    scene: '人物偷窥、空间切换',
  },
  {
    id: 'pass-through',
    name: '穿越运镜',
    prompt: '镜头穿过门窗、人群或物体形成沉浸视角',
    scene: '梦境进入、场景衔接',
  },
  {
    id: 'low-angle-push',
    name: '低机位推进',
    prompt: '贴近地面向前推进，强化力量与压迫',
    scene: '英雄出场、危险逼近',
  },
  {
    id: 'high-angle',
    name: '高机位俯拍',
    prompt: '从上向下观察人物，制造渺小与疏离感',
    scene: '失败时刻、群像调度',
  },
  {
    id: 'pov',
    name: '主观镜头',
    prompt: '以角色视角移动拍摄，强化代入感',
    scene: '第一视角、惊悚探索',
  },
  {
    id: 'long-take',
    name: '长镜头调度',
    prompt: '长时间不停机配合复杂走位',
    scene: '群戏表演、沉浸叙事',
  },
  {
    id: 'dutch-angle',
    name: '倾斜镜头',
    prompt: '画面带角度倾斜，制造失衡与不安',
    scene: '精神崩溃、悬疑氛围',
  },
  {
    id: 'push-zoom',
    name: '快速推进变焦',
    prompt: '推进与变焦结合，形成强烈视觉冲击',
    scene: '真相揭露、危机降临',
  },
  {
    id: 'drift-away',
    name: '抽离镜头',
    prompt: '镜头逐渐远离主体，留下余韵与空间感',
    scene: '结尾升华、情绪落幕',
  },
]

export function appendCameraMovePrompt(currentPrompt, term) {
  const basePrompt = String(currentPrompt ?? '').trim()
  const cameraPrompt = cameraPromptText(term)

  if (!cameraPrompt) return basePrompt
  if (basePrompt.includes(cameraPrompt)) return basePrompt
  if (!basePrompt) return cameraPrompt

  const connector = /[。！？；;,.，]$/.test(basePrompt) ? '' : '，'
  return `${basePrompt}${connector}${cameraPrompt}`
}

export function hasCameraMovePrompt(currentPrompt, term) {
  const cameraPrompt = cameraPromptText(term)
  return Boolean(cameraPrompt && String(currentPrompt ?? '').includes(cameraPrompt))
}

function cameraPromptText(term) {
  if (typeof term === 'string') return term.trim()
  return String(term?.prompt ?? '').trim()
}
