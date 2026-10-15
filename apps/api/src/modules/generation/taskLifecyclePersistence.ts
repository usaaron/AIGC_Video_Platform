import type { GenerationTask, Principal } from '@seqora/contracts'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import { generationTaskColumns, type GenerationTaskRow, taskFromRow } from './repositoryData.js'
import { metadataString } from './taskStateHelpers.js'
import { findProviderCompletionContext } from '../../core/jobs/providerCompletionContext.js'
import { findTextTaskPersistenceContext } from '../../core/jobs/textTaskPersistenceContext.js'
import { providerCompletionEvidence } from './providerCompletionEvidence.js'
import { textCompletionEvidence } from './textCompletionEvidence.js'
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
  options: { runtimeSnapshot?: boolean } = {},
): Promise<GenerationTask | null> {
  if (task.metadata.providerCompletionReceipt !== undefined && !providerCompletionEvidence(task).receipt) {
    return null
  }
  if (task.metadata.textCompletionReceipt !== undefined && !textCompletionEvidence(task).receipt) {
    return null
  }
  const completion = findProviderCompletionContext(task)
  const textContext = findTextTaskPersistenceContext(task)
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
        NOT $20::boolean
        OR (NOT (kind = 'text' AND provider = 'text') AND NOT $28::boolean)
        OR (
          $28::boolean AND kind = 'text' AND provider = 'text'
          AND project_id NOT LIKE 'sm-standalone-%'
          AND tenant_id = $16 AND project_id = $17
          AND user_id = $21 AND client_request_id = $22
          AND model IS NOT DISTINCT FROM $23
          AND CASE WHEN jsonb_typeof(metadata->'scriptOperation') = 'string'
            THEN metadata->>'scriptOperation' ELSE NULL END IS NOT DISTINCT FROM $24
          AND (
            (
              $25 = 'worker' AND status = 'running'
              AND attempts = $5
              AND lease_owner_id = $26::jsonb->>'leaseOwnerId'
              AND lease_token = $26::jsonb->>'leaseToken'
              AND lease_expires_at > clock_timestamp()
            )
            OR (
              $25 = 'control'
              AND status = $27::jsonb->>'status'
              AND updated_at = ($27::jsonb->>'updatedAt')::timestamptz
              AND attempts = ($27::jsonb->>'attempts')::integer
              AND COALESCE(max_attempts, 3) = ($27::jsonb->>'maxAttempts')::integer
              AND progress = ($27::jsonb->>'progress')::integer
              AND lease_owner_id IS NOT DISTINCT FROM $27::jsonb->>'leaseOwnerId'
              AND lease_token IS NOT DISTINCT FROM $27::jsonb->>'leaseToken'
              AND lease_acquired_at IS NOT DISTINCT FROM ($27::jsonb->>'leaseAcquiredAt')::timestamptz
              AND lease_heartbeat_at IS NOT DISTINCT FROM ($27::jsonb->>'leaseHeartbeatAt')::timestamptz
              AND lease_expires_at IS NOT DISTINCT FROM ($27::jsonb->>'leaseExpiresAt')::timestamptz
              AND metadata = $27::jsonb->'metadata'
              AND result_url IS NOT DISTINCT FROM $27::jsonb->>'resultUrl'
              AND outputs = $27::jsonb->'outputs'
              AND error IS NOT DISTINCT FROM $27::jsonb->>'error'
            )
            OR (
              $25 IS NULL AND status = $3 AND attempts = $5
              AND COALESCE(max_attempts, 3) = $6
              AND progress = $4
              AND lease_owner_id IS NOT DISTINCT FROM $7
              AND lease_token IS NOT DISTINCT FROM $8
              AND lease_acquired_at IS NOT DISTINCT FROM $9::timestamptz
              AND lease_heartbeat_at IS NOT DISTINCT FROM $10::timestamptz
              AND lease_expires_at IS NOT DISTINCT FROM $11::timestamptz
              AND (status <> 'running' OR lease_expires_at > clock_timestamp())
              AND metadata = $2::jsonb
              AND result_url IS NOT DISTINCT FROM $12
              AND outputs = $13::jsonb
              AND error IS NOT DISTINCT FROM $14
            )
          )
        )
      )
      AND (
        (NOT ($2::jsonb ? 'providerCompletionReceipt') AND NOT (metadata ? 'providerCompletionReceipt'))
        OR (
          $3 = 'completed'
          AND tenant_id = $16 AND project_id = $17
          AND attempts = $5
          AND (
            (kind = 'video' AND provider = 'seedance'
              AND metadata->>'providerTaskId' = $2::jsonb->>'providerTaskId')
            OR (kind = 'image' AND provider = 'img2'
              AND metadata->>'providerIdempotencyKey' = $2::jsonb->>'providerIdempotencyKey'
              AND COALESCE(metadata->'turnaround' = 'true'::jsonb, false)
                = COALESCE($2::jsonb->'turnaround' = 'true'::jsonb, false))
          )
          AND metadata->>'providerName' = $2::jsonb->>'providerName'
          AND (
            (status = 'running' AND lease_owner_id = $18 AND lease_token = $19)
            OR (status = 'completed' AND metadata->'providerCompletionReceipt' = $2::jsonb->'providerCompletionReceipt')
          )
        )
      )
      AND (
        (NOT ($2::jsonb ? 'textCompletionReceipt') AND NOT (metadata ? 'textCompletionReceipt'))
        OR (
          $3 = 'completed' AND $28::boolean AND kind = 'text' AND provider = 'text'
          AND project_id NOT LIKE 'sm-standalone-%'
          AND tenant_id = $16 AND project_id = $17
          AND user_id = $21 AND client_request_id = $22
          AND model IS NOT DISTINCT FROM $23
          AND CASE WHEN jsonb_typeof(metadata->'scriptOperation') = 'string'
            THEN metadata->>'scriptOperation' ELSE NULL END IS NOT DISTINCT FROM $24
          AND attempts = $5
          AND (
            (
              status = 'running' AND NOT (metadata ? 'textCompletionReceipt')
              AND $25 = 'worker'
              AND lease_owner_id = $26::jsonb->>'leaseOwnerId'
              AND lease_token = $26::jsonb->>'leaseToken'
              AND lease_expires_at > clock_timestamp()
            )
            OR (
              status = 'completed'
              AND metadata->'textCompletionReceipt' = $2::jsonb->'textCompletionReceipt'
              AND metadata->'textResult' = $2::jsonb->'textResult'
            )
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
      options.runtimeSnapshot === true,
      task.userId,
      task.clientRequestId,
      task.model ?? null,
      typeof task.metadata.scriptOperation === 'string' ? task.metadata.scriptOperation : null,
      textContext?.kind ?? null,
      textContext?.kind === 'worker' ? JSON.stringify(textContext.guard) : null,
      textContext?.kind === 'control' ? JSON.stringify(textContext.previous) : null,
      task.kind === 'text' && task.provider === 'text',
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
