import { optionLabel } from './assetOptions'
import { negativePromptForAsset, negativeTermsFromPrompt } from '../prompts/negativePromptPresets'

export const PROMPT_FORMULA = ['风格', '构图', '主体', '动作', '场景', '光影', '细节', '质量词']
export const AUDIO_PROMPT_FORMULA = ['类型', '时长', '主体', '情绪', '语言', '音色', '细节', '质量词']

export const QUALITY_GROUPS = [
  {
    key: 'resolution',
    label: '分辨率',
    items: ['4K (3840x2160)', '6K (6144x3456)', '9K (7680x4320)', '超高分辨率', '高像素', '细节丰富'],
  },
  {
    key: 'image',
    label: '画质',
    items: ['超清画质', '高清细腻', '清晰锐利', '无损画质', '动态范围 HDR', '专业级画质'],
  },
  {
    key: 'detail',
    label: '细节',
    items: ['极致细节', '精细纹理', '复杂细节', '微观细节', '丰富层次', '细节清晰可见'],
  },
  {
    key: 'realism',
    label: '真实感',
    items: ['照片级真实', '道具写实', '真实光影', '自然色彩', '真实材质', '仿真实拍摄'],
  },
  {
    key: 'style',
    label: '风格化增强',
    items: ['电影级色调', '大师风格', '艺术风格', '氛围感强', '色彩增强', '视觉冲击力强'],
  },
  {
    key: 'negative',
    label: '负面词',
    items: ['低质量', '模糊', '噪点', '畸形', '多余肢体', '水印', '文字', 'logo'],
  },
]

const SECTION_KEYS = ['style', 'composition', 'subject', 'action', 'scene', 'lighting', 'detail', 'quality']
const SECTION_HINTS = {
  style: '定义整体画面气质与艺术形式',
  composition: '确定视角、比例和视觉焦点',
  subject: '明确画面核心元素',
  action: '描述姿态、状态和行为',
  scene: '设定环境背景与空间氛围',
  lighting: '控制光线方向、强度和层次',
  detail: '补充材质、纹理和可辨识信息',
  quality: '提升清晰度、专业度和输出稳定性',
}
const AUDIO_SECTION_HINTS = {
  style: '定义音频资产类型',
  composition: '控制时长、循环和交付规格',
  subject: '明确声音主体和使用场景',
  action: '描述情绪、语速和动态变化',
  scene: '设定语言或环境语境',
  lighting: '控制音色、质感和听感方向',
  detail: '补充可辨识细节和剪辑边界',
  quality: '提升清晰度、稳定度和可用性',
}

export function buildPromptBlueprint(asset, aspectRatio, stage = null) {
  const sections = buildPromptSections(asset, aspectRatio, stage)
  const automaticPrompt = renderPrompt(sections)
  const finalPrompt = applyCustomPrompt(asset, automaticPrompt)
  const suggestedNegativePrompt = buildSuggestedNegativePrompt(asset)
  return {
    formula: sections.map((section) => section.label),
    sections,
    qualityTerms: sections.find((item) => item.key === 'quality')?.terms || [],
    negativeTerms: buildNegativeTerms(asset, suggestedNegativePrompt),
    suggestedNegativePrompt,
    automaticPrompt,
    finalPrompt,
  }
}

export function compileAssetPrompt(asset, aspectRatio) {
  return buildPromptBlueprint(asset, aspectRatio).finalPrompt
}

export function compileCharacterStagePrompt(asset, aspectRatio, stage) {
  if (asset.attributes.type !== 'character') return compileAssetPrompt(asset, aspectRatio)
  return buildPromptBlueprint(asset, aspectRatio, stage).finalPrompt
}

function buildPromptSections(asset, aspectRatio, stage) {
  const attributes = asset.attributes
  if (attributes.type === 'character') return buildCharacterSections(asset, aspectRatio, stage)
  if (attributes.type === 'scene') return buildSceneSections(asset, aspectRatio)
  if (attributes.type === 'prop') return buildPropSections(asset, aspectRatio)
  if (attributes.type === 'costume') return buildCostumeSections(asset, aspectRatio)
  return buildAudioSections(asset)
}

function buildCharacterSections(asset, aspectRatio, stage) {
  const attributes = asset.attributes
  const stageRatio = stage === 'face' ? '1:1' : stage === 'turnaround' ? '16:9' : aspectRatio
  const turnaroundLayout = attributes.turnaroundLayout || 'sheet'
  const identity = [
    asset.name,
    asset.description,
    attributes.subjectType === 'animal' ? `动物角色，${attributes.species || '自定义物种'}` : '人物角色',
    optionLabel('gender', attributes.gender),
    attributes.exactAge ? `${attributes.exactAge}岁` : optionLabel('ageGroup', attributes.ageGroup),
    attributes.subjectType === 'animal' && attributes.anthropomorphic ? '拟人化表现' : '',
  ]

  const standardComposition =
    stage === 'face'
      ? ['头肩构图，正面平视', `画面比例${stageRatio}`]
      : stage === 'turnaround'
        ? [
            turnaroundLayout === 'separate'
              ? '人物三视图源图，正面、侧面、背面分别输出'
              : '16:9三栏人物三视图设定表',
            `画面比例${stageRatio}`,
          ]
        : stage === 'body'
          ? ['全身完整入镜，平视镜头', `画面比例${stageRatio}`]
          : [`${optionLabel('framing', attributes.framing)}构图`, '平视镜头', `画面比例${stageRatio}`]
  const standardAction =
    stage === 'face'
      ? '自然中性表情，目视镜头'
      : stage === 'turnaround'
        ? '标准站姿，正面、侧面、背面视角完整'
        : '自然站立，动作克制，身体结构稳定'
  const standardDetail = [
    stage === 'face' ? '五官清晰，脸型、发型和年龄特征可辨识' : '',
    stage === 'body' ? '严格保持已确认面部的五官、脸型、发型和年龄特征' : '',
    stage === 'turnaround'
      ? `严格保持面部、发型、身材和服装一致，${
          turnaroundLayout === 'separate' ? '三张源图视角清楚' : '三栏间距清楚'
        }`
      : '',
    stage === 'face' ? '' : optionLabel('bodyType', attributes.bodyType),
    attributes.legStretch ? '自然适度拉长腿部比例，保持身体结构正确' : '',
    attributes.subjectType === 'human' && attributes.faceBrightening
      ? '自然提亮面部肤色，脸部干净透亮，保留皮肤纹理、真实肤色层次和五官立体感'
      : '',
    attributes.turnaround || stage === 'turnaround' ? '角色外观和服装严格一致，正面、侧面、背面视角清楚' : '',
    asset.sourceMode === 'import' && asset.references?.length
      ? '严格保持导入参考图中的身份和关键外观特征'
      : '',
  ]
  const qualityTerms = buildQualityTerms(attributes.type, attributes.visualStyle, [
    stage === 'face' ? '五官清晰' : '',
    stage === 'turnaround' ? '结构清晰' : '',
  ])

  return createSections([
    ['style', `${optionLabel('visualStyle', attributes.visualStyle)}风格`],
    ['composition', standardComposition],
    ['subject', identity],
    ['action', standardAction],
    ['scene', `${optionLabel('background', attributes.background)}背景`],
    ['lighting', stage === 'face' ? '均匀柔光' : '统一光线，柔和补光'],
    ['detail', standardDetail],
    ['quality', [...qualityTerms, `画面比例${stageRatio}`], qualityTerms],
  ])
}

function buildSceneSections(asset, aspectRatio) {
  const attributes = asset.attributes
  const qualityTerms = buildQualityTerms(attributes.type, attributes.visualStyle, ['空间层次', '环境完整'])
  return createSections([
    ['style', `${optionLabel('visualStyle', attributes.visualStyle)}风格`],
    ['composition', [optionLabel('camera', attributes.camera), `画面比例${aspectRatio}`]],
    ['subject', [asset.name, asset.description, `${optionLabel('sceneType', attributes.sceneType)}场景`]],
    [
      'action',
      [
        attributes.emptyScene ? '空场景，不出现人物' : '',
        attributes.activitySpace ? '预留人物表演和镜头运动空间' : '',
      ],
    ],
    [
      'scene',
      [
        optionLabel('space', attributes.space),
        optionLabel('era', attributes.era),
        optionLabel('time', attributes.time),
        `${optionLabel('weather', attributes.weather)}天`,
        `${optionLabel('mood', attributes.mood)}氛围`,
      ],
    ],
    ['lighting', sceneLighting(attributes)],
    ['detail', '建筑纹理、地面材质、空气层次和空间纵深清晰'],
    ['quality', [...qualityTerms, `画面比例${aspectRatio}`], qualityTerms],
  ])
}

function buildPropSections(asset, aspectRatio) {
  const attributes = asset.attributes
  const qualityTerms = buildQualityTerms(attributes.type, attributes.visualStyle, ['材质可信', '清晰锐利'])
  return createSections([
    ['style', `${optionLabel('visualStyle', attributes.visualStyle)}风格`],
    ['composition', [optionLabel('view', attributes.view), '单体居中展示', `画面比例${aspectRatio}`]],
    [
      'subject',
      [
        asset.name,
        asset.description,
        optionLabel('propUsage', attributes.usage || 'key'),
        `${optionLabel('propCategory', attributes.category)}物品`,
        `${optionLabel('material', attributes.material)}材质`,
      ],
    ],
    ['action', '静物陈列，边缘完整，主体不被遮挡'],
    ['scene', `${optionLabel('background', attributes.background)}背景`],
    ['lighting', '棚拍柔光，突出材质反射与轮廓'],
    ['detail', [optionLabel('condition', attributes.condition), '材质纹理、边缘清晰、结构完整']],
    ['quality', [...qualityTerms, `画面比例${aspectRatio}`], qualityTerms],
  ])
}

function buildCostumeSections(asset, aspectRatio) {
  const attributes = asset.attributes
  const qualityTerms = buildQualityTerms(attributes.type, attributes.visualStyle, ['精细纹理', '版型清晰'])
  return createSections([
    ['style', `${optionLabel('visualStyle', attributes.visualStyle)}风格`],
    [
      'composition',
      [optionLabel('presentation', attributes.presentation), '服装完整展示', `画面比例${aspectRatio}`],
    ],
    [
      'subject',
      [
        asset.name,
        asset.description,
        optionLabel('audience', attributes.audience),
        optionLabel('costumeCategory', attributes.category),
        optionLabel('season', attributes.season),
      ],
    ],
    [
      'action',
      [
        `${optionLabel('presentation', attributes.presentation)}展示`,
        attributes.turnaround ? '正面、背面和细节三张独立图片' : '',
      ],
    ],
    ['scene', '干净背景，便于观察版型和轮廓'],
    ['lighting', '均匀棚拍光，布料色彩稳定'],
    ['detail', [optionLabel('design', attributes.design), '布料纹理、走线、褶皱和版型细节清晰']],
    ['quality', [...qualityTerms, `画面比例${aspectRatio}`], qualityTerms],
  ])
}

function buildAudioSections(asset) {
  const attributes = asset.attributes
  const qualityTerms = ['音质清晰', '层次稳定', '无明显底噪']
  return createSections(
    [
      ['style', '音频资产'],
      ['composition', [`${attributes.duration}秒`, attributes.loop ? '可循环播放' : '单次播放']],
      [
        'subject',
        [
          asset.name,
          asset.description,
          optionLabel('audioType', attributes.audioType),
          attributes.audioType === 'voice' ? optionLabel('gender', attributes.gender) : '',
          attributes.audioType === 'voice' ? optionLabel('ageGroup', attributes.ageGroup) : '',
        ],
      ],
      ['action', [optionLabel('emotion', attributes.emotion), optionLabel('speed', attributes.speed)]],
      ['scene', optionLabel('language', attributes.language)],
      ['lighting', `${optionLabel('tone', attributes.tone)}音色`],
      ['detail', attributes.loop ? '首尾自然衔接，可循环播放' : '开头和结尾干净'],
      ['quality', qualityTerms, qualityTerms],
    ],
    AUDIO_PROMPT_FORMULA,
    AUDIO_SECTION_HINTS,
  )
}

function createSections(definitions, formula = PROMPT_FORMULA, hints = SECTION_HINTS) {
  return definitions.map(([key, value, terms = []]) => {
    const index = SECTION_KEYS.indexOf(key)
    return {
      key,
      index: String(index + 1).padStart(2, '0'),
      label: formula[index],
      hint: hints[key],
      value: joinParts(value),
      terms,
    }
  })
}

function buildQualityTerms(kind, visualStyle, extra = []) {
  const styleTerms = {
    photorealistic: ['照片级真实', '真实质感', '自然色彩'],
    'cinematic-cg': ['电影感', '真实光影', '视觉冲击力'],
    'chinese-3d': ['高清细腻', '结构清晰', '色彩增强'],
    'chinese-2d': ['线条干净', '色彩增强', '艺术风格'],
    anime: ['线条干净', '色彩增强', '高清细腻'],
    storybook: ['艺术风格', '柔和色彩', '精细纹理'],
  }
  const kindTerms = {
    character: ['高分辨率', '主体清晰', '细节完整'],
    scene: ['超高分辨率', '复杂层次', '细节清晰可见'],
    prop: ['高像素', '精细纹理', '材质可信'],
    costume: ['高清细腻', '精细纹理', '细节完整'],
  }
  return unique(['清晰锐利', ...(kindTerms[kind] || []), ...(styleTerms[visualStyle] || []), ...extra])
}

function buildSuggestedNegativePrompt(asset) {
  return negativePromptForAsset(asset) || fallbackNegativeTerms(asset.attributes.type).join('，')
}

function buildNegativeTerms(asset, suggestedNegativePrompt) {
  const presetTerms = negativeTermsFromPrompt(suggestedNegativePrompt)
  if (presetTerms.length) return presetTerms
  return fallbackNegativeTerms(asset.attributes.type)
}

function fallbackNegativeTerms(kind) {
  const common = ['低质量', '模糊', '噪点', '水印', '文字']
  const byKind = {
    character: ['畸形', '多余肢体', '五官扭曲'],
    scene: ['透视错误', '杂乱人物'],
    prop: ['结构变形', '边缘破损'],
    costume: ['版型变形', '布料破损'],
    audio: ['杂音', '破音', '失真', '电流声', '截断'],
  }
  return unique([...common, ...(byKind[kind] || [])])
}

function sceneLighting(attributes) {
  const timeLighting = {
    dawn: '晨光柔和，空气有层次',
    day: '自然日光，阴影清晰',
    sunset: '黄金时刻，暖色侧逆光',
    night: '夜景光线，局部高光和环境反射',
  }
  const weatherLighting = {
    rain: '雨面反光，湿润高光',
    fog: '雾气散射光，低对比层次',
    snow: '冷色漫射光，雪面反射',
    cloudy: '阴天柔光，低阴影',
    clear: '',
  }
  return joinParts([timeLighting[attributes.time], weatherLighting[attributes.weather]])
}

function renderPrompt(sections) {
  return sections
    .map((item) => item.value)
    .filter(Boolean)
    .join('，')
}

function applyCustomPrompt(asset, automatic) {
  const custom = asset.customPrompt?.trim() || ''
  if (asset.promptMode === 'advanced' && asset.customPromptMode === 'replace' && custom) return custom
  return [automatic, asset.promptMode === 'advanced' ? custom : ''].filter(Boolean).join('，')
}

function joinParts(parts) {
  if (Array.isArray(parts)) return unique(parts).join('，')
  return parts || ''
}

function unique(parts) {
  return [...new Set(parts.filter(Boolean))]
}

export function summarizeAsset(asset) {
  const attributes = asset.attributes
  if (attributes.type === 'character') {
    return [
      attributes.subjectType === 'animal'
        ? attributes.species || '动物'
        : optionLabel('gender', attributes.gender),
      optionLabel('visualStyle', attributes.visualStyle),
      attributes.turnaround ? '三视图' : optionLabel('framing', attributes.framing),
    ]
  }
  if (attributes.type === 'scene') {
    return [
      optionLabel('sceneType', attributes.sceneType),
      optionLabel('time', attributes.time),
      optionLabel('visualStyle', attributes.visualStyle),
    ]
  }
  if (attributes.type === 'prop') {
    return [
      optionLabel('propCategory', attributes.category),
      optionLabel('material', attributes.material),
      optionLabel('view', attributes.view),
    ]
  }
  if (attributes.type === 'costume') {
    return [
      optionLabel('audience', attributes.audience),
      optionLabel('costumeCategory', attributes.category),
      optionLabel('design', attributes.design),
    ]
  }
  return [
    optionLabel('audioType', attributes.audioType),
    `${attributes.duration}秒`,
    attributes.loop ? '循环' : '单次',
  ]
}
