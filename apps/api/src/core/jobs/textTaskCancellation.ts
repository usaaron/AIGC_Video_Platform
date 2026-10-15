import { createHash } from 'node:crypto'
import type { GenerationTask } from '@seqora/contracts'
import type { TextTaskWriteGuard } from './textTaskExecutionGuard.js'

function executionHash(guard: TextTaskWriteGuard): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        guard.taskId,
        guard.tenantId,
        guard.projectId,
        guard.userId,
        guard.clientRequestId,
        guard.attempts,
        guard.leaseOwnerId,
        guard.leaseToken,
        guard.operation,
        guard.model,
      ]),
    )
    .digest('hex')
}

/** Record the cancelled execution without persisting its lease credentials. */
export function recordTextTaskCancellation(task: GenerationTask): void {
  if (
    task.kind !== 'text' ||
    task.provider !== 'text' ||
    task.status !== 'running' ||
    !task.leaseOwnerId ||
    !task.leaseToken ||
    typeof task.metadata.scriptOperation !== 'string'
  )
    return
  task.metadata.textCancellationExecution = {
    version: 'seqora.text-cancellation.v1',
    executionHash: executionHash({
      taskId: task.id,
      tenantId: task.tenantId,
      projectId: task.projectId,
      userId: task.userId,
      clientRequestId: task.clientRequestId,
      attempts: task.attempts ?? 0,
      leaseOwnerId: task.leaseOwnerId,
      leaseToken: task.leaseToken,
      operation: task.metadata.scriptOperation,
      model: task.model ?? null,
    }),
  }
}

export function textTaskCancellationMatches(task: GenerationTask, guard: TextTaskWriteGuard): boolean {
  const raw = task.metadata.textCancellationExecution
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const proof = raw as Record<string, unknown>
  return (
    task.kind === 'text' &&
    task.provider === 'text' &&
    task.status === 'cancelled' &&
    task.id === guard.taskId &&
    task.tenantId === guard.tenantId &&
    task.projectId === guard.projectId &&
    task.userId === guard.userId &&
    task.clientRequestId === guard.clientRequestId &&
    task.attempts === guard.attempts &&
    (task.model ?? null) === guard.model &&
    task.metadata.scriptOperation === guard.operation &&
    proof.version === 'seqora.text-cancellation.v1' &&
    proof.executionHash === executionHash(guard)
  )
}
