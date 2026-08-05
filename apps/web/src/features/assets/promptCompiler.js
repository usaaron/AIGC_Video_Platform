import { optionLabel } from './assetOptions'

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
  ]
  let stageParts
  if (stage === 'face') {
    stageParts = [
      isAnimal
        ? '动物头部身份照，头部和肩颈完整入镜，面部特征与毛发纹理清晰可调整'
        : '人物面部大头照，头部和肩部完整入镜，五官清晰可调整',
      '正面平视镜头，自然中性表情，均匀平光',
      '不出现手部、前爪、文字和饰边',
      '画面比例1:1',
    ]
  } else if (stage === 'turnaround') {
    stageParts = [
      '严格保持已确认的头部、外形、身材和服装一致',
      '标准站姿或自然站立姿态，全身完整，统一比例',
      '分别生成正面、侧面、背面三张独立源图',
      '最终组合为一张16:9三栏角色三视图设定表',
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
  return applyCustomPrompt(asset, [...identity, ...stageParts].filter(Boolean).join('，'), stage)
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
  '透明背景，Alpha通道，无背景色，无光影效果，无投影，无高光，无环境反射，均匀平光，主体边缘清晰'

function characterIdentityParts(attributes) {
  if (attributes.subjectType === 'animal') {
    return [
      `动物角色，${attributes.species || '自定义物种'}`,
      attributes.anthropomorphic ? '拟人动物表现，保持动物头部和物种特征' : '保持自然动物形态',
      '只生成指定动物，禁止人类形态、人类面部和人类皮肤',
    ]
  }
  return [
    '人物角色',
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
    if (legacyStage === stage) return legacyPrompt
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
    )
  }
  if (attributes.type === 'prop') {
    parts.push(
      `${optionLabel('propCategory', attributes.category)}物品`,
      `${optionLabel('material', attributes.material)}材质`,
      optionLabel('condition', attributes.condition),
      optionLabel('view', attributes.view),
      '只生成单个物品本体，不生成人物、人体、手、手指、手臂、腿、脚、脸、身体局部、模特、工作人员、穿戴状态和人形轮廓',
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
      activeVariant?.name ? `当前版本：${activeVariant.name}` : '',
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
