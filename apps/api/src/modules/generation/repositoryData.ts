export { projectFromRow, assetFromRow, shotFromRow } from '../projects/repositoryData.js'
export type {
  ProjectRow as GenerationProjectRow,
  AssetRow as GenerationAssetRow,
  ShotRow as GenerationShotRow,
} from '../projects/repositoryData.js'
import type { GenerationTask } from '@seqora/contracts'
import type { QueryResultRow } from 'pg'
import { normalizeGenerationTaskLifecycle } from '../../core/jobs/taskLease.js'
import type { AppState } from '../../infra/store.js'

export type GenerationTaskRow = QueryResultRow & {
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

export const generationTaskColumns = `
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

export function taskFromRow(row: GenerationTaskRow): GenerationTask {
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

export function upsertTaskInState(state: AppState, task: GenerationTask): void {
  const index = state.tasks.findIndex((item) => item.id === task.id)
  if (index >= 0) {
    if (Date.parse(state.tasks[index]!.updatedAt) > Date.parse(task.updatedAt)) return
    state.tasks[index] = task
  } else {
    state.tasks.unshift(task)
  }
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
