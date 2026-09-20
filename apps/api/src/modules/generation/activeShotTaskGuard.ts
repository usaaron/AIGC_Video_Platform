import type { CreateGenerationTask, Principal } from '@seqora/contracts'
import type { QueryResult, QueryResultRow } from 'pg'
import { AppError } from '../../core/errors.js'
import type { AppState } from '../../infra/store.js'
import { metadataString } from './taskStateHelpers.js'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

export async function assertNoActiveShotTask(
  queryable: Queryable,
  input: CreateGenerationTask,
  principal: Principal,
): Promise<void> {
  const shotId = metadataString(input.metadata, 'shotId')
  if (input.kind !== 'video' || !shotId) return
  const activeTask = await queryable.query<{ id: string }>(
    `
    SELECT id
    FROM generation_tasks
    WHERE project_id = $1
      AND tenant_id = $2
      AND kind = 'video'
      AND metadata->>'shotId' = $3
      AND status IN ('queued', 'paused', 'running')
      AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
    LIMIT 1
    `,
    [input.projectId, principal.tenantId, shotId],
  )
  if (activeTask.rows[0]) throw videoShotConflict()
}

export function assertNoActiveShotTaskInState(
  state: AppState,
  input: CreateGenerationTask,
  principal: Principal,
): void {
  const shotId = metadataString(input.metadata, 'shotId')
  if (input.kind !== 'video' || !shotId) return
  const activeTask = state.tasks.find(
    (item) =>
      item.projectId === input.projectId &&
      item.tenantId === principal.tenantId &&
      item.kind === 'video' &&
      item.metadata.shotId === shotId &&
      ['queued', 'paused', 'running'].includes(item.status) &&
      typeof item.metadata.queueHiddenAt !== 'string',
  )
  if (activeTask) throw videoShotConflict()
}

function videoShotConflict(): AppError {
  return new AppError(
    409,
    'VIDEO_SHOT_BATCH_CONFLICT',
    'This shot already has an active video generation task. Pause or delete it before creating another one.',
  )
}
