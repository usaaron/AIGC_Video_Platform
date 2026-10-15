import type { GenerationTask, Principal } from '@seqora/contracts'
import type { QueryResult, QueryResultRow } from 'pg'
import { AppError } from '../../core/errors.js'
import { generationTaskLeaseActive } from '../../core/jobs/taskLease.js'
import { textTaskCancellationMatches } from '../../core/jobs/textTaskCancellation.js'
import type { TextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import type { AppState } from '../../infra/store.js'
import { generationTaskColumns, taskFromRow, type GenerationTaskRow } from '../generation/repositoryData.js'
import type { BillingLedgerAuditInput } from './repository.js'

export type BillingLedgerRefundInput = {
  tenantId: string
  userId: string
  originalEntryId: string
  refundEntryId: string
  amount: number
  description: string
  createdByUserId?: string | null
  createdAt?: string
  audit?: BillingLedgerAuditInput
  taskWriteGuard?: TextTaskWriteGuard | undefined
}

type RefundScope = Pick<
  BillingLedgerRefundInput,
  'tenantId' | 'userId' | 'originalEntryId' | 'refundEntryId' | 'taskWriteGuard'
>
type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>
}

function matchesReference(task: GenerationTask, guard: TextTaskWriteGuard, reference: string): boolean {
  if (guard.operation !== 'generate' && guard.operation !== 'enrich') return false
  const direct = `script-${guard.operation}-${guard.clientRequestId}`
  if (reference === direct) return true
  if (guard.operation !== 'generate') return false
  const plan = task.metadata.episodePlan
  if (!plan || typeof plan !== 'object' || !('episodes' in plan) || !Array.isArray(plan.episodes))
    return false
  const prefix = `script-generate-${guard.taskId}-episode-`
  if (!reference.startsWith(prefix)) return false
  const match = /^(0|[1-9][0-9]*)(?::retry:([1-9][0-9]?))?$/.exec(reference.slice(prefix.length))
  return Boolean(match && Number(match[1]) < plan.episodes.length)
}

/** A cancelled execution may refund only its own reservation, never a successor's. */
export function assertTextTaskRefundGuard(
  task: GenerationTask | null | undefined,
  input: RefundScope,
  now = Date.now(),
): void {
  const guard = input.taskWriteGuard
  if (!guard) return
  const reference = input.originalEntryId.slice('generation-'.length)
  const identityMatches =
    task &&
    task.kind === 'text' &&
    task.provider === 'text' &&
    !task.projectId.startsWith('sm-standalone-') &&
    task.id === guard.taskId &&
    task.tenantId === guard.tenantId &&
    task.projectId === guard.projectId &&
    task.userId === guard.userId &&
    task.clientRequestId === guard.clientRequestId &&
    task.attempts === guard.attempts &&
    task.metadata.scriptOperation === guard.operation &&
    (task.model ?? null) === guard.model &&
    input.tenantId === guard.tenantId &&
    input.userId === guard.userId
  const originalLease = task?.leaseOwnerId === guard.leaseOwnerId && task.leaseToken === guard.leaseToken
  if (
    !identityMatches ||
    !guard.leaseOwnerId ||
    !guard.leaseToken ||
    typeof task.metadata.creditsRefundDisabledAt === 'string' ||
    !input.originalEntryId.startsWith('generation-') ||
    input.refundEntryId !== `refund-${reference}` ||
    !matchesReference(task, guard, reference) ||
    !(
      (originalLease && generationTaskLeaseActive(task, now)) ||
      (task.status === 'cancelled' && textTaskCancellationMatches(task, guard))
    )
  ) {
    throw new AppError(409, 'TASK_LEASE_LOST', '剧本执行权已变更，未退还本次预约')
  }
}

export function assertStoreTextTaskRefundGuard(state: AppState, input: RefundScope): void {
  if (!input.taskWriteGuard) return
  assertTextTaskRefundGuard(
    state.tasks.find((task) => task.id === input.taskWriteGuard!.taskId),
    input,
  )
}

export function assertStoreScriptReservationRefund(
  state: AppState,
  principal: Principal,
  reference: string,
  taskWriteGuard?: TextTaskWriteGuard,
): void {
  assertStoreTextTaskRefundGuard(state, {
    tenantId: principal.tenantId,
    userId: principal.userId,
    originalEntryId: `generation-${reference}`,
    refundEntryId: `refund-${reference}`,
    taskWriteGuard,
  })
}

/** Hold the task lock until the refund transaction commits; recheck after balance locks. */
export async function lockTextTaskRefundGuard(client: Queryable, input: RefundScope): Promise<() => void> {
  const guard = input.taskWriteGuard
  if (!guard) return () => {}
  const result = await client.query<GenerationTaskRow>(
    `SELECT ${generationTaskColumns} FROM generation_tasks
     WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND user_id = $4 FOR UPDATE`,
    [guard.taskId, input.tenantId, guard.projectId, input.userId],
  )
  const task = result.rows[0] ? taskFromRow(result.rows[0]) : null
  const assertRefundable = () => assertTextTaskRefundGuard(task, input)
  assertRefundable()
  return assertRefundable
}
