import type { AiJob, CreateAiJob, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { traceMetadata } from '../../core/observability/trace.js'
import { normalizeAiJobLifecycle } from '../../core/jobs/aiJobLease.js'

export function aiJobInsertParams(job: AiJob, membershipId: string | null): unknown[] {
  return [
    job.id,
    job.clientRequestId,
    job.projectId,
    job.tenantId,
    job.userId,
    membershipId,
    job.kind,
    job.label,
    job.provider,
    JSON.stringify(job.input),
    job.output ? JSON.stringify(job.output) : null,
    job.status,
    job.costCredits,
    job.attempts ?? 0,
    job.maxAttempts ?? null,
    job.leaseOwnerId ?? null,
    job.leaseToken ?? null,
    job.leaseAcquiredAt ?? null,
    job.leaseHeartbeatAt ?? null,
    job.leaseExpiresAt ?? null,
    job.error,
    job.refundedAt ?? null,
    job.createdAt,
    job.updatedAt,
  ]
}

export function buildQueuedAiJob(
  input: CreateAiJob,
  principal: Principal,
  now: string,
  options: { traceId?: string | null } = {},
): AiJob {
  return normalizeAiJobLifecycle({
    id: randomUUID(),
    clientRequestId: input.clientRequestId,
    projectId: input.projectId,
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: input.kind,
    label: input.label,
    provider: input.provider,
    input: traceMetadata(input.input, options.traceId),
    output: null,
    status: 'queued',
    costCredits: input.costCredits,
    maxAttempts: input.maxAttempts,
    error: null,
    refundedAt: null,
    createdAt: now,
    updatedAt: now,
  })
}
