import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createProjectSchema, type DeliveryDownloadReceipt } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { UserRepository } from '../users/repository.js'
import { ProjectRepository } from '../projects/repository.js'
import { GenerationTaskRepository } from './repository.js'
import { DeliveryDownloadRepository } from './deliveryDownloadRepository.js'
import { downloadDraft, downloadPrincipal as principal, downloadTask } from './deliveryDownload.fixture.js'

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
      name: 'Isolated download audit',
      contentType: 'short-drama',
      aspectRatio: '9:16',
    }),
    principal,
  )
  const task = downloadTask(project.id)
  await store.mutate((state) => {
    state.tasks = [structuredClone(task)]
  })
  const repository = new GenerationTaskRepository(store, null, database)
  expect((await repository.importFromStore()).tasks.inserted).toBe(1)
  return { task, store, repository }
}

describe('formal download Postgres authorization', () => {
  it('atomically records one audit and one receipt for concurrent retries, then mirrors the current version', async () => {
    const { task, store, repository } = await setup()
    const draft = downloadDraft(task)
    const [first, second] = await Promise.all([
      repository.deliveryDownloads.authorize(task.id, principal, task.updatedAt, draft),
      repository.deliveryDownloads.authorize(task.id, principal, task.updatedAt, draft),
    ])
    expect(first).toEqual(second)
    const persisted = await repository.findById(task.id, principal)
    expect(persisted?.metadata.deliveryDownloads).toEqual([first])
    expect(persisted?.updatedAt).toBe(first.recordedTaskUpdatedAt)
    expect(
      store.read((state) => state.tasks.find((item) => item.id === task.id)?.metadata.deliveryDownloads),
    ).toEqual([first])
    const audit = await database.query(
      'SELECT action, actor_user_id, metadata FROM audit_log_entries WHERE resource_id = $1',
      [task.id],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]).toMatchObject({
      action: 'generation.delivery.download_authorized',
      actor_user_id: principal.userId,
      metadata: { receiptId: first.id, sha256: draft.sha256, sourceTaskUpdatedAt: task.updatedAt },
    })
  })

  it('prevents an older runtime cache flush from overwriting the authorization', async () => {
    const { task, store, repository } = await setup()
    const receipt = await repository.deliveryDownloads.authorize(
      task.id,
      principal,
      task.updatedAt,
      downloadDraft(task),
    )
    await store.replaceGenerationTaskRuntimeCacheAsync([task])
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    const persisted = await repository.findById(task.id, principal)
    expect(persisted?.metadata.deliveryDownloads).toEqual([receipt])
    expect(persisted?.updatedAt).toBe(receipt.recordedTaskUpdatedAt)
  })

  it('rolls back the receipt and task version when transactional audit insertion fails', async () => {
    const { task, repository } = await setup()
    const transaction = database.transaction.bind(database)
    const spy = vi.spyOn(database, 'transaction').mockImplementation((operation) =>
      transaction(async (client) => {
        const query = client.query.bind(client)
        const querySpy = vi.spyOn(client, 'query').mockImplementation((...args: unknown[]) => {
          if (typeof args[0] === 'string' && args[0].includes('INSERT INTO audit_log_entries'))
            throw new Error('Synthetic audit persistence failure')
          return Reflect.apply(query, client, args)
        })
        try {
          return await operation(client)
        } finally {
          querySpy.mockRestore()
        }
      }),
    )
    try {
      await expect(
        repository.deliveryDownloads.authorize(task.id, principal, task.updatedAt, downloadDraft(task)),
      ).rejects.toThrow('Synthetic audit persistence failure')
    } finally {
      spy.mockRestore()
    }
    const persisted = await repository.findById(task.id, principal)
    expect(persisted?.updatedAt).toBe(task.updatedAt)
    expect(persisted?.metadata.deliveryDownloads).toBeUndefined()
    expect(
      (await database.query('SELECT id FROM audit_log_entries WHERE resource_id = $1', [task.id])).rows,
    ).toEqual([])
  })

  it('checks organization ownership and a cancellation after waiting for the task lock', async () => {
    const { task, repository } = await setup()
    await expect(
      repository.deliveryDownloads.authorize(
        task.id,
        { ...principal, tenantId: 'other', roles: ['owner'] },
        task.updatedAt,
        downloadDraft(task),
      ),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' })
    const controller = new AbortController()
    let releaseLock!: () => void
    let lockAcquired!: () => void
    const lockReady = new Promise<void>((resolve) => {
      lockAcquired = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const lock = database.transaction(async (client) => {
      await client.query('SELECT id FROM generation_tasks WHERE id = $1 FOR UPDATE', [task.id])
      lockAcquired()
      await blocked
    })
    await lockReady
    const authorization = repository.deliveryDownloads.authorize(
      task.id,
      principal,
      task.updatedAt,
      downloadDraft(task),
      controller.signal,
    )
    controller.abort()
    releaseLock()
    await lock
    await expect(authorization).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_ABORTED' })
    const persisted = await repository.findById(task.id, principal)
    expect(persisted?.metadata.deliveryDownloads).toBeUndefined()
  })

  it('rejects stale state after a competing row mutation commits', async () => {
    const { task, repository } = await setup()
    await database.query(
      "UPDATE generation_tasks SET updated_at = updated_at + interval '1 millisecond' WHERE id = $1",
      [task.id],
    )
    await expect(
      repository.deliveryDownloads.authorize(task.id, principal, task.updatedAt, downloadDraft(task)),
    ).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_STALE' })
    expect(
      (await database.query('SELECT id FROM audit_log_entries WHERE resource_id = $1', [task.id])).rows,
    ).toEqual([])
  })

  it('keeps an authorized receipt available for retry after post-commit mirror failure', async () => {
    const { task, repository } = await setup()
    const failingMirror = new DeliveryDownloadRepository(null, database, async () => {
      throw new Error('Synthetic cache failure')
    })
    await expect(
      failingMirror.authorize(task.id, principal, task.updatedAt, downloadDraft(task)),
    ).rejects.toThrow('Synthetic cache failure')
    const current = (await repository.findById(task.id, principal))!
    const receipt = (current.metadata.deliveryDownloads as DeliveryDownloadReceipt[])[0]!
    const retried = await repository.deliveryDownloads.authorize(task.id, principal, current.updatedAt, {
      ...downloadDraft(current),
      sourceTaskUpdatedAt: task.updatedAt,
    })
    expect(retried).toEqual(receipt)
    expect(
      (await database.query('SELECT id FROM audit_log_entries WHERE resource_id = $1', [task.id])).rows,
    ).toHaveLength(1)
  })
})
