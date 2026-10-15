import { randomUUID } from 'node:crypto'
import { createProjectSchema, type GenerationTask, type Principal } from '@seqora/contracts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { captureTextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import {
  clearTextTaskPersistenceContext,
  findTextTaskPersistenceContext,
  registerTextTaskControlPersistenceContext,
  registerTextTaskPersistenceContext,
} from '../../core/jobs/textTaskPersistenceContext.js'
import { claimGenerationTaskLease, releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import {
  isTextTaskTerminalPending,
  markTextTaskTerminalPending,
} from '../../core/jobs/textTaskTerminalEffects.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { ProjectRepository } from '../projects/repository.js'
import { UserRepository } from '../users/repository.js'
import { GenerationTaskRepository } from './repository.js'
import { GenerationTaskRunner } from '../../core/jobs/taskDispatcher.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { usageCollector } from '../../core/observability/usage.js'
import { createScriptTaskHandler } from '../../core/jobs/scriptTaskHandler.js'
import type { ProjectService } from '../projects/service.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
let fixture: PostgresAuthFixture
let database: AccountDatabase
beforeAll(async () => {
  fixture = await startPostgresAuthFixture()
  database = new AccountDatabase(fixture.connectionString)
}, 120_000)
afterAll(async () => {
  await database?.close()
  await fixture?.close()
})

async function setup(status: 'running' | 'queued' = 'running') {
  const store = new AppStore(null)
  await store.initialize()
  await new UserRepository(store, database).bootstrapFromStore()
  const project = await new ProjectRepository(store, database).create(
    createProjectSchema.parse({
      name: 'Isolated text persistence',
      contentType: 'short-drama',
      aspectRatio: '9:16',
    }),
    principal,
  )
  const initial: GenerationTask = {
    id: randomUUID(),
    clientRequestId: randomUUID(),
    projectId: project.id,
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: 'text',
    provider: 'text',
    model: 'synthetic-model',
    tier: null,
    label: 'Text persistence',
    prompt: 'Synthetic',
    negativePrompt: '',
    metadata: { scriptOperation: 'generate', billingMode: 'prepaid' },
    status,
    progress: status === 'running' ? 30 : 0,
    estimatedCredits: 1,
    attempts: status === 'running' ? 1 : 0,
    maxAttempts: 3,
    leaseOwnerId: status === 'running' ? 'text-worker-1' : null,
    leaseToken: status === 'running' ? 'text-token-1' : null,
    leaseAcquiredAt: status === 'running' ? '2026-01-01T00:00:00.000Z' : null,
    leaseHeartbeatAt: status === 'running' ? '2026-01-01T00:00:00.000Z' : null,
    leaseExpiresAt: status === 'running' ? '2030-01-01T00:00:00.000Z' : null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    resultUrl: null,
    outputs: [],
    error: null,
  }
  await store.mutate((state) => {
    state.tasks = [structuredClone(initial)]
  })
  const repository = new GenerationTaskRepository(store, null, database)
  expect((await repository.importFromStore()).tasks.inserted).toBe(1)
  const task = (await repository.findById(initial.id, principal))!
  await store.replaceGenerationTaskRuntimeCacheAsync([task])
  return { task, store, repository }
}

function outgoing(task: GenerationTask, status: 'running' | 'completed' | 'failed' = 'completed') {
  const next = structuredClone(task)
  next.status = status
  next.progress = status === 'running' ? 75 : 100
  next.updatedAt = '2026-01-01T00:00:03.000Z'
  if (status === 'completed') next.metadata.textResult = { script: 'Synthetic generated script' }
  if (status === 'failed') next.error = 'Synthetic provider failure'
  if (status === 'running') next.metadata.textPreview = 'Synthetic preview'
  if (status !== 'running') releaseGenerationTaskLease(next)
  registerTextTaskPersistenceContext(next, captureTextTaskWriteGuard(task))
  return next
}

const cached = (store: AppStore, id: string) =>
  store.read((state) => state.tasks.find((task) => task.id === id))
const conflicts = [
  'cancelled',
  'new attempt',
  'new token',
  'new owner',
  'new operation',
  'new model',
  'new request',
  'expired lease',
] as const
async function changeCurrent(task: GenerationTask, conflict: (typeof conflicts)[number]) {
  const row = {
    status: 'running',
    attempts: 1,
    owner: task.leaseOwnerId,
    token: task.leaseToken,
    operation: 'generate',
    model: task.model,
    request: task.clientRequestId,
    expiry: task.leaseExpiresAt,
  }
  if (conflict === 'cancelled') Object.assign(row, { status: 'cancelled', owner: null, token: null })
  if (conflict === 'new attempt') row.attempts = 2
  if (conflict === 'new token') row.token = 'text-token-2'
  if (conflict === 'new owner') row.owner = 'text-worker-2'
  if (conflict === 'new operation') row.operation = 'enrich'
  if (conflict === 'new model') row.model = 'different-model'
  if (conflict === 'new request') row.request = randomUUID()
  if (conflict === 'expired lease') row.expiry = '2026-01-01T00:00:00.000Z'
  await database.query(
    "UPDATE generation_tasks SET status=$2, attempts=$3, lease_owner_id=$4, lease_token=$5, metadata=metadata || $6::jsonb, model=$7, client_request_id=$8, lease_expires_at=$9, updated_at='2026-01-01T00:00:02.000Z' WHERE id=$1",
    [
      task.id,
      row.status,
      row.attempts,
      row.owner,
      row.token,
      JSON.stringify({ scriptOperation: row.operation }),
      row.model,
      row.request,
      row.expiry,
    ],
  )
}

describe('text task runtime persistence CAS', () => {
  it.each(['running', 'completed', 'failed'] as const)(
    'persists the current worker %s snapshot and clears private authority',
    async (status) => {
      const { task, store, repository } = await setup()
      const next = outgoing(task, status)
      await store.replaceGenerationTaskRuntimeCacheAsync([next])
      expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
      expect(await repository.findById(task.id, principal)).toEqual(next)
      expect(findTextTaskPersistenceContext(next)).toBeNull()
      const restarted = new AppStore(null)
      await restarted.initialize()
      await new GenerationTaskRepository(restarted, null, database).refreshRuntimeCacheFromDatabase()
      expect(cached(restarted, task.id)).toEqual(next)
    },
  )

  for (const mode of ['single', 'batch'] as const)
    for (const status of ['running', 'completed', 'failed'] as const)
      it.each(conflicts)(
        mode + ' rejects late ' + status + ' after %s and restores cache',
        async (conflict) => {
          const { task, store, repository } = await setup()
          const next = outgoing(task, status)
          await changeCurrent(task, conflict)
          await store.replaceGenerationTaskRuntimeCacheAsync([next])
          const result =
            mode === 'single'
              ? await repository.flushRuntimeTaskToDatabase(task.id)
              : await repository.flushRuntimeTasksToDatabase([task.id])
          expect(result).toBe(mode === 'single' ? false : 0)
          const persisted = await repository.findById(task.id, principal)
          expect(cached(store, task.id)).toEqual(persisted)
          expect(persisted?.metadata.textResult).toBeUndefined()
          expect(persisted?.metadata.textPreview).toBeUndefined()
          expect(persisted?.error).toBeNull()
          expect(findTextTaskPersistenceContext(next)).toBeNull()
        },
      )

  it.each(['tenantId', 'projectId', 'userId', 'clientRequestId'] as const)(
    'rejects a worker snapshot for a different %s',
    async (field) => {
      const { task, store, repository } = await setup()
      const foreign = { ...task, [field]: randomUUID() }
      const next = outgoing(foreign)
      await store.replaceGenerationTaskRuntimeCacheAsync([next])
      expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
      expect(cached(store, task.id)).toEqual(task)
    },
  )

  it.each(['missing', 'expired', 'altered'] as const)(
    'fails closed on a %s terminal context',
    async (mode) => {
      const { task, store, repository } = await setup()
      const next = outgoing(task)
      if (mode === 'missing') clearTextTaskPersistenceContext(next)
      if (mode === 'altered') next.metadata.textResult = { script: 'Changed after authorization' }
      if (mode === 'expired') {
        const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60_000)
        try {
          expect(findTextTaskPersistenceContext(next)).toBeNull()
        } finally {
          spy.mockRestore()
        }
      }
      await store.replaceGenerationTaskRuntimeCacheAsync([next])
      expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
      expect(cached(store, task.id)).toEqual(task)
    },
  )

  it('allows idempotent completion flush but rejects changed metadata without a control context', async () => {
    const { task, store, repository } = await setup()
    const next = outgoing(task)
    await store.replaceGenerationTaskRuntimeCacheAsync([next])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    const duplicate = { ...next, updatedAt: '2026-01-01T00:00:04.000Z' }
    await store.replaceGenerationTaskRuntimeCacheAsync([duplicate])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    const altered = {
      ...duplicate,
      updatedAt: '2026-01-01T00:00:05.000Z',
      metadata: { ...duplicate.metadata, textResult: { script: 'Unauthorized replacement' } },
    }
    await store.replaceGenerationTaskRuntimeCacheAsync([altered])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    expect(cached(store, task.id)).toEqual(duplicate)
  })

  it.each(['progress', 'preview', 'heartbeat'] as const)(
    'rejects changed running %s without a private context',
    async (field) => {
      const { task, store, repository } = await setup()
      const next = structuredClone(task)
      next.updatedAt = '2026-01-01T00:00:04.000Z'
      if (field === 'progress') next.progress = 80
      if (field === 'preview') next.metadata.textPreview = 'Stale worker output'
      if (field === 'heartbeat') next.leaseHeartbeatAt = '2026-01-01T00:00:03.000Z'
      await store.replaceGenerationTaskRuntimeCacheAsync([next])
      expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
      expect(cached(store, task.id)).toEqual(task)
    },
  )

  it('preserves valid completion authority and pending effects through transaction rollback', async () => {
    const { task, store, repository } = await setup()
    const next = outgoing(task, 'failed')
    await store.replaceGenerationTaskRuntimeCacheAsync([next])
    markTextTaskTerminalPending(store, next)
    const transaction = database.transaction.bind(database)
    const spy = vi.spyOn(database, 'transaction').mockImplementation((operation) =>
      transaction(async (client) => {
        await operation(client)
        throw new Error('Synthetic text rollback')
      }),
    )
    try {
      await expect(repository.flushRuntimeTaskToDatabase(task.id)).rejects.toThrow('Synthetic text rollback')
    } finally {
      spy.mockRestore()
    }
    expect((await repository.findById(task.id, principal))?.status).toBe('running')
    expect(findTextTaskPersistenceContext(next)).not.toBeNull()
    expect(isTextTaskTerminalPending(store, next)).toBe(true)
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    expect(findTextTaskPersistenceContext(next)).toBeNull()
    expect(isTextTaskTerminalPending(store, next)).toBe(false)
  })

  it('retains a newer local cache mutation during rejected snapshot reconciliation', async () => {
    const { task, store, repository } = await setup()
    const next = outgoing(task)
    clearTextTaskPersistenceContext(next)
    await store.replaceGenerationTaskRuntimeCacheAsync([next])
    const newer = { ...task, leaseToken: 'new-local-token', updatedAt: '2026-01-01T00:00:05.000Z' }
    const query = database.query.bind(database)
    const spy = vi.spyOn(database, 'query').mockImplementation(async (...args) => {
      const result = await query(...args)
      if (args[0].includes('id = ANY')) await store.replaceGenerationTaskRuntimeCacheAsync([newer])
      return result
    })
    try {
      expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    } finally {
      spy.mockRestore()
    }
    expect(cached(store, task.id)).toEqual(newer)
  })

  it('removes a rejected task from cache if its authoritative row no longer exists', async () => {
    const { task, store, repository } = await setup()
    const next = outgoing(task)
    await database.query('DELETE FROM generation_tasks WHERE id=$1', [task.id])
    await store.replaceGenerationTaskRuntimeCacheAsync([next])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    expect(cached(store, task.id)).toBeUndefined()
  })
})

describe('text task control baseline persistence', () => {
  it('claims legacy tasks whose nullable max attempts normalizes to the default', async () => {
    const { task, store, repository } = await setup('queued')
    await database.query('UPDATE generation_tasks SET max_attempts=NULL WHERE id=$1', [task.id])
    const legacy = (await repository.findById(task.id, principal))!
    const claimed = structuredClone(legacy)
    claimGenerationTaskLease(claimed, 'claim-worker', 60_000)
    claimed.updatedAt = new Date().toISOString()
    registerTextTaskControlPersistenceContext(claimed, legacy)
    await store.replaceGenerationTaskRuntimeCacheAsync([claimed])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    expect((await repository.findById(task.id, principal))?.maxAttempts).toBe(3)
  })

  it('requires the observed queued baseline to persist a new execution lease', async () => {
    const { task, store, repository } = await setup('queued')
    const claimed = structuredClone(task)
    claimGenerationTaskLease(claimed, 'claim-worker', 60_000)
    claimed.updatedAt = new Date().toISOString()
    await store.replaceGenerationTaskRuntimeCacheAsync([claimed])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    registerTextTaskControlPersistenceContext(claimed, task)
    await store.replaceGenerationTaskRuntimeCacheAsync([claimed])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    expect((await repository.findById(task.id, principal))?.leaseToken).toBe(claimed.leaseToken)
  })

  it.each(['timestamp', 'same-time metadata', 'new lease'] as const)(
    'rejects a claim after concurrent %s',
    async (conflict) => {
      const { task, store, repository } = await setup('queued')
      const claimed = structuredClone(task)
      claimGenerationTaskLease(claimed, 'claim-worker', 60_000)
      claimed.updatedAt = new Date().toISOString()
      registerTextTaskControlPersistenceContext(claimed, task)
      if (conflict === 'timestamp')
        await database.query(
          "UPDATE generation_tasks SET updated_at='2026-01-01T00:00:02.000Z' WHERE id=$1",
          [task.id],
        )
      if (conflict === 'same-time metadata')
        await database.query('UPDATE generation_tasks SET metadata=metadata || $2::jsonb WHERE id=$1', [
          task.id,
          JSON.stringify({ pausedByAdmin: true }),
        ])
      if (conflict === 'new lease')
        await database.query(
          "UPDATE generation_tasks SET status='running', attempts=1, lease_owner_id='other-worker', lease_token='other-token' WHERE id=$1",
          [task.id],
        )
      await store.replaceGenerationTaskRuntimeCacheAsync([claimed])
      expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
      expect(cached(store, task.id)).toEqual(await repository.findById(task.id, principal))
    },
  )

  it('supports recovery against its unchanged baseline without inventing Provider evidence', async () => {
    const { task, store, repository } = await setup()
    const recovered = outgoing(task)
    clearTextTaskPersistenceContext(recovered)
    recovered.metadata.recoveredFromDraft = true
    registerTextTaskControlPersistenceContext(recovered, task)
    await store.replaceGenerationTaskRuntimeCacheAsync([recovered])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    expect(
      (await repository.findById(task.id, principal))?.metadata.providerCompletionReceipt,
    ).toBeUndefined()
  })

  it('preserves authorized user cancellation through the locked control API', async () => {
    const { task, repository } = await setup()
    const result = await repository.stopRunningWithoutRefund(task.id, principal)
    expect(result.outcome).toBe('stopped')
    expect((await repository.findById(task.id, principal))?.status).toBe('cancelled')
  })
})

describe('text preview runtime persistence', () => {
  it('persists a current running preview using its private execution identity', async () => {
    const { task, store, repository } = await setup()
    const preview = outgoing(task, 'running')
    await store.replaceGenerationTaskRuntimeCacheAsync([preview])
    expect(await repository.flushRuntimeTextPreviewToDatabase(task.id)).toBe(true)
    expect(await repository.findById(task.id, principal)).toEqual(preview)
    expect(findTextTaskPersistenceContext(preview)).toBeNull()
  })

  it.each(conflicts)('rejects a preview after %s and restores authoritative cache', async (conflict) => {
    const { task, store, repository } = await setup()
    const preview = outgoing(task, 'running')
    await changeCurrent(task, conflict)
    await store.replaceGenerationTaskRuntimeCacheAsync([preview])
    expect(await repository.flushRuntimeTextPreviewToDatabase(task.id)).toBe(false)
    expect(cached(store, task.id)).toEqual(await repository.findById(task.id, principal))
    expect(cached(store, task.id)?.metadata.textPreview).toBeUndefined()
  })

  it('does not flush a terminal task through the preview-only method', async () => {
    const { task, store, repository } = await setup()
    const completion = outgoing(task)
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    expect(await repository.flushRuntimeTextPreviewToDatabase(task.id)).toBe(false)
    expect((await repository.findById(task.id, principal))?.status).toBe('running')
    expect(cached(store, task.id)).toEqual(completion)
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
  })

  it('keeps a completion cached while a previously captured preview is being persisted', async () => {
    const { task, store, repository } = await setup()
    const preview = outgoing(task, 'running')
    const completion = outgoing(task)
    completion.updatedAt = '2026-01-01T00:00:04.000Z'
    registerTextTaskPersistenceContext(completion, captureTextTaskWriteGuard(task))
    await store.replaceGenerationTaskRuntimeCacheAsync([preview])
    const transaction = database.transaction.bind(database)
    let applied = false
    const spy = vi.spyOn(database, 'transaction').mockImplementation(async (operation) => {
      if (!applied) {
        applied = true
        await store.replaceGenerationTaskRuntimeCacheAsync([completion])
      }
      return transaction(operation)
    })
    try {
      expect(await repository.flushRuntimeTextPreviewToDatabase(task.id)).toBe(true)
    } finally {
      spy.mockRestore()
    }
    expect((await repository.findById(task.id, principal))?.status).toBe('running')
    expect(cached(store, task.id)).toEqual(completion)
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    expect((await repository.findById(task.id, principal))?.status).toBe('completed')
  })
})

describe('text runner PostgreSQL persistence pipeline', () => {
  it.each([undefined, null, 42])(
    'persists failure and refund for unsupported operation %j',
    async (operation) => {
      const { task, store, repository } = await setup('queued')
      const metadata = { ...task.metadata }
      if (operation === undefined) delete metadata.scriptOperation
      else metadata.scriptOperation = operation
      await database.query('UPDATE generation_tasks SET metadata=$2::jsonb WHERE id=$1', [
        task.id,
        JSON.stringify(metadata),
      ])
      usageCollector.resetForTests()
      const refundGeneration = vi.fn(async (candidate: GenerationTask) => {
        const persisted = await repository.findById(candidate.id, principal)
        expect(persisted?.status).toBe('failed')
        expect(persisted?.error).toBe('Unsupported text task operation')
        expect(persisted?.attempts).toBe(1)
        expect(isTextTaskTerminalPending(store, candidate)).toBe(false)
      })
      const runner = new GenerationTaskRunner(store, {
        creditLedger: { refundGeneration } as unknown as CreditLedger,
        beforeTick: async () => {
          await repository.refreshRuntimeTaskFromDatabase(task.id)
        },
        refreshTask: async (id) => {
          await repository.refreshRuntimeTaskFromDatabase(id)
        },
        persistTask: async (id) => {
          await repository.flushRuntimeTaskToDatabase(id)
        },
        persistTickTasks: async (ids) => {
          await repository.flushRuntimeTasksToDatabase(ids)
        },
        localTaskHandler: {
          canHandle: () => true,
          execute: createScriptTaskHandler(store, {} as ProjectService),
        },
      })
      try {
        await runner.tick()
        await vi.waitFor(() => expect(usageCollector.snapshot().jobConcurrency).toBe(0), {
          timeout: 5_000,
        })
        const persisted = (await repository.findById(task.id, principal))!
        expect(persisted).toMatchObject({
          status: 'failed',
          error: 'Unsupported text task operation',
          attempts: 1,
          leaseToken: null,
          leaseOwnerId: null,
        })
        expect(persisted.metadata.scriptOperation).toEqual(operation)
        expect(persisted.metadata.creditsRefundedAt).toEqual(expect.any(String))
        expect(cached(store, task.id)).toEqual(persisted)
        expect(refundGeneration).toHaveBeenCalledTimes(1)
        expect(usageCollector.snapshot()).toMatchObject({ jobCount: 1, jobFailedCount: 1 })
        expect(isTextTaskTerminalPending(store, persisted)).toBe(false)
      } finally {
        runner.stop()
      }
    },
  )

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'keeps database, cache, metrics and refunds consistent after %s',
    async (outcome) => {
      const { task, store, repository } = await setup('queued')
      usageCollector.resetForTests()
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let entered = false
      const refunds: GenerationTask[] = []
      const refundGeneration = vi.fn(async (candidate: GenerationTask) => {
        const persisted = await repository.findById(candidate.id, principal)
        expect(persisted?.status).toBe('failed')
        expect(persisted?.attempts).toBe(candidate.attempts)
        expect(persisted?.metadata.textTiming).toEqual(candidate.metadata.textTiming)
        refunds.push(candidate)
      })
      const persistTask = vi.fn(async (id: string) => {
        await repository.flushRuntimeTaskToDatabase(id)
      })
      const persistTickTasks = vi.fn(async (ids: readonly string[]) => {
        await repository.flushRuntimeTasksToDatabase(ids)
      })
      const persistTextPreview = vi.fn(async (id: string) => {
        await repository.flushRuntimeTextPreviewToDatabase(id)
      })
      const runner = new GenerationTaskRunner(store, {
        creditLedger: { refundGeneration } as unknown as CreditLedger,
        beforeTick: async () => {
          await repository.refreshRuntimeTaskFromDatabase(task.id)
        },
        refreshTask: async (id) => {
          await repository.refreshRuntimeTaskFromDatabase(id)
        },
        persistTask,
        persistTickTasks,
        persistTextPreview,
        localTaskHandler: {
          canHandle: (candidate) => candidate.id === task.id,
          execute: async (claimed, context) => {
            expect(context?.taskWriteGuard).toMatchObject({ taskId: task.id, attempts: 1 })
            const persistedClaim = await repository.findById(task.id, principal)
            expect(persistedClaim).toMatchObject({
              status: 'running',
              leaseToken: claimed.leaseToken,
              attempts: 1,
            })
            entered = true
            context?.onTextProgress?.('Synthetic running preview')
            await held
            if (outcome === 'failed') throw new Error('Synthetic runner provider failure')
            return { script: 'Synthetic runner completed script' }
          },
        },
      })
      try {
        // Exercise a claim whose timestamp is identical to the queued source row.
        // Only Date is faked, so the preview debounce and PostgreSQL remain live.
        if (outcome === 'completed') {
          const clock = new Date(Date.now() + 60_000)
          await database.query('UPDATE generation_tasks SET updated_at=$2 WHERE id=$1', [
            task.id,
            clock.toISOString(),
          ])
          vi.useFakeTimers({ toFake: ['Date'] })
          vi.setSystemTime(clock)
        }
        await runner.tick()
        await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5_000 })
        await vi.waitFor(
          async () => {
            expect((await repository.findById(task.id, principal))?.metadata.textPreview).toBe(
              'Synthetic running preview',
            )
          },
          { timeout: 5_000 },
        )
        expect(persistTextPreview).toHaveBeenCalled()
        expect(usageCollector.snapshot().jobCount).toBe(0)
        expect(refundGeneration).not.toHaveBeenCalled()
        if (outcome === 'cancelled') {
          const cancellation = await repository.deleteFromQueue(task.id, principal)
          expect(cancellation.task?.status).toBe('cancelled')
        }
        release()
        await vi.waitFor(() => expect(usageCollector.snapshot().jobConcurrency).toBe(0), { timeout: 5_000 })
        const persisted = (await repository.findById(task.id, principal))!
        const current = cached(store, task.id)!
        expect(persisted.status).toBe(outcome)
        expect(current.status).toBe(outcome)
        expect(current.attempts).toBe(1)
        expect(current.maxAttempts).toBe(3)
        expect(current.leaseToken).toBeNull()
        expect(persisted.leaseToken).toBeNull()
        expect(current.metadata.textResult).toEqual(persisted.metadata.textResult)
        expect(current.metadata.textTiming).toEqual(persisted.metadata.textTiming)
        expect(usageCollector.snapshot()).toMatchObject({
          jobCount: outcome === 'cancelled' ? 0 : 1,
          jobFailedCount: outcome === 'failed' ? 1 : 0,
        })
        expect(refunds).toHaveLength(outcome === 'failed' ? 1 : 0)
        if (outcome === 'completed')
          expect(persisted.metadata.textResult).toEqual({ script: 'Synthetic runner completed script' })
        else expect(persisted.metadata.textResult).toBeUndefined()
        expect(persistTickTasks.mock.calls[0]?.[0]).toContain(task.id)
        expect(persistTask).toHaveBeenCalled()
      } finally {
        release()
        runner.stop()
        vi.useRealTimers()
      }
    },
  )
})
