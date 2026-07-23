export function getAssetPreviewUrl(asset) {
  if (asset.kind === 'audio') return null
  if (asset.kind === 'character') {
    return asset.attributes?.faceReference?.url || asset.imageUrl || asset.references?.[0]?.url || null
  }
  return asset.imageUrl || asset.references?.[0]?.url || null
}
