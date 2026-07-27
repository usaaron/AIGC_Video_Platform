export function planVideoBatch(shots, mode = 'parallel', concurrency = 3) {
  const orderedShots = [...shots].sort((left, right) => left.order - right.order)
  if (!orderedShots.length) {
    return { lanes: [], immediateLaneCount: 0, continuityUpdates: [] }
  }

  const limit = Math.max(1, Math.min(orderedShots.length, Math.floor(concurrency) || 1))
  if (mode === 'continuity') {
    const continuityUpdates = []
    const lane = orderedShots.map((shot, index) => {
      const continuityMode = index === 0 ? 'independent' : 'continue'
      if (continuityMode !== shot.continuityMode) {
        continuityUpdates.push({ shotId: shot.id, continuityMode })
      }
      return { ...shot, continuityMode }
    })
    return { lanes: [lane], immediateLaneCount: 1, continuityUpdates }
  }

  if (mode === 'independent') {
    const continuityUpdates = []
    const lanes = orderedShots.map((shot) => {
      if (shot.continuityMode !== 'independent') {
        continuityUpdates.push({ shotId: shot.id, continuityMode: 'independent' })
      }
      return [{ ...shot, continuityMode: 'independent' }]
    })
    return {
      lanes,
      immediateLaneCount: Math.min(limit, lanes.length),
      continuityUpdates,
    }
  }

  const lanes = continuitySegments(orderedShots)

  return {
    lanes,
    immediateLaneCount: Math.min(limit, lanes.length),
    continuityUpdates: [],
  }
}

export function activeVideoTasksForShots(tasks, shots) {
  const shotIds = new Set(shots.map((shot) => shot.id))
  return tasks.filter(
    (task) =>
      task.kind === 'video' &&
      shotIds.has(task.metadata?.shotId) &&
      ['queued', 'paused', 'running'].includes(task.status) &&
      typeof task.metadata?.queueHiddenAt !== 'string',
  )
}

export function isCompatibleCompletedVideoTask(
  task,
  { shotId, referenceAssetIds = [], resolution, continuityMode = 'independent', previousTaskId = null },
) {
  if (
    task?.kind !== 'video' ||
    task.status !== 'completed' ||
    task.metadata?.shotId !== shotId ||
    task.metadata?.resolution !== resolution
  ) {
    return false
  }

  const actualReferences = task.metadata?.referenceAssetIds
  if (
    !Array.isArray(actualReferences) ||
    actualReferences.length !== referenceAssetIds.length ||
    actualReferences.some((id, index) => id !== referenceAssetIds[index])
  ) {
    return false
  }

  const actualContinuityMode = task.metadata?.continuityMode || 'independent'
  if (actualContinuityMode !== continuityMode) return false
  if (continuityMode === 'continue') {
    return task.metadata?.continuitySourceTaskId === previousTaskId
  }
  return typeof task.metadata?.continuitySourceTaskId !== 'string'
}

function continuitySegments(shots) {
  const segments = []
  for (const shot of shots) {
    if (!segments.length || shot.continuityMode !== 'continue') segments.push([])
    segments.at(-1).push(shot)
  }
  return segments
}
