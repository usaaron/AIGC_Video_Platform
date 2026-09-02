const VIDEO_CACHE_LIMIT = 24
const VIDEO_WARM_BATCH_SIZE = 2
const VIDEO_RETRY_COOLDOWN_MS = 60_000
const videoMetadataCache = new Map()
const videoRetryAfterCache = new Map()

export function warmVideoPlaybackCache(tasks = []) {
  if (typeof window === 'undefined' || typeof window.document?.createElement !== 'function') return
  const urls = [...new Set(tasks.map(completedVideoUrl).filter(Boolean))].slice(0, VIDEO_CACHE_LIMIT)
  let started = 0
  for (const url of urls) {
    if (videoMetadataCache.has(url)) {
      touchVideoCache(url)
      continue
    }
    if ((videoRetryAfterCache.get(url) || 0) > Date.now()) continue
    if (started >= VIDEO_WARM_BATCH_SIZE) break

    const video = window.document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const entry = { video, ready: false }
    videoMetadataCache.set(url, entry)
    video.onloadedmetadata = () => markVideoMetadataLoaded(url)
    video.oncanplay = () => markVideoMetadataLoaded(url)
    video.onerror = () => {
      videoMetadataCache.delete(url)
      videoRetryAfterCache.set(url, Date.now() + VIDEO_RETRY_COOLDOWN_MS)
    }
    video.src = url
    video.load?.()
    started += 1
    trimVideoCache()
  }
}

export function hasVideoMetadataLoaded(url) {
  return Boolean(url && videoMetadataCache.get(url)?.ready)
}

export function markVideoMetadataLoaded(url) {
  if (!url) return
  videoRetryAfterCache.delete(url)
  const entry = videoMetadataCache.get(url) || { video: null, ready: true }
  entry.ready = true
  videoMetadataCache.set(url, entry)
  touchVideoCache(url)
  trimVideoCache()
}

function completedVideoUrl(task) {
  if (task?.status !== 'completed') return null
  if (task.kind !== 'video' && task.provider !== 'local-compose') return null
  return task.resultUrl || task.outputs?.find((output) => output.view !== 'last-frame')?.url || null
}

function touchVideoCache(url) {
  const entry = videoMetadataCache.get(url)
  if (!entry) return
  videoMetadataCache.delete(url)
  videoMetadataCache.set(url, entry)
}

function trimVideoCache() {
  while (videoMetadataCache.size > VIDEO_CACHE_LIMIT) {
    const oldest = videoMetadataCache.keys().next().value
    if (!oldest) break
    videoMetadataCache.delete(oldest)
  }
}
