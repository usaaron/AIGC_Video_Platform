import { orderedVideoReferenceImages } from '@seqora/prompting'
const KIND_PRIORITY = { scene: 20, character: 16, brand: 10, costume: 8, prop: 8 }
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
  const assetIndex = createShotAssetReferenceIndex(assets)
  return selectShotAssetReferencesFromIndex(assetIndex, shot, limit)
}

export function createShotAssetReferenceIndex(assets) {
  const source = Array.isArray(assets) ? assets : []
  return {
    byId: new Map(source.filter((asset) => asset?.id).map((asset) => [asset.id, asset])),
    candidates: source.filter(
      (asset) =>
        asset.kind !== 'audio' &&
        (referenceUrl(asset) ||
          asset.attributes?.appearanceVariants?.some((item) => item.bodyReference?.url || item.turnaroundReferences?.some((ref) => ref.url))),
    ),
  }
}

export function selectShotAssetReferencesFromIndex(assetIndex, shot, limit = 6, assets = []) {
  const resolvedIndex = assetIndex || createShotAssetReferenceIndex(assets)
  const shotText = normalize(`${shot.title || ''}${shot.prompt || ''}`)
  const characterNames = [...resolvedIndex.byId.values()].filter((asset) => asset.kind === 'character').map((asset) => asset.name)
  const candidates = resolvedIndex.candidates
    .filter((asset) => asset.kind !== 'character' || shotMentionsVisibleCharacter(asset.name, shot, characterNames))
    .map((asset, index) => ({ asset, index, ...scoreAsset(asset, shotText, resolvedIndex.byId) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)

  const selected = []
  const selectedCostumeOwners = new Set()
  for (const candidate of candidates) {
    if (!candidate.matched) continue
    const ownerId = candidate.asset.kind === 'costume' ? candidate.asset.attributes?.characterAssetId : null
    if (ownerId && selectedCostumeOwners.has(ownerId)) continue
    selected.push(candidate)
    if (ownerId) selectedCostumeOwners.add(ownerId)
    if (selected.length >= limit) break
  }
  return selected
    .slice(0, limit)
    .map(({ asset }) => {
      const selection = selectCharacterShotAppearance(asset, shot, [...resolvedIndex.byId.values()].filter((item) => item.kind === 'character').map((item) => item.name))
      const variant = selection?.variant
      const name = variant ? characterVariantName(asset.name, variant.name) : asset.name
      return {
        id: asset.id,
        url: selection ? selection.url : referenceUrl(asset),
        videoUrl: selection ? selection.videoUrl : referenceUrl(asset),
        appearanceUrl: selection?.appearanceUrl,
        role: selection?.role || '外观',
        appearanceRole: selection?.appearanceRole,
        view: selection?.view,
        ...(variant
          ? {
              appearance: { name, description: [variant.description, variant.prompt].filter(Boolean).join('\n') },
            }
          : {}),
        name: `${name}.png`,
        assetName: name,
        assetKind: asset.kind,
      }
    })
    .filter((reference) => reference.url || reference.videoUrl)
}

export function taskUsesAssetReferences(task, references) {
  const actual = task?.metadata?.referenceAssetIds
  if (!Array.isArray(actual)) return false
  const expected = references.map((reference) => reference.id)
  return actual.length === expected.length && expected.every((id, index) => actual[index] === id)
}

export function selectVideoReferenceImages(manualReferenceUrl, references, limit = 9) {
  const manual = Array.isArray(manualReferenceUrl) ? manualReferenceUrl : [manualReferenceUrl].filter(Boolean)
  return orderedVideoReferenceImages(
    manual,
    [
      ...references.map((reference) => reference.videoUrl || reference.url),
      ...references.map((reference) => reference.appearanceUrl),
    ],
    limit,
  )
}

function scoreAsset(asset, shotText, assetById) {
  const name = normalize(asset.kind === 'character' ? characterReferenceName(asset.name) : asset.name)
  const exactNameMatch = Boolean(name && shotText.includes(name))
  if (asset.kind === 'character' && !exactNameMatch) {
    return { score: KIND_PRIORITY[asset.kind] || 0, matched: false }
  }
  let matchScore = exactNameMatch ? 200 : 0
  let matchingName = name
  if (asset.kind === 'costume' && asset.attributes?.characterAssetId) {
    const owner = assetById.get(asset.attributes.characterAssetId)
    const ownerName = normalize(owner?.name)
    if (ownerName) matchingName = name.replace(ownerName, '')
    if (ownerName && shotText.includes(ownerName) &&
        (exactNameMatch || overlapScore(shotText, matchingName + normalize(asset.description), 1, 1))) matchScore += 190
  }
  matchScore += overlapScore(shotText, matchingName, 20, 40)
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

function referenceUrl(asset, variant = characterAppearance(asset)) {
  if (asset.kind === 'character' && asset.attributes?.type === 'character') {
    if (variant) return variant.bodyReference?.url || asset.attributes.faceReference?.url || null
    return asset.attributes.bodyReference?.url || asset.attributes.faceReference?.url || asset.imageUrl
  }
  return asset.imageUrl
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}
import { characterAppearance, characterReferenceName, characterVariantName, selectCharacterShotAppearance, shotMentionsVisibleCharacter } from '@seqora/contracts'
