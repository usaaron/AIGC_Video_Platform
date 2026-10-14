import { createProjectSchema, type GenerationTask } from '@seqora/contracts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  registerProviderCompletionContext,
  findProviderCompletionContext,
  clearProviderCompletionContext,
} from '../../core/jobs/providerCompletionContext.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { ProjectRepository } from '../projects/repository.js'
import { UserRepository } from '../users/repository.js'
import { completedImage } from './imageProviderCompletion.fixture.js'
import { downloadPrincipal as principal } from './deliveryDownload.fixture.js'
import { providerCompletionEvidence } from './providerCompletionEvidence.js'
import { GenerationTaskRepository } from './repository.js'

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
      name: 'Isolated image receipt CAS',
      contentType: 'short-drama',
      aspectRatio: '9:16',
    }),
    principal,
  )
  const { task: completion } = completedImage(true, project.id)
  completion.createdAt = '2026-01-01T00:00:00.000Z'
  completion.updatedAt = '2026-01-01T00:00:03.000Z'
  const task: GenerationTask = {
    ...structuredClone(completion),
    status: 'running',
    progress: 40,
    resultUrl: null,
    outputs: [],
    leaseOwnerId: 'image-worker-1',
    leaseToken: 'image-lease-1',
    leaseAcquiredAt: '2026-01-01T00:00:00.000Z',
    leaseHeartbeatAt: '2026-01-01T00:00:00.000Z',
    leaseExpiresAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
  }
  delete task.metadata.providerCompletionReceipt
  delete task.metadata.generatedOutputs
  delete task.metadata.deliveryContract
  task.metadata.providerState = 'running'
  registerProviderCompletionContext(completion, task.leaseOwnerId!, task.leaseToken!)
  await store.mutate((state) => {
    state.tasks = [task]
  })
  const repository = new GenerationTaskRepository(store, null, database)
  expect((await repository.importFromStore()).tasks.inserted).toBe(1)
  return { task, completion, store, repository }
}
const cached = (store: AppStore, id: string) =>
  store.read((state) => state.tasks.find((task) => task.id === id))

describe('image completion lifecycle persistence CAS', () => {
  it('persists all-view completion, survives restart, and allows same-receipt later metadata updates', async () => {
    const { task, completion, store, repository } = await setup()
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    expect(findProviderCompletionContext(completion)).toBeNull()
    const restarted = new AppStore(null)
    await restarted.initialize()
    const recovered = new GenerationTaskRepository(restarted, null, database)
    await recovered.refreshRuntimeCacheFromDatabase()
    const saved = cached(restarted, task.id)!
    expect(providerCompletionEvidence(saved).reason).toBe('verified')
    expect(saved.metadata.providerCompletionReceipt).toEqual(completion.metadata.providerCompletionReceipt)
    const later = {
      ...saved,
      updatedAt: '2026-01-01T00:00:05.000Z',
      metadata: { ...saved.metadata, deliveryDownloads: [] },
    }
    await restarted.replaceGenerationTaskRuntimeCacheAsync([later])
    expect(await recovered.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    expect((await recovered.findById(task.id, principal))?.metadata.providerCompletionReceipt).toEqual(
      completion.metadata.providerCompletionReceipt,
    )
  })

  const conflicts = [
    ['cancelled', { status: 'cancelled', owner: null, token: null }],
    ['new attempt', { attempts: 2 }],
    ['new owner', { owner: 'image-worker-2' }],
    ['new token', { token: 'image-lease-2' }],
    ['new server request', { requestId: 'new-request' }],
    ['new provider adapter', { providerName: 'other-provider' }],
    ['changed requested views', { turnaround: false }],
  ] as const
  for (const mode of ['single', 'batch'] as const)
    it.each(conflicts)(
      `${mode} rejects %s before first receipt and restores DB cache`,
      async (_name, change) => {
        const { task, completion, store, repository } = await setup()
        const row = {
          status: 'running',
          attempts: 1,
          owner: task.leaseOwnerId,
          token: task.leaseToken,
          requestId: task.metadata.providerIdempotencyKey,
          providerName: task.metadata.providerName,
          turnaround: true,
          ...change,
        }
        await database.query(
          `UPDATE generation_tasks SET status=$2, attempts=$3, lease_owner_id=$4, lease_token=$5, metadata=metadata || $6::jsonb, updated_at='2026-01-01T00:00:02.000Z' WHERE id=$1`,
          [
            task.id,
            row.status,
            row.attempts,
            row.owner,
            row.token,
            JSON.stringify({
              providerIdempotencyKey: row.requestId,
              providerName: row.providerName,
              turnaround: row.turnaround,
            }),
          ],
        )
        await store.replaceGenerationTaskRuntimeCacheAsync([completion])
        expect(
          mode === 'single'
            ? await repository.flushRuntimeTaskToDatabase(task.id)
            : await repository.flushRuntimeTasksToDatabase([task.id]),
        ).toBe(mode === 'single' ? false : 0)
        const saved = await repository.findById(task.id, principal)
        expect(saved).toMatchObject({
          status: row.status,
          attempts: row.attempts,
          leaseOwnerId: row.owner,
          leaseToken: row.token,
          metadata: { providerIdempotencyKey: row.requestId, providerName: row.providerName },
        })
        expect(saved?.metadata.providerCompletionReceipt).toBeUndefined()
        expect(cached(store, task.id)).toEqual(saved)
        expect(findProviderCompletionContext(completion)).toBeNull()
      },
    )

  it('rejects a receipt lacking private original lease authority', async () => {
    const { task, completion, store, repository } = await setup()
    clearProviderCompletionContext(completion)
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    expect(cached(store, task.id)?.status).toBe('running')
  })

  it('does not persist malformed or incomplete secondary output receipt bindings', async () => {
    const { task, completion, store, repository } = await setup()
    clearProviderCompletionContext(completion)
    completion.outputs.pop()
    registerProviderCompletionContext(completion, task.leaseOwnerId!, task.leaseToken!)
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    expect(cached(store, task.id)?.metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('prevents a later receipt-free snapshot from erasing committed image provenance', async () => {
    const { task, completion, store, repository } = await setup()
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    await store.replaceGenerationTaskRuntimeCacheAsync([{ ...task, updatedAt: '2026-01-01T00:00:06.000Z' }])
    expect(await repository.flushRuntimeTasksToDatabase([task.id])).toBe(0)
    expect(cached(store, task.id)?.metadata.providerCompletionReceipt).toEqual(
      completion.metadata.providerCompletionReceipt,
    )
  })

  it('preserves private authority across a rolled-back image transaction for retry', async () => {
    const { task, completion, store, repository } = await setup()
    await store.replaceGenerationTaskRuntimeCacheAsync([completion])
    const transaction = database.transaction.bind(database)
    const spy = vi.spyOn(database, 'transaction').mockImplementation((operation) =>
      transaction(async (client) => {
        await operation(client)
        throw new Error('Synthetic image rollback')
      }),
    )
    try {
      await expect(repository.flushRuntimeTaskToDatabase(task.id)).rejects.toThrow('Synthetic image rollback')
    } finally {
      spy.mockRestore()
    }
    expect(findProviderCompletionContext(completion)).not.toBeNull()
    expect((await repository.findById(task.id, principal))?.status).toBe('running')
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    expect(findProviderCompletionContext(completion)).toBeNull()
  })
})
