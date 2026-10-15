import type { GenerationTask } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import { isStandaloneProjectId } from '../../modules/projects/projectSurface.js'
import {
  generationTaskLeaseMatches,
  releaseGenerationTaskLease,
  renewGenerationTaskLease,
} from './taskLease.js'
import {
  type LocalTaskDiagnostics,
  progressiveTextValidation,
  recordGenerationTaskTerminal,
  summarizeTextTiming,
} from './taskDiagnostics.js'
import { assertTextTaskWriteGuard, type TextTaskWriteGuard } from './textTaskExecutionGuard.js'
import { registerTextTaskPersistenceContext } from './textTaskPersistenceContext.js'
import { markTextTaskTerminalPending } from './textTaskTerminalEffects.js'
import { buildTextCompletionReceipt } from './textCompletion.js'

function writable(
  task: GenerationTask | undefined,
  owner: string,
  token: string,
  guard?: TextTaskWriteGuard,
): task is GenerationTask {
  if (
    !task ||
    isStandaloneProjectId(task.projectId) ||
    task.status !== 'running' ||
    !generationTaskLeaseMatches(task, owner, token)
  )
    return false
  if (guard) {
    try {
      assertTextTaskWriteGuard(task, guard)
    } catch {
      return false
    }
  }
  return true
}

export async function completeLocalTask(
  store: AppStore,
  owner: string,
  taskId: string,
  token: string,
  result: unknown,
  diagnostics?: LocalTaskDiagnostics,
  guard?: TextTaskWriteGuard,
): Promise<GenerationTask | null> {
  return store.mutateGenerationTaskRuntimeCacheAsync((state) => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!writable(task, owner, token, guard)) return null
    const nowMs = Date.now()
    const now = new Date(nowMs).toISOString()
    const receipt = guard ? buildTextCompletionReceipt(task, result, guard, now) : null
    const {
      textPreview: _preview,
      textPreviewUpdatedAt: _updated,
      textFirstPreviewAt: _first,
      textPreviewValidation: _validation,
      textPreviewStage: _stage,
      textCompletionReceipt: _oldReceipt,
      ...metadata
    } = task.metadata
    task.status = 'completed'
    task.progress = 100
    task.error = null
    task.metadata = {
      ...metadata,
      localTaskCompletedAt: now,
      ...(diagnostics ? { textTiming: summarizeTextTiming(task, diagnostics, nowMs) } : {}),
      ...(task.kind === 'text' ? { textResult: structuredClone(result) } : {}),
      ...(receipt ? { textCompletionReceipt: receipt } : {}),
    }
    task.updatedAt = now
    releaseGenerationTaskLease(task)
    if (guard) {
      registerTextTaskPersistenceContext(task, guard)
      markTextTaskTerminalPending(store, task)
    } else recordGenerationTaskTerminal(task)
    return structuredClone(task)
  })
}

export async function failLocalTextTask(
  store: AppStore,
  guard: TextTaskWriteGuard,
  error: string,
  diagnostics: LocalTaskDiagnostics,
): Promise<GenerationTask | null> {
  return store.mutateGenerationTaskRuntimeCacheAsync((state) => {
    const task = state.tasks.find((item) => item.id === guard.taskId)
    if (!writable(task, guard.leaseOwnerId, guard.leaseToken, guard)) return null
    task.status = 'failed'
    task.progress = 100
    task.error = error.slice(0, 1_000)
    delete task.metadata.providerCompletionReceipt
    delete task.metadata.textCompletionReceipt
    task.metadata = { ...task.metadata, textTiming: summarizeTextTiming(task, diagnostics, Date.now()) }
    task.updatedAt = new Date().toISOString()
    releaseGenerationTaskLease(task)
    registerTextTaskPersistenceContext(task, guard)
    markTextTaskTerminalPending(store, task)
    return structuredClone(task)
  })
}

export async function updateLocalTextPreview(
  store: AppStore,
  owner: string,
  taskId: string,
  token: string,
  preview: string,
  stage = 'first-draft',
  guard?: TextTaskWriteGuard,
): Promise<void> {
  await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!writable(task, owner, token, guard) || task.kind !== 'text') return
    const now = new Date().toISOString()
    const boundedPreview = preview.slice(0, 24_000)
    task.progress = Math.max(task.progress, Math.min(88, 12 + Math.floor(boundedPreview.length / 40)))
    task.metadata = {
      ...task.metadata,
      textPreview: boundedPreview,
      textPreviewStage: stage,
      textPreviewUpdatedAt: now,
      textPreviewValidation: progressiveTextValidation(boundedPreview),
      textFirstPreviewAt:
        typeof task.metadata.textFirstPreviewAt === 'string' ? task.metadata.textFirstPreviewAt : now,
    }
    task.updatedAt = now
    if (guard) registerTextTaskPersistenceContext(task, guard)
  })
}

export async function renewLocalTaskLease(
  store: AppStore,
  owner: string,
  ttlMs: number,
  taskId: string,
  token: string,
  guard?: TextTaskWriteGuard,
): Promise<void> {
  await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!writable(task, owner, token, guard)) return
    const now = new Date()
    renewGenerationTaskLease(task, owner, token, ttlMs, now)
    task.updatedAt = now.toISOString()
    if (guard) registerTextTaskPersistenceContext(task, guard)
  })
}
