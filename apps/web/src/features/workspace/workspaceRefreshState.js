const ACTIVE_TASK_STATUSES = new Set(['queued', 'paused', 'running'])
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export function taskSnapshotKey(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map(taskSnapshot).join('|')
}

export function workspaceSnapshotKey(workspace) {
  if (!workspace) return ''
  return [
    recordSnapshot(workspace.project, ['id', 'updatedAt', 'version', 'contentType', 'script', 'synopsis']),
    collectionSnapshot(workspace.scriptEpisodes, [
      'id',
      'episodeNumber',
      'status',
      'revision',
      'updatedAt',
      'content',
      'draftContent',
      'continuityState',
    ]),
    collectionSnapshot(workspace.assets, [
      'id',
      'kind',
      'updatedAt',
      'name',
      'imageUrl',
      'prompt',
      'sourceMode',
      'attributes',
    ]),
    collectionSnapshot(workspace.shots, [
      'id',
      'order',
      'updatedAt',
      'title',
      'prompt',
      'imageUrl',
      'duration',
      'selectedImageTaskId',
      'selectedVideoTaskId',
      'continuityMode',
      'scriptEpisodeId',
      'episodeNumber',
    ]),
  ].join('||')
}

export function workspaceVersionKey(workspace) {
  if (!workspace?.project) return ''
  return [
    workspace.project.version,
    workspace.project.updatedAt,
    collectionVersion(workspace.scriptEpisodes),
    collectionVersion(workspace.assets),
    collectionVersion(workspace.shots),
  ].join(':')
}

export function hasTaskTerminalTransition(previousStatuses, nextTasks) {
  if (!(previousStatuses instanceof Map)) return false
  return (Array.isArray(nextTasks) ? nextTasks : []).some(
    (task) =>
      TERMINAL_TASK_STATUSES.has(task?.status) && ACTIVE_TASK_STATUSES.has(previousStatuses.get(task?.id)),
  )
}

export function taskStatusMap(tasks) {
  return new Map(
    (Array.isArray(tasks) ? tasks : []).filter((task) => task?.id).map((task) => [task.id, task.status]),
  )
}

export function mergeTaskPolling(previousTasks, pollingTasks) {
  const previousById = new Map(
    (Array.isArray(previousTasks) ? previousTasks : [])
      .filter((task) => task?.id)
      .map((task) => [task.id, task]),
  )
  return (Array.isArray(pollingTasks) ? pollingTasks : []).map((summary) => {
    const previous = previousById.get(summary?.id)
    if (!previous) return summary
    return {
      ...previous,
      ...summary,
      metadata: { ...previous.metadata, ...summary.metadata },
      outputs: summary.outputs ?? previous.outputs,
    }
  })
}

function taskSnapshot(task) {
  const metadata = task?.metadata || {}
  return [
    task?.id,
    task?.kind,
    task?.status,
    task?.progress,
    task?.updatedAt,
    task?.resultUrl,
    task?.error,
    metadata.textPreviewStage,
    metadata.textPreviewValidation,
    metadata.queueHiddenAt,
    task?.outputs?.map((output) => [output?.url, output?.view, output?.mediaType]),
  ]
    .map(snapshotValue)
    .join(':')
}

function collectionSnapshot(items, fields) {
  return (Array.isArray(items) ? items : []).map((item) => recordSnapshot(item, fields)).join('|')
}

function recordSnapshot(record, fields) {
  if (!record) return ''
  return fields.map((field) => `${field}=${snapshotValue(record[field])}`).join(';')
}

function collectionVersion(items) {
  const values = Array.isArray(items) ? items : []
  const latest = values.reduce(
    (current, item) => (item?.updatedAt > current ? item.updatedAt : current),
    '1970-01-01T00:00:00.000Z',
  )
  return `${values.length}:${latest}`
}

function snapshotValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return `s${value.length}:${hashString(value)}`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `a${value.length}[${value.map(snapshotValue).join(',')}]`
  if (typeof value === 'object') {
    return `o{${Object.keys(value)
      .sort()
      .map((key) => `${key}=${snapshotValue(value[key])}`)
      .join(',')}}`
  }
  return `${typeof value}:${String(value)}`
}

function hashString(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}
