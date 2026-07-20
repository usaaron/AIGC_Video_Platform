export const PROP_ASSET_POLICY = {
  title: '道具资产创建规则',
  summary: '只为剧情关键或多次出现的物件建立道具资产。',
  include: ['关键线索', '反复出现', '需要保持外观一致'],
  exclude: '一次性背景物直接写入镜头提示词。',
}

const KEY_PROP_TERMS = [
  '关键',
  '重要',
  '核心',
  '线索',
  '证据',
  '信物',
  '主道具',
  '剧情道具',
  '反复出现',
  '多次出现',
  '贯穿',
  '标志性',
  '保持一致',
]

export function shouldCreatePropAsset({ name, description = '', prompt = '', shotPrompts = [] }) {
  const normalizedName = normalizeText(name)
  if (!normalizedName) return false

  const candidateText = normalizeText([name, description, prompt].join(' '))
  if (KEY_PROP_TERMS.some((term) => candidateText.includes(term))) return true

  return countPropMentions(normalizedName, shotPrompts) >= 2
}

export function propAssetDecisionReason(input) {
  if (!normalizeText(input.name)) return '先填写明确的物件名称。'
  if (shouldCreatePropAsset(input)) return '适合建立道具资产。'
  return '建议写进单个镜头提示词，不单独建资产。'
}

export function countPropMentions(name, shotPrompts = []) {
  const normalizedName = normalizeText(name)
  if (!normalizedName) return 0
  return shotPrompts.reduce((count, text) => {
    const normalizedText = normalizeText(text)
    if (!normalizedText) return count
    return count + occurrences(normalizedText, normalizedName)
  }, 0)
}

function occurrences(text, term) {
  let count = 0
  let index = text.indexOf(term)
  while (index !== -1) {
    count += 1
    index = text.indexOf(term, index + term.length)
  }
  return count
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
}
