export const VIDEO_PROMPT_VERSION = 'seedance-storyboard-v5'

export type PromptProject = {
  aspectRatio: string
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
}

export type PromptReference = { id: string }

const ASSET_KIND_LABELS: Record<string, string> = {
  character: '人物',
  scene: '场景',
  prop: '物品',
  costume: '服装',
}

export function compileStoryboardVideoPrompt(input: {
  project: PromptProject
  shot: PromptShot
  shots?: PromptShot[]
  assets?: PromptAsset[]
  references?: PromptReference[]
  continuityMode?: 'independent' | 'continue'
}): string {
  const { project, shot, shots = [], assets = [], references = [], continuityMode = 'independent' } = input
  const duration = normalizedVideoDuration(shot.duration)
  const referenceAssets = references
    .map((reference) => assets.find((asset) => asset.id === reference.id))
    .filter((asset): asset is PromptAsset => Boolean(asset))
  const context = adjacentShotContext(shot, shots)
  const focusedPrompt = focusedShotPrompt(shot.prompt)
  const primaryAction = primaryActionFor(shot.prompt)
  const identityRules = referenceAssets.map(identityRuleFor).join('；')
  const subjectMotion = subjectMotionFor(primaryAction || focusedPrompt, referenceAssets)

  return [
    `生成一段连续${duration}秒、${project.aspectRatio}画幅的电影叙事视频。`,
    `【当前镜头】${shot.title || '未命名镜头'}，${shot.framing || '中景'}。${sentence(focusedPrompt)}`,
    context ? `【前后镜头】${context}` : '',
    shot.continuityNote ? `【场景衔接上下文】${sentence(shot.continuityNote)}` : '',
    continuityMode === 'continue'
      ? '【镜头衔接】严格承接上一镜头尾帧，人物身份、动作方向、视线、空间位置、光线和服装保持连续，首帧不要跳变。'
      : '',
    identityRules ? `【资产一致性】${identityRules}。严格沿用输入参考图，不得更换人物或重设计资产。` : '',
    `【连续动作】${subjectMotion}`,
    `【镜头运动】${cameraMotionFor(shot.framing)}`,
    `【环境运动】${environmentMotionFor(shot.prompt, referenceAssets)}`,
    `【时间推进】0-1秒建立画面，1-${Math.max(2, duration - 1)}秒完成主要动作，最后1秒自然收束并保持动作连续。`,
    '【镜内剪辑】全程保持同一时间、同一空间和同一条动作线，只完成当前镜头指定动作。禁止插入特写、钟表、回忆、下一事件或其他画面；禁止突然切镜、跳时、回切和蒙太奇。',
    '输出必须是真实连续动态视频，不是静止图片，不是幻灯片；人物不能全程冻结，避免只有缩放、平移或单帧抖动。保持角色面部、身材、服装、场景空间和光线方向跨帧稳定。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function normalizedVideoDuration(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(15, Math.max(4, Math.round(parsed))) : 5
}

function adjacentShotContext(shot: PromptShot, shots: PromptShot[]): string {
  const index = shots.findIndex((item) => item.id === shot.id)
  if (index < 0) return ''
  return [
    shots[index - 1]?.prompt ? `上一镜结束：${sentence(lastActionFor(shots[index - 1]?.prompt))}` : '',
    shots[index + 1]?.prompt ? `下一镜开始：${sentence(primaryActionFor(shots[index + 1]?.prompt))}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function identityRuleFor(asset: PromptAsset): string {
  const label = ASSET_KIND_LABELS[asset.kind] || '资产'
  const detail = [asset.description, conciseAssetPrompt(asset.prompt)].filter(Boolean).join('，')
  if (asset.kind === 'character') {
    return `${label}“${asset.name}”保持参考图中的脸、发型、年龄、体型和服装完全一致${detail ? `（${detail}）` : ''}`
  }
  return `${label}“${asset.name}”保持结构、材质、颜色和空间位置一致${detail ? `（${detail}）` : ''}`
}

function subjectMotionFor(prompt: string | undefined, assets: PromptAsset[]): string {
  const text = String(prompt || '').trim()
  if (/动作[：:]/.test(text))
    return `${sentence(text)}动作包含自然起势、过程和结束，身体重心、手部和视线同步变化。`
  if (/对白[：:]/.test(text)) {
    return `${sentence(text)}说话者自然眨眼、呼吸、转头并配合克制口型和表情，其他人物有自然反应。`
  }
  if (assets.some((asset) => asset.kind === 'character')) {
    return `${sentence(text)}人物持续做与剧情相符的细微表情、呼吸、视线和身体动作，动作有明确开始与结束。`
  }
  return `${sentence(text)}画面中的可动物体持续发生符合剧情和物理规律的变化。`
}

function cameraMotionFor(framing: string | undefined): string {
  const motions: Record<string, string> = {
    大全景: '从稳定大全景缓慢向主体推进，保留空间关系和明确景深。',
    广角: '镜头做轻微横移并缓慢推进，主体运动与背景视差清晰。',
    中景: '镜头稳定跟随主体并轻微推进，不使用纯数字缩放。',
    中近景: '镜头跟随人物视线轻微移动，保持面部和上身清晰。',
    特写: '镜头微缓推进到表情或关键细节，焦点自然过渡。',
    俯拍: '保持俯拍空间方向，镜头轻微下压并跟随关键动作。',
  }
  return motions[framing || ''] || '镜头平稳跟随主要动作并产生自然景深和视差，不使用纯数字缩放。'
}

function environmentMotionFor(prompt: string | undefined, assets: PromptAsset[]): string {
  const source = `${prompt || ''} ${assets.map((asset) => `${asset.name} ${asset.prompt || ''}`).join(' ')}`
  const motions: string[] = []
  if (/雨|水|湿|伞/.test(source)) motions.push('雨滴持续下落并在物体表面产生细小水流和反光变化')
  if (/风|衣|发|树|帘/.test(source)) motions.push('风带动头发、衣摆或环境中的柔性物体自然摆动')
  if (/灯|光|夜|火|影/.test(source)) motions.push('环境光和阴影随动作产生细微、连续的变化')
  if (/车|列车|轨道/.test(source)) motions.push('远近物体保持正确视差，运动方向符合场景空间')
  if (!motions.length) motions.push('背景保持稳定，同时保留自然的光影、空气和景深变化')
  return `${motions.join('；')}。`
}

function conciseAssetPrompt(value: string | undefined): string {
  return String(value || '')
    .split(/[，。\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('，')
}

function sentence(value: string | undefined): string {
  const text = String(value || '').trim()
  return text && !/[。！？!?]$/.test(text) ? `${text}。` : text
}

function focusedShotPrompt(value: string | undefined): string {
  const text = String(value || '').trim()
  const fields = promptFields(text)
  if (!Object.keys(fields).length) return text.slice(0, 500)
  return [
    compactField('场景', fields.场景, 160),
    compactField('角色', fields.角色, 160),
    compactField('动作', primaryActionFor(text), 220),
    compactField('对白', fields.动作 ? '' : firstBeat(fields.对白), 120),
    compactField('风格', fields.风格, 100),
    compactField('构图', fields.构图, 120),
    compactField('光影', fields.光影, 100),
    compactField('运镜', firstBeat(fields.运镜), 100),
  ]
    .filter(Boolean)
    .join('｜')
}

function promptFields(value: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const segment of value.split('｜')) {
    const match = segment.trim().match(/^([^：:]+)[：:]([\s\S]*)$/)
    if (match?.[1] && match[2]) fields[match[1].trim()] = match[2].trim()
  }
  return fields
}

function primaryActionFor(value: string | undefined): string {
  const text = String(value || '').trim()
  const fields = promptFields(text)
  return firstBeat(fields.动作 || fields.剧情 || text).slice(0, 240)
}

function lastActionFor(value: string | undefined): string {
  const text = String(value || '').trim()
  const fields = promptFields(text)
  const beats = fieldBeats(fields.动作 || fields.剧情 || text)
  return (beats.at(-1) || '').slice(0, 160)
}

function firstBeat(value: string | undefined): string {
  return fieldBeats(value).at(0) || ''
}

function fieldBeats(value: string | undefined): string[] {
  return String(value || '')
    .split(/[；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function compactField(label: string, value: string | undefined, limit: number): string {
  const text = String(value || '').trim()
  return text ? `${label}：${text.slice(0, limit)}` : ''
}
