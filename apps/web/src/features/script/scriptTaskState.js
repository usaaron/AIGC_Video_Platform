export function formatEpisodeDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  if (value >= 60) {
    const minutes = Math.floor(value / 60)
    const remainder = value % 60
    return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`
  }
  return `${value} 秒`
}

export function isQueuedTextTask(result) {
  return Boolean(result?.kind === 'text' && ['queued', 'running', 'paused'].includes(result.status))
}

export function isAssetSuggestionResult(value) {
  return Boolean(
    value && typeof value === 'object' && typeof value.summary === 'string' && Array.isArray(value.assets),
  )
}

export function taskTimestamp(task) {
  const value = Date.parse(task?.updatedAt || task?.createdAt || '')
  return Number.isFinite(value) ? value : 0
}

export function scriptTaskStatusPriority(status) {
  if (status === 'running') return 3
  if (status === 'queued') return 2
  if (status === 'paused') return 1
  return 0
}

export function scriptResultText(task) {
  const result = task?.metadata?.textResult
  if (typeof result === 'string') return result.trim()
  if (!result || typeof result !== 'object') return ''
  if (typeof result.script === 'string') return result.script.trim()
  if (typeof result.segment === 'string') return result.segment.trim()
  return ''
}

export function commonPrefix(left, right) {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return left.slice(0, index)
}

export function scriptSuggestionFingerprint(value) {
  let hash = 2166136261
  for (const character of value.trim()) {
    hash ^= character.codePointAt(0) || 0
    hash = Math.imul(hash, 16777619)
  }
  return `${value.trim().length}:${(hash >>> 0).toString(16)}`
}

export function assetSuggestionRevision(assets) {
  const revision = (Array.isArray(assets) ? assets : [])
    .map((asset) => `${asset.id}:${asset.updatedAt}`)
    .sort()
    .join('|')
  return revision || 'none'
}

export function scriptTaskOperation(task) {
  if (task?.metadata?.mode === 'segment') return 'segment'
  if (task?.metadata?.scriptOperation === 'enrich') return 'revise'
  if (task?.metadata?.scriptOperation === 'generate' && String(task.metadata?.revisionNote || '').trim()) {
    return 'revise'
  }
  return 'generate'
}

export function scriptTaskStage(task) {
  if (!task) return ''
  if (task?.metadata?.textPreviewStage) return textPreviewStageLabel(task.metadata.textPreviewStage)
  const elapsedSeconds = Math.max(0, (Date.now() - Date.parse(task.updatedAt || task.createdAt)) / 1_000)
  if (elapsedSeconds < 4) return '整理项目与资产上下文'
  if (elapsedSeconds < 10) return '调用编剧模型'
  return '撰写并校验剧本结构'
}

export function textPreviewStageLabel(stage) {
  if (stage === 'scene-completion') return '保留首轮内容，正在补齐缺少场次'
  if (stage === 'structure-repair') return '正在修复场次结构'
  if (stage === 'language-repair') return '正在统一中文与格式'
  return '正在边生成边校验'
}

export function deriveScriptTaskState({
  tasks,
  projectId,
  orderedEpisodes,
  assetSuggestionFingerprint,
  currentAssetRevision,
}) {
  const projectTasks = tasks.filter((task) => task.projectId === projectId)
  const scriptTasks = projectTasks
    .filter(
      (task) =>
        task.kind === 'text' &&
        String(task.metadata?.generationStage || '').startsWith('script-') &&
        task.metadata?.scriptOperation !== 'suggest-assets',
    )
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left))
  const latestScriptTask = scriptTasks[0]
  const latestFailedScriptTask = latestScriptTask?.status === 'failed' ? latestScriptTask : null
  const latestCompletedScriptTask = latestScriptTask?.status === 'completed' ? latestScriptTask : null
  const completedScriptText = scriptResultText(latestCompletedScriptTask)
  const completedScriptEpisodeId =
    latestCompletedScriptTask?.metadata?.episodeId ||
    latestCompletedScriptTask?.metadata?.textResult?.episode?.id ||
    ''
  const latestAssetSuggestionTask = [...projectTasks]
    .filter(
      (task) =>
        task.kind === 'text' &&
        task.metadata?.scriptOperation === 'suggest-assets' &&
        task.metadata?.sourceScriptFingerprint === assetSuggestionFingerprint &&
        (task.metadata?.assetRevision === currentAssetRevision ||
          (currentAssetRevision === 'none' && !task.metadata?.assetRevision)),
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
  const activeAssetSuggestionTask = ['queued', 'paused', 'running'].includes(
    latestAssetSuggestionTask?.status,
  )
    ? latestAssetSuggestionTask
    : null
  const activeScriptTasks = projectTasks
    .filter(
      (task) =>
        task.kind === 'text' &&
        String(task.metadata?.generationStage || '').startsWith('script-') &&
        task.metadata?.scriptOperation !== 'suggest-assets' &&
        ['queued', 'paused', 'running'].includes(task.status),
    )
    .sort(
      (left, right) =>
        scriptTaskStatusPriority(right.status) - scriptTaskStatusPriority(left.status) ||
        taskTimestamp(right) - taskTimestamp(left),
    )
  const activeScriptTaskCandidate = activeScriptTasks[0]
  const activeTaskEpisodeId =
    activeScriptTaskCandidate?.metadata?.mode === 'segment'
      ? ''
      : String(activeScriptTaskCandidate?.metadata?.episodeId || '')
  const activeTaskStartedAt = Date.parse(
    String(
      activeScriptTaskCandidate?.metadata?.localTaskStartedAt || activeScriptTaskCandidate?.createdAt || '',
    ),
  )
  const activeTaskEpisodeById = activeTaskEpisodeId
    ? orderedEpisodes.find((episode) => episode.id === activeTaskEpisodeId)
    : null
  const activeTaskEpisodeByMarker = activeScriptTaskCandidate
    ? orderedEpisodes.find(
        (episode) =>
          episode.continuityState?.generationClientRequestId === activeScriptTaskCandidate.clientRequestId,
      )
    : null
  const activeTaskLegacyEpisode =
    activeScriptTaskCandidate && !activeTaskEpisodeId
      ? [...orderedEpisodes]
          .filter(
            (episode) =>
              episode.status === 'draft' &&
              Boolean((episode.draftContent || '').trim()) &&
              (!Number.isFinite(activeTaskStartedAt) || Date.parse(episode.updatedAt) >= activeTaskStartedAt),
          )
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]
      : null
  const activeTaskEpisode =
    activeTaskEpisodeByMarker || activeTaskEpisodeById || activeTaskLegacyEpisode || null
  const activeTaskDraftText = String(activeTaskEpisode?.draftContent || '').trim()
  const activeTaskWritebackMarker = String(
    activeTaskEpisode?.continuityState?.generationClientRequestId || '',
  )
  const activeTaskHasWriteback = Boolean(
    activeScriptTaskCandidate &&
    activeTaskDraftText &&
    (activeTaskWritebackMarker === activeScriptTaskCandidate.clientRequestId ||
      (!activeTaskWritebackMarker &&
        (!Number.isFinite(activeTaskStartedAt) ||
          Date.parse(activeTaskEpisode?.updatedAt || '') >= activeTaskStartedAt))),
  )
  const activeScriptTask = activeTaskHasWriteback ? null : activeScriptTaskCandidate
  const activeGenerateTask = activeScriptTask
    ? activeScriptTasks.find((task) => scriptTaskOperation(task) === 'generate')
    : null
  const activeRevisionTask = activeScriptTask
    ? activeScriptTasks.find((task) => scriptTaskOperation(task) === 'revise')
    : null
  const activeSegmentTask = activeScriptTask
    ? activeScriptTasks.find((task) => scriptTaskOperation(task) === 'segment')
    : null
  const latestScriptTimingTask = [...projectTasks]
    .filter(
      (task) =>
        task.kind === 'text' &&
        task.metadata?.scriptOperation !== 'suggest-assets' &&
        task.metadata?.textTiming &&
        typeof task.metadata.textTiming === 'object',
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]

  return {
    latestFailedScriptTask,
    completedScriptText,
    completedScriptEpisodeId,
    latestAssetSuggestionTask,
    activeAssetSuggestionTask,
    activeTaskEpisode,
    activeTaskDraftText,
    activeTaskHasWriteback,
    activeScriptTask,
    activeGenerateTask,
    activeRevisionTask,
    activeSegmentTask,
    activeTextPreview: String(activeScriptTask?.metadata?.textPreview || ''),
    activePreviewSessionKey: activeScriptTask ? `${projectId}:${activeScriptTask.id}` : `${projectId}:idle`,
    activePreviewStage: String(activeScriptTask?.metadata?.textPreviewStage || 'first-draft'),
    activePreviewValidation: activeScriptTask?.metadata?.textPreviewValidation || null,
    latestTextTiming: latestScriptTimingTask?.metadata?.textTiming || null,
  }
}
