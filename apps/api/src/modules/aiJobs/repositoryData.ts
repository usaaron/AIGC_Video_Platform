import type { AiJob } from '@seqora/contracts'
import type { QueryResultRow } from 'pg'
import { normalizeAiJobLifecycle } from '../../core/jobs/aiJobLease.js'
import type { AppState, AppStore } from '../../infra/store.js'

export type AiJobRow = QueryResultRow & {
  id: string
  client_request_id: string
  project_id: string
  tenant_id: string
  user_id: string
  kind: string
  label: string
  provider: string
  input: unknown
  output: unknown | null
  status: AiJob['status']
  cost_credits: number | string
  attempts: number | string
  max_attempts: number | string | null
  lease_owner_id: string | null
  lease_token: string | null
  lease_acquired_at: Date | string | null
  lease_heartbeat_at: Date | string | null
  lease_expires_at: Date | string | null
  error: string | null
  refunded_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

export const aiJobColumns = `
  id,
  client_request_id,
  project_id,
  tenant_id,
  user_id,
  kind,
  label,
  provider,
  input,
  output,
  status,
  cost_credits,
  attempts,
  max_attempts,
  lease_owner_id,
  lease_token,
  lease_acquired_at,
  lease_heartbeat_at,
  lease_expires_at,
  error,
  refunded_at,
  created_at,
  updated_at
`

export function jobFromRow(row: AiJobRow): AiJob {
  return normalizeAiJobLifecycle({
    id: row.id,
    clientRequestId: row.client_request_id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    kind: row.kind,
    label: row.label,
    provider: row.provider,
    input: jsonValue(row.input, {}),
    output: row.output === null ? null : jsonValue(row.output, {}),
    status: row.status,
    costCredits: Number(row.cost_credits),
    attempts: Number(row.attempts),
    maxAttempts: row.max_attempts === null ? undefined : Number(row.max_attempts),
    leaseOwnerId: row.lease_owner_id,
    leaseToken: row.lease_token,
    leaseAcquiredAt: nullableIsoString(row.lease_acquired_at),
    leaseHeartbeatAt: nullableIsoString(row.lease_heartbeat_at),
    leaseExpiresAt: nullableIsoString(row.lease_expires_at),
    error: row.error,
    refundedAt: nullableIsoString(row.refunded_at),
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  })
}

export function upsertAiJobInState(state: AppState, job: AiJob): void {
  const index = state.aiJobs.findIndex((item) => item.id === job.id)
  if (index >= 0) {
    if (Date.parse(state.aiJobs[index]!.updatedAt) > Date.parse(job.updatedAt)) return
    state.aiJobs[index] = job
  } else {
    state.aiJobs.unshift(job)
  }
}

export async function reconcileActiveAiJobs(store: AppStore, jobs: AiJob[]): Promise<void> {
  await store.mutateAiJobRuntimeCacheAsync((state) => {
    for (const job of jobs) {
      if (job.status === 'queued' || job.status === 'paused' || job.status === 'running') {
        upsertAiJobInState(state, job)
      } else {
        state.aiJobs = state.aiJobs.filter((item) => item.id !== job.id)
      }
    }
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
