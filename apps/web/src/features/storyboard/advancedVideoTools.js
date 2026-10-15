export const ADVANCED_VIDEO_MODES = [
  {
    id: 'video-to-video',
    label: 'video-to-video',
    title: '视频参考重绘',
    description: '保留源视频节奏和主体动作，重写风格、质感或画面细节。',
    estimatedCredits: 26,
  },
  {
    id: 'first-last-frame',
    label: '首尾帧',
    title: '首尾帧生成',
    description: '锁定起始和结束画面，中间由模型补足连贯动作。',
    estimatedCredits: 24,
  },
  {
    id: 'extend',
    label: '视频延长',
    title: '视频延长',
    description: '沿用已有镜头的运动方向和情绪，向后延展数秒。',
    estimatedCredits: 20,
  },
  {
    id: 'inpaint',
    label: '局部编辑',
    title: '局部编辑',
    description: '配合遮罩只修改画面局部，尽量保持其他区域稳定。',
    estimatedCredits: 22,
  },
  {
    id: 'replace-background',
    label: '换背景',
    title: '换背景',
    description: '保留人物或产品主体，替换环境、空间和背景关系。',
    estimatedCredits: 24,
  },
  {
    id: 'relight',
    label: '重打光',
    title: '重打光',
    description: '调整主光、轮廓光和环境光，让镜头更接近目标光影。',
    estimatedCredits: 20,
  },
  {
    id: 'upscale',
    label: 'upscale',
    title: '清晰放大',
    description: '对已生成视频做清晰度、细节和压缩痕迹优化。',
    estimatedCredits: 18,
  },
  {
    id: 'lip-sync',
    label: 'lip-sync',
    title: '口型同步',
    description: '使用旁白或台词音频驱动人物嘴型，保持角色脸部一致。',
    estimatedCredits: 24,
  },
]

export const VIDEO_TEMPLATE_MARKETPLACE = [
  {
    id: 'cinematic-dialogue',
    title: '电影对白',
    category: '剧情',
    modeId: 'first-last-frame',
    description: '适合人物对话、回头、停顿和情绪反应。',
    promptAppend: '电影对白镜头，表演克制真实，眼神和微表情连贯，景深自然，剪辑点明确',
    metadata: { lightingPreset: 'soft-window' },
  },
  {
    id: 'product-hero',
    title: '产品展示',
    category: '广告',
    modeId: 'relight',
    description: '适合产品转场、材质展示和广告主视觉。',
    promptAppend: '产品广告主视觉，材质真实，边缘清晰，背景干净，光泽受控不过曝',
    metadata: { lightingPreset: 'studio-softbox' },
  },
  {
    id: 'avatar-speech',
    title: '虚拟人口播',
    category: '虚拟人',
    modeId: 'lip-sync',
    description: '适合角色口播、讲解、旁白同步和半身镜头。',
    promptAppend: '虚拟人口播，嘴型与音频同步，面部不漂移，头肩姿态稳定，眼神自然',
    metadata: { lightingPreset: 'clean-front-key' },
  },
  {
    id: 'scene-remix',
    title: '场景重构',
    category: '场景',
    modeId: 'replace-background',
    description: '适合保留主体并替换空间、天气、布景或时间段。',
    promptAppend: '主体位置和动作保持稳定，背景空间替换自然，透视、接触阴影和色温一致',
    metadata: { lightingPreset: 'matched-environment' },
  },
]

export const AGENT_FILM_TEMPLATES = [
  {
    id: 'agent-cinematic-short',
    title: '剧情短片 Agent',
    description: '按现有镜头顺序补齐画面连续性、角色一致性和镜头转场。',
    videoTemplateId: 'cinematic-dialogue',
    defaultModeId: 'first-last-frame',
    estimatedCreditsPerShot: 24,
  },
  {
    id: 'agent-product-ad',
    title: '广告片 Agent',
    description: '按产品展示逻辑强化卖点、材质、灯光和封面镜头。',
    videoTemplateId: 'product-hero',
    defaultModeId: 'relight',
    estimatedCreditsPerShot: 22,
  },
  {
    id: 'agent-avatar-explainer',
    title: '虚拟人口播 Agent',
    description: '按口播视频逻辑组织镜头，优先使用音频资产和角色基准。',
    videoTemplateId: 'avatar-speech',
    defaultModeId: 'lip-sync',
    estimatedCreditsPerShot: 24,
  },
]

export function advancedVideoModeById(modeId) {
  return ADVANCED_VIDEO_MODES.find((mode) => mode.id === modeId) || ADVANCED_VIDEO_MODES[0]
}

export function videoTemplateById(templateId) {
  return VIDEO_TEMPLATE_MARKETPLACE.find((template) => template.id === templateId) || null
}

export function agentFilmTemplateById(templateId) {
  return AGENT_FILM_TEMPLATES.find((template) => template.id === templateId) || AGENT_FILM_TEMPLATES[0]
}

export function advancedVideoPromptForShot(shot, modeId, options = {}) {
  const mode = advancedVideoModeById(modeId)
  const template = videoTemplateById(options.templateId)
  return [
    String(shot?.prompt || shot?.title || '').trim(),
    `高级视频操作：${mode.title}。${mode.description}`,
    template ? `模板市场：${template.title}。${template.promptAppend}` : '',
    options.promptAppend,
  ]
    .filter(Boolean)
    .join('\n')
}

export function advancedVideoMetadataForShot(shot, modeId, options = {}) {
  const mode = advancedVideoModeById(modeId)
  const template = videoTemplateById(options.templateId)
  const templateMetadata = template?.metadata || {}
  const firstFrameUrl = urlValue(options.firstFrameUrl || shot?.imageUrl)
  const lastFrameUrl = urlValue(options.lastFrameUrl)
  const maskUrl = urlValue(options.maskUrl)
  const backgroundReferenceUrl = urlValue(options.backgroundReferenceUrl)
  const sourceImageUrls = uniqueUrls([
    ...urlsFromText(options.sourceImageUrls),
    ...urlsFromText(options.sourceImageUrl),
  ])
  const images = uniqueUrls([
    firstFrameUrl,
    lastFrameUrl,
    maskUrl,
    backgroundReferenceUrl,
    ...sourceImageUrls,
  ])

  return compactObject({
    videoMode: mode.id,
    operationLabel: mode.title,
    templateId: template?.id || options.templateId,
    sourceVideoUrl: urlValue(options.sourceVideoUrl),
    sourceImageUrls,
    firstFrameUrl,
    lastFrameUrl,
    maskUrl,
    backgroundReferenceUrl,
    lightingPreset: stringValue(options.lightingPreset || templateMetadata.lightingPreset),
    upscaleFactor: integerValue(options.upscaleFactor),
    lipSyncAudioUrl: urlValue(options.lipSyncAudioUrl),
    extendSeconds: integerValue(options.extendSeconds),
    agentPlanId: stringValue(options.agentPlanId),
    images,
  })
}

export function agentFilmPlanForProject(project, shots = [], assets = [], templateId) {
  const template = agentFilmTemplateById(templateId)
  const videoTemplate = videoTemplateById(template.videoTemplateId)
  const agentPlanId = `agent-${template.id}-${String(project?.id || 'project')}`
  const audioAsset = assets.find((asset) => asset.kind === 'audio')

  const items = shots.map((shot, index) => ({
    shot,
    modeId: template.defaultModeId,
    options: {
      templateId: template.videoTemplateId,
      agentPlanId,
      promptAppend: agentPromptAppend(template, shot, index),
      firstFrameUrl: shot.imageUrl || '',
      lipSyncAudioUrl: template.defaultModeId === 'lip-sync' ? mediaUrlForAsset(audioAsset) : '',
    },
  }))

  return {
    id: agentPlanId,
    title: template.title,
    description: template.description,
    template,
    videoTemplate,
    items,
    estimatedCredits: items.length * template.estimatedCreditsPerShot,
  }
}

function agentPromptAppend(template, shot, index) {
  return `Agent 整片计划：${template.title}。第 ${index + 1} 个镜头，保持与前后镜头叙事连续。${
    shot?.title ? `当前镜头：${shot.title}。` : ''
  }`
}

function mediaUrlForAsset(asset) {
  return asset?.imageUrl || asset?.references?.[0]?.url || ''
}

function urlsFromText(value) {
  if (Array.isArray(value)) return value.map(urlValue).filter(Boolean)
  return String(value || '')
    .split(/[\n,，\s]+/)
    .map(urlValue)
    .filter(Boolean)
}

function urlValue(value) {
  const text = String(value || '').trim()
  return /^https?:\/\//.test(text) || /^\/api\/v1\/media\/[0-9a-fA-F-]{36}/.test(text) ? text : ''
}

function integerValue(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined
}

function stringValue(value) {
  const text = String(value || '').trim()
  return text || undefined
}

function uniqueUrls(urls) {
  return [...new Set(urls.filter(Boolean))]
}

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0
      return value !== undefined && value !== null && value !== ''
    }),
  )
}
