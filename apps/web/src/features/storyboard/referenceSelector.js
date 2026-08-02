const KIND_PRIORITY = { scene: 20, character: 16, costume: 8, prop: 8 }
const COMMON_BIGRAMS = new Set([
  '人物',
  '角色',
  '画面',
  '生成',
  '影视',
  '电影',
  '风格',
  '项目',
  '资产',
  '雨夜',
  '主角',
  '场景',
])

export function selectShotAssetReferences(assets, shot, limit = 6) {
  const shotText = normalize(`${shot.title || ''}${shot.prompt || ''}`)
  const candidates = assets
    .filter((asset) => asset.kind !== 'audio' && referenceUrl(asset))
    .map((asset, index) => ({ asset, index, ...scoreAsset(asset, shotText) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)

  const selected = candidates.filter((candidate) => candidate.matched).slice(0, limit)
  if (!selected.some(({ asset }) => asset.kind === 'scene')) {
    const scene = candidates.find(({ asset }) => asset.kind === 'scene')
    if (scene && !selected.includes(scene)) selected.push(scene)
  }

  return selected.slice(0, limit).map(({ asset }) => ({
    id: asset.id,
    url: referenceUrl(asset),
    videoUrl: videoReferenceUrl(asset),
    name: `${asset.name}.png`,
    assetName: asset.name,
    assetKind: asset.kind,
  }))
}

export function taskUsesAssetReferences(task, references) {
  const actual = task?.metadata?.referenceAssetIds
  if (!Array.isArray(actual)) return false
  const expected = references.map((reference) => reference.id)
  return actual.length === expected.length && expected.every((id, index) => actual[index] === id)
}

export function selectVideoReferenceImages(storyboardImageUrl, references, limit = 9) {
  return [
    ...new Set(
      [storyboardImageUrl, ...references.map((reference) => reference.videoUrl || reference.url)].filter(
        Boolean,
      ),
    ),
  ].slice(0, limit)
}

function scoreAsset(asset, shotText) {
  const name = normalize(asset.name)
  let matchScore = name && shotText.includes(name) ? 200 : 0
  matchScore += overlapScore(shotText, name, 20, 40)
  matchScore += overlapScore(shotText, normalize(asset.description), 2, 20)
  return { score: (KIND_PRIORITY[asset.kind] || 0) + matchScore, matched: matchScore > 0 }
}

function overlapScore(text, source, weight, limit) {
  let matches = 0
  for (const token of bigrams(source)) {
    if (!COMMON_BIGRAMS.has(token) && text.includes(token)) matches += 1
    if (matches >= limit) break
  }
  return matches * weight
}

function bigrams(value) {
  const tokens = new Set()
  for (let index = 0; index < value.length - 1; index += 1) {
    tokens.add(value.slice(index, index + 2))
  }
  return tokens
}

function referenceUrl(asset) {
  if (asset.kind === 'character' && asset.attributes?.type === 'character') {
    return asset.attributes.bodyReference?.url || asset.attributes.faceReference?.url || asset.imageUrl
  }
  return asset.imageUrl
}

function videoReferenceUrl(asset) {
  if (asset.kind !== 'character' || asset.attributes?.type !== 'character') return referenceUrl(asset)
  const portrait = asset.attributes.trustedPortrait
  return portrait?.status === 'active' ? `asset://${portrait.assetId}` : referenceUrl(asset)
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}
