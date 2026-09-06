const CHUNK_RELOAD_KEY = 'seqora:chunk-reload'

// A deployed SPA may still have an older entry point whose hashed chunk was removed.
// Reload once with a cache-busting query so the browser can recover automatically.
export function loadWithChunkRecovery(loader) {
  return loader()
    .then((module) => {
      clearReloadMarker()
      return module
    })
    .catch((error) => {
      if (requestRecoveryReload()) return new Promise(() => {})
      clearReloadMarker()
      throw error
    })
}

function requestRecoveryReload() {
  if (typeof window === 'undefined') return false
  try {
    const storage = window.sessionStorage
    if (storage.getItem(CHUNK_RELOAD_KEY)) return false
    storage.setItem(CHUNK_RELOAD_KEY, '1')
    const url = new URL(window.location.href)
    url.searchParams.set('_seqora_reload', String(Date.now()))
    window.location.replace(url.href)
    return true
  } catch {
    return false
  }
}

function clearReloadMarker() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY)
  } catch {
    // Storage may be unavailable in privacy-restricted browsers.
  }
}
