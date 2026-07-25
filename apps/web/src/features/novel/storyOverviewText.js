const STORY_OVERVIEW_LABELS = {
  coreApproach: '核心改编方式',
  episodeStructure: '篇章结构',
  visualLanguage: '视觉语言',
  continuityPriority: '连续性重点',
  adaptationStrategy: '改编策略',
  characterArc: '人物弧光',
  assetPriority: '资产优先级',
  pacingPlan: '节奏规划',
  productionNotes: '制作注意',
  riskControl: '风险控制',
  nextStep: '下一步',
}

const STORY_OVERVIEW_TERMS = {
  foreshadowing: '伏笔（foreshadowing）',
  continuity: '连续性（continuity）',
  timeline: '时间线（timeline）',
  worldbuilding: '世界观构建（worldbuilding）',
  montage: '蒙太奇（montage）',
  protagonist: '主角（protagonist）',
}

export function formatStoryOverviewText(value) {
  let text = String(value || '').trim()
  if (!text) return ''

  for (const [key, label] of Object.entries(STORY_OVERVIEW_LABELS)) {
    text = text.replace(new RegExp(`(^|[\\s,;，；。])${key}\\s*[:：]`, 'g'), `$1${label}：`)
  }

  for (const [term, bilingual] of Object.entries(STORY_OVERVIEW_TERMS)) {
    text = text.replace(new RegExp(`\\b${term}\\b`, 'gi'), bilingual)
  }

  return text
    .replace(/\s*;\s*/g, '；')
    .replace(/\s*,\s*/g, '，')
    .replace(/([：；。])\s+/g, '$1')
    .trim()
}
