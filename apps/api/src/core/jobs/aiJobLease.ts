import type { AiJob } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'

export const DEFAULT_AI_JOB_MAX_ATTEMPTS = 3

export type AiJobLeaseClaimOptions = {
  countAttempt?: boolean
}

export function normalizeAiJobLifecycle(job: AiJob): AiJob {
  const attempts = normalizeAttemptCount(job.attempts)
  const maxAttempts = normalizeMaxAttempts(job.maxAttempts)
  const leaseActive = job.status === 'running'
  return {
    ...job,
    attempts,
    maxAttempts,
    output: job.output ?? null,
    error: job.error ?? null,
    refundedAt: job.refundedAt ?? null,
    leaseOwnerId: leaseActive ? normalizeLeaseString(job.leaseOwnerId) : null,
    leaseToken: leaseActive ? normalizeLeaseString(job.leaseToken) : null,
    leaseAcquiredAt: leaseActive ? normalizeLeaseDate(job.leaseAcquiredAt) : null,
    leaseHeartbeatAt: leaseActive ? normalizeLeaseDate(job.leaseHeartbeatAt) : null,
    leaseExpiresAt: leaseActive ? normalizeLeaseDate(job.leaseExpiresAt) : null,
  }
}

export function claimAiJobLease(
  job: AiJob,
  ownerId: string,
  leaseTtlMs: number,
  now = new Date(),
  options: AiJobLeaseClaimOptions = {},
): string {
  const nowIso = now.toISOString()
  const token = randomUUID()
  if (job.status !== 'running') job.status = 'running'
  if (options.countAttempt !== false) job.attempts = normalizeAttemptCount(job.attempts) + 1
  job.maxAttempts = normalizeMaxAttempts(job.maxAttempts)
  job.leaseOwnerId = ownerId
  job.leaseToken = token
  job.leaseAcquiredAt = nowIso
  job.leaseHeartbeatAt = nowIso
  job.leaseExpiresAt = new Date(now.getTime() + leaseTtlMs).toISOString()
  return token
}

export function renewAiJobLease(
  job: AiJob,
  ownerId: string,
  leaseToken: string,
  leaseTtlMs: number,
  now = new Date(),
): boolean {
  if (!aiJobLeaseMatches(job, ownerId, leaseToken)) return false
  const nowIso = now.toISOString()
  job.leaseHeartbeatAt = nowIso
  job.leaseExpiresAt = new Date(now.getTime() + leaseTtlMs).toISOString()
  return true
}

export function releaseAiJobLease(job: AiJob): void {
  job.leaseOwnerId = null
  job.leaseToken = null
  job.leaseAcquiredAt = null
  job.leaseHeartbeatAt = null
  job.leaseExpiresAt = null
}

export function aiJobLeaseMatches(job: AiJob, ownerId: string, leaseToken: string): boolean {
  return job.leaseOwnerId === ownerId && job.leaseToken === leaseToken
}

export function aiJobLeaseActive(job: AiJob, now = Date.now()): boolean {
  const expiresAt = job.leaseExpiresAt ? Date.parse(job.leaseExpiresAt) : Number.NaN
  return (
    job.status === 'running' &&
    typeof job.leaseOwnerId === 'string' &&
    job.leaseOwnerId.length > 0 &&
    typeof job.leaseToken === 'string' &&
    job.leaseToken.length > 0 &&
    Number.isFinite(expiresAt) &&
    expiresAt > now
  )
}

function normalizeAttemptCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function normalizeMaxAttempts(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10
    ? value
    : DEFAULT_AI_JOB_MAX_ATTEMPTS
}

function normalizeLeaseString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeLeaseDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}
