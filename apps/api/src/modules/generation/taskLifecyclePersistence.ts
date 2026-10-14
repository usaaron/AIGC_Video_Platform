import type { GenerationTask, Principal } from '@seqora/contracts'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import { generationTaskColumns, type GenerationTaskRow, taskFromRow } from './repositoryData.js'
import { metadataString } from './taskStateHelpers.js'
import { findProviderCompletionContext } from '../../core/jobs/providerCompletionContext.js'
import { providerCompletionEvidence } from './providerCompletionEvidence.js'
import type { QueryResult, QueryResultRow } from 'pg'
type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}
export async function findControlledTaskInDatabase(
  queryable: Queryable,
  taskId: string,
  principal: Principal,
): Promise<GenerationTask | null> {
  const result = await queryable.query<GenerationTaskRow>(
    `
    SELECT ${generationTaskColumns}
    FROM generation_tasks
    WHERE id = $1
      AND project_id NOT LIKE 'sm-standalone-%'
      AND tenant_id = $2
      AND ($3::boolean OR user_id = $4)
    LIMIT 1
    FOR UPDATE
    `,
    [taskId, principal.tenantId, canReadAllTenantContent(principal), principal.userId],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

export async function updateGenerationTaskLifecycle(
  queryable: Queryable,
  task: GenerationTask,
): Promise<GenerationTask | null> {
  if (task.metadata.providerCompletionReceipt !== undefined && !providerCompletionEvidence(task).receipt) {
    return null
  }
  const completion = findProviderCompletionContext(task)
  const result = await queryable.query<GenerationTaskRow>(
    `
    UPDATE generation_tasks
    SET metadata = $2::jsonb,
        status = $3,
        progress = $4,
        attempts = $5,
        max_attempts = $6,
        lease_owner_id = $7,
        lease_token = $8,
        lease_acquired_at = $9,
        lease_heartbeat_at = $10,
        lease_expires_at = $11,
        result_url = $12,
        outputs = $13::jsonb,
        error = $14,
        updated_at = $15
    WHERE id = $1
      AND updated_at <= $15::timestamptz
      AND (
        (NOT ($2::jsonb ? 'providerCompletionReceipt') AND NOT (metadata ? 'providerCompletionReceipt'))
        OR (
          $3 = 'completed' AND kind = 'video' AND provider = 'seedance'
          AND tenant_id = $16 AND project_id = $17
          AND attempts = $5
          AND metadata->>'providerTaskId' = $2::jsonb->>'providerTaskId'
          AND metadata->>'providerName' = $2::jsonb->>'providerName'
          AND (
            (status = 'running' AND lease_owner_id = $18 AND lease_token = $19)
            OR (status = 'completed' AND metadata->'providerCompletionReceipt' = $2::jsonb->'providerCompletionReceipt')
          )
        )
      )
    RETURNING ${generationTaskColumns}
    `,
    [
      task.id,
      JSON.stringify(task.metadata),
      task.status,
      task.progress,
      task.attempts ?? 0,
      task.maxAttempts ?? null,
      task.leaseOwnerId ?? null,
      task.leaseToken ?? null,
      task.leaseAcquiredAt ?? null,
      task.leaseHeartbeatAt ?? null,
      task.leaseExpiresAt ?? null,
      task.resultUrl,
      JSON.stringify(task.outputs),
      task.error,
      task.updatedAt,
      task.tenantId,
      task.projectId,
      completion?.leaseOwnerId ?? null,
      completion?.leaseToken ?? null,
    ],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

export async function updateTaskResultTargets(
  queryable: Queryable,
  task: GenerationTask,
  selectedVersions?: { imageTaskId: string | null; videoTaskId: string | null },
): Promise<void> {
  if (task.status !== 'completed') return
  const updatedAt = task.updatedAt
  const assetId = metadataString(task.metadata, 'assetId')
  if (task.kind === 'image' && task.resultUrl && assetId) {
    await queryable.query(
      `
      UPDATE assets
      SET image_url = $4,
          updated_at = GREATEST(updated_at, $5::timestamptz)
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
      `,
      [assetId, task.projectId, task.tenantId, task.resultUrl, updatedAt],
    )
  }
  const shotId = metadataString(task.metadata, 'shotId')
  if (
    task.kind === 'image' &&
    task.resultUrl &&
    shotId &&
    (!selectedVersions?.imageTaskId || selectedVersions.imageTaskId === task.id)
  ) {
    await queryable.query(
      `
      UPDATE shots
      SET image_url = $4,
          selected_image_task_id = $5,
          updated_at = GREATEST(updated_at, $6::timestamptz)
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
      `,
      [shotId, task.projectId, task.tenantId, task.resultUrl, task.id, updatedAt],
    )
  }
  if (
    task.kind === 'video' &&
    shotId &&
    (!selectedVersions?.videoTaskId || selectedVersions.videoTaskId === task.id)
  ) {
    await queryable.query(
      `
      UPDATE shots
      SET selected_video_task_id = $4,
          updated_at = $5
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
      `,
      [shotId, task.projectId, task.tenantId, task.id, updatedAt],
    )
  }
}
