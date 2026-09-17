const taskIndexCache = new WeakMap()

// Workspace updates replace the tasks array; each snapshot gets one shared index.
export function taskIndexFor(tasks) {
  if (!Array.isArray(tasks)) return { byId: new Map(), byShotKind: new Map(), byAsset: new Map() }
  const cached = taskIndexCache.get(tasks)
  if (cached) return cached
  const index = { byId: new Map(), byShotKind: new Map(), byAsset: new Map() }
  for (const task of tasks) {
    if (task?.id) index.byId.set(task.id, task)
    const shotId = task?.metadata?.shotId
    if (task?.kind && shotId) append(index.byShotKind, taskKey(task.kind, shotId), task)
    const assetId = task?.metadata?.assetId
    if (assetId) append(index.byAsset, assetId, task)
  }
  taskIndexCache.set(tasks, index)
  return index
}

export function taskKey(kind, shotId) {
  return `${kind}:${shotId}`
}

export function isActive(task) {
  return task?.status === 'queued' || task?.status === 'paused' || task?.status === 'running'
}

function append(index, key, task) {
  const candidates = index.get(key)
  if (candidates) candidates.push(task)
  else index.set(key, [task])
}
