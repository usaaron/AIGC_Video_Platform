import type { Principal } from '@seqora/contracts'
import type { QueryResult, QueryResultRow } from 'pg'
import { AppError } from '../../core/errors.js'
import { assertTextTaskWriteGuard, type TextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import type { AppState } from '../../infra/store.js'
import { generationTaskColumns, taskFromRow, type GenerationTaskRow } from '../generation/repositoryData.js'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>
}

function assertWriteTarget(projectId: string, principal: Principal, guard: TextTaskWriteGuard): void {
  if (
    projectId !== guard.projectId ||
    principal.tenantId !== guard.tenantId ||
    principal.userId !== guard.userId
  ) {
    throw new AppError(409, 'TASK_LEASE_LOST', '剧本任务范围已变更，未写入本次结果')
  }
}

/** Run inside the same synchronous store mutation as the actual content write. */
export function assertStoreTextTaskWriteGuard(
  state: AppState,
  projectId: string,
  principal: Principal,
  guard?: TextTaskWriteGuard,
): void {
  if (!guard) return
  assertWriteTarget(projectId, principal, guard)
  assertTextTaskWriteGuard(
    state.tasks.find((task) => task.id === guard.taskId),
    guard,
  )
}

/** Keep this row lock only for the content transaction, never during Provider execution. */
export async function lockTextTaskWriteGuard(
  client: Queryable,
  projectId: string,
  principal: Principal,
  guard?: TextTaskWriteGuard,
): Promise<() => void> {
  if (!guard) return () => {}
  assertWriteTarget(projectId, principal, guard)
  const result = await client.query<GenerationTaskRow>(
    `SELECT ${generationTaskColumns} FROM generation_tasks
     WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND user_id = $4 FOR UPDATE`,
    [guard.taskId, principal.tenantId, projectId, principal.userId],
  )
  const task = result.rows[0] ? taskFromRow(result.rows[0]) : null
  const assertActive = () => assertTextTaskWriteGuard(task, guard)
  assertActive()
  // The project or episode lock may wait long enough for this lease to expire.
  return assertActive
}
