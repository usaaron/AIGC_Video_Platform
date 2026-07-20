export function resultUrlForTask(task) {
  const videoOutput = task.outputs?.find((output) => output.mediaType === 'video')
  const firstOutput = task.outputs?.[0]
  return task.resultUrl || videoOutput?.url || firstOutput?.url || ''
}

export function isPlayableVideoUrl(url) {
  return (
    /^\/api\/v1\/generation\/tasks\/[^/]+\/content$/.test(url) ||
    /^\/api\/v1\/media\/[^/?#]+/.test(url) ||
    /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)
  )
}

export function downloadNameForTask(task) {
  const safeLabel = task.label.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'video-result'
  const mediaType = task.outputs?.[0]?.mediaType ?? task.kind
  const extension = mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : 'jpg'
  return `${safeLabel}.${extension}`
}

export function isFilmExportTask(task) {
  return task.kind === 'video' && task.provider === 'film-export'
}

export function latestFilmExportTask(tasks) {
  return tasks.find(isFilmExportTask) || null
}

export function completedFilmExportTask(tasks) {
  return (
    tasks.find((task) => isFilmExportTask(task) && task.status === 'completed' && resultUrlForTask(task)) ||
    null
  )
}

export function latestVideoTaskForShot(tasks, shotId) {
  return tasks.find((task) => isShotVideoTask(task, shotId)) || null
}

export function completedVideoTaskForShot(tasks, shotId) {
  return (
    tasks.find(
      (task) => isShotVideoTask(task, shotId) && task.status === 'completed' && resultUrlForTask(task),
    ) || null
  )
}

export function hasCompletedVideoForShot(tasks, shotId) {
  const task = completedVideoTaskForShot(tasks, shotId)
  return Boolean(task && isPlayableVideoUrl(resultUrlForTask(task)))
}

function isShotVideoTask(task, shotId) {
  return task.kind === 'video' && task.metadata?.shotId === shotId
}
