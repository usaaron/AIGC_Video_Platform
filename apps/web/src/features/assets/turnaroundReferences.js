const VIEWS = ['front', 'side', 'back']
const LABELS = { front: '正面', side: '侧面', back: '背面' }

export function buildTurnaroundReferences(outputs, assetName) {
  const images = (outputs || []).filter((output) => output.mediaType === 'image' && output.url)
  return VIEWS.map((view) => {
    const matches = images.filter((output) => output.view === view)
    if (matches.length !== 1) throw new Error('请等待正面、侧面、背面各一张独立源图全部生成')
    const output = matches[0]
    return { id: output.id, url: output.url, name: `${assetName || '人物'}-${LABELS[view]}`, view }
  })
}

export function turnaroundPreviewOutputs(references) {
  const selected = (references || []).slice(0, 3)
  // Only wholly untagged legacy records used positional front/side/back ordering.
  const legacy = selected.every((reference) => !reference.view)
  return selected
    .map((reference, index) => ({
      ...reference,
      mediaType: 'image',
      view: legacy ? VIEWS[index] : reference.view,
    }))
    .sort((left, right) => VIEWS.indexOf(left.view) - VIEWS.indexOf(right.view))
}
