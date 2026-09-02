export function scriptGenerationTaskLabel(contentType) {
  if (contentType === 'advertisement') return '广告脚本'
  if (contentType === 'animation') return '短片剧本'
  return '生成本集'
}

export function scriptSegmentTaskLabel(contentType) {
  if (contentType === 'advertisement') return '延长广告脚本'
  if (contentType === 'animation') return '续写短片'
  return '续写下一集'
}

export function assetSuggestionRevision(assets) {
  const revision = (Array.isArray(assets) ? assets : [])
    .map((asset) => `${asset.id}:${asset.updatedAt}`)
    .sort()
    .join('|')
  return revision || 'none'
}
