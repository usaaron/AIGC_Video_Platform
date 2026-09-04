export function getAssetPreviewUrl(asset, tasks = []) {
  if (asset.kind === 'audio') return null
  const generatedTaskUrl = latestCompletedAssetOutput(asset, tasks)
  if (asset.kind === 'character') {
    const activeVariant = (asset.attributes?.appearanceVariants || []).find(
      (variant) => variant.id === asset.attributes?.activeAppearanceVariantId,
    )
    const trustedPortrait = asset.attributes?.trustedPortrait
    const trustedPortraitUrl =
      trustedPortrait?.status === 'active'
        ? trustedPortrait.previewUrl ||
          (trustedPortrait.assetId
            ? `/api/v1/trusted-assets/portraits/${encodeURIComponent(trustedPortrait.assetId)}/preview`
            : null)
        : null
    return (
      activeVariant?.bodyReference?.url ||
      asset.attributes?.bodyReference?.url ||
      asset.imageUrl ||
      generatedTaskUrl ||
      asset.attributes?.faceReference?.url ||
      trustedPortraitUrl ||
      asset.references?.[0]?.url ||
      null
    )
  }
  return asset.imageUrl || generatedTaskUrl || asset.references?.[0]?.url || null
}

function latestCompletedAssetOutput(asset, tasks) {
  return tasks
    .filter(
      (task) =>
        task.kind === 'image' &&
        task.status === 'completed' &&
        task.metadata?.assetId === asset.id &&
        Array.isArray(task.outputs) &&
        task.outputs.some((output) => output?.mediaType === 'image' && output?.url),
    )
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left))[0]
    ?.outputs.find((output) => output?.mediaType === 'image' && output?.url)?.url
}

function taskTimestamp(task) {
  const value = Date.parse(task.updatedAt || task.createdAt || '')
  return Number.isFinite(value) ? value : 0
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
