export const FILM_PREVIEW_STAGE = 'film-preview'
export const FILM_PREVIEW_MODE_FULL = 'full'
export const FILM_PREVIEW_MODE_PARTIAL = 'partial'

export function completedShotVideoTask(tasks, shotOrId) {
  const shotId = typeof shotOrId === 'string' ? shotOrId : shotOrId.id
  const selectedVideoTaskId = typeof shotOrId === 'string' ? null : shotOrId.selectedVideoTaskId
  const completed = tasks.filter(
    (task) =>
      task.kind === 'video' &&
      task.provider === 'seedance' &&
      task.status === 'completed' &&
      task.metadata?.shotId === shotId,
  )
  return completed.find((task) => task.id === selectedVideoTaskId) || completed[0]
}

export function sourceVideoTaskIds(tasks, shots) {
  const sourceTaskIds = contiguousSourceVideoTaskIds(tasks, shots)
  return sourceTaskIds.length === shots.length ? sourceTaskIds : []
}

export function contiguousSourceVideoTaskIds(tasks, shots) {
  const sourceTaskIds = []
  for (const shot of shots) {
    const task = completedShotVideoTask(tasks, shot)
    if (!task) break
    sourceTaskIds.push(task.id)
  }
  return sourceTaskIds
}

export function filmPreviewTaskFor(tasks, sourceTaskIds, mode = FILM_PREVIEW_MODE_FULL) {
  const previewTasks = tasks.filter(
    (task) => task.metadata?.generationStage === FILM_PREVIEW_STAGE && previewModeFor(task) === mode,
  )
  return (
    previewTasks.find((task) => sameIds(task.metadata?.sourceVideoTaskIds, sourceTaskIds)) ||
    previewTasks[0] ||
    null
  )
}

export function latestCompletedFilmPreviewTask(tasks, mode = FILM_PREVIEW_MODE_FULL) {
  return (
    tasks
      .filter(
        (task) =>
          task.metadata?.generationStage === FILM_PREVIEW_STAGE &&
          previewModeFor(task) === mode &&
          task.status === 'completed',
      )
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0] ||
    null
  )
}

export function isCurrentFilmPreview(task, sourceTaskIds, mode = FILM_PREVIEW_MODE_FULL) {
  return Boolean(
    task &&
    sourceTaskIds.length &&
    previewModeFor(task) === mode &&
    sameIds(task.metadata?.sourceVideoTaskIds, sourceTaskIds),
  )
}

function previewModeFor(task) {
  return task.metadata?.previewMode === FILM_PREVIEW_MODE_PARTIAL
    ? FILM_PREVIEW_MODE_PARTIAL
    : FILM_PREVIEW_MODE_FULL
}

function sameIds(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  )
}
