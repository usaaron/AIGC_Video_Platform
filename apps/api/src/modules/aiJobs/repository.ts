import type { AiJob, CreateAiJob, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { QueryResult, QueryResultRow } from 'pg'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import { AppError } from '../../core/errors.js'
import { observabilityMetrics } from '../../core/observability/metrics.js'
import { traceMetadata } from '../../core/observability/trace.js'
import type { OutboxRepository } from '../../core/jobs/outbox.js'
import {
  DEFAULT_AI_JOB_MAX_ATTEMPTS,
  aiJobLeaseActive,
  aiJobLeaseMatches,
  claimAiJobLease,
  normalizeAiJobLifecycle,
  releaseAiJobLease,
  renewAiJobLease,
} from '../../core/jobs/aiJobLease.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppState, AppStore } from '../../infra/store.js'
import { RuntimeCacheCoordinator } from '../../runtime/runtimeCacheCoordinator.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import {
  aiJobColumns,
  type AiJobRow,
  jobFromRow,
  reconcileActiveAiJobs,
  upsertAiJobInState,
} from './repositoryData.js'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

type AiJobBillingTarget = {
  id: string
  credits: number | null
  billingScope: 'membership' | 'organization'
}

type AiJobRuntimeCacheOptions = {
  activeOnly?: boolean
}

export class AiJobRepository {
  private readonly runtimeCache: RuntimeCacheCoordinator<AiJob, AiJobRow>

  constructor(
    private readonly store: AppStore,
    private readonly creditLedger: CreditLedger | null = null,
    private readonly database: AccountDatabase | null = null,
    private readonly outbox: OutboxRepository | null = null,
  ) {
    this.runtimeCache = new RuntimeCacheCoordinator(database, {
      allQuery: `
        SELECT ${aiJobColumns}, updated_at::text AS runtime_sync_updated_at
        FROM ai_jobs
        ORDER BY created_at DESC, id DESC
      `,
      activeLoader: () => this.loadActiveJobsFromDatabase(),
      cursorQuery: `
        SELECT id, updated_at::text AS runtime_sync_updated_at
        FROM ai_jobs
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      deltaQuery: `
        SELECT ${aiJobColumns}, updated_at::text AS runtime_sync_updated_at
        FROM ai_jobs
        WHERE updated_at > $1::timestamptz
           OR (updated_at = $1::timestamptz AND id > $2)
        ORDER BY updated_at ASC, id ASC
        LIMIT $3
      `,
      sameTimestampQuery: `
        SELECT ${aiJobColumns}, updated_at::text AS runtime_sync_updated_at
        FROM ai_jobs
        WHERE updated_at = $1::timestamptz
        ORDER BY id ASC
        LIMIT $2
      `,
      rowToItem: jobFromRow,
      itemKey: (job) => job.id,
      replace: (jobs) => this.store.replaceAiJobRuntimeCacheAsync(jobs),
      merge: (jobs) => this.mirrorJobs(jobs),
      reconcileActive: (jobs) => reconcileActiveAiJobs(this.store, jobs),
    })
  }

  async refreshRuntimeCacheFromDatabase(options: AiJobRuntimeCacheOptions = {}): Promise<AiJob[]> {
    if (!this.database) return this.store.read((state) => state.aiJobs)
    return this.runtimeCache.refresh(options.activeOnly === true)
  }

  async refreshRuntimeCacheDeltaFromDatabase(): Promise<void> {
    await this.runtimeCache.refreshDelta()
  }

  async createWithCharge(
    input: CreateAiJob,
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<AiJob> {
    if (this.database) return this.createInDatabase(input, principal, true, options)
    return this.createWithChargeInStore(input, principal, options)
  }

  async listByProject(projectId: string, principal: Principal): Promise<AiJob[]> {
    if (!this.database) return this.listByProjectFromStore(projectId, principal)

    const canReadAll = canReadAllTenantContent(principal)
    const result = await this.database.query<AiJobRow>(
      `
      SELECT ${aiJobColumns}
      FROM ai_jobs
      WHERE project_id = $1
        AND tenant_id = $2
        AND ($3::boolean OR user_id = $4)
      ORDER BY created_at DESC, id DESC
      `,
      [projectId, principal.tenantId, canReadAll, principal.userId],
    )
    return result.rows.map(jobFromRow)
  }

  async findById(jobId: string, principal: Principal): Promise<AiJob | null> {
    if (!this.database) return this.findByIdFromStore(jobId, principal)

    const canReadAll = canReadAllTenantContent(principal)
    const result = await this.database.query<AiJobRow>(
      `
      SELECT ${aiJobColumns}
      FROM ai_jobs
      WHERE id = $1
        AND tenant_id = $2
        AND ($3::boolean OR user_id = $4)
      LIMIT 1
      `,
      [jobId, principal.tenantId, canReadAll, principal.userId],
    )
    return result.rows[0] ? jobFromRow(result.rows[0]) : null
  }

  async claimReadyJobs(options: { ownerId: string; leaseTtlMs: number; limit: number }): Promise<AiJob[]> {
    if (this.database) return this.claimReadyJobsInDatabase(options)

    return this.store.mutate((state) => {
      const now = new Date()
      const nowIso = now.toISOString()
      const claimed: AiJob[] = []
      const orderedJobs = state.aiJobs
        .filter((job) => job.status === 'queued' || job.status === 'running')
        .sort((left, right) => {
          const createdAt = left.createdAt.localeCompare(right.createdAt)
          if (createdAt !== 0) return createdAt
          return left.id.localeCompare(right.id)
        })

      for (const job of orderedJobs) {
        if (claimed.length >= options.limit) break
        if (job.status === 'running' && aiJobLeaseActive(job, now.getTime())) continue
        if ((job.attempts ?? 0) >= (job.maxAttempts ?? DEFAULT_AI_JOB_MAX_ATTEMPTS)) {
          job.status = 'failed'
          job.error = 'AI job exceeded maximum attempts; create a new job or retry later'
          releaseAiJobLease(job)
          job.updatedAt = nowIso
          continue
        }
        claimAiJobLease(job, options.ownerId, options.leaseTtlMs, now, {
          countAttempt: job.status !== 'running',
        })
        job.error = null
        job.updatedAt = nowIso
        claimed.push(job)
      }
      return claimed
    })
  }

  async renewLease(jobId: string, ownerId: string, leaseToken: string, leaseTtlMs: number): Promise<void> {
    if (this.database) {
      const now = new Date()
      const nowIso = now.toISOString()
      const leaseExpiresAt = new Date(now.getTime() + leaseTtlMs).toISOString()
      const result = await this.database.query<AiJobRow>(
        `
        UPDATE ai_jobs
        SET lease_heartbeat_at = $4,
            lease_expires_at = $5,
            updated_at = $4
        WHERE id = $1
          AND status = 'running'
          AND lease_owner_id = $2
          AND lease_token = $3
        RETURNING ${aiJobColumns}
        `,
        [jobId, ownerId, leaseToken, nowIso, leaseExpiresAt],
      )
      const job = result.rows[0] ? jobFromRow(result.rows[0]) : null
      if (job) await this.mirrorJob(job, null)
      return
    }

    await this.store.mutate((state) => {
      const job = state.aiJobs.find((item) => item.id === jobId)
      if (!job || job.status !== 'running') return
      if (!renewAiJobLease(job, ownerId, leaseToken, leaseTtlMs)) return
      job.updatedAt = new Date().toISOString()
    })
  }

  async complete(
    jobId: string,
    ownerId: string,
    leaseToken: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    if (this.database) {
      const now = new Date().toISOString()
      const result = await this.database.query<AiJobRow>(
        `
        UPDATE ai_jobs
        SET status = 'completed',
            output = $4::jsonb,
            error = NULL,
            lease_owner_id = NULL,
            lease_token = NULL,
            lease_acquired_at = NULL,
            lease_heartbeat_at = NULL,
            lease_expires_at = NULL,
            updated_at = $5
        WHERE id = $1
          AND status = 'running'
          AND lease_owner_id = $2
          AND lease_token = $3
        RETURNING ${aiJobColumns}
        `,
        [jobId, ownerId, leaseToken, JSON.stringify(output), now],
      )
      const job = result.rows[0] ? jobFromRow(result.rows[0]) : null
      if (job) await this.mirrorJob(job, null)
      return
    }

    await this.store.mutate((state) => {
      const job = state.aiJobs.find((item) => item.id === jobId)
      if (!job || job.status !== 'running') return
      if (!aiJobLeaseMatches(job, ownerId, leaseToken)) return
      const now = new Date().toISOString()
      job.status = 'completed'
      job.output = output
      job.error = null
      releaseAiJobLease(job)
      job.updatedAt = now
    })
  }

  async fail(jobId: string, ownerId: string, leaseToken: string, error: string): Promise<void> {
    if (this.database) {
      const now = new Date().toISOString()
      const result = await this.database.query<AiJobRow>(
        `
        UPDATE ai_jobs
        SET status = 'failed',
            error = $4,
            lease_owner_id = NULL,
            lease_token = NULL,
            lease_acquired_at = NULL,
            lease_heartbeat_at = NULL,
            lease_expires_at = NULL,
            updated_at = $5
        WHERE id = $1
          AND status = 'running'
          AND lease_owner_id = $2
          AND lease_token = $3
        RETURNING ${aiJobColumns}
        `,
        [jobId, ownerId, leaseToken, error.slice(0, 1_000), now],
      )
      const job = result.rows[0] ? jobFromRow(result.rows[0]) : null
      if (job) await this.mirrorJob(job, null)
      await this.refundTerminalJobs()
      return
    }

    await this.store.mutate((state) => {
      const job = state.aiJobs.find((item) => item.id === jobId)
      if (!job || job.status !== 'running') return
      if (!aiJobLeaseMatches(job, ownerId, leaseToken)) return
      const now = new Date().toISOString()
      job.status = 'failed'
      job.error = error.slice(0, 1_000)
      releaseAiJobLease(job)
      job.updatedAt = now
    })
    await this.refundTerminalJobs()
  }

  async refundTerminalJobs(): Promise<void> {
    if (this.database) {
      await this.refundTerminalJobsInDatabase()
      return
    }

    const creditLedger = this.creditLedger
    await this.store.mutate(async (state) => {
      for (const job of state.aiJobs) {
        if (!canRefundJob(job)) continue
        const description = refundDescription(job)
        if (creditLedger) {
          await creditLedger.refundReservationInState(
            state,
            { userId: job.userId, tenantId: job.tenantId, roles: [] },
            job.clientRequestId,
            description,
          )
        } else {
          const amount = refundJobInState(state, job, description)
          if (amount !== null) {
            observabilityMetrics.recordRefund({ tenantId: job.tenantId, amount })
          }
        }
        job.refundedAt = new Date().toISOString()
      }
    })
  }

  private async claimReadyJobsInDatabase(options: {
    ownerId: string
    leaseTtlMs: number
    limit: number
  }): Promise<AiJob[]> {
    if (options.limit <= 0) return []

    const updatedJobs = await this.database!.transaction(async (client) => {
      const result = await client.query<AiJobRow>(
        `
        SELECT ${aiJobColumns}
        FROM ai_jobs
        WHERE status IN ('queued', 'running')
          AND (
            status = 'queued'
            OR lease_expires_at IS NULL
            OR lease_expires_at <= now()
          )
        ORDER BY created_at ASC, id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
        `,
        [options.limit],
      )

      const claimed: AiJob[] = []
      const changed: AiJob[] = []
      const now = new Date()
      const nowIso = now.toISOString()

      for (const row of result.rows) {
        const job = jobFromRow(row)
        if ((job.attempts ?? 0) >= (job.maxAttempts ?? DEFAULT_AI_JOB_MAX_ATTEMPTS)) {
          job.status = 'failed'
          job.error = 'AI job exceeded maximum attempts; create a new job or retry later'
          releaseAiJobLease(job)
          job.updatedAt = nowIso
          const failed = await updateAiJobLifecycle(client, job)
          if (failed) changed.push(failed)
          continue
        }

        claimAiJobLease(job, options.ownerId, options.leaseTtlMs, now, {
          countAttempt: job.status !== 'running',
        })
        job.error = null
        job.updatedAt = nowIso
        const claimedJob = await updateAiJobLifecycle(client, job)
        if (!claimedJob) continue
        claimed.push(claimedJob)
        changed.push(claimedJob)
      }

      return { claimed, changed }
    })

    for (const job of updatedJobs.changed) {
      await this.mirrorJob(job, null)
    }
    return updatedJobs.claimed
  }

  private async refundTerminalJobsInDatabase(): Promise<void> {
    const refunded = await this.database!.transaction(async (client) => {
      const result = await client.query<AiJobRow>(
        `
        SELECT ${aiJobColumns}
        FROM ai_jobs
        WHERE status = 'failed'
          AND cost_credits > 0
          AND refunded_at IS NULL
        ORDER BY updated_at ASC, id ASC
        LIMIT 50
        FOR UPDATE SKIP LOCKED
        `,
      )

      const updated: AiJob[] = []
      for (const row of result.rows) {
        const job = jobFromRow(row)
        const refundAmount = await refundAiJobCredits(client, job, refundDescription(job))
        const now = new Date().toISOString()
        const marked = await client.query<AiJobRow>(
          `
          UPDATE ai_jobs
          SET refunded_at = $2,
              updated_at = $2
          WHERE id = $1
            AND refunded_at IS NULL
          RETURNING ${aiJobColumns}
          `,
          [job.id, now],
        )
        if (marked.rows[0]) {
          if (refundAmount !== null) {
            observabilityMetrics.recordRefund({ tenantId: job.tenantId, amount: refundAmount })
          }
          updated.push(jobFromRow(marked.rows[0]))
        }
      }
      return updated
    })

    for (const job of refunded) {
      await this.mirrorJob(job, null)
    }
  }

  private async createInDatabase(
    input: CreateAiJob,
    principal: Principal,
    chargeCredits: boolean,
    options: { traceId?: string | null } = {},
  ): Promise<AiJob> {
    const created = await this.database!.transaction(async (client) => {
      const replayed = await findJobByClientRequest(client, input.clientRequestId, principal)
      if (replayed) {
        await this.outbox?.enqueueAiJobDispatch(client, replayed)
        return { job: replayed, credits: null }
      }

      const membership = await resolveMembershipForJob(client, principal, chargeCredits)
      if (!membership) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')

      const now = new Date().toISOString()
      const job = buildQueuedAiJob(input, principal, now, options)
      const inserted = await insertCreatedJob(client, job, membership.id)
      if (!inserted) {
        const existing = await findJobByClientRequest(client, input.clientRequestId, principal)
        if (existing) {
          await this.outbox?.enqueueAiJobDispatch(client, existing)
          return { job: existing, credits: null }
        }
        throw new AppError(409, 'AI_JOB_CONFLICT', 'AI job already exists')
      }

      if (!chargeCredits || input.costCredits <= 0) {
        await this.outbox?.enqueueAiJobDispatch(client, inserted)
        return { job: inserted, credits: null }
      }
      if (membership.credits === null || membership.credits < input.costCredits) {
        throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
      }

      const nextCredits = membership.credits - input.costCredits
      if (membership.billingScope === 'organization') {
        await client.query(
          `
          UPDATE organization_billing_accounts
          SET credits = $2,
              updated_at = now()
          WHERE tenant_id = $1
          `,
          [principal.tenantId, nextCredits],
        )
        await client.query(
          `
          INSERT INTO organization_billing_ledger_entries (
            id,
            tenant_id,
            user_id,
            membership_id,
            reference_id,
            related_entry_id,
            entry_type,
            amount,
            balance,
            description,
            created_by_user_id,
            created_at,
            updated_at,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, NULL, 'generation', $6, $7, $8, $3, $9, $9, '{}'::jsonb)
          `,
          [
            `generation-${input.clientRequestId}`,
            principal.tenantId,
            principal.userId,
            membership.id,
            input.clientRequestId,
            -input.costCredits,
            nextCredits,
            input.label,
            now,
          ],
        )
      } else {
        await client.query(
          `
          UPDATE billing_accounts
          SET credits = $2,
              updated_at = now()
          WHERE membership_id = $1
          `,
          [membership.id, nextCredits],
        )
        await client.query(
          `
          INSERT INTO billing_ledger_entries (
            id,
            tenant_id,
            user_id,
            membership_id,
            reference_id,
            related_entry_id,
            entry_type,
            amount,
            balance,
            description,
            created_by_user_id,
            created_at,
            updated_at,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, NULL, 'generation', $6, $7, $8, $3, $9, $9, '{}'::jsonb)
          `,
          [
            `generation-${input.clientRequestId}`,
            principal.tenantId,
            principal.userId,
            membership.id,
            input.clientRequestId,
            -input.costCredits,
            nextCredits,
            input.label,
            now,
          ],
        )
      }
      await this.outbox?.enqueueAiJobDispatch(client, inserted)
      return { job: inserted, credits: membership.billingScope === 'organization' ? null : nextCredits }
    })

    await this.mirrorJob(created.job, created.credits)
    return created.job
  }

  private async createWithChargeInStore(
    input: CreateAiJob,
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<AiJob> {
    const creditLedger = this.creditLedger
    return this.store.transaction(async (state) => {
      const existing = state.aiJobs.find(
        (item) => item.clientRequestId === input.clientRequestId && item.userId === principal.userId,
      )
      if (existing) return existing

      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')

      const now = new Date().toISOString()
      const job = buildQueuedAiJob(input, principal, now, options)
      if (input.costCredits <= 0) {
        state.aiJobs.unshift(job)
        return job
      }
      if (creditLedger) {
        await creditLedger.reserveCreditsInState(
          state,
          principal,
          input.costCredits,
          input.clientRequestId,
          input.label,
        )
      } else {
        if (user.credits < input.costCredits) {
          throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
        }
        user.credits -= input.costCredits
        state.ledger.unshift({
          id: `generation-${input.clientRequestId}`,
          userId: user.id,
          tenantId: user.tenantId,
          amount: -input.costCredits,
          balance: user.credits,
          type: 'generation',
          description: input.label,
          createdAt: now,
        })
      }
      state.aiJobs.unshift(job)
      return job
    })
  }

  private listByProjectFromStore(projectId: string, principal: Principal): AiJob[] {
    const canReadAll = canReadAllTenantContent(principal)
    return this.store.read((state) =>
      state.aiJobs.filter(
        (job) =>
          job.projectId === projectId &&
          job.tenantId === principal.tenantId &&
          (canReadAll || job.userId === principal.userId),
      ),
    )
  }

  private findByIdFromStore(jobId: string, principal: Principal): AiJob | null {
    const canReadAll = canReadAllTenantContent(principal)
    return this.store.read(
      (state) =>
        state.aiJobs.find(
          (job) =>
            job.id === jobId &&
            job.tenantId === principal.tenantId &&
            (canReadAll || job.userId === principal.userId),
        ) ?? null,
    )
  }

  private async mirrorJob(job: AiJob, credits: number | null): Promise<void> {
    await this.store.mutateRuntimeCachesAsync(
      (state) => {
        upsertAiJobInState(state, job)
        if (credits === null) return
        const user = state.users.find((item) => item.id === job.userId && item.tenantId === job.tenantId)
        if (user) user.credits = credits
      },
      credits === null ? ['aiJobs'] : ['aiJobs', 'account'],
    )
  }

  private async mirrorJobs(jobs: AiJob[]): Promise<void> {
    if (!jobs.length) return
    await this.store.mutateAiJobRuntimeCacheAsync((state) => {
      for (const job of jobs) upsertAiJobInState(state, job)
    })
  }

  private async loadActiveJobsFromDatabase(): Promise<AiJob[]> {
    const result = await this.database!.query<AiJobRow>(
      `
      SELECT ${aiJobColumns}
      FROM ai_jobs
      WHERE status IN ('queued', 'paused', 'running')
      ORDER BY created_at ASC, id ASC
      `,
    )
    return result.rows.map(jobFromRow)
  }
}

async function findJobByClientRequest(
  queryable: Queryable,
  clientRequestId: string,
  principal: Principal,
): Promise<AiJob | null> {
  const result = await queryable.query<AiJobRow>(
    `
    SELECT ${aiJobColumns}
    FROM ai_jobs
    WHERE tenant_id = $1
      AND user_id = $2
      AND client_request_id = $3
    LIMIT 1
    `,
    [principal.tenantId, principal.userId, clientRequestId],
  )
  return result.rows[0] ? jobFromRow(result.rows[0]) : null
}

async function resolveMembershipForJob(
  queryable: Queryable,
  principal: Principal,
  forUpdate: boolean,
): Promise<AiJobBillingTarget | null> {
  const result = await queryable.query<{
    id: string
    credits: number | null
    organization_type: string | null
    roles: string[]
  }>(
    `
    SELECT
      m.id,
      ${forUpdate ? 'b.credits' : 'NULL::integer'} AS credits,
      t.organization_type,
      m.roles
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
    JOIN billing_accounts b ON b.membership_id = m.id
    WHERE m.user_id = $1
      AND m.tenant_id = $2
      AND m.status = 'active'
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF b' : ''}
    `,
    [principal.userId, principal.tenantId],
  )
  const row = result.rows[0]
  if (!row) return null

  const usesOrganizationPool =
    row.organization_type === 'enterprise' &&
    (row.roles.includes('organization_admin') || row.roles.includes('organization_member'))
  if (!forUpdate || !usesOrganizationPool) {
    return {
      id: row.id,
      credits: row.credits === null ? null : Number(row.credits),
      billingScope: 'membership',
    }
  }

  await queryable.query(
    `
    INSERT INTO organization_billing_accounts (tenant_id, credits, created_at, updated_at)
    VALUES ($1, 0, now(), now())
    ON CONFLICT (tenant_id) DO NOTHING
    `,
    [principal.tenantId],
  )
  const organizationAccount = await queryable.query<{ credits: number | string }>(
    `
    SELECT credits
    FROM organization_billing_accounts
    WHERE tenant_id = $1
    LIMIT 1
    FOR UPDATE
    `,
    [principal.tenantId],
  )
  const organizationCredits = organizationAccount.rows[0]?.credits
  if (organizationCredits === undefined) return null
  return {
    id: row.id,
    credits: Number(organizationCredits),
    billingScope: 'organization',
  }
}

async function insertCreatedJob(
  queryable: Queryable,
  job: AiJob,
  membershipId: string,
): Promise<AiJob | null> {
  const inserted = await queryable.query<AiJobRow>(
    `
    INSERT INTO ai_jobs (
      id,
      client_request_id,
      project_id,
      tenant_id,
      user_id,
      membership_id,
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
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12,
      $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
    )
    ON CONFLICT (tenant_id, user_id, client_request_id) DO NOTHING
    RETURNING ${aiJobColumns}
    `,
    aiJobInsertParams(job, membershipId),
  )
  return inserted.rows[0] ? jobFromRow(inserted.rows[0]) : null
}

async function updateAiJobLifecycle(queryable: Queryable, job: AiJob): Promise<AiJob | null> {
  const result = await queryable.query<AiJobRow>(
    `
    UPDATE ai_jobs
    SET output = $2::jsonb,
        status = $3,
        attempts = $4,
        max_attempts = $5,
        lease_owner_id = $6,
        lease_token = $7,
        lease_acquired_at = $8,
        lease_heartbeat_at = $9,
        lease_expires_at = $10,
        error = $11,
        refunded_at = $12,
        updated_at = $13
    WHERE id = $1
    RETURNING ${aiJobColumns}
    `,
    [
      job.id,
      job.output ? JSON.stringify(job.output) : null,
      job.status,
      job.attempts ?? 0,
      job.maxAttempts ?? null,
      job.leaseOwnerId ?? null,
      job.leaseToken ?? null,
      job.leaseAcquiredAt ?? null,
      job.leaseHeartbeatAt ?? null,
      job.leaseExpiresAt ?? null,
      job.error,
      job.refundedAt ?? null,
      job.updatedAt,
    ],
  )
  return result.rows[0] ? jobFromRow(result.rows[0]) : null
}

async function refundAiJobCredits(
  queryable: Queryable,
  job: AiJob,
  description: string,
): Promise<number | null> {
  const debitId = `generation-${job.clientRequestId}`
  const refundId = `refund-${job.clientRequestId}`
  const organizationDebit = await queryable.query<{
    id: string
    membership_id: string | null
    amount: number | string
  }>(
    `
    SELECT id, membership_id, amount
    FROM organization_billing_ledger_entries
    WHERE id = $1
      AND user_id = $2
      AND tenant_id = $3
    LIMIT 1
    FOR UPDATE
    `,
    [debitId, job.userId, job.tenantId],
  )
  const originalOrganizationDebit = organizationDebit.rows[0]
  if (originalOrganizationDebit) {
    const existingOrganizationRefund = await queryable.query<{ id: string }>(
      `
      SELECT id
      FROM organization_billing_ledger_entries
      WHERE (id = $1 OR reference_id = $1)
        AND tenant_id = $2
      LIMIT 1
      `,
      [refundId, job.tenantId],
    )
    if (existingOrganizationRefund.rows[0]) return null

    const amount = Math.abs(Number(originalOrganizationDebit.amount))
    if (amount <= 0) return null

    const account = await queryable.query<{ credits: number | string }>(
      `
      SELECT credits
      FROM organization_billing_accounts
      WHERE tenant_id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [job.tenantId],
    )
    const current = account.rows[0]
    if (!current) return null

    const nextCredits = Number(current.credits) + amount
    const now = new Date().toISOString()
    await queryable.query(
      `
      UPDATE organization_billing_accounts
      SET credits = $2,
          updated_at = $3
      WHERE tenant_id = $1
      `,
      [job.tenantId, nextCredits, now],
    )
    await queryable.query(
      `
      INSERT INTO organization_billing_ledger_entries (
        id,
        tenant_id,
        user_id,
        membership_id,
        reference_id,
        related_entry_id,
        entry_type,
        amount,
        balance,
        description,
        created_by_user_id,
        created_at,
        updated_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $1, $5, 'adjustment', $6, $7, $8, $3, $9, $9, '{}'::jsonb)
      ON CONFLICT DO NOTHING
      `,
      [
        refundId,
        job.tenantId,
        job.userId,
        originalOrganizationDebit.membership_id,
        originalOrganizationDebit.id,
        amount,
        nextCredits,
        description,
        now,
      ],
    )
    return amount
  }

  const debit = await queryable.query<{
    id: string
    membership_id: string
    amount: number | string
  }>(
    `
    SELECT id, membership_id, amount
    FROM billing_ledger_entries
    WHERE id = $1
      AND user_id = $2
      AND tenant_id = $3
    LIMIT 1
    FOR UPDATE
    `,
    [debitId, job.userId, job.tenantId],
  )
  const original = debit.rows[0]
  if (!original) return null

  const existingRefund = await queryable.query<{ id: string }>(
    `
    SELECT id
    FROM billing_ledger_entries
    WHERE (id = $1 OR reference_id = $1)
      AND user_id = $2
      AND tenant_id = $3
    LIMIT 1
    `,
    [refundId, job.userId, job.tenantId],
  )
  if (existingRefund.rows[0]) return null

  const amount = Math.abs(Number(original.amount))
  if (amount <= 0) return null

  const account = await queryable.query<{ credits: number | string }>(
    `
    SELECT credits
    FROM billing_accounts
    WHERE membership_id = $1
    LIMIT 1
    FOR UPDATE
    `,
    [original.membership_id],
  )
  const current = account.rows[0]
  if (!current) return null

  const nextCredits = Number(current.credits) + amount
  const now = new Date().toISOString()
  await queryable.query(
    `
    UPDATE billing_accounts
    SET credits = $2,
        updated_at = $3
    WHERE membership_id = $1
    `,
    [original.membership_id, nextCredits, now],
  )
  await queryable.query(
    `
    INSERT INTO billing_ledger_entries (
      id,
      tenant_id,
      user_id,
      membership_id,
      reference_id,
      related_entry_id,
      entry_type,
      amount,
      balance,
      description,
      created_by_user_id,
      created_at,
      updated_at,
      metadata
    )
    VALUES ($1, $2, $3, $4, $1, $5, 'adjustment', $6, $7, $8, $3, $9, $9, '{}'::jsonb)
    ON CONFLICT DO NOTHING
    `,
    [
      refundId,
      job.tenantId,
      job.userId,
      original.membership_id,
      original.id,
      amount,
      nextCredits,
      description,
      now,
    ],
  )
  return amount
}

function aiJobInsertParams(job: AiJob, membershipId: string | null): unknown[] {
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

function buildQueuedAiJob(
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

function canRefundJob(job: AiJob): boolean {
  return job.costCredits > 0 && job.status === 'failed' && !job.refundedAt
}

function refundJobInState(state: AppState, job: AiJob, description: string): number | null {
  const debitId = `generation-${job.clientRequestId}`
  const refundId = `refund-${job.clientRequestId}`
  const debit = state.ledger.find(
    (entry) => entry.id === debitId && entry.userId === job.userId && entry.tenantId === job.tenantId,
  )
  if (!debit || state.ledger.some((entry) => entry.id === refundId)) return null
  const user = state.users.find((item) => item.id === job.userId && item.tenantId === job.tenantId)
  if (!user) return null
  const amount = Math.abs(debit.amount)
  if (amount <= 0) return null
  user.credits += amount
  state.ledger.unshift({
    id: refundId,
    userId: user.id,
    tenantId: user.tenantId,
    amount,
    balance: user.credits,
    type: 'adjustment',
    description,
    createdAt: new Date().toISOString(),
  })
  return amount
}

function refundDescription(job: AiJob): string {
  return `${job.label} · 失败退款`
}
