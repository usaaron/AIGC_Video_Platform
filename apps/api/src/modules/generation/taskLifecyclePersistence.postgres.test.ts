import { randomUUID } from 'node:crypto'
import {
  createProjectSchema,
  videoReviewVersion,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  clearProviderCompletionContext,
  findProviderCompletionContext,
  registerProviderCompletionContext,
} from '../../core/jobs/providerCompletionContext.js'
import { releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { ProjectRepository } from '../projects/repository.js'
import { UserRepository } from '../users/repository.js'
import { GenerationTaskRepository } from './repository.js'

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

async function setup() {
  const store = new AppStore(null)
  await store.initialize()
  await new UserRepository(store, database).bootstrapFromStore()
  const project = await new ProjectRepository(store, database).create(
    createProjectSchema.parse({
      name: 'Isolated completion persistence',
      contentType: 'short-drama',
      aspectRatio: '9:16',
    }),
    principal,
  )
  const task: GenerationTask = {
    id: randomUUID(),
    clientRequestId: randomUUID(),
    projectId: project.id,
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: 'video',
    provider: 'seedance',
    model: null,
    label: 'Completion CAS',
    prompt: 'Synthetic fixture',
    negativePrompt: '',
    metadata: {
      providerName: 'dora-router-seedance',
      providerTaskId: 'provider-task-1',
      providerState: 'running',
    },
    status: 'running',
    progress: 50,
    estimatedCredits: 18,
    attempts: 1,
    maxAttempts: 3,
    leaseOwnerId: 'worker-1',
    leaseToken: 'lease-1',
    leaseAcquiredAt: '2026-01-01T00:00:00.000Z',
    leaseHeartbeatAt: '2026-01-01T00:00:00.000Z',
    leaseExpiresAt: '2030-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    resultUrl: null,
    outputs: [],
    error: null,
  }
  await store.mutate((state) => {
    state.tasks = [structuredClone(task)]
  })
  const repository = new GenerationTaskRepository(store, null, database)
  expect((await repository.importFromStore()).tasks.inserted).toBe(1)
  return { task, store, repository }
}

function completed(task: GenerationTask): GenerationTask {
  const current = structuredClone(task)
  const media = {
    view: 'single',
    storageKey: `${task.tenantId}/${task.projectId}/generated/${task.id}-video.mp4`,
    contentType: 'video/mp4',
    size: 24,
    sha256: 'a'.repeat(64),
  }
  current.status = 'completed'
  current.progress = 100
  current.updatedAt = '2026-01-01T00:00:03.000Z'
  current.resultUrl = `/api/v1/generation/tasks/${task.id}/content`
  current.outputs = [{ id: `${task.id}-video`, view: 'single', mediaType: 'video', url: current.resultUrl }]
  current.metadata = {
    ...current.metadata,
    providerState: 'completed',
    generatedOutputs: [media],
    videoStorageKey: media.storageKey,
    videoContentType: media.contentType,
    videoSize: media.size,
  }
  current.metadata.providerCompletionReceipt = {
    version: 'seqora.provider-completion.v1',
    attestation: 'server-observed-completion',
    tenantId: task.tenantId,
    projectId: task.projectId,
    taskId: task.id,
    provider: 'seedance',
    providerName: task.metadata.providerName,
    providerTaskId: task.metadata.providerTaskId,
    attempts: task.attempts,
    completedAt: current.updatedAt,
    mediaVersion: videoReviewVersion(current),
    media,
  }
  registerProviderCompletionContext(current, task.leaseOwnerId!, task.leaseToken!)
  releaseGenerationTaskLease(current)
  return current
}

function cached(store: AppStore, taskId: string) {
  return store.read((state) => state.tasks.find((task) => task.id === taskId))
}

describe('provider completion persistence CAS', () => {
  it('persists the current lease receipt and reads it back after restart and normal review', async () => {
    const { task, store, repository } = await setup()
    const completion = completed(task)
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    expect(findProviderCompletionContext(completion)).toBeNull()
    const restarted = new AppStore(null)
    await restarted.initialize()
    const recovered = new GenerationTaskRepository(restarted, null, database)
    await recovered.refreshRuntimeCacheFromDatabase()
    expect(cached(restarted, task.id)).toMatchObject({
      status: 'completed',
      leaseToken: null,
      metadata: { providerCompletionReceipt: completion.metadata.providerCompletionReceipt },
    })
    const review = await recovered.reviewVideo(
      task.id,
      { decision: 'approved', note: 'Synthetic review', expectedUpdatedAt: completion.updatedAt },
      principal,
    )
    expect(review.metadata.providerCompletionReceipt).toEqual(completion.metadata.providerCompletionReceipt)
    expect(await recovered.flushRuntimeTaskToDatabase(task.id)).toBe(true)
  })

  const conflicts = [
    ['cancelled', { status: 'cancelled', lease_owner_id: null, lease_token: null }],
    ['new attempt', { attempts: 2 }],
    ['new token in the same attempt', { lease_token: 'lease-2' }],
    ['new owner in the same attempt', { lease_owner_id: 'worker-2' }],
    ['new provider task', { providerTaskId: 'provider-task-2' }],
    ['new provider implementation', { providerName: 'stringx-seedance' }],
  ] as const
  for (const mode of ['single', 'batch'] as const) {
    it.each(conflicts)(
      `${mode} flush rejects a completion after %s and restores authoritative cache`,
      async (_name, change) => {
        const { task, store, repository } = await setup()
        const completion = completed(task)
        const row = {
          status: 'running',
          attempts: 1,
          lease_owner_id: 'worker-1',
          lease_token: 'lease-1',
          providerTaskId: task.metadata.providerTaskId,
          providerName: task.metadata.providerName,
          ...change,
        }
        await database.query(
          `UPDATE generation_tasks SET status = $2, attempts = $3, lease_owner_id = $4, lease_token = $5, metadata = metadata || $6::jsonb, updated_at = '2026-01-01T00:00:02.000Z' WHERE id = $1`,
          [
            task.id,
            row.status,
            row.attempts,
            row.lease_owner_id,
            row.lease_token,
            JSON.stringify({ providerTaskId: row.providerTaskId, providerName: row.providerName }),
          ],
        )
        await store.replaceGenerationTaskRuntimeCacheAsync([completion])
        const result =
          mode === 'single'
            ? await repository.flushRuntimeTaskToDatabase(task.id)
            : await repository.flushRuntimeTasksToDatabase([task.id])
        expect(result).toBe(mode === 'single' ? false : 0)
        const persisted = await repository.findById(task.id, principal)
        expect(persisted).toMatchObject({
          status: row.status,
          attempts: row.attempts,
          leaseOwnerId: row.lease_owner_id,
          leaseToken: row.lease_token,
          metadata: { providerTaskId: row.providerTaskId, providerName: row.providerName },
        })
        expect(persisted?.metadata.providerCompletionReceipt).toBeUndefined()
        expect(cached(store, task.id)).toEqual(persisted)
        expect(findProviderCompletionContext(completion)).toBeNull()
      },
    )
  }

  it('fails closed without the in-process source lease context', async () => {
    const { task, store, repository } = await setup()
    const completion = completed(task)
    clearProviderCompletionContext(completion)
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    expect(cached(store, task.id)).toMatchObject({ status: 'running', leaseToken: 'lease-1' })
    expect(cached(store, task.id)?.metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('rejects a malformed receipt even with the current source lease context', async () => {
    const { task, store, repository } = await setup()
    const completion = completed(task)
    clearProviderCompletionContext(completion)
    ;(completion.metadata.providerCompletionReceipt as Record<string, unknown>).taskId = 'unrelated-task'
    registerProviderCompletionContext(completion, task.leaseOwnerId!, task.leaseToken!)
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    expect(cached(store, task.id)?.metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('prevents a later receipt-free worker snapshot from erasing a committed completion', async () => {
    const { task, store, repository } = await setup()
    const completion = completed(task)
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    const stale = { ...task, updatedAt: '2026-01-01T00:00:04.000Z' }
    await store.replaceGenerationTaskRuntimeCacheAsync([stale])
    expect(await repository.flushRuntimeTasksToDatabase([task.id])).toBe(0)
    expect(cached(store, task.id)).toMatchObject({
      status: 'completed',
      metadata: { providerCompletionReceipt: completion.metadata.providerCompletionReceipt },
    })
    expect((await repository.findById(task.id, principal))?.metadata.providerCompletionReceipt).toEqual(
      completion.metadata.providerCompletionReceipt,
    )
  })

  it('retains completion authority on transaction rollback so the valid write can retry', async () => {
    const { task, store, repository } = await setup()
    const completion = completed(task)
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    const transaction = database.transaction.bind(database)
    const spy = vi.spyOn(database, 'transaction').mockImplementation((operation) =>
      transaction(async (client) => {
        await operation(client)
        throw new Error('Synthetic completion rollback')
      }),
    )
    try {
      await expect(repository.flushRuntimeTaskToDatabase(task.id)).rejects.toThrow(
        'Synthetic completion rollback',
      )
    } finally {
      spy.mockRestore()
    }
    expect((await repository.findById(task.id, principal))?.status).toBe('running')
    expect(findProviderCompletionContext(completion)).not.toBeNull()
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    expect(findProviderCompletionContext(completion)).toBeNull()
  })

  it('does not overwrite a newer cache mutation while reconciling a rejected completion', async () => {
    const { task, store, repository } = await setup()
    const completion = completed(task)
    clearProviderCompletionContext(completion)
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    const query = database.query.bind(database)
    const newer = {
      ...task,
      leaseOwnerId: 'worker-2',
      leaseToken: 'lease-2',
      updatedAt: '2026-01-01T00:00:05.000Z',
    }
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
})
