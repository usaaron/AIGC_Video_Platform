import type { GenerationTask } from '@seqora/contracts'
import type { TextGenerationTiming } from '../generation/textProvider.js'
import { observabilityMetrics } from '../observability/metrics.js'
import { traceIdFromGenerationTask } from '../observability/trace.js'
import { usageCollector } from '../observability/usage.js'

export type LocalTaskDiagnostics = {
  executionStartedAtMs: number
  firstPreviewAtMs: number | null
  textTimings: TextGenerationTiming[]
}

export function recordGenerationTaskQueueWait(task: GenerationTask, now = Date.now()): void {
  observabilityMetrics.recordTaskQueueWait({
    kind: taskMetricKind(task),
    tenantId: task.tenantId,
    taskId: task.id,
    waitMs: durationSince(task.createdAt, now),
  })
}

export function recordGenerationTaskTerminal(task: GenerationTask, error?: unknown): void {
  observabilityMetrics.recordTaskTerminal({
    kind: taskMetricKind(task),
    tenantId: task.tenantId,
    taskId: task.id,
    status: task.status,
  })
  observabilityMetrics.recordTaskExecution({
    kind: taskMetricKind(task),
    tenantId: task.tenantId,
    taskId: task.id,
    durationMs: durationSince(task.createdAt),
    ok: task.status === 'completed',
    error,
  })
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    usageCollector.recordJobTerminal({
      jobId: task.id,
      source: 'generation_task',
      kind: task.kind,
      status: task.status,
      creditsUsed: task.status === 'completed' ? task.estimatedCredits : 0,
      tenantId: task.tenantId,
      organizationId: task.tenantId,
      userId: task.userId,
      traceId: traceIdFromGenerationTask(task),
    })
  }
}

function taskMetricKind(task: GenerationTask): string {
  return `${task.kind}:${task.provider}`
}

export function progressiveTextValidation(preview: string): Record<string, number> {
  const scenes = preview
    .split(/(?=场次\s*[:：])/u)
    .map((scene) => scene.trim())
    .filter((scene) => /^场次\s*[:：]/u.test(scene))
  const closedScenes = scenes.slice(0, -1)
  const structurallyCompleteScenes = closedScenes.filter((scene) =>
    ['剧情', '场景', '角色', '动作'].every((field) => new RegExp(`${field}\\s*[:：]`, 'u').test(scene)),
  )
  const dialogueScenes = closedScenes.filter((scene) => /(?:对白|画外音|内心独白)\s*[:：]/u.test(scene))
  return {
    recognizedScenes: scenes.length,
    checkedScenes: closedScenes.length,
    structurallyCompleteScenes: structurallyCompleteScenes.length,
    dialogueScenes: dialogueScenes.length,
  }
}

export function summarizeTextTiming(
  task: GenerationTask,
  diagnostics: LocalTaskDiagnostics,
  completedAtMs: number,
): Record<string, unknown> {
  const calls = diagnostics.textTimings.map((timing, index) => ({
    label: timing.label || `call-${index + 1}`,
    outcome: timing.outcome || 'completed',
    responseHeadersMs: timing.responseHeadersMs,
    firstTokenMs: timing.firstTokenMs,
    firstTokenWaitMs:
      timing.firstTokenMs === null || timing.responseHeadersMs === null
        ? null
        : Math.max(0, timing.firstTokenMs - timing.responseHeadersMs),
    generationMs: timing.generationMs,
    totalMs: timing.totalMs,
    attempt: timing.attempt,
  }))
  const providerMs = calls.reduce((total, call) => total + call.totalMs, 0)
  const executionMs = Math.max(0, completedAtMs - diagnostics.executionStartedAtMs)
  const createdAtMs = Date.parse(task.createdAt)
  const queueWaitMs = Number.isFinite(createdAtMs)
    ? Math.max(0, diagnostics.executionStartedAtMs - createdAtMs)
    : 0
  const primary = calls[0] ?? null
  return {
    queueWaitMs,
    responseHeadersMs: primary?.responseHeadersMs ?? null,
    firstTokenWaitMs: primary?.firstTokenWaitMs ?? null,
    firstTokenMs: primary?.firstTokenMs ?? null,
    generationMs: primary?.generationMs ?? null,
    providerMs,
    appProcessingMs: Math.max(0, executionMs - providerMs),
    executionMs,
    totalMs: Number.isFinite(createdAtMs) ? Math.max(0, completedAtMs - createdAtMs) : executionMs,
    firstVisibleMs:
      diagnostics.firstPreviewAtMs === null
        ? null
        : Math.max(0, diagnostics.firstPreviewAtMs - diagnostics.executionStartedAtMs),
    extraModelCalls: Math.max(0, calls.length - 1),
    calls,
  }
}

export function durationSince(startIso: string, now = Date.now()): number {
  const startedAt = Date.parse(startIso)
  return Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0
}
