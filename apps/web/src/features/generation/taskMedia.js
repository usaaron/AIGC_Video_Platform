import { isActive, taskIndexFor, taskKey } from './taskIndex'

export function isAutomaticVideoResult(task) {
  return task.metadata?.providerReconciliationHistoryOnly !== true
}

export function latestVideoTaskFor(tasks, shotOrId, needsLastFrame = false) {
  const shotId = typeof shotOrId === 'string' ? shotOrId : shotOrId.id
  const selectedVideoTaskId = typeof shotOrId === 'string' ? null : shotOrId.selectedVideoTaskId
  const candidates = (taskIndexFor(tasks).byShotKind.get(taskKey('video', shotId)) || []).filter(
    (task) => task.id === selectedVideoTaskId || isAutomaticVideoResult(task),
  )
  // Honor an explicit rollback. The caller reports a missing tail frame rather
  // than silently continuing from a different completed version.
  const selected = candidates.find((task) => task.id === selectedVideoTaskId && task.status === 'completed')
  return (
    candidates.find(isActive) ||
    selected ||
    candidates.find((task) => task.status === 'completed' && (!needsLastFrame || hasLastFrame(task))) ||
    null
  )
}

export function hasLastFrame(task) {
  return task?.outputs?.some((output) => output.view === 'last-frame') ?? false
}
