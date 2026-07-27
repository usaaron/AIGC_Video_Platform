import { optionLabel } from './assetOptions'

export function compileAssetPrompt(asset, aspectRatio) {
  const automatic = compileAutomatic(asset, aspectRatio)
  return applyCustomPrompt(asset, automatic)
}

export function compileCharacterStagePrompt(asset, aspectRatio, stage) {
  if (asset.attributes.type !== 'character') return compileAssetPrompt(asset, aspectRatio)
  const attributes = asset.attributes
  const identity = [
    asset.name,
    asset.description,
    attributes.subjectType === 'animal' ? `动物角色，${attributes.species || '自定义物种'}` : '人物角色',
    optionLabel('gender', attributes.gender),
    attributes.exactAge ? `${attributes.exactAge}岁` : optionLabel('ageGroup', attributes.ageGroup),
    attributes.subjectType === 'animal' && attributes.anthropomorphic ? '拟人化表现' : '',
    `${optionLabel('visualStyle', attributes.visualStyle)}风格`,
  ]
  let stageParts
  if (stage === 'face') {
    stageParts = [
      '人物面部大头照，头部和肩部完整入镜，五官清晰可调整',
      '正面平视镜头，自然中性表情，均匀柔光，纯色背景',
      '不出现手部，不出现文字和饰边',
      '画面比例1:1',
    ]
  } else if (stage === 'turnaround') {
    stageParts = [
      '严格保持已确认的面部、发型、身材和服装一致',
      '标准站姿，全身完整，视线平视，统一比例和光线',
      '分别生成正面、侧面、背面三张独立源图',
      '最终组合为一张16:9三栏人物三视图设定表',
    ]
  } else {
    stageParts = [
      '严格保持已确认面部的五官、脸型、发型和年龄特征',
      optionLabel('bodyType', attributes.bodyType),
      '全身完整入镜',
      attributes.legStretch
        ? '腿部比例优化：自然适度拉长双腿，腿部约占身高55%到58%，保持头身比例、骨骼、关节和衣服结构正确，不拉伸躯干和手臂'
        : '',
      `${optionLabel('background', attributes.background)}背景`,
      `画面比例${aspectRatio}`,
    ]
  }
  if (asset.references?.length) {
    stageParts.push('严格保持导入参考图中的身份和关键外观特征')
  }
  return applyCustomPrompt(asset, [...identity, ...stageParts].filter(Boolean).join('，'), {
    preserveAutomatic: stage === 'face',
  })
}

function applyCustomPrompt(asset, automatic, options = {}) {
  const custom = asset.customPrompt?.trim() || ''
  if (
    asset.promptMode === 'advanced' &&
    asset.customPromptMode === 'replace' &&
    custom &&
    !options.preserveAutomatic
  ) {
    return custom
  }
  return [automatic, asset.promptMode === 'advanced' ? custom : ''].filter(Boolean).join('，')
}

function compileAutomatic(asset, aspectRatio) {
  const attributes = asset.attributes
  const parts = [asset.name, asset.description]

  if (attributes.type === 'character') {
    parts.push(
      attributes.subjectType === 'animal' ? `动物角色，${attributes.species || '自定义物种'}` : '人物角色',
      optionLabel('gender', attributes.gender),
      attributes.exactAge ? `${attributes.exactAge}岁` : optionLabel('ageGroup', attributes.ageGroup),
      attributes.subjectType === 'animal' && attributes.anthropomorphic ? '拟人化表现' : '',
      optionLabel('bodyType', attributes.bodyType),
      optionLabel('framing', attributes.framing),
      attributes.legStretch
        ? '腿部比例优化：自然适度拉长双腿，腿部约占身高55%到58%，保持头身比例、骨骼、关节和衣服结构正确，不拉伸躯干和手臂'
        : '',
      attributes.turnaround ? '分别生成正面、侧面、背面三张独立设定图，角色外观和服装严格一致' : '',
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
      attributes.emptyScene ? '空场景，不出现人物' : '',
      attributes.activitySpace ? '预留人物表演和镜头运动空间' : '',
    )
  }
  if (attributes.type === 'prop') {
    parts.push(
      `${optionLabel('propCategory', attributes.category)}物品`,
      `${optionLabel('material', attributes.material)}材质`,
      optionLabel('condition', attributes.condition),
      optionLabel('view', attributes.view),
    )
  }
  if (attributes.type === 'costume') {
    parts.push(
      optionLabel('audience', attributes.audience),
      optionLabel('costumeCategory', attributes.category),
      optionLabel('season', attributes.season),
      optionLabel('design', attributes.design),
      `${optionLabel('presentation', attributes.presentation)}展示`,
      attributes.turnaround ? '分别生成服装正面、背面和细节三张独立图片' : '',
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

  if ('background' in attributes) parts.push(`${optionLabel('background', attributes.background)}背景`)
  if (asset.references?.length) {
    parts.push('严格保持参考图主体身份、结构、颜色和关键细节一致')
  }
  return parts.filter(Boolean).join('，')
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
