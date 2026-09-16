import { ASSET_LIBRARY_CATEGORY_KINDS } from '@seqora/contracts'

export const LIBRARY_CATEGORIES = [
  ['character', '人物'],
  ['prop', '物品'],
  ['scene', '场景'],
  ['audio', '音频'],
  ['script', '剧本'],
  ['prompt-template', '提示词模板'],
]
export const LIBRARY_LABELS = {
  ...Object.fromEntries(LIBRARY_CATEGORIES),
  costume: '服装',
  brand: '品牌',
  image: '图片',
  video: '视频',
  'final-cut': '成片',
}
export function matchesCategory(kind, category) {
  return !category || ASSET_LIBRARY_CATEGORY_KINDS[category]?.includes(kind)
}
export function categoryCount(stats, category, trash = false) {
  return (stats?.byKind || [])
    .filter((item) => matchesCategory(item.kind, category))
    .reduce((sum, item) => sum + (trash ? item.trashed : item.count), 0)
}
export function libraryText(item) {
  return item.sourceSnapshot?.contentPreview || item.sourceSnapshot?.content || item.description || ''
}
export function libraryPrompt(item) {
  return (
    item.sourceSnapshot?.asset?.prompt ||
    item.sourceSnapshot?.task?.prompt ||
    item.sourceSnapshot?.prompt ||
    ''
  )
}
export function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`
}
