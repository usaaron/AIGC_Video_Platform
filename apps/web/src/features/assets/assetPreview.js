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

const PREVIEW_CACHE_LIMIT = 96
const previewImageCache = new Map()

// Keep a bounded set of decoded image objects alive while the user moves between workflow pages.
export function warmAssetPreviewCache(assets = []) {
  if (typeof window === 'undefined' || typeof window.Image !== 'function') return
  for (const asset of assets) {
    const url = getAssetPreviewUrl(asset)
    if (!url || previewImageCache.has(url)) {
      if (url && previewImageCache.has(url)) touchPreviewCache(url)
      continue
    }
    const image = new window.Image()
    image.decoding = 'async'
    image.loading = 'eager'
    const entry = { image, loaded: false }
    previewImageCache.set(url, entry)
    image.onload = () => {
      entry.loaded = true
      touchPreviewCache(url)
    }
    image.onerror = () => {
      previewImageCache.delete(url)
    }
    image.src = url
    while (previewImageCache.size > PREVIEW_CACHE_LIMIT) {
      const oldest = previewImageCache.keys().next().value
      if (!oldest) break
      previewImageCache.delete(oldest)
    }
  }
}

function touchPreviewCache(url) {
  const entry = previewImageCache.get(url)
  if (!entry) return
  previewImageCache.delete(url)
  previewImageCache.set(url, entry)
}
