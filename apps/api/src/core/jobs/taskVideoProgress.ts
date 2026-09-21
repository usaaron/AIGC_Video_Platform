import type { GenerationTask } from '@seqora/contracts'
import type { VideoGenerationStatus } from '../generation/videoProvider.js'

export const VIDEO_WAIT_TIMEOUT =
  '上游视频生成超过等待时限，平台已停止等待并退回积分；远端任务编号已保留供找回结果，未自动重新提交。'

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
