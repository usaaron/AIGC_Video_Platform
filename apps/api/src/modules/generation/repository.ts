import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import { AppError } from '../../core/errors.js'
import type { OutboxRepository } from '../../core/jobs/outbox.js'
import { normalizeGenerationTaskLifecycle, releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { cancellationResourceLockForTask } from '../../core/jobs/taskResourceLock.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppState, AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { traceMetadata } from '../../core/observability/trace.js'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

type GenerationTaskRow = QueryResultRow & {
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

type GenerationTaskImportResult = {
  tasks: { inserted: number; skipped: number }
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

export class GenerationTaskRepository {
  constructor(
    private readonly store: AppStore,
    private readonly creditLedger: CreditLedger | null = null,
    private readonly database: AccountDatabase | null = null,
    private readonly outbox: OutboxRepository | null = null,
  ) {}

  async importFromStore(): Promise<GenerationTaskImportResult> {
    const result: GenerationTaskImportResult = { tasks: { inserted: 0, skipped: 0 } }
    if (!this.database) return result

    const tasks = this.store.read((state) => state.tasks)
    if (!tasks.length) return result

    await this.database.transaction(async (client) => {
      for (const task of tasks) {
        if (await insertTaskFromStore(client, task)) {
          result.tasks.inserted += 1
        } else {
          result.tasks.skipped += 1
        }
      }
    })
    await this.refreshRuntimeCacheFromDatabase()
    return result
  }

  async refreshRuntimeCacheFromDatabase(): Promise<void> {
    if (!this.database) return
    const result = await this.database.query<GenerationTaskRow>(
      `
      SELECT ${generationTaskColumns}
      FROM generation_tasks
      ORDER BY created_at DESC, id DESC
      `,
    )
    this.store.replaceGenerationTaskRuntimeCache(result.rows.map(taskFromRow))
  }

  async flushRuntimeCacheToDatabase(): Promise<number> {
    if (!this.database) return 0

    const tasks = this.store.read((state) => state.tasks.map(normalizeGenerationTaskLifecycle))
    if (!tasks.length) return 0

    return this.database.transaction(async (client) => {
      let updated = 0
      for (const task of tasks) {
        const persisted = await updateGenerationTaskLifecycle(client, task)
        if (!persisted) continue
        updated += 1
        await updateTaskResultTargets(client, persisted)
      }
      return updated
    })
  }

  canCreate(projectId: string, principal: Principal): boolean {
    return this.store.read((state) =>
      state.projects.some(
        (project) =>
          project.id === projectId &&
          project.tenantId === principal.tenantId &&
          project.ownerId === principal.userId,
      ),
    )
  }

  blockedPortraitNames(input: CreateGenerationTask, principal: Principal): string[] {
    if (input.kind !== 'video' || !Array.isArray(input.metadata?.referenceAssetIds)) return []
    const referenceIds = input.metadata.referenceAssetIds.filter(
      (value): value is string => typeof value === 'string',
    )
    return this.store.read((state) =>
      state.assets
        .filter(
          (asset) =>
            referenceIds.includes(asset.id) &&
            asset.projectId === input.projectId &&
            asset.tenantId === principal.tenantId &&
            asset.attributes.type === 'character' &&
            asset.attributes.subjectType === 'human' &&
            (asset.attributes.portraitSource === 'authorized-real' ||
              asset.attributes.visualStyle === 'photorealistic') &&
            asset.attributes.trustedPortrait?.status !== 'active',
        )
        .map((asset) => asset.name),
    )
  }

  stringXPortraitNames(input: CreateGenerationTask, principal: Principal): string[] {
    if (input.kind !== 'video' || !Array.isArray(input.metadata?.referenceAssetIds)) return []
    const referenceIds = input.metadata.referenceAssetIds.filter(
      (value): value is string => typeof value === 'string',
    )
    return this.store.read((state) =>
      state.assets
        .filter(
          (asset) =>
            referenceIds.includes(asset.id) &&
            asset.projectId === input.projectId &&
            asset.tenantId === principal.tenantId &&
            asset.attributes.type === 'character' &&
            asset.attributes.trustedPortrait?.status === 'active' &&
            asset.attributes.trustedPortrait.assetId.startsWith('maas-'),
        )
        .map((asset) => asset.name),
    )
  }

  async create(
    input: CreateGenerationTask,
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask> {
    if (this.database) return this.createInDatabase(input, principal, false, options)
    return this.createInStore(input, principal, options)
  }

  async createWithCharge(
    input: CreateGenerationTask,
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask> {
    if (this.database) return this.createInDatabase(input, principal, true, options)
    return this.createWithChargeInStore(input, principal, options)
  }

  async listByProject(projectId: string, principal: Principal): Promise<GenerationTask[]> {
    if (!this.database) return this.listByProjectFromStore(projectId, principal)

    const canReadAll = canReadAllTenantContent(principal)
    const result = await this.database.query<GenerationTaskRow>(
      `
      SELECT ${generationTaskColumns}
      FROM generation_tasks
      WHERE project_id = $1
        AND tenant_id = $2
        AND ($3::boolean OR user_id = $4)
      ORDER BY created_at DESC, id DESC
      `,
      [projectId, principal.tenantId, canReadAll, principal.userId],
    )
    return result.rows.map(taskFromRow)
  }

  filmPreviewPlan(projectId: string, principal: Principal) {
    return this.store.read((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          (item.ownerId === principal.userId || canReadAllTenantContent(principal)),
      )
      if (!project) return null
      const shots = state.shots
        .filter((shot) => shot.projectId === projectId && shot.tenantId === principal.tenantId)
        .sort((left, right) => left.order - right.order)
      const sources = shots.map((shot) => ({
        shot,
        task: state.tasks.find(
          (task) =>
            task.projectId === projectId &&
            task.tenantId === principal.tenantId &&
            task.kind === 'video' &&
            task.provider === 'seedance' &&
            task.status === 'completed' &&
            task.metadata.shotId === shot.id &&
            typeof task.metadata.providerTaskId === 'string',
        ),
      }))
      return { project, shots, sources }
    })
  }

  async findById(taskId: string, principal: Principal): Promise<GenerationTask | null> {
    if (!this.database) return this.findByIdFromStore(taskId, principal)

    const canReadAll = canReadAllTenantContent(principal)
    const result = await this.database.query<GenerationTaskRow>(
      `
      SELECT ${generationTaskColumns}
      FROM generation_tasks
      WHERE id = $1
        AND tenant_id = $2
        AND ($3::boolean OR user_id = $4)
      LIMIT 1
      `,
      [taskId, principal.tenantId, canReadAll, principal.userId],
    )
    return result.rows[0] ? taskFromRow(result.rows[0]) : null
  }

  async clearCompleted(projectId: string, principal: Principal): Promise<number> {
    if (this.database) {
      const now = new Date().toISOString()
      const result = await this.database.query<GenerationTaskRow>(
        `
        UPDATE generation_tasks
        SET metadata = metadata || jsonb_build_object('queueHiddenAt', $4::text),
            updated_at = $4::timestamptz
        WHERE project_id = $1
          AND tenant_id = $2
          AND user_id = $3
          AND status IN ('completed', 'failed', 'cancelled')
          AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
        RETURNING ${generationTaskColumns}
        `,
        [projectId, principal.tenantId, principal.userId, now],
      )
      const tasks = result.rows.map(taskFromRow)
      for (const task of tasks) {
        await this.mirrorTask(task, null)
      }
      return tasks.length
    }

    return this.store.mutate((state) => {
      const now = new Date().toISOString()
      const terminalTasks = state.tasks.filter(
        (task) =>
          task.projectId === projectId &&
          task.userId === principal.userId &&
          (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') &&
          typeof task.metadata.queueHiddenAt !== 'string',
      )
      terminalTasks.forEach((task) => {
        task.metadata = { ...task.metadata, queueHiddenAt: now }
        task.updatedAt = now
      })
      return terminalTasks.length
    })
  }

  async pause(
    taskId: string,
    principal: Principal,
  ): Promise<{
    outcome: 'not_found' | 'paused' | 'already_paused' | 'not_pausable'
    task: GenerationTask | null
  }> {
    if (this.database) {
      const result = await this.database.transaction(async (client) => {
        const task = await findControlledTaskInDatabase(client, taskId, principal)
        if (!task) return { outcome: 'not_found' as const, task: null }
        if (task.status === 'paused') return { outcome: 'already_paused' as const, task }
        if (task.status !== 'queued' || typeof task.metadata.queueHiddenAt === 'string') {
          return { outcome: 'not_pausable' as const, task }
        }
        const now = new Date().toISOString()
        task.status = 'paused'
        task.metadata = { ...task.metadata, pausedAt: now }
        releaseGenerationTaskLease(task)
        task.updatedAt = now
        const updated = await updateGenerationTaskLifecycle(client, task)
        return { outcome: 'paused' as const, task: updated ?? task }
      })
      if (result.task) await this.mirrorTask(result.task, null)
      return result
    }

    return this.store.mutate((state) => {
      const task = findControlledTask(state.tasks, taskId, principal)
      if (!task) return { outcome: 'not_found' as const, task: null }
      if (task.status === 'paused') return { outcome: 'already_paused' as const, task }
      if (task.status !== 'queued' || typeof task.metadata.queueHiddenAt === 'string') {
        return { outcome: 'not_pausable' as const, task }
      }
      const now = new Date().toISOString()
      task.status = 'paused'
      task.metadata = { ...task.metadata, pausedAt: now }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      return { outcome: 'paused' as const, task }
    })
  }

  async resume(
    taskId: string,
    principal: Principal,
  ): Promise<{ outcome: 'not_found' | 'resumed' | 'not_resumable'; task: GenerationTask | null }> {
    if (this.database) {
      const result = await this.database.transaction(async (client) => {
        const task = await findControlledTaskInDatabase(client, taskId, principal)
        if (!task) return { outcome: 'not_found' as const, task: null }
        if (task.status !== 'paused' || typeof task.metadata.queueHiddenAt === 'string') {
          return { outcome: 'not_resumable' as const, task }
        }
        const now = new Date().toISOString()
        const { pausedAt: _pausedAt, ...metadata } = task.metadata
        task.status = 'queued'
        task.progress = 0
        task.error = null
        task.metadata = { ...metadata, resumedAt: now }
        releaseGenerationTaskLease(task)
        task.updatedAt = now
        const updated = await updateGenerationTaskLifecycle(client, task)
        await this.outbox?.enqueueGenerationTaskDispatch(client, updated ?? task)
        return { outcome: 'resumed' as const, task: updated ?? task }
      })
      if (result.task) await this.mirrorTask(result.task, null)
      return result
    }

    return this.store.mutate((state) => {
      const task = findControlledTask(state.tasks, taskId, principal)
      if (!task) return { outcome: 'not_found' as const, task: null }
      if (task.status !== 'paused' || typeof task.metadata.queueHiddenAt === 'string') {
        return { outcome: 'not_resumable' as const, task }
      }
      const now = new Date().toISOString()
      const { pausedAt: _pausedAt, ...metadata } = task.metadata
      task.status = 'queued'
      task.progress = 0
      task.error = null
      task.metadata = { ...metadata, resumedAt: now }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      return { outcome: 'resumed' as const, task }
    })
  }

  async deleteFromQueue(
    taskId: string,
    principal: Principal,
  ): Promise<{
    outcome: 'not_found' | 'deleted' | 'already_deleted' | 'not_deletable'
    task: GenerationTask | null
    refund: boolean
  }> {
    if (this.database) {
      const result = await this.database.transaction(async (client) => {
        const task = await findControlledTaskInDatabase(client, taskId, principal)
        if (!task) return { outcome: 'not_found' as const, task: null, refund: false }
        if (typeof task.metadata.queueHiddenAt === 'string') {
          return { outcome: 'already_deleted' as const, task, refund: false }
        }

        const now = new Date().toISOString()
        if (task.status === 'running') {
          const lock = cancellationResourceLockForTask(task)
          task.status = 'cancelled'
          task.progress = 100
          task.error = null
          task.metadata = {
            ...task.metadata,
            cancelResourceLockKind: lock.kind,
            cancelResourceLockKey: lock.key,
            providerCancelRequestedAt: now,
            cancelledAt: now,
            deletedAt: now,
            queueHiddenAt: now,
          }
          releaseGenerationTaskLease(task)
          task.updatedAt = now
          const updated = await updateGenerationTaskLifecycle(client, task)
          return { outcome: 'deleted' as const, task: updated ?? task, refund: false }
        }

        const refund = task.status === 'queued' || task.status === 'paused'
        if (task.status === 'queued') {
          task.status = 'paused'
          task.progress = 0
          task.metadata = { ...task.metadata, pausedAt: now }
        }
        task.metadata = { ...task.metadata, queueHiddenAt: now, deletedAt: now }
        releaseGenerationTaskLease(task)
        task.updatedAt = now
        const updated = await updateGenerationTaskLifecycle(client, task)
        return { outcome: 'deleted' as const, task: updated ?? task, refund }
      })
      if (result.task) await this.mirrorTask(result.task, null)
      return result
    }

    return this.store.mutate((state) => {
      const task = findControlledTask(state.tasks, taskId, principal)
      if (!task) return { outcome: 'not_found' as const, task: null, refund: false }
      if (typeof task.metadata.queueHiddenAt === 'string') {
        return { outcome: 'already_deleted' as const, task, refund: false }
      }
      if (task.status === 'running') {
        const now = new Date().toISOString()
        const lock = cancellationResourceLockForTask(task)
        task.status = 'cancelled'
        task.progress = 100
        task.error = null
        task.metadata = {
          ...task.metadata,
          cancelResourceLockKind: lock.kind,
          cancelResourceLockKey: lock.key,
          providerCancelRequestedAt: now,
          cancelledAt: now,
          deletedAt: now,
          queueHiddenAt: now,
        }
        releaseGenerationTaskLease(task)
        task.updatedAt = now
        return { outcome: 'deleted' as const, task, refund: false }
      }
      const now = new Date().toISOString()
      const refund = task.status === 'queued' || task.status === 'paused'
      if (task.status === 'queued') {
        task.status = 'paused'
        task.progress = 0
        task.metadata = { ...task.metadata, pausedAt: now }
      }
      task.metadata = { ...task.metadata, queueHiddenAt: now, deletedAt: now }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      return { outcome: 'deleted' as const, task, refund }
    })
  }

  async cancelRunning(taskId: string, principal: Principal): Promise<GenerationTask | null> {
    return this.deleteFromQueue(taskId, principal).then((result) => result.task)
  }

  private async createInDatabase(
    input: CreateGenerationTask,
    principal: Principal,
    chargeCredits: boolean,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask> {
    const created = await this.database!.transaction(async (client) => {
      const replayed = await findTaskByClientRequest(client, input.clientRequestId, principal)
      if (replayed) {
        await this.outbox?.enqueueGenerationTaskDispatch(client, replayed)
        return { task: replayed, credits: null }
      }

      await assertNoActiveShotTask(client, input, principal)
      const membership = await resolveMembershipForTask(client, principal, chargeCredits)
      if (!membership) {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
      }

      const now = new Date().toISOString()
      const task = buildQueuedGenerationTask(input, principal, now, options)
      const inserted = await insertCreatedTask(client, task, membership.id)
      if (!inserted) {
        const existing = await findTaskByClientRequest(client, input.clientRequestId, principal)
        if (existing) {
          await this.outbox?.enqueueGenerationTaskDispatch(client, existing)
          return { task: existing, credits: null }
        }
        throw new AppError(409, 'TASK_CONFLICT', 'Generation task already exists')
      }

      if (!chargeCredits || input.estimatedCredits <= 0) {
        await this.outbox?.enqueueGenerationTaskDispatch(client, inserted)
        return { task: inserted, credits: null }
      }
      if (membership.credits === null || membership.credits < input.estimatedCredits) {
        throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
      }

      const nextCredits = membership.credits - input.estimatedCredits
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
          -input.estimatedCredits,
          nextCredits,
          input.label,
          now,
        ],
      )
      await this.outbox?.enqueueGenerationTaskDispatch(client, inserted)
      return { task: inserted, credits: nextCredits }
    })

    await this.mirrorTask(created.task, created.credits)
    return created.task
  }

  private async createInStore(
    input: CreateGenerationTask,
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask> {
    return this.store.mutate((state) => {
      const existing = state.tasks.find(
        (item) => item.clientRequestId === input.clientRequestId && item.userId === principal.userId,
      )
      if (existing) return existing

      assertNoActiveShotTaskInState(state, input, principal)
      const now = new Date().toISOString()
      const task = buildQueuedGenerationTask(input, principal, now, options)
      state.tasks.unshift(task)
      return task
    })
  }

  private async createWithChargeInStore(
    input: CreateGenerationTask,
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask> {
    const creditLedger = this.creditLedger
    return this.store.transaction(async (state) => {
      const existing = state.tasks.find(
        (item) => item.clientRequestId === input.clientRequestId && item.userId === principal.userId,
      )
      if (existing) return existing

      assertNoActiveShotTaskInState(state, input, principal)
      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')

      const now = new Date().toISOString()
      const task = buildQueuedGenerationTask(input, principal, now, options)
      if (creditLedger) {
        await creditLedger.reserveCreditsInState(
          state,
          principal,
          input.estimatedCredits,
          input.clientRequestId,
          input.label,
        )
      } else {
        if (user.credits < input.estimatedCredits) {
          throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
        }
        user.credits -= input.estimatedCredits
        state.ledger.unshift({
          id: `generation-${input.clientRequestId}`,
          userId: user.id,
          tenantId: user.tenantId,
          amount: -input.estimatedCredits,
          balance: user.credits,
          type: 'generation',
          description: input.label,
          createdAt: now,
        })
      }
      state.tasks.unshift(task)
      return task
    })
  }

  private listByProjectFromStore(projectId: string, principal: Principal): GenerationTask[] {
    const canReadAll = canReadAllTenantContent(principal)
    return this.store.read((state) =>
      state.tasks.filter(
        (task) =>
          task.projectId === projectId &&
          task.tenantId === principal.tenantId &&
          (canReadAll || task.userId === principal.userId),
      ),
    )
  }

  private findByIdFromStore(taskId: string, principal: Principal): GenerationTask | null {
    const canReadAll = canReadAllTenantContent(principal)
    return this.store.read(
      (state) =>
        state.tasks.find(
          (task) =>
            task.id === taskId &&
            task.tenantId === principal.tenantId &&
            (canReadAll || task.userId === principal.userId),
        ) ?? null,
    )
  }

  private async mirrorTask(task: GenerationTask, credits: number | null): Promise<void> {
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      upsertTaskInState(state, task)
      if (credits === null) return
      const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
      if (user) user.credits = credits
    })
  }
}

async function findTaskByClientRequest(
  queryable: Queryable,
  clientRequestId: string,
  principal: Principal,
): Promise<GenerationTask | null> {
  const result = await queryable.query<GenerationTaskRow>(
    `
    SELECT ${generationTaskColumns}
    FROM generation_tasks
    WHERE tenant_id = $1
      AND user_id = $2
      AND client_request_id = $3
    LIMIT 1
    `,
    [principal.tenantId, principal.userId, clientRequestId],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

async function findControlledTaskInDatabase(
  queryable: Queryable,
  taskId: string,
  principal: Principal,
): Promise<GenerationTask | null> {
  const result = await queryable.query<GenerationTaskRow>(
    `
    SELECT ${generationTaskColumns}
    FROM generation_tasks
    WHERE id = $1
      AND tenant_id = $2
      AND ($3::boolean OR user_id = $4)
    LIMIT 1
    FOR UPDATE
    `,
    [taskId, principal.tenantId, canReadAllTenantContent(principal), principal.userId],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

async function updateGenerationTaskLifecycle(
  queryable: Queryable,
  task: GenerationTask,
): Promise<GenerationTask | null> {
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
    ],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

async function updateTaskResultTargets(queryable: Queryable, task: GenerationTask): Promise<void> {
  if (task.kind !== 'image' || task.status !== 'completed' || !task.resultUrl) return
  const updatedAt = task.updatedAt
  const assetId = metadataString(task.metadata, 'assetId')
  if (assetId) {
    await queryable.query(
      `
      UPDATE assets
      SET image_url = $4,
          updated_at = $5
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
      `,
      [assetId, task.projectId, task.tenantId, task.resultUrl, updatedAt],
    )
  }
  const shotId = metadataString(task.metadata, 'shotId')
  if (shotId) {
    await queryable.query(
      `
      UPDATE shots
      SET image_url = $4,
          updated_at = $5
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
      `,
      [shotId, task.projectId, task.tenantId, task.resultUrl, updatedAt],
    )
  }
}

async function assertNoActiveShotTask(
  queryable: Queryable,
  input: CreateGenerationTask,
  principal: Principal,
): Promise<void> {
  const shotId = metadataString(input.metadata, 'shotId')
  if (input.kind !== 'video' || !shotId) return
  const activeTask = await queryable.query<{ id: string }>(
    `
    SELECT id
    FROM generation_tasks
    WHERE project_id = $1
      AND tenant_id = $2
      AND kind = 'video'
      AND metadata->>'shotId' = $3
      AND status IN ('queued', 'paused', 'running')
      AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
    LIMIT 1
    `,
    [input.projectId, principal.tenantId, shotId],
  )
  if (activeTask.rows[0]) throw videoShotConflict()
}

function assertNoActiveShotTaskInState(
  state: AppState,
  input: CreateGenerationTask,
  principal: Principal,
): void {
  const shotId = metadataString(input.metadata, 'shotId')
  if (input.kind !== 'video' || !shotId) return
  const activeTask = state.tasks.find(
    (item) =>
      item.projectId === input.projectId &&
      item.tenantId === principal.tenantId &&
      item.kind === 'video' &&
      item.metadata.shotId === shotId &&
      ['queued', 'paused', 'running'].includes(item.status) &&
      typeof item.metadata.queueHiddenAt !== 'string',
  )
  if (activeTask) throw videoShotConflict()
}

function videoShotConflict(): AppError {
  return new AppError(
    409,
    'VIDEO_SHOT_BATCH_CONFLICT',
    'This shot already has an active video generation task. Pause or delete it before creating another one.',
  )
}

async function resolveMembershipForTask(
  queryable: Queryable,
  principal: Principal,
  forUpdate: boolean,
): Promise<{ id: string; credits: number | null } | null> {
  const result = await queryable.query<{ id: string; credits: number | null }>(
    `
    SELECT m.id, ${forUpdate ? 'b.credits' : 'NULL::integer'} AS credits
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
  return row ? { id: row.id, credits: row.credits === null ? null : Number(row.credits) } : null
}

async function insertCreatedTask(
  client: PoolClient,
  task: GenerationTask,
  membershipId: string | null,
): Promise<GenerationTask | null> {
  const inserted = await client.query<GenerationTaskRow>(
    `
    INSERT INTO generation_tasks (
      id,
      client_request_id,
      project_id,
      tenant_id,
      user_id,
      membership_id,
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
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19,
      $20, $21, $22, $23, $24, $25, $26::jsonb, $27, $28, $29
    )
    ON CONFLICT (tenant_id, user_id, client_request_id) DO NOTHING
    RETURNING ${generationTaskColumns}
    `,
    taskInsertParams(task, membershipId),
  )
  return inserted.rows[0] ? taskFromRow(inserted.rows[0]) : null
}

async function insertTaskFromStore(client: PoolClient, task: GenerationTask): Promise<boolean> {
  const membership = await resolveMembershipForTask(
    client,
    { userId: task.userId, tenantId: task.tenantId, roles: [] },
    false,
  )
  const result = await client.query(
    `
    INSERT INTO generation_tasks (
      id,
      client_request_id,
      project_id,
      tenant_id,
      user_id,
      membership_id,
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
    )
    SELECT
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19,
      $20, $21, $22, $23, $24, $25, $26::jsonb, $27, $28, $29
    WHERE EXISTS (SELECT 1 FROM projects WHERE id = $3 AND tenant_id = $4)
      AND EXISTS (SELECT 1 FROM users WHERE id = $5)
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    taskInsertParams(normalizeGenerationTaskLifecycle(task), membership?.id ?? null),
  )
  return (result.rowCount ?? 0) > 0
}

function taskInsertParams(task: GenerationTask, membershipId: string | null): unknown[] {
  return [
    task.id,
    task.clientRequestId,
    task.projectId,
    task.tenantId,
    task.userId,
    membershipId,
    task.kind,
    task.label,
    task.prompt,
    task.negativePrompt,
    task.provider,
    task.model,
    task.tier ?? null,
    JSON.stringify(task.metadata),
    task.status,
    task.progress,
    task.estimatedCredits,
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
    task.createdAt,
    task.updatedAt,
  ]
}

function buildQueuedGenerationTask(
  input: CreateGenerationTask,
  principal: Principal,
  now: string,
  options: { traceId?: string | null } = {},
): GenerationTask {
  return normalizeGenerationTaskLifecycle({
    id: randomUUID(),
    clientRequestId: input.clientRequestId,
    projectId: input.projectId,
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: input.kind,
    label: input.label,
    prompt: input.prompt ?? '',
    negativePrompt: input.negativePrompt ?? '',
    provider: input.provider,
    model: input.model ?? null,
    tier: input.tier ?? null,
    metadata: traceMetadata(input.metadata, options.traceId),
    status: 'queued',
    progress: 0,
    estimatedCredits: input.estimatedCredits,
    maxAttempts: input.maxAttempts,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
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

function upsertTaskInState(state: AppState, task: GenerationTask): void {
  const index = state.tasks.findIndex((item) => item.id === task.id)
  if (index >= 0) {
    state.tasks[index] = task
  } else {
    state.tasks.unshift(task)
  }
}

function findControlledTask(
  tasks: GenerationTask[],
  taskId: string,
  principal: Principal,
): GenerationTask | undefined {
  const canControlAll = canReadAllTenantContent(principal)
  return tasks.find(
    (task) =>
      task.id === taskId &&
      task.tenantId === principal.tenantId &&
      (canControlAll || task.userId === principal.userId),
  )
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
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
