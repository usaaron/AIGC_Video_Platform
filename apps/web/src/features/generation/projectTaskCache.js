const TASK_CACHE_PREFIX = 'seqora:project-task-cache:'
const TASK_CACHE_TTL_MS = 6 * 60 * 60 * 1_000
const TASK_CACHE_LIMIT = 120

export function readProjectTaskCache(projectId) {
  const storage = sessionStorageForCache()
  if (!storage || !projectId) return []
  try {
    const cached = JSON.parse(storage.getItem(cacheKey(projectId)) || 'null')
    if (!cached || !Array.isArray(cached.tasks) || Date.now() - cached.savedAt > TASK_CACHE_TTL_MS) {
      storage.removeItem(cacheKey(projectId))
      return []
    }
    return cached.tasks
  } catch {
    storage.removeItem(cacheKey(projectId))
    return []
  }
}

export function writeProjectTaskCache(projectId, tasks) {
  const storage = sessionStorageForCache()
  if (!storage || !projectId || !Array.isArray(tasks)) return
  try {
    storage.setItem(
      cacheKey(projectId),
      JSON.stringify({ savedAt: Date.now(), tasks: tasks.slice(0, TASK_CACHE_LIMIT) }),
    )
  } catch {
    // Storage quota or privacy settings should not interrupt the workflow.
  }
}

export function clearProjectTaskCache(projectId) {
  const storage = sessionStorageForCache()
  if (storage && projectId) storage.removeItem(cacheKey(projectId))
}

function cacheKey(projectId) {
  return `${TASK_CACHE_PREFIX}${projectId}`
}

function sessionStorageForCache() {
  if (typeof window === 'undefined') return null
  return window.sessionStorage || null
}
