import { BookOpenText, Clapperboard } from 'lucide-react'
import { SCRIPT_MODEL_CATALOG } from '@seqora/contracts'

export const SCRIPT_CONTENT_CONFIGS = {
  'short-drama': {
    productionMode: 'web-series',
    pageTitle: '网剧剧本',
    pageDescription: '一次生成一集，快速得到可继续拆分镜的网剧制作稿。',
    initialTitle: '从想法快速生成一集网剧',
    generatedTitle: '当前单集可以重新生成或继续精修',
    modeLabel: '单集生成',
    modeNote: '每次固定生成 1 集、6～8 个有效场次；长篇内容请切换到长剧本生成。',
    usesDuration: false,
    durationLabel: '每集时长',
    durationSuffix: '/ 集',
    minimumDuration: 30,
    maximumDuration: 300,
    defaultDuration: 60,
    featureNote: '单次 1 集 · 6～8 场 · 冲突对白 · 结尾钩子',
    documentName: '网剧剧本',
    placeholder: '写下本集故事、冲突或已有剧本，系统会结合项目资产扩写成可制作的网剧场次。',
    progressText: '正在编排网剧冲突、表演节拍与结尾钩子',
    revisionTitle: '完善当前网剧',
    revisionHelp: '改写会按意见重写当前一集；续写只在末尾生成下一集，不会覆盖已有剧本。',
    revisionPlaceholder: '例如：保留人物关系，加强中段阻力和结尾反击前的钩子',
    appendTitle: '续写下一集',
    appendHelp: '承接当前结尾的人物、动作和物件状态，生成下一集并保留新的结尾钩子。',
    appendPlaceholder: '下一集要发生什么（可选）',
    appendDurationLabel: '下一集时长',
    appendAction: '生成下一集',
  },
  advertisement: {
    productionMode: 'short-video',
    pageTitle: '广告脚本',
    pageDescription: '从传播想法生成带时间码、画面、文案、声音和品牌落版的广告制作稿。',
    initialTitle: '从传播想法生成可直接分镜的广告脚本',
    generatedTitle: '当前广告可以重新生成或继续优化',
    modeLabel: '广告创作模式',
    modeNote: '按目标秒数编排开场抓点、核心价值、可见证明与品牌落版。',
    usesDuration: true,
    durationLabel: '广告时长',
    durationSuffix: '成片',
    minimumDuration: 5,
    maximumDuration: 180,
    defaultDuration: 30,
    featureNote: '传播结构 · 产品画面 · 旁白文案 · 品牌落版',
    documentName: '广告脚本',
    placeholder: '写下品牌、产品、受众、核心卖点或一句广告想法，系统会扩写成可执行广告脚本。',
    progressText: '正在编排广告抓点、核心价值与品牌落版',
    revisionTitle: '优化当前广告',
    revisionHelp: '改写会按意见优化整支广告；延长只在末尾补充新段落，不会覆盖已有内容。',
    revisionPlaceholder: '例如：品牌更早出现，只保留一个核心卖点，结尾文案更克制',
    appendTitle: '延长广告脚本',
    appendHelp: '在现有广告末尾补充使用场景或可见证明，并重新完成品牌落版。',
    appendPlaceholder: '希望补充什么场景或信息（可选）',
    appendDurationLabel: '追加时长',
    appendAction: '延长广告',
  },
  animation: {
    productionMode: 'short-video',
    pageTitle: '短片剧本',
    pageDescription: '从一句想法生成有建立、阻力、转折和收束的独立短片制作稿。',
    initialTitle: '从想法生成可直接分镜的完整短片',
    generatedTitle: '当前短片可以重新生成或继续精修',
    modeLabel: '短片创作模式',
    modeNote: '按目标秒数完成角色目标、可见阻力、因果转折与情绪落点。',
    usesDuration: true,
    durationLabel: '短片时长',
    durationSuffix: '成片',
    minimumDuration: 10,
    maximumDuration: 300,
    defaultDuration: 30,
    featureNote: '叙事闭环 · 角色行动 · 对白声音 · 镜头衔接',
    documentName: '短片剧本',
    placeholder: '写下人物、处境、冲突或一句短片想法，系统会扩写成有完整结尾的独立短片。',
    progressText: '正在编排短片行动、转折与结尾情绪',
    revisionTitle: '完善当前短片',
    revisionHelp: '改写会按意见优化整支短片；续写只在末尾增加新场次，不会覆盖已有内容。',
    revisionPlaceholder: '例如：减少旁白，让转折由人物行动触发，结尾更有余韵',
    appendTitle: '续写短片',
    appendHelp: '承接当前人物和物件状态继续推进新场次，可按目标要求自然收尾。',
    appendPlaceholder: '接下来要发生什么（可选）',
    appendDurationLabel: '续写时长',
    appendAction: '续写短片',
  },
}

export const SCRIPT_SECTIONS = [
  {
    id: 'writing',
    label: '单集生成',
    description: '一次生成 1 集，快速进入资产与分镜',
    icon: Clapperboard,
  },
  {
    id: 'long-form',
    label: '长剧本生成',
    description: '进入外部研发的剧本大师',
    status: '外部模块',
    icon: BookOpenText,
  },
]

export const SCRIPT_ASSET_SUGGESTION_COPY = {
  eyebrow: '辅助资产建议',
  title: '随剧本自动识别人物、场景、物品、服装和品牌',
  refresh: '扫描当前剧本',
  refreshAgain: '重新扫描当前剧本',
  empty: '剧本生成完成后会自动快速识别，不调用模型，也不会占用生成队列。',
}

export function availableScriptModelOptions(capabilities) {
  const availability = new Map(capabilities.map((capability) => [capability.id, capability.available]))
  return SCRIPT_MODEL_CATALOG.map((model) => ({
    ...model,
    // Preserve the conservative GLM fallback until rolling API deployments expose capabilities.
    available: availability.get(model.id) ?? model.id !== 'glm-5.2',
  }))
}

export function scriptGenerationStatusMessage(status) {
  return status === 'unavailable'
    ? '当前预发环境未配置可用的文本模型，已暂停无效提交；配置完成后刷新页面即可生成。'
    : '暂时无法确认文本模型状态，已暂停无效提交；请刷新页面后重试。'
}

export function orderScriptEpisodes(episodes) {
  return [...episodes].sort((left, right) => left.episodeNumber - right.episodeNumber)
}

export function initialScriptValue(initialDraftEpisode, isSeries, hasEpisodes, projectScript) {
  return (
    initialDraftEpisode?.draftContent ||
    initialDraftEpisode?.content ||
    (isSeries && hasEpisodes ? '' : projectScript)
  )
}

export function looksLikeDevelopedScript(value) {
  const source = value.trim()
  return source.length >= 300 || /(?:场景|场次|剧情|角色)[：:]/.test(source)
}
