import type { GenerationTask } from '@seqora/contracts'
import { AppError } from '../errors.js'
import { generationTaskLeaseActive } from './taskLease.js'

/** Internal execution identity; never accepted from request metadata. */
export type TextTaskWriteGuard = Readonly<{
  taskId: string
  tenantId: string
  projectId: string
  userId: string
  clientRequestId: string
  attempts: number
  leaseOwnerId: string
  leaseToken: string
  operation: string | null
  model: string | null
}>

/** Invalid legacy operations must reach the handler's normal failure path. */
export function textTaskOperation(task: GenerationTask): string | null {
  return typeof task.metadata.scriptOperation === 'string' ? task.metadata.scriptOperation : null
}

export function captureTextTaskWriteGuard(task: GenerationTask): TextTaskWriteGuard {
  const guard = Object.freeze({
    taskId: task.id,
    tenantId: task.tenantId,
    projectId: task.projectId,
    userId: task.userId,
    clientRequestId: task.clientRequestId,
    attempts: task.attempts ?? 0,
    leaseOwnerId: task.leaseOwnerId ?? '',
    leaseToken: task.leaseToken ?? '',
    operation: textTaskOperation(task),
    model: task.model ?? null,
  })
  assertTextTaskWriteGuard(task, guard)
  return guard
}

export function assertTextTaskWriteGuard(
  task: GenerationTask | null | undefined,
  guard: TextTaskWriteGuard,
  now = Date.now(),
): void {
  if (
    !task ||
    task.kind !== 'text' ||
    task.provider !== 'text' ||
    task.projectId.startsWith('sm-standalone-') ||
    task.id !== guard.taskId ||
    task.tenantId !== guard.tenantId ||
    task.projectId !== guard.projectId ||
    task.userId !== guard.userId ||
    task.clientRequestId !== guard.clientRequestId ||
    task.attempts !== guard.attempts ||
    task.leaseOwnerId !== guard.leaseOwnerId ||
    task.leaseToken !== guard.leaseToken ||
    textTaskOperation(task) !== guard.operation ||
    (task.model ?? null) !== guard.model ||
    !generationTaskLeaseActive(task, now)
  ) {
    throw new AppError(409, 'TASK_LEASE_LOST', '剧本任务已停止或执行权已变更，未写入本次结果')
  }
}
