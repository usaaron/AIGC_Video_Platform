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

export function mergeCharacterVariants<T extends Asset | ScriptAssetSuggestion>(
  existing: T,
  input: CreateAsset | ScriptAssetSuggestion,
): T {
  if (existing.attributes.type !== 'character' || input.attributes.type !== 'character') return existing
  const variants = [...(existing.attributes.appearanceVariants || [])]
  const names = new Set(
    variants.map((variant) => assetIdentityKey({ kind: 'character', name: variant.name })),
  )
  for (const variant of input.attributes.appearanceVariants || []) {
    const key = assetIdentityKey({ kind: 'character', name: variant.name })
    if (!names.has(key)) {
      variants.push(variant)
      names.add(key)
    }
  }
  return { ...existing, attributes: { ...existing.attributes, appearanceVariants: variants } }
}
