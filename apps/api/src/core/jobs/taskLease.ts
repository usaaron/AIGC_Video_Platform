import type { GenerationTask } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'

export const DEFAULT_TASK_MAX_ATTEMPTS = 3

export type TaskLeaseClaimOptions = {
  countAttempt?: boolean
}

export function normalizeGenerationTaskLifecycle(task: GenerationTask): GenerationTask {
  const attempts = normalizeAttemptCount(task.attempts)
  const maxAttempts = normalizeMaxAttempts(task.maxAttempts)
  const leaseActive = task.status === 'running'
  return {
    ...task,
    attempts,
    maxAttempts,
    leaseOwnerId: leaseActive ? normalizeLeaseString(task.leaseOwnerId) : null,
    leaseToken: leaseActive ? normalizeLeaseString(task.leaseToken) : null,
    leaseAcquiredAt: leaseActive ? normalizeLeaseDate(task.leaseAcquiredAt) : null,
    leaseHeartbeatAt: leaseActive ? normalizeLeaseDate(task.leaseHeartbeatAt) : null,
    leaseExpiresAt: leaseActive ? normalizeLeaseDate(task.leaseExpiresAt) : null,
  }
}

export function claimGenerationTaskLease(
  task: GenerationTask,
  ownerId: string,
  leaseTtlMs: number,
  now = new Date(),
  options: TaskLeaseClaimOptions = {},
): string {
  const nowIso = now.toISOString()
  const token = randomUUID()
  if (task.status !== 'running') task.status = 'running'
  if (options.countAttempt !== false) task.attempts = normalizeAttemptCount(task.attempts) + 1
  task.maxAttempts = normalizeMaxAttempts(task.maxAttempts)
  task.leaseOwnerId = ownerId
  task.leaseToken = token
  task.leaseAcquiredAt = nowIso
  task.leaseHeartbeatAt = nowIso
  task.leaseExpiresAt = new Date(now.getTime() + leaseTtlMs).toISOString()
  return token
}

export function renewGenerationTaskLease(
  task: GenerationTask,
  ownerId: string,
  leaseToken: string,
  leaseTtlMs: number,
  now = new Date(),
): boolean {
  if (!generationTaskLeaseMatches(task, ownerId, leaseToken)) return false
  const nowIso = now.toISOString()
  task.leaseHeartbeatAt = nowIso
  task.leaseExpiresAt = new Date(now.getTime() + leaseTtlMs).toISOString()
  return true
}

export function releaseGenerationTaskLease(task: GenerationTask): void {
  task.leaseOwnerId = null
  task.leaseToken = null
  task.leaseAcquiredAt = null
  task.leaseHeartbeatAt = null
  task.leaseExpiresAt = null
}

export function generationTaskLeaseMatches(
  task: GenerationTask,
  ownerId: string,
  leaseToken: string,
): boolean {
  return task.leaseOwnerId === ownerId && task.leaseToken === leaseToken
}

export function generationTaskLeaseActive(task: GenerationTask, now = Date.now()): boolean {
  const expiresAt = task.leaseExpiresAt ? Date.parse(task.leaseExpiresAt) : Number.NaN
  return (
    task.status === 'running' &&
    typeof task.leaseOwnerId === 'string' &&
    task.leaseOwnerId.length > 0 &&
    typeof task.leaseToken === 'string' &&
    task.leaseToken.length > 0 &&
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
    : DEFAULT_TASK_MAX_ATTEMPTS
}

function normalizeLeaseString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeLeaseDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}
