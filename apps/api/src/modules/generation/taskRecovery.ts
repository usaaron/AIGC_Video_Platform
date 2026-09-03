import type { GenerationTask, Principal } from '@seqora/contracts'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import { normalizeGenerationTaskLifecycle, releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'

type Queryable = Pick<AccountDatabase, 'query'>

type GenerationTaskRow = {
  id: string
  client_request_id: string
  project_id: string
  tenant_id: string
  user_id: string
  kind: GenerationTask['kind']
  label: string
  prompt: string
  negative_prompt: string
  provider: string
  model: string | null
  tier: GenerationTask['tier'] | null
  metadata: unknown
  status: GenerationTask['status']
  progress: number | string
  estimated_credits: number | string
  attempts: number | string
  max_attempts: number | string | null
  lease_owner_id: string | null
  lease_token: string | null
  lease_acquired_at: Date | string | null
  lease_heartbeat_at: Date | string | null
  lease_expires_at: Date | string | null
  result_url: string | null
  outputs: unknown
  error: string | null
  created_at: Date | string
  updated_at: Date | string
}

const generationTaskColumns = `
  id,
  client_request_id,
  project_id,
  tenant_id,
  user_id,
  kind,
  label,
  prompt,
  negative_prompt,
  provider,
  model,
  tier,
  metadata,
  status,
  progress,
  estimated_credits,
  attempts,
  max_attempts,
  lease_owner_id,
  lease_token,
  lease_acquired_at,
  lease_heartbeat_at,
  lease_expires_at,
  result_url,
  outputs,
  error,
  created_at,
  updated_at
`

export async function recoverExpiredFilmPreviewTasks(
  database: Queryable | null,
  store: AppStore | null,
  principal: Principal,
  projectId: string | null,
  mirrorTasks: (tasks: GenerationTask[]) => void | Promise<void>,
): Promise<void> {
  const recoveredAt = new Date().toISOString()
  const recoveryCutoff = new Date(Date.parse(recoveredAt) - 5 * 60_000).toISOString()
  const error = '成片预览合成进程已中断，请重新合成'
  const canReadAll = canReadAllTenantContent(principal)

  if (database) {
    const result = await database.query<GenerationTaskRow>(
      `
      UPDATE generation_tasks
      SET status = 'failed',
          progress = 100,
          error = $5,
          metadata = metadata || jsonb_build_object(
            'providerState', 'failed',
            'compositionStage', 'failed',
            'compositionRecoveredAt', $6::text
          ),
          lease_owner_id = NULL,
          lease_token = NULL,
          lease_acquired_at = NULL,
          lease_heartbeat_at = NULL,
          lease_expires_at = NULL,
          updated_at = $6::timestamptz
      WHERE provider = 'local-compose'
        AND status = 'running'
        AND tenant_id = $1
        AND ($2::boolean OR user_id = $3)
        AND ($4::text IS NULL OR project_id = $4)
        AND (lease_expires_at IS NULL OR lease_expires_at <= $6::timestamptz)
        AND updated_at <= $7::timestamptz
      RETURNING ${generationTaskColumns}
      `,
      [principal.tenantId, canReadAll, principal.userId, projectId, error, recoveredAt, recoveryCutoff],
    )
    await mirrorTasks(result.rows.map(taskFromRow))
    return
  }

  if (!store) {
    throw new Error('JSON AppStore is unavailable; GenerationTaskRepository must use Postgres in runtime')
  }
  await store.mutate((state) => {
    for (const task of state.tasks) {
      if (
        task.provider !== 'local-compose' ||
        task.status !== 'running' ||
        task.tenantId !== principal.tenantId ||
        (!canReadAll && task.userId !== principal.userId) ||
        (projectId !== null && task.projectId !== projectId)
      ) {
        continue
      }
      const expiresAt = task.leaseExpiresAt ? Date.parse(task.leaseExpiresAt) : Number.NaN
      if (Number.isFinite(expiresAt) && expiresAt > Date.parse(recoveredAt)) continue
      if (Date.parse(task.updatedAt) > Date.parse(recoveryCutoff)) continue
      task.status = 'failed'
      task.progress = 100
      task.error = error
      task.metadata = {
        ...task.metadata,
        providerState: 'failed',
        compositionStage: 'failed',
        compositionRecoveredAt: recoveredAt,
      }
      releaseGenerationTaskLease(task)
      task.updatedAt = recoveredAt
    }
  })
}

function taskFromRow(row: GenerationTaskRow): GenerationTask {
  return normalizeGenerationTaskLifecycle({
    id: row.id,
    clientRequestId: row.client_request_id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    kind: row.kind,
    label: row.label,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    provider: row.provider,
    model: row.model,
    tier: row.tier ?? null,
    metadata: jsonValue(row.metadata, {}),
    status: row.status,
    progress: Number(row.progress),
    estimatedCredits: Number(row.estimated_credits),
    attempts: Number(row.attempts),
    maxAttempts: row.max_attempts === null ? undefined : Number(row.max_attempts),
    leaseOwnerId: row.lease_owner_id,
    leaseToken: row.lease_token,
    leaseAcquiredAt: nullableIsoString(row.lease_acquired_at),
    leaseHeartbeatAt: nullableIsoString(row.lease_heartbeat_at),
    leaseExpiresAt: nullableIsoString(row.lease_expires_at),
    resultUrl: row.result_url,
    outputs: jsonValue(row.outputs, []),
    error: row.error,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  })
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return structuredClone(value) as T
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function nullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : isoString(value)
}
