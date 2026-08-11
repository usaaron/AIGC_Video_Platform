const VIDEO_CACHE_LIMIT = 24
const videoMetadataCache = new Map()

export function warmVideoPlaybackCache(tasks = []) {
  if (typeof window === 'undefined' || typeof window.document?.createElement !== 'function') return
  for (const task of tasks) {
    const url = completedVideoUrl(task)
    if (!url) continue
    if (videoMetadataCache.has(url)) {
      touchVideoCache(url)
      continue
    }

    const video = window.document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const entry = { video, ready: false }
    videoMetadataCache.set(url, entry)
    video.onloadedmetadata = () => markVideoMetadataLoaded(url)
    video.oncanplay = () => markVideoMetadataLoaded(url)
    video.onerror = () => videoMetadataCache.delete(url)
    video.src = url
    video.load?.()
    trimVideoCache()
  }
}

export function hasVideoMetadataLoaded(url) {
  return Boolean(url && videoMetadataCache.get(url)?.ready)
}

export function markVideoMetadataLoaded(url) {
  if (!url) return
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
