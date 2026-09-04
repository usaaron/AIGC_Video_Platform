export function planVideoBatch(shots, mode = 'parallel', concurrency = 3) {
  const orderedShots = [...shots].sort((left, right) => left.order - right.order)
  if (!orderedShots.length) {
    return { lanes: [], immediateLaneCount: 0, continuityUpdates: [] }
  }

  const limit = Math.max(1, Math.min(orderedShots.length, Math.floor(concurrency) || 1))
  if (mode === 'continuity') {
    const continuityUpdates = []
    const plannedShots = orderedShots.map((shot, index) => {
      const continuityMode = startsEpisode(shot, orderedShots[index - 1]) ? 'independent' : 'continue'
      if (continuityMode !== shot.continuityMode) {
        continuityUpdates.push({ shotId: shot.id, continuityMode })
      }
      return { ...shot, continuityMode }
    })
    const lanes = continuitySegments(plannedShots)
    return { lanes, immediateLaneCount: Math.min(limit, lanes.length), continuityUpdates }
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

  const continuityUpdates = []
  const plannedShots = orderedShots.map((shot, index) => {
    if (!startsEpisode(shot, orderedShots[index - 1]) || shot.continuityMode === 'independent') return shot
    continuityUpdates.push({ shotId: shot.id, continuityMode: 'independent' })
    return { ...shot, continuityMode: 'independent' }
  })
  const lanes = continuitySegments(plannedShots)

  return {
    lanes,
    immediateLaneCount: Math.min(limit, lanes.length),
    continuityUpdates,
  }
}

export function planSelectedVideoRegeneration(
  allShots,
  selectedShotIds,
  mode = 'continuity',
  concurrency = 3,
) {
  const selectedIds = selectedShotIds instanceof Set ? selectedShotIds : new Set(selectedShotIds)
  const orderedShots = [...allShots].sort((left, right) => left.order - right.order)
  const shotIndexes = new Map(orderedShots.map((shot, index) => [shot.id, index]))
  const selectedShots = orderedShots.filter((shot) => selectedIds.has(shot.id))
  if (!selectedShots.length) {
    return { lanes: [], immediateLaneCount: 0, continuityUpdates: [] }
  }

  const limit = Math.max(1, Math.min(selectedShots.length, Math.floor(concurrency) || 1))
  if (mode === 'independent') {
    return {
      lanes: selectedShots.map((shot) => [{ ...shot, continuityMode: 'independent' }]),
      immediateLaneCount: Math.min(limit, selectedShots.length),
      continuityUpdates: [],
    }
  }

  const lanes = []
  let previousSelectedShot = null
  let previousSelectedIndex = -2
  for (const shot of selectedShots) {
    const fullIndex = shotIndexes.get(shot.id)
    const followsSelectedShot = fullIndex === previousSelectedIndex + 1
    const continuesSelectedShot =
      followsSelectedShot && shot.continuityMode === 'continue' && !startsEpisode(shot, previousSelectedShot)
    if (!continuesSelectedShot) lanes.push([])
    lanes.at(-1).push(shot)
    previousSelectedShot = shot
    previousSelectedIndex = fullIndex
  }

  return {
    lanes,
    immediateLaneCount: Math.min(limit, lanes.length),
    continuityUpdates: [],
  }
}

export function unselectedContinuityDependents(allShots, selectedShotIds) {
  const selectedIds = selectedShotIds instanceof Set ? selectedShotIds : new Set(selectedShotIds)
  const orderedShots = [...allShots].sort((left, right) => left.order - right.order)
  const affected = []
  let followsRegeneratedVersion = false

  for (const [index, shot] of orderedShots.entries()) {
    const previousShot = orderedShots[index - 1]
    if (selectedIds.has(shot.id)) {
      followsRegeneratedVersion = true
      continue
    }
    if (startsEpisode(shot, previousShot) || shot.continuityMode !== 'continue') {
      followsRegeneratedVersion = false
      continue
    }
    if (followsRegeneratedVersion) affected.push(shot)
  }

  return affected
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
  {
    shotId,
    referenceAssetIds = [],
    resolution,
    continuityMode = 'independent',
    previousTaskId = null,
    sourcePromptSnapshot,
  },
) {
  if (
    task?.kind !== 'video' ||
    task.status !== 'completed' ||
    task.metadata?.shotId !== shotId ||
    task.metadata?.resolution !== resolution
  ) {
    return false
  }
  if (
    typeof sourcePromptSnapshot === 'string' &&
    task.metadata?.sourcePromptSnapshot !== sourcePromptSnapshot
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

function startsEpisode(shot, previousShot) {
  if (!previousShot) return true
  if (shot?.episodeBreakBefore) return true
  return (
    Number.isInteger(shot?.episodeNumber) &&
    Number.isInteger(previousShot?.episodeNumber) &&
    shot.episodeNumber !== previousShot.episodeNumber
  )
}
