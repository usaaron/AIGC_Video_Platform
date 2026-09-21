import type { GenerationTask } from '@seqora/contracts'
import type { VideoGenerationStatus } from '../generation/videoProvider.js'

export const VIDEO_WAIT_TIMEOUT =
  '上游视频生成超过等待时限，平台已停止等待并退回积分；原任务编号已保留，未自动重新提交。'

export function isDoraRemoteTask(task: GenerationTask): boolean {
  return (
    task.kind === 'video' &&
    task.metadata.providerName === 'dora-router-seedance' &&
    typeof task.metadata.providerTaskId === 'string' &&
    task.metadata.providerTaskId.length > 0
  )
}

export function pollRetryDue(task: GenerationTask, now: number): boolean {
  const retryAt = Date.parse(stringValue(task.metadata.providerPollRetryNotBefore, ''))
  return !Number.isFinite(retryAt) || retryAt <= now
}

export function pollFailureMetadata(attempts: number, now = Date.now()): GenerationTask['metadata'] {
  const delayMs = Math.min(60_000, 5_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 4))
  return {
    providerFailureSource: 'status_poll',
    providerFailureCode: 'STATUS_POLL_ERROR',
    providerLastPollErrorAt: new Date(now).toISOString(),
    providerPollRetryNotBefore: new Date(now + delayMs).toISOString(),
  }
}

export function reconciliationMetadata(
  task: GenerationTask,
  reason: 'poll_error' | 'processing_timeout',
  now = Date.now(),
): GenerationTask['metadata'] {
  return {
    providerFailureSource: reason === 'poll_error' ? 'status_poll' : 'processing_timeout',
    providerFailureCode: reason === 'poll_error' ? 'STATUS_POLL_ERROR' : 'PROCESSING_TIMEOUT',
    ...(isDoraRemoteTask(task)
      ? {
          providerReconciliationReason: reason,
          providerReconciliationStatus: 'pending',
          providerReconciliationNextPollAt: new Date(now + 60_000).toISOString(),
          providerReconciliationExpiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
          providerReconciliationAttempts: 0,
        }
      : {}),
  }
}

export function videoProcessingStalled(
  task: GenerationTask,
  status: VideoGenerationStatus,
  stallTimeoutMs: number,
): boolean {
  if (status.progressIsEstimated) return false
  if (status.progress > task.progress) return false
  const progressChangedAt = Date.parse(
    stringValue(task.metadata.providerProgressChangedAt, stringValue(task.metadata.providerSubmittedAt, '')),
  )
  return Number.isFinite(progressChangedAt) && Date.now() - progressChangedAt >= stallTimeoutMs
}

export function videoProcessingExpired(task: GenerationTask, timeoutMs: number): boolean {
  const submittedAt = Date.parse(stringValue(task.metadata.providerSubmittedAt, task.createdAt))
  return Number.isFinite(submittedAt) && Date.now() - submittedAt >= timeoutMs
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}
