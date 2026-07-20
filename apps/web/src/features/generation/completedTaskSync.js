export function hasNewCompletedAssetTasks(tasks, syncedKeys) {
  let hasNewCompletedTask = false
  tasks.forEach((task) => {
    if (
      (task.kind !== 'image' && task.kind !== 'audio') ||
      task.status !== 'completed' ||
      !task.metadata?.assetId ||
      !task.outputs?.length
    ) {
      return
    }
    const key = `${task.id}:${task.updatedAt}`
    if (syncedKeys.has(key)) return
    syncedKeys.add(key)
    hasNewCompletedTask = true
  })
  return hasNewCompletedTask
}
