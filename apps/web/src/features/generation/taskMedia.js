export function latestVideoTaskFor(tasks, shotOrId, needsLastFrame = false) {
  const shotId = typeof shotOrId === 'string' ? shotOrId : shotOrId.id
  const selectedVideoTaskId = typeof shotOrId === 'string' ? null : shotOrId.selectedVideoTaskId
  // Honor an explicit rollback. The caller reports a missing tail frame rather
  // than silently continuing from a different completed version.
  const selected = tasks.find(
    (task) =>
      task.id === selectedVideoTaskId &&
      task.kind === 'video' &&
      task.metadata?.shotId === shotId &&
      task.status === 'completed',
  )
  return (
    tasks.find(
      (task) =>
        task.kind === 'video' &&
        task.metadata?.shotId === shotId &&
        task.status !== 'cancelled' &&
        (task.status === 'queued' || task.status === 'paused' || task.status === 'running'),
    ) ||
    selected ||
    tasks.find(
      (task) =>
        task.kind === 'video' &&
        task.metadata?.shotId === shotId &&
        task.status === 'completed' &&
        (!needsLastFrame || hasLastFrame(task)),
    ) ||
    null
  )
}

export function hasLastFrame(task) {
  return task?.outputs?.some((output) => output.view === 'last-frame') ?? false
}
