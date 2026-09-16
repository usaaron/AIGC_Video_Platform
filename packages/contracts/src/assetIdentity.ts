import type { Asset, CreateAsset, ScriptAssetSuggestion } from './project.js'

export function assetIdentityKey(asset: { kind: string; name: string }) {
  return `${asset.kind}:${asset.name.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('zh-CN')}`
}

export function characterIdentity(name: string) {
  const match = name.trim().match(/^(.+?)\s*[-—·]\s*(.+(?:版本|版|造型))$/u)
  return {
    name: match?.[1]?.trim() || name.trim(),
    variant: match?.[2]?.trim().replace(/版本$/u, '版') || '标准版',
  }
}

/** Keep the character identity separate from its reusable appearance. Accept legacy names. */
export function characterVariantName(name: string, variant?: string) {
  const identity = characterIdentity(name)
  const supplied = variant?.normalize('NFKC').trim() || identity.variant
  const label = supplied.startsWith(identity.name)
    ? supplied.slice(identity.name.length).replace(/^[\s\-—·]+/u, '')
    : characterIdentity(supplied).name !== supplied
      ? characterIdentity(supplied).variant
      : supplied
  return `${identity.name}-${label.replace(/(?:版本|版|造型)$/u, '').trim() || '标准'}版本`
}

export function characterVariantKey(name: string) {
  return assetIdentityKey({ kind: 'character', name: characterVariantName(name) })
}

type NamedAsset = Pick<Asset, 'kind' | 'name' | 'attributes'>

export function characterAppearance(asset: NamedAsset, text = '') {
  if (asset.kind !== 'character' || asset.attributes?.type !== 'character') return null
  const attributes = asset.attributes
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLocaleLowerCase('zh-CN')
      .replace(/版本/gu, '版')
      .replace(/[\s\p{P}\p{S}]+/gu, '')
  const prompt = normalize(text)
  const variants = attributes.appearanceVariants || []
  return (
    [...variants]
      .sort((a, b) => b.name.length - a.name.length)
      .find((item) => prompt.includes(normalize(characterVariantName(asset.name, item.name)))) ||
    variants.find((item) => item.id === attributes.activeAppearanceVariantId) ||
    null
  )
}

export function assetDisplayName(asset: NamedAsset) {
  return asset.kind === 'character'
    ? characterVariantName(asset.name, characterAppearance(asset)?.name)
    : asset.name
}

export function mergeCharacterVariants<T extends Asset | ScriptAssetSuggestion>(
  existing: T,
  input: CreateAsset | ScriptAssetSuggestion,
): T {
  if (existing.attributes.type !== 'character' || input.attributes.type !== 'character') return existing
  const variants = [...(existing.attributes.appearanceVariants || [])]
  const names = new Set(variants.map((variant) => characterVariantKey(variant.name)))
  for (const variant of input.attributes.appearanceVariants || []) {
    const key = characterVariantKey(variant.name)
    if (!names.has(key)) {
      variants.push(variant)
      names.add(key)
    }
  }
  return { ...existing, attributes: { ...existing.attributes, appearanceVariants: variants } }
}
