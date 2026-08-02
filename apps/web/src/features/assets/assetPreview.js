export function getAssetPreviewUrl(asset) {
  if (asset.kind === 'audio') return null
  if (asset.kind === 'character') {
    const activeVariant = (asset.attributes?.appearanceVariants || []).find(
      (variant) => variant.id === asset.attributes?.activeAppearanceVariantId,
    )
    return (
      activeVariant?.bodyReference?.url ||
      asset.attributes?.bodyReference?.url ||
      asset.imageUrl ||
      asset.attributes?.faceReference?.url ||
      asset.references?.[0]?.url ||
      null
    )
  }
  return asset.imageUrl || asset.references?.[0]?.url || null
}
