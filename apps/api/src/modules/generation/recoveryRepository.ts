import { randomUUID } from 'node:crypto'
import type { GenerationTask } from '@seqora/contracts'
import type { AccountDatabase } from '../../infra/postgres.js'
import { insertAuditLog } from '../../core/audit/auditLog.js'
import type { GeneratedOutputDescriptor } from '../../core/jobs/taskWriteback.js'
import { generationTaskColumns, taskFromRow, type GenerationTaskRow } from './repositoryData.js'

export type VideoRecoveryClaim = {
  task: GenerationTask
  providerTaskId: string
  token: string
  revision: string
  expiresAt: string
}

export type VideoRecoveryState = 'pending' | 'expired' | 'upstream_failed'

// Normal runtime cache writes cannot overwrite a newer reconciliation claim or completed result.
export const recoveryWritebackGuard = `
  AND (metadata->>'providerReconciliationRevision' IS NULL
    OR metadata->>'providerReconciliationRevision' IS NOT DISTINCT FROM $2::jsonb->>'providerReconciliationRevision')
  AND (metadata->>'providerReconciliationStatus' IS DISTINCT FROM 'completed' OR $3 = 'completed')
`

export function isAutomaticVideoResult(task: GenerationTask): boolean {
  return task.metadata.providerReconciliationHistoryOnly !== true
}

export interface VideoRecoveryRepository {
  claimDue(now: Date, limit: number): Promise<VideoRecoveryClaim[]>
  defer(claim: VideoRecoveryClaim, state: VideoRecoveryState, code: string, now: Date): Promise<boolean>
  complete(claim: VideoRecoveryClaim, descriptors: GeneratedOutputDescriptor[], now: Date): Promise<boolean>
}

const recoveryPredicate = `
  kind = 'video' AND provider = 'seedance' AND status = 'failed'
  AND metadata->>'providerName' = 'dora-router-seedance'
  AND metadata->>'providerReconciliationStatus' = 'pending'
  AND metadata->>'providerReconciliationReason' IN ('poll_error', 'processing_timeout')
  AND jsonb_typeof(metadata->'providerTaskId') = 'string'
  AND length(metadata->>'providerTaskId') > 0
  AND jsonb_typeof(metadata->'providerReconciliationExpiresAt') = 'string'
  AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
  AND (estimated_credits = 0 OR jsonb_typeof(metadata->'creditsRefundedAt') = 'string')
  AND outputs = '[]'::jsonb AND result_url IS NULL AND lease_token IS NULL
`

/** Result reconciliation has its own claim; a failed task is never made runnable again. */
export class PostgresVideoRecoveryRepository implements VideoRecoveryRepository {
  constructor(private readonly database: AccountDatabase) {}

  async claimDue(now: Date, limit: number): Promise<VideoRecoveryClaim[]> {
    return this.database.transaction(async (client) => {
      const result = await client.query<GenerationTaskRow>(
        `
        SELECT ${generationTaskColumns} FROM generation_tasks
        WHERE ${recoveryPredicate}
          AND COALESCE(metadata->>'providerReconciliationNextPollAt', '') <= $1
          AND COALESCE(metadata->>'providerReconciliationClaimExpiresAt', '') <= $1
        ORDER BY COALESCE(metadata->>'providerReconciliationNextPollAt', ''), id
        LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [now.toISOString(), Math.min(2, Math.max(0, limit))],
      )
      const claims: VideoRecoveryClaim[] = []
      for (const row of result.rows) {
        const original = taskFromRow(row)
        const token = randomUUID()
        const revision = randomUUID()
        const metadata: Record<string, unknown> = {
          ...original.metadata,
          providerReconciliationClaimToken: token,
          providerReconciliationRevision: revision,
          providerReconciliationClaimExpiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
          providerReconciliationNextPollAt: new Date(now.getTime() + 60_000).toISOString(),
          providerReconciliationAttempts: Number(original.metadata.providerReconciliationAttempts ?? 0) + 1,
        }
        const updated = await client.query<GenerationTaskRow>(
          `
          UPDATE generation_tasks SET metadata = $2::jsonb, updated_at = $3::timestamptz
          WHERE id = $1 RETURNING ${generationTaskColumns}`,
          [row.id, JSON.stringify(metadata), now.toISOString()],
        )
        const task = taskFromRow(updated.rows[0]!)
        claims.push({
          task,
          token,
          revision,
          providerTaskId: String(metadata.providerTaskId),
          expiresAt: String(metadata.providerReconciliationExpiresAt),
        })
      }
      return claims
    })
  }

  async defer(
    claim: VideoRecoveryClaim,
    state: VideoRecoveryState,
    code: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.database.query(
      `
      UPDATE generation_tasks
      SET metadata = (metadata - 'providerReconciliationClaimToken' - 'providerReconciliationClaimExpiresAt')
        || jsonb_build_object(
          'providerReconciliationStatus', $5::text,
          'providerReconciliationLastCode', $6::text,
          'providerReconciliationCheckedAt', $7::text,
          'providerReconciliationNextPollAt', $8::text,
          'providerReconciliationRevision', $9::text),
        updated_at = $7::timestamptz
      WHERE id = $1 AND tenant_id = $2 AND ${recoveryPredicate}
        AND metadata->>'providerTaskId' = $3
        AND metadata->>'providerReconciliationClaimToken' = $4
        AND metadata->>'providerReconciliationRevision' = $10`,
      [
        claim.task.id,
        claim.task.tenantId,
        claim.providerTaskId,
        claim.token,
        state,
        code,
        now.toISOString(),
        new Date(now.getTime() + 60_000).toISOString(),
        randomUUID(),
        claim.revision,
      ],
    )
    return result.rowCount === 1
  }

  async complete(
    claim: VideoRecoveryClaim,
    descriptors: GeneratedOutputDescriptor[],
    now: Date,
  ): Promise<boolean> {
    const video = descriptors.find(
      (item) => item.view === 'single' && item.contentType.startsWith('video/') && item.size > 0,
    )
    const tail = descriptors.find(
      (item) => item.view === 'last-frame' && item.contentType.startsWith('image/') && item.size > 0,
    )
    if (!video || !tail || descriptors.length !== 2) return false
    return this.database.transaction(async (client) => {
      const selected = await client.query<GenerationTaskRow>(
        `
        SELECT ${generationTaskColumns} FROM generation_tasks
        WHERE id = $1 AND tenant_id = $2 AND ${recoveryPredicate}
          AND metadata->>'providerTaskId' = $3
          AND metadata->>'providerReconciliationClaimToken' = $4
          AND metadata->>'providerReconciliationRevision' = $5
          AND updated_at = $6::timestamptz
        FOR UPDATE`,
        [
          claim.task.id,
          claim.task.tenantId,
          claim.providerTaskId,
          claim.token,
          claim.revision,
          claim.task.updatedAt,
        ],
      )
      const row = selected.rows[0]
      if (!row) return false
      const task = taskFromRow(row)
      // Refund receipt and ledger must agree before removing the task from terminal maintenance.
      if (task.estimatedCredits > 0) {
        const entries: Array<{
          id: string
          entry_type: string
          amount: number
          related_entry_id: string | null
          source: string
        }> = []
        const debitId = `generation-${task.clientRequestId}`
        const refundId = `refund-${task.id}`
        for (const source of ['billing_ledger_entries', 'organization_billing_ledger_entries']) {
          const ledger = await client.query<{
            id: string
            entry_type: string
            amount: number
            related_entry_id: string | null
          }>(
            `
            SELECT id, entry_type, amount, related_entry_id FROM ${source}
            WHERE id = ANY($1::text[]) AND tenant_id = $2 AND user_id = $3 FOR SHARE`,
            [[debitId, refundId], task.tenantId, task.userId],
          )
          entries.push(...ledger.rows.map((entry) => ({ ...entry, source })))
        }
        const debit = entries.find((entry) => entry.id === debitId)
        const refund = entries.find((entry) => entry.id === refundId)
        if (
          entries.length !== 2 ||
          !debit ||
          !refund ||
          debit.source !== refund.source ||
          debit.entry_type !== 'generation' ||
          refund.entry_type !== 'adjustment' ||
          Number(debit.amount) >= 0 ||
          Number(refund.amount) !== -Number(debit.amount) ||
          refund.related_entry_id !== debitId
        )
          return false
      }
      const shotId = typeof task.metadata.shotId === 'string' ? task.metadata.shotId : null
      // Lock project before checking newer tasks: task creation references this project FK.
      await client.query('SELECT id FROM projects WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [
        task.projectId,
        task.tenantId,
      ])
      const shotResult = shotId
        ? await client.query<{
            id: string
            selected_video_task_id: string | null
            updated_at: Date
          }>(
            `SELECT id, selected_video_task_id, updated_at FROM shots
          WHERE id = $1 AND project_id = $2 AND tenant_id = $3 FOR UPDATE`,
            [shotId, task.projectId, task.tenantId],
          )
        : null
      const shot = shotResult?.rows[0]
      let selectShot = Boolean(
        shot &&
        (!shot.selected_video_task_id || shot.selected_video_task_id === task.id) &&
        new Date(shot.updated_at).getTime() <= Date.parse(task.createdAt),
      )
      if (selectShot) {
        const newer = await client.query(
          `SELECT id FROM generation_tasks
          WHERE project_id = $1 AND tenant_id = $2 AND id <> $3 AND kind = 'video'
            AND metadata->>'shotId' = $4
            AND (created_at >= $5::timestamptz OR status IN ('queued', 'paused', 'running')) LIMIT 1`,
          [task.projectId, task.tenantId, task.id, shotId, task.createdAt],
        )
        selectShot = newer.rows.length === 0
      }
      const contentUrl = `/api/v1/generation/tasks/${task.id}/content`
      const outputs: GenerationTask['outputs'] = [
        { id: `${task.id}-video`, url: contentUrl, mediaType: 'video', view: 'single' },
        {
          id: `${task.id}-last-frame`,
          url: `/api/v1/generation/tasks/${task.id}/outputs/last-frame`,
          mediaType: 'image',
          view: 'last-frame',
        },
      ]
      const metadata: Record<string, unknown> = {
        ...task.metadata,
        providerState: 'completed',
        providerPollErrors: 0,
        generatedOutputs: descriptors,
        videoStorageKey: video.storageKey,
        videoContentType: video.contentType,
        videoSize: video.size,
        lastFrameStorageKey: tail.storageKey,
        lastFrameContentType: tail.contentType,
        providerReconciliationStatus: 'completed',
        providerReconciliationRevision: randomUUID(),
        providerReconciliationCompletedAt: now.toISOString(),
        providerReconciliationHistoryOnly: !selectShot,
      }
      delete metadata.providerReconciliationClaimToken
      delete metadata.providerReconciliationClaimExpiresAt
      await client.query(
        `UPDATE generation_tasks SET status = 'completed', progress = 100,
          metadata = $3::jsonb, outputs = $4::jsonb, result_url = $5, error = NULL,
          updated_at = $6::timestamptz
        WHERE id = $1 AND tenant_id = $2`,
        [
          task.id,
          task.tenantId,
          JSON.stringify(metadata),
          JSON.stringify(outputs),
          contentUrl,
          now.toISOString(),
        ],
      )
      if (selectShot && shot)
        await client.query(
          `UPDATE shots SET selected_video_task_id = $4,
        updated_at = $5::timestamptz WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
          [shot.id, task.projectId, task.tenantId, task.id, now.toISOString()],
        )
      await insertAuditLog(client, {
        tenantId: task.tenantId,
        userId: task.userId,
        actorUserId: null,
        action: 'generation.remote_result_reconciled',
        resourceType: 'generation_task',
        resourceId: task.id,
        ipAddress: null,
        userAgent: 'video-result-reconciler',
        metadata: {
          providerTaskId: claim.providerTaskId,
          reason: task.metadata.providerReconciliationReason,
          refundPreserved: true,
          shotSelected: selectShot,
          videoBytes: video.size,
          tailBytes: tail.size,
        },
      })
      return true
    })
  }
}
