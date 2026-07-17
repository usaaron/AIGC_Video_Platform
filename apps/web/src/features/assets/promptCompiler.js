import { optionLabel } from './assetOptions'

export function compileAssetPrompt(asset, aspectRatio) {
  const automatic = compileAutomatic(asset, aspectRatio)
  const custom = asset.customPrompt?.trim() || ''
  if (asset.promptMode === 'advanced' && asset.customPromptMode === 'replace' && custom) return custom
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
      attributes.legStretch ? '自然适度拉长腿部比例，保持身体结构正确' : '',
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
  if (asset.sourceMode === 'import' && asset.references?.length) {
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
