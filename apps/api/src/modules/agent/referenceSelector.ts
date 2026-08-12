import type { Asset, Shot } from '@seqora/contracts'

const KIND_PRIORITY: Record<Asset['kind'], number> = {
  scene: 20,
  character: 16,
  brand: 10,
  costume: 8,
  prop: 8,
  audio: 0,
}

export function selectAgentShotReferences(assets: Asset[], shot: Shot, limit = 6): Asset[] {
  const text = normalize(`${shot.title}${shot.prompt}`)
  const candidates = assets
    .filter((asset) => asset.kind !== 'audio' && assetReferenceUrl(asset))
    .map((asset, index) => ({ asset, index, score: score(asset, text, assets) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
  const selected = candidates.filter((candidate) => candidate.score > KIND_PRIORITY[candidate.asset.kind])
  const scene = candidates.find((candidate) => candidate.asset.kind === 'scene')
  if (scene && !selected.includes(scene)) selected.push(scene)
  return selected.slice(0, limit).map((candidate) => candidate.asset)
}

export function assetReferenceUrl(asset: Asset): string | null {
  if (asset.attributes.type === 'character') {
    const portrait = asset.attributes.trustedPortrait
    if (portrait?.status === 'active') return `asset://${portrait.assetId}`
    return asset.attributes.bodyReference?.url || asset.attributes.faceReference?.url || asset.imageUrl
  }
  return asset.imageUrl
}

function score(asset: Asset, text: string, assets: Asset[]): number {
  const name = normalize(asset.name)
  let match = name && text.includes(name) ? 200 : 0
  if (asset.kind === 'character' && !match) return KIND_PRIORITY.character
  if (asset.attributes.type === 'costume' && asset.attributes.characterAssetId) {
    const ownerId = asset.attributes.characterAssetId
    const owner = assets.find((item) => item.id === ownerId)
    if (owner && text.includes(normalize(owner.name))) match += 190
  }
  for (const token of bigrams(normalize(asset.description))) {
    if (text.includes(token)) match += 2
  }
  return KIND_PRIORITY[asset.kind] + match
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>()
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2))
  return result
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}
