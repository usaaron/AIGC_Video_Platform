export const VIDEO_PROMPT_VERSION = 'seedance-storyboard-v9'

export type PromptProject = {
  aspectRatio: string
  contentType?: string
  visualStyle?: string
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
  attributes?: unknown
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
  const { project, shot, assets = [], references = [], continuityMode = 'independent' } = input
  const duration = normalizedVideoDuration(shot.duration, project.contentType === 'short-drama' ? 3 : 4)
  const referenceAssets = references
    .map((reference) => assets.find((asset) => asset.id === reference.id))
    .filter((asset): asset is PromptAsset => Boolean(asset))
  const focusedPrompt = focusedShotPrompt(shot.prompt)
  const actionSequence = actionSequenceFor(shot.prompt)
  const shotFields = promptFields(String(shot.prompt || ''))
  const identityRules = referenceAssets.map(identityRuleFor).join('；')
  const actorPerformance = actorPerformanceFor(shotFields.角色, actionSequence, shotFields.对白)
  const soundPlan = soundPlanFor(shotFields.对白, shot.prompt, referenceAssets)
  const subjectMotion = subjectMotionFor(
    shotFields.动作
      ? `动作：${actionSequence}`
      : shotFields.对白
        ? `对白：${shotFields.对白}`
        : actionSequence || focusedPrompt,
    referenceAssets,
  )

  return [
    `生成一段连续${duration}秒、${project.aspectRatio}画幅的${visualStyleLabel(project.visualStyle)}电影叙事视频。`,
    `【当前镜头】${shot.title || '未命名镜头'}，${shot.framing || '中景'}。${sentence(focusedPrompt)}`,
    shot.continuityNote ? `【场景衔接上下文】${sentence(shot.continuityNote)}` : '',
    continuityMode === 'continue'
      ? '【镜头衔接】严格承接上一镜头尾帧，人物身份、动作方向、视线、空间位置、光线和服装保持连续，首帧不要跳变。'
      : '',
    identityRules ? `【资产一致性】${identityRules}。严格沿用输入参考图，不得更换人物或重设计资产。` : '',
    `【动作执行】本镜只完成一个主动作，不追加第二个剧情动作。${subjectMotion}`,
    `【群像表演】${actorPerformance}`,
    actionSequence
      ? `【主动作】必须完整拍完这一项，不得拆成第二个事件、不得凭空增加动作：${actionSequence}`
      : '',
    `【声音执行】${soundPlan}`,
    `【镜头运动】${cameraMotionFor(shot.framing)}`,
    `【环境运动】${environmentMotionFor(shot.prompt, referenceAssets)}`,
    `【时间推进】0-1秒延续上镜状态并建立画面，1-${Math.max(2, duration - 1)}秒完整完成主动作与至少一次表情或视线变化，最后1秒停在下一镜可直接承接的结束姿态。`,
    '【镜内剪辑】全程保持同一时间、同一空间和同一条动作线，只完成当前镜头指定动作。禁止插入特写、钟表、回忆、下一事件或其他画面；禁止突然切镜、跳时、回切和蒙太奇。',
    '输出必须是真实连续动态视频，不是静止图片，不是幻灯片；人物不能全程冻结，避免只有缩放、平移或单帧抖动。保持角色面部、身材、服装、场景空间和光线方向跨帧稳定。必须生成可听见的现场声音、对白或旁白；不要输出静音视频。',
  ]
    .filter(Boolean)
    .join('\n')
}

function visualStyleLabel(value: string | undefined): string {
  const labels: Record<string, string> = {
    photorealistic: '仿真人风格',
    'cinematic-cg': '影视CG风格',
    'chinese-2d': '2D风格',
    'chinese-3d': '3D国漫风格',
    anime: '日漫风格',
    storybook: '绘本风格',
  }
  return labels[value || 'cinematic-cg'] || '统一项目视觉风格'
}

export function normalizedVideoDuration(value: unknown, minimum = 4): number {
  const parsed = Number(value)
  const min = Math.min(15, Math.max(1, Math.round(minimum)))
  return Number.isFinite(parsed) ? Math.min(15, Math.max(min, Math.round(parsed))) : Math.max(5, min)
}

function identityRuleFor(asset: PromptAsset): string {
  const label = ASSET_KIND_LABELS[asset.kind] || '资产'
  const detail = [
    asset.description,
    conciseAssetPrompt(asset.prompt),
    conciseAssetAttributes(asset.attributes),
  ]
    .filter(Boolean)
    .join('，')
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

function actorPerformanceFor(
  roleField: string | undefined,
  actionSequence: string,
  dialogue: string | undefined,
): string {
  const roles = String(roleField || '').trim()
  const dialogueText = String(dialogue || '').trim()
  if (!roles) {
    return '画面内所有人物都必须有可见的呼吸、眨眼、视线、表情或姿态变化；不能只有主角运动，不能把配角和背景人物冻结成照片。'
  }
  return [
    `角色栏列出的所有人物都必须实际出现在镜头中：${roles}`,
    '主角执行当前动作时，配角和背景角色必须同步做符合场景的可见反应，例如转头、后退、交换视线、握紧物件、调整姿态、交谈口型或表情变化；不得凭空增加角色，也不得让除主角外的人物静止不动。',
    '每 2 到 3 秒至少发生一次可见的表情、视线、重心、手部或姿态变化；动作从起势连续发展到结束姿态，角色之间保持明确的视线和空间关系。',
    dialogueText && !/无台词/u.test(dialogueText)
      ? '有台词时说话者必须有自然口型、呼吸和表情反应，听者必须同步做可见的倾听或反应。'
      : '没有台词时，用现场动作、表情和环境声传达信息，不要用空镜或静止人物填充时间。',
  ].join('')
}

function soundPlanFor(
  dialogue: string | undefined,
  prompt: string | undefined,
  assets: PromptAsset[],
): string {
  const dialogueText = String(dialogue || '').trim()
  const source = `${prompt || ''} ${assets.map((asset) => `${asset.name} ${asset.description || ''} ${asset.prompt || ''}`).join(' ')}`
  const effects: string[] = []
  if (/雨|水|湿|伞/u.test(source)) effects.push('雨声和水滴声')
  if (/门|脚步|走|跑|站台|列车|车/u.test(source)) effects.push('脚步、门响或远处交通声')
  if (/风|树|帘|衣/u.test(source)) effects.push('连续风声和环境物体轻微摩擦声')
  if (!effects.length) effects.push('与场景一致的低存在感环境底噪和动作音效')
  return [
    dialogueText && !/无台词/u.test(dialogueText)
      ? `严格按对白字段生成同步人声：${dialogueText}；[对白]需要口型同步，[画外音]和[内心独白]只作为画外声音，不让人物错误对口型。`
      : '本镜无台词，生成自然的现场声和动作音效，不插入无意义的人声。',
    `声音至少包含${effects.join('、')}，声音随动作先后进入、变化并在镜尾自然收束。`,
    '不要静音、不要把对白写成字幕、不要生成背景音乐盖住台词。',
  ].join('')
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

function conciseAssetAttributes(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const attributes = value as Record<string, unknown>
  return Object.entries(attributes)
    .filter(
      ([key, item]) =>
        key !== 'type' &&
        key !== 'faceReference' &&
        key !== 'bodyReference' &&
        key !== 'trustedPortrait' &&
        key !== 'stagePrompts' &&
        key !== 'appearanceVariants' &&
        item !== null &&
        item !== undefined &&
        item !== '',
    )
    .slice(0, 8)
    .map(([key, item]) => `${key}=${String(item)}`)
    .join('、')
}

function sentence(value: string | undefined): string {
  const text = String(value || '').trim()
  return text && !/[。！？!?]$/.test(text) ? `${text}。` : text
}

function focusedShotPrompt(value: string | undefined): string {
  const text = String(value || '').trim()
  const fields = promptFields(text)
  if (!Object.keys(fields).length) return text.slice(0, 900)
  return [
    compactField('剧情目的', fields.剧情, 240),
    compactField('场次目标', fields.目标, 180),
    compactField('场次阻力', fields.阻力, 180),
    compactField('场次变化', fields.变化, 180),
    compactField('场景', fields.场景, 260),
    compactField('角色状态', fields.角色, 260),
    compactField('关键物件', fields.关键物件 || fields.物件 || fields.道具, 220),
    compactField('动作', actionSequenceFor(text), 420),
    compactField('对白与声音', fields.对白, 240),
    compactField('风格', fields.风格, 140),
    compactField('构图', fields.构图, 180),
    compactField('光影', fields.光影, 180),
    compactField('运镜', fields.运镜, 200),
    compactField('衔接', fields.衔接, 280),
    compactField('入场状态', fields.入场状态, 220),
    compactField('出场状态', fields.出场状态, 220),
    compactField('导演节拍', fields.导演节拍, 420),
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

function actionSequenceFor(value: string | undefined): string {
  const text = String(value || '').trim()
  const fields = promptFields(text)
  const source = fields.动作 || fields.剧情 || (Object.keys(fields).length ? '' : text)
  const beats = fieldBeats(source)
  return (beats[0] || source).slice(0, 420)
}

function fieldBeats(value: string | undefined): string[] {
  return String(value || '')
    .split(/[；;]+|(?=动作\s*[1-9][0-9]*\s*[：:])/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function compactField(label: string, value: string | undefined, limit: number): string {
  const text = String(value || '').trim()
  return text ? `${label}：${text.slice(0, limit)}` : ''
}
