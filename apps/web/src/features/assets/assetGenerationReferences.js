export function assetGenerationReferences(asset, assets) {
  const references = [...(asset.references || [])]
  if (asset.kind !== 'costume' || !asset.attributes?.characterAssetId) return references
  const character = assets.find(
    (item) => item.kind === 'character' && item.id === asset.attributes.characterAssetId,
  )
  if (!character || character.attributes?.type !== 'character') return references
  const activeVariant = (character.attributes.appearanceVariants || []).find(
    (variant) => variant.id === character.attributes.activeAppearanceVariantId,
  )
  const source =
    activeVariant?.bodyReference ||
    character.attributes.bodyReference ||
    character.attributes.faceReference ||
    (character.imageUrl
      ? { id: `character-${character.id}`, url: character.imageUrl, name: `${character.name}-人物参考` }
      : null)
  if (!source?.url || references.some((reference) => reference?.url === source.url)) return references
  return [source, ...references]
}
