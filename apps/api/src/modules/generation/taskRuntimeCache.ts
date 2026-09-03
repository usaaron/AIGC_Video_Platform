import type { GenerationTask } from '@seqora/contracts'

export type TaskDependencyReference = {
  id: string
  projectId: string
  tenantId: string
}

export const activeGenerationTaskPredicate = `
  (
    status IN ('queued', 'paused', 'running')
    OR (
      status = 'cancelled'
      AND metadata->>'providerTaskId' IS NOT NULL
      AND metadata->>'providerCancelRequestedAt' IS NOT NULL
      AND metadata->>'providerCancelCompletedAt' IS NULL
      AND metadata->>'providerCancelSkippedAt' IS NULL
    )
    OR (
      status = 'failed'
      AND (
        (
          estimated_credits > 0
          AND metadata->>'creditsRefundedAt' IS NULL
        )
        OR (
          metadata->>'providerName' IS NOT NULL
          AND metadata->>'providerTaskId' IS NOT NULL
          AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
          AND error LIKE '%"invalid_value"%'
          AND error LIKE '%"status"%'
        )
      )
    )
    OR (
      status = 'cancelled'
      AND estimated_credits > 0
      AND metadata->>'creditsRefundedAt' IS NULL
      AND (
        metadata->>'providerTaskId' IS NULL
        OR metadata->>'providerCancelRequestedAt' IS NULL
        OR metadata->>'providerCancelCompletedAt' IS NOT NULL
        OR metadata->>'providerCancelSkippedAt' IS NOT NULL
      )
    )
  )
`

export function taskRuntimeKey(id: string, projectId: string, tenantId: string): string {
  return `${tenantId}:${projectId}:${id}`
}

export function taskDependencyKey(reference: TaskDependencyReference): string {
  return taskRuntimeKey(reference.id, reference.projectId, reference.tenantId)
}

export function latestTasksByRuntimeKey(tasks: GenerationTask[]): GenerationTask[] {
  const latest = new Map<string, GenerationTask>()
  for (const task of tasks) {
    const key = taskRuntimeKey(task.id, task.projectId, task.tenantId)
    const current = latest.get(key)
    if (!current || Date.parse(current.updatedAt) <= Date.parse(task.updatedAt)) latest.set(key, task)
  }
  return [...latest.values()]
}

export function generationTaskRuntimeClosureKeys(tasks: GenerationTask[]): Set<string> {
  const tasksByKey = new Map(
    tasks.map((task) => [taskRuntimeKey(task.id, task.projectId, task.tenantId), task]),
  )
  const retained = new Set<string>()
  const pending = tasks.filter(isGenerationTaskRuntimeActive)
  while (pending.length) {
    const task = pending.pop()!
    const key = taskRuntimeKey(task.id, task.projectId, task.tenantId)
    if (retained.has(key)) continue
    retained.add(key)
    for (const dependency of taskDependencyReferences(task)) {
      const candidate = tasksByKey.get(taskDependencyKey(dependency))
      if (candidate) pending.push(candidate)
    }
  }
  return retained
}

export function taskDependencyReferences(task: GenerationTask): TaskDependencyReference[] {
  const references: TaskDependencyReference[] = []
  const add = (id: unknown): void => {
    if (typeof id !== 'string' || !id) return
    references.push({ id, projectId: task.projectId, tenantId: task.tenantId })
  }

  add(task.metadata.dependsOnTaskId)
  add(task.metadata.continuitySourceTaskId)
  for (const key of ['dependsOnTaskIds', 'sourceVideoTaskIds']) {
    const ids = task.metadata[key]
    if (!Array.isArray(ids)) continue
    ids.forEach(add)
  }
  return [
    ...new Map(
      references.map((reference) => [
        taskRuntimeKey(reference.id, reference.projectId, reference.tenantId),
        reference,
      ]),
    ).values(),
  ]
}

function isGenerationTaskRuntimeActive(task: GenerationTask): boolean {
  if (task.status === 'queued' || task.status === 'paused' || task.status === 'running') return true
  const metadata = task.metadata
  const refundPending = task.estimatedCredits > 0 && typeof metadata.creditsRefundedAt !== 'string'
  if (task.status === 'failed') {
    const statusRecoveryPending =
      typeof metadata.providerName === 'string' &&
      typeof metadata.providerTaskId === 'string' &&
      typeof metadata.queueHiddenAt !== 'string' &&
      task.error?.includes('"invalid_value"') === true &&
      task.error.includes('"status"')
    return refundPending || statusRecoveryPending
  }
  if (task.status !== 'cancelled') return false
  const remoteCancellationPending =
    typeof metadata.providerTaskId === 'string' &&
    typeof metadata.providerCancelRequestedAt === 'string' &&
    typeof metadata.providerCancelCompletedAt !== 'string' &&
    typeof metadata.providerCancelSkippedAt !== 'string'
  const localRefundPending =
    refundPending &&
    (typeof metadata.providerTaskId !== 'string' ||
      typeof metadata.providerCancelRequestedAt !== 'string' ||
      typeof metadata.providerCancelCompletedAt === 'string' ||
      typeof metadata.providerCancelSkippedAt === 'string')
  return remoteCancellationPending || localRefundPending
}
