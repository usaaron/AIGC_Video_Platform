import { optionLabel } from './assetOptions'
import { characterVariantName } from '@seqora/contracts'

export function compileAssetPrompt(asset, aspectRatio) {
  const automatic = compileAutomatic(asset, aspectRatio)
  return applyCustomPrompt(asset, automatic)
}

export function compileCharacterStagePrompt(asset, aspectRatio, stage) {
  if (asset.attributes.type !== 'character') return compileAssetPrompt(asset, aspectRatio)
  const attributes = asset.attributes
  const isAnimal = attributes.subjectType === 'animal'
  const identity = [
    asset.name,
    asset.description,
    ...characterIdentityParts(attributes),
    `${optionLabel('visualStyle', attributes.visualStyle)}风格`,
    CHARACTER_CUTOUT_REQUIREMENTS,
    characterSurfaceRequirements(attributes),
    CHARACTER_STATE_REQUIREMENTS,
  ]
  let stageParts
  if (stage === 'face') {
    stageParts = [
      isAnimal
        ? '动物头部身份照，头部和肩颈完整入镜，面部特征与毛发纹理清晰可调整'
        : '人类人物面部大头照，头部和肩部完整入镜，五官清晰可调整',
      '正面平视镜头，自然中性表情，均匀平光',
      isAnimal ? '不出现前爪、文字和饰边' : '不出现手部、文字和饰边',
      '画面比例1:1',
    ]
  } else if (stage === 'turnaround') {
    stageParts = [
      '严格保持已确认的头部、外形、身材和服装一致',
      '标准站姿或自然站立姿态，全身完整，统一比例',
      '分别生成正面、侧面、背面三张独立源图，每张仅呈现本次指定视角，不在单张源图内拼接多视图或面部插图',
      '身体图保留完整头部与足端；背面不回头，侧面不变成斜正面，各视角属于同一身份、同一造型和同一状态',
      '正背服装的层次、接缝、背带、配饰连接、材质与鞋履相互对应，不因换视角重设计，统一比例与照明，不加标签、分割线或第四视图',
    ]
  } else {
    stageParts = [
      isAnimal
        ? '严格保持已确认动物头部的物种、面部、毛色和纹理特征'
        : '严格保持已确认面部的五官、脸型、发型和年龄特征',
      isAnimal ? '' : optionLabel('bodyType', attributes.bodyType),
      '全身完整入镜',
      !isAnimal && attributes.legStretch
        ? '腿部比例优化：自然适度拉长双腿，腿部约占身高55%到58%，保持头身比例、骨骼、关节和衣服结构正确，不拉伸躯干和手臂'
        : '',
      `画面比例${aspectRatio}`,
    ]
  }
  if (asset.references?.length) {
    stageParts.push('严格保持导入参考图中的身份和关键外观特征')
  }
  const compiled = applyCustomPrompt(asset, [...identity, ...stageParts].filter(Boolean).join('，'), stage)
  const variant = attributes.appearanceVariants?.find(
    (item) => item.id === attributes.activeAppearanceVariantId,
  )
  return stage !== 'face' && variant
    ? `${compiled}。本次造型：${characterVariantName(asset.name, variant.name)}${variantDetails(variant)}。服饰按本次造型，面部沿用已确认基准；适用条件只限定本版本，不执行其中的剧情动作或改成全剧固定状态。`
    : compiled
}

function variantDetails(variant) {
  const details = [
    ['外观', variant.description],
    ['造型要求', variant.prompt],
    ['适用与连续性', variant.continuityNote],
  ]
    .map(([label, value]) => (typeof value === 'string' && value.trim() ? `${label}：${value.trim()}` : ''))
    .filter(Boolean)
  return details.length ? `，${details.join('；')}` : ''
}

export function inferCharacterPromptStage(prompt) {
  const value = String(prompt || '').toLowerCase()
  if (!value.trim()) return null
  if (/三视图|设定表|正面.{0,12}侧面.{0,12}背面|turnaround|character sheet/.test(value)) return 'turnaround'
  if (/全身|标准站姿|full[ -]?body|body shot/.test(value)) return 'body'
  if (/大头照|面部|头像|头部|肩部|五官|headshot|close[ -]?up|\bportrait\b|1:1/.test(value)) return 'face'
  return null
}

const CHARACTER_CUTOUT_REQUIREMENTS =
  '透明背景，Alpha通道，无背景色，无戏剧化光影效果，无投影和外部环境倒影；均匀柔和照明，保留身体体积与材质本身必要的明暗和克制高光，主体边缘清晰'

const CHARACTER_STATE_REQUIREMENTS =
  '这是当前身份与造型的参考资产，保留已确认识别特征；临时伤势、湿痕、污渍或持物仅在本次生成明确指定时呈现，不把剧情摘要中的动作、知情或被看守状态演成固定外观'

function characterSurfaceRequirements(attributes) {
  if (attributes.visualStyle !== 'photorealistic') return ''
  return attributes.subjectType === 'animal'
    ? '写实动物材质按既定物种呈现自然毛发、羽毛或鳞片与体积，不套用人类皮肤，不删去物种本身的纹理'
    : '写实人像保留符合既定年龄的自然肤质、发丝与布料纹理，皮肤细节清晰而克制；避免塑料蜡像感、重复伪纹理、过度磨皮和过度锐化，保留已确认的皱纹、疤痕、痣和纹身，不美颜换脸或年轻化'
}

function characterIdentityParts(attributes) {
  if (attributes.subjectType === 'animal') {
    return [
      `动物角色，${attributes.species || '自定义物种'}`,
      attributes.anthropomorphic ? '拟人动物表现，保持动物头部和物种特征' : '保持自然动物形态',
      '只生成指定动物，禁止人类形态、人类面部和人类皮肤',
    ]
  }
  return [
    '人类人物角色，保持人类五官和身体结构',
    optionLabel('gender', attributes.gender),
    attributes.exactAge ? `${attributes.exactAge}岁` : optionLabel('ageGroup', attributes.ageGroup),
    ...characterAppearanceParts(attributes),
  ]
}

function characterAppearanceParts(attributes) {
  return [
    specifiedOption('ethnicity', attributes.ethnicity, '族裔特征'),
    specifiedOption('skinTone', attributes.skinTone, '肤色'),
    specifiedOption('eyeColor', attributes.eyeColor, '瞳孔'),
    specifiedOption('hairColor', attributes.hairColor, '头发'),
  ].filter(Boolean)
}

function specifiedOption(option, value, suffix) {
  if (!value || value === 'unspecified') return ''
  return `${optionLabel(option, value)}${suffix}`
}

function applyCustomPrompt(asset, automatic, stage = null) {
  if (stage && asset.promptMode === 'advanced') {
    const stagePrompt = asset.attributes?.stagePrompts?.[stage]?.trim() || ''
    if (stagePrompt) return stagePrompt
    const legacyPrompt = asset.customPrompt?.trim() || ''
    const legacyStage = inferCharacterPromptStage(legacyPrompt)
    if (legacyStage === stage && asset.customPromptMode === 'replace') return legacyPrompt
    if (asset.customPromptMode === 'append' && legacyPrompt) return [automatic, legacyPrompt].join('，')
    if (!legacyStage && legacyPrompt) return [automatic, legacyPrompt].join('，')
    return automatic
  }
  const custom = asset.customPrompt?.trim() || ''
  if (asset.promptMode === 'advanced' && asset.customPromptMode === 'replace' && custom) {
    return custom
  }
  return [automatic, asset.promptMode === 'advanced' ? custom : ''].filter(Boolean).join('，')
}

function compileAutomatic(asset, aspectRatio) {
  const attributes = asset.attributes
  const parts = [asset.name, asset.description]

  if (attributes.type === 'character') {
    parts.push(
      ...characterIdentityParts(attributes),
      attributes.subjectType === 'animal' ? '' : optionLabel('bodyType', attributes.bodyType),
      optionLabel('framing', attributes.framing),
      attributes.subjectType !== 'animal' && attributes.legStretch
        ? '腿部比例优化：自然适度拉长双腿，腿部约占身高55%到58%，保持头身比例、骨骼、关节和衣服结构正确，不拉伸躯干和手臂'
        : '',
      attributes.turnaround ? '分别生成正面、侧面、背面三张独立设定图，角色外观和服装严格一致' : '',
      CHARACTER_CUTOUT_REQUIREMENTS,
      characterSurfaceRequirements(attributes),
      CHARACTER_STATE_REQUIREMENTS,
    )
  }
  if (attributes.type === 'scene') {
    parts.push(
      optionLabel('space', attributes.space),
      optionLabel('sceneType', attributes.sceneType),
      optionLabel('era', attributes.era),
      optionLabel('time', attributes.time),
      `${optionLabel('weather', attributes.weather)}天`,
      `${optionLabel('mood', attributes.mood)}氛围`,
      optionLabel('camera', attributes.camera),
      '空场景，不出现人物',
      '预留人物表演和镜头运动空间',
      '固定建筑、出入口、尺度与陈设保持一致，时间天气和光线仅属于当前场景版本，不把尚未发生的破坏或人物活动固化为背景',
    )
  }
  if (attributes.type === 'prop') {
    parts.push(
      `${optionLabel('propCategory', attributes.category)}物品`,
      `${optionLabel('material', attributes.material)}材质`,
      optionLabel('condition', attributes.condition),
      optionLabel('view', attributes.view),
      '只生成单个物品本体，不生成人物、人体、手、手指、手臂、腿、脚、脸、身体局部、模特、工作人员、穿戴状态和人形轮廓',
      '保持已确认结构、材质和用途，开合、磨损或损坏只按本次明确状态呈现；不因外观陈旧补造年代、主人或取得历史',
    )
  }
  if (attributes.type === 'costume') {
    parts.push(
      attributes.characterAssetId
        ? '以绑定人物参考图中的原服装为版型和配色依据，只提取并重设计服装，不复制人物身体'
        : '',
      optionLabel('audience', attributes.audience),
      optionLabel('costumeCategory', attributes.category),
      optionLabel('season', attributes.season),
      optionLabel('design', attributes.design),
      `${optionLabel('presentation', attributes.presentation)}展示`,
      attributes.turnaround ? '分别生成服装正面、背面和细节三张独立图片' : '',
      '只生成服装本体，不生成人物、人体、脸、手、手臂、腿、脚、身体局部、模特、工作人员、穿着效果、人体轮廓和衣架',
      '款式、层次、剪裁、面料和配色服从当前造型，正背接缝及配饰连接合理对应；保留指定单色、朴素或旧衣设计，不自动加礼服、花纹、奢华材质或品牌',
    )
  }
  if (attributes.type === 'brand') {
    parts.push(
      optionLabel('brandType', attributes.brandType),
      optionLabel('usage', attributes.usage),
      optionLabel('layout', attributes.layout),
      attributes.exactText ? `必须准确显示文字“${attributes.exactText}”` : '',
      attributes.palette ? `品牌配色：${attributes.palette}` : '',
      '品牌标识完整清晰，保持字形、字母、比例和图形结构准确，适合片尾落版、产品包装或场景招牌复用',
      '不出现人物、人体、手部、产品乱码、错别字、额外文字、水印、二维码、变形图形、重复 Logo、投影和环境反射',
    )
  }
  if (attributes.type === 'audio') {
    parts.push(
      optionLabel('audioType', attributes.audioType),
      attributes.audioType === 'voice' ? optionLabel('gender', attributes.gender) : '',
      attributes.audioType === 'voice' ? optionLabel('ageGroup', attributes.ageGroup) : '',
      optionLabel('emotion', attributes.emotion),
      `${optionLabel('tone', attributes.tone)}音色`,
      optionLabel('speed', attributes.speed),
      optionLabel('language', attributes.language),
      `${attributes.duration}秒`,
      attributes.loop ? '首尾自然衔接，可循环播放' : '',
    )
  } else {
    parts.push(
      `${optionLabel('visualStyle', attributes.visualStyle)}风格`,
      '画面主体清晰，细节完整，适合影视资产一致性参考',
      `画面比例${aspectRatio}`,
    )
  }

  if ('background' in attributes && attributes.type !== 'character') {
    parts.push(`${optionLabel('background', attributes.background)}背景`)
  }
  if (asset.references?.length) {
    parts.push('严格保持参考图主体身份、结构、颜色和关键细节一致')
  }
  return parts.filter(Boolean).join('，')
}

export function summarizeAsset(asset) {
  const attributes = asset.attributes
  if (attributes.type === 'character') {
    const activeVariant = (attributes.appearanceVariants || []).find(
      (variant) => variant.id === attributes.activeAppearanceVariantId,
    )
    return [
      attributes.subjectType === 'animal'
        ? attributes.species || '动物'
        : optionLabel('gender', attributes.gender),
      optionLabel('visualStyle', attributes.visualStyle),
      attributes.turnaround ? '三视图' : optionLabel('framing', attributes.framing),
      activeVariant?.name ? `当前版本：${characterVariantName(asset.name, activeVariant.name)}` : '',
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
  if (attributes.type === 'brand') {
    return [
      optionLabel('brandType', attributes.brandType),
      optionLabel('usage', attributes.usage),
      attributes.exactText ? `文字：${attributes.exactText}` : '',
      optionLabel('visualStyle', attributes.visualStyle),
    ]
  }
  return [
    optionLabel('audioType', attributes.audioType),
    `${attributes.duration}秒`,
    attributes.loop ? '循环' : '单次',
  ]
}

export function compactAssetDescription(asset) {
  const description = String(asset.description || '').trim()
  const attributes = asset.attributes || {}
  if (attributes.type === 'character') {
    if (attributes.subjectType === 'animal') {
      const animalFacts = [attributes.species || '动物', attributes.anthropomorphic ? '拟人形态' : '自然形态']
      const animalDescription = dedupeDescription(description)
      return [animalFacts.join(' · '), animalDescription].filter(Boolean).join('；')
    }
    const identity = [
      optionLabel('gender', attributes.gender),
      attributes.ageGroup ? optionLabel('ageGroup', attributes.ageGroup) : '',
      attributes.exactAge ? `${attributes.exactAge}岁` : '',
    ].filter((value) => value && value !== '不限')
    const role = firstLabeledValue(description, ['身份', '角色身份', '人物背景'])
    const appearance = [
      firstLabeledValue(description, ['体型']),
      firstLabeledValue(description, ['脸型']),
      firstLabeledValue(description, ['发型']),
      firstLabeledValue(description, ['肤色']),
    ].filter(Boolean)
    const outfit = firstLabeledValue(description, ['基础造型', '造型', '服装'])
    if (description && !role && !appearance.length && !outfit) return dedupeDescription(description)
    const compact = [
      identity.join(' · '),
      role ? `身份：${role}` : '',
      appearance.length ? `外观：${appearance.join('、')}` : '',
      outfit ? `造型：${outfit}` : '',
    ].filter(Boolean)
    return compact.length ? compact.join('；') : dedupeDescription(description)
  }
  return dedupeDescription(description)
}

function firstLabeledValue(text, labels) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}\\s*[:：]\\s*([^；;\\n]+)`, 'u'))
    if (match?.[1]) return match[1].trim()
  }
  return ''
}

function dedupeDescription(value) {
  const parts = String(value || '')
    .split(/[；;\n]+/u)
    .map((part) => part.trim())
    .filter(Boolean)
  return [...new Set(parts)].join('；')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
