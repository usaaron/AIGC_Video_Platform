import type { GenerationTask } from '@seqora/contracts'
import type { AppState, AppStore } from '../../infra/store.js'
import { releaseGenerationTaskLease } from './taskLease.js'
import { markTextTaskTerminalPending } from './textTaskTerminalEffects.js'

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

export function recoverScriptTaskFromDraft(
  task: GenerationTask,
  state: AppState,
  store: AppStore,
  nowIso: string,
  requireWritebackMarker = false,
): boolean {
  if (!(
    task.kind === 'text' &&
    task.provider === 'text' &&
    String(task.metadata.generationStage || '').startsWith('script-') &&
    (task.metadata.scriptOperation === 'generate' || task.metadata.scriptOperation === 'enrich')
  ))
    return false
  const startedAt = Date.parse(stringValue(task.metadata.localTaskStartedAt, ''))
  const requestedEpisodeId = task.metadata.mode === 'segment' ? '' : stringValue(task.metadata.episodeId, '')
  const draft = state.scriptEpisodes
    .filter(
      (episode) =>
        episode.projectId === task.projectId &&
        episode.tenantId === task.tenantId &&
        episode.status === 'draft' &&
        episode.draftContent.trim().length > 0 &&
        (!requestedEpisodeId || episode.id === requestedEpisodeId) &&
        (!Number.isFinite(startedAt) || Date.parse(episode.updatedAt) >= startedAt),
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  const episode = draft[0]
  if (!episode) return false

  const generationClientRequestId = stringValue(episode.continuityState?.generationClientRequestId, '')
  const hasWritebackMarker = generationClientRequestId === task.clientRequestId
  if (requireWritebackMarker && !hasWritebackMarker) return false
  const hasLegacyPreview = Boolean(stringValue(task.metadata.textPreview, '').trim())
  const episodeUpdatedAt = Date.parse(episode.updatedAt)
  const episodeCreatedAt = Date.parse(episode.createdAt)
  const hasLegacyWritebackEvidence =
    hasLegacyPreview ||
    (Number.isFinite(startedAt) &&
      ((requestedEpisodeId && episode.id === requestedEpisodeId) ||
        (Number.isFinite(episodeCreatedAt) && episodeCreatedAt >= startedAt)) &&
      episodeUpdatedAt >= startedAt)
  if (!hasWritebackMarker && !hasLegacyWritebackEvidence) return false

  const {
    textCompletionReceipt: _textCompletionReceipt,
    textPreview: _textPreview,
    textPreviewUpdatedAt: _textPreviewUpdatedAt,
    textFirstPreviewAt: _textFirstPreviewAt,
    textPreviewValidation: _textPreviewValidation,
    textPreviewStage: _textPreviewStage,
    ...metadata
  } = task.metadata
  const script = episode.draftContent.trim()
  task.status = 'completed'
  task.progress = 100
  task.error = null
  task.metadata = {
    ...metadata,
    localTaskRecoveredAt: nowIso,
    scriptWritebackRecoveredAt: nowIso,
    textResult: {
      script,
      episode,
      ...(task.metadata.mode === 'segment' ? { segment: script } : {}),
      mode: task.metadata.mode === 'segment' ? 'segment' : 'quick',
    },
  }
  task.updatedAt = nowIso
  releaseGenerationTaskLease(task)
  markTextTaskTerminalPending(store, task)
  return true
}
