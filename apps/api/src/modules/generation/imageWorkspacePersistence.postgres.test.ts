import { createAssetSchema, createProjectSchema, createShotSchema } from '@seqora/contracts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareImageCompletion } from '../../core/jobs/imageProviderCompletion.js'
import { imageRequestFor } from '../../core/jobs/imageTaskRequest.js'
import { claimGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { GenerationResultWriteback } from '../../core/jobs/taskWriteback.js'
import {
  clearImageWorkspaceWriteback,
  restoreRejectedImageWorkspaceWriteback,
} from '../../core/jobs/imageWorkspaceWriteback.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore, defaultAssetAttributes } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { ProjectRepository } from '../projects/repository.js'
import { UserRepository } from '../users/repository.js'
import { downloadPrincipal as principal } from './deliveryDownload.fixture.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
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

async function setup(stage: 'body' | 'turnaround' = 'body', foreignShot = false) {
  const store = new AppStore(null, undefined, true, true, true, true)
  await store.initialize()
  await new UserRepository(store, database).bootstrapFromStore()
  const projects = new ProjectRepository(store, database)
  const project = await projects.create(
    createProjectSchema.parse({
      name: 'Image workspace CAS',
      contentType: 'short-drama',
      aspectRatio: '9:16',
    }),
    principal,
  )
  const asset = (await projects.createAsset(
    project.id,
    createAssetSchema.parse({
      kind: 'character',
      sourceMode: 'generate',
      name: 'Synthetic character',
      imageUrl: '/original-asset.png',
      attributes: {
        ...defaultAssetAttributes('character'),
        faceReference: { id: 'face-before', url: '/face.png', name: 'Original face' },
        activeAppearanceVariantId: 'look-1',
        appearanceVariants: [
          {
            id: 'look-1',
            name: 'Original look',
            bodyReference: null,
            turnaroundReferences: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    }),
    principal,
  ))!
  const shot = (await projects.createShot(
    project.id,
    createShotSchema.parse({ title: 'Synthetic shot', imageUrl: '/original-shot.png' }),
    principal,
  ))!
  const task = buildQueuedGenerationTask(
    {
      clientRequestId: `workspace-${asset.id}`,
      projectId: project.id,
      kind: 'image',
      provider: 'img2',
      label: 'Synthetic image target',
      estimatedCredits: 0,
      metadata: {
        assetId: asset.id,
        shotId: shot.id,
        generationStage: stage,
        attributes: structuredClone(asset.attributes),
        turnaround: stage === 'turnaround',
        providerName: 'tokenadvent-img2',
        providerIdempotencyKey: `workspace-request-${asset.id}`,
      },
    },
    principal,
    '2026-01-01T00:00:00.000Z',
  )
  task.metadata.providerName = 'tokenadvent-img2'
  task.metadata.providerIdempotencyKey = `workspace-request-${asset.id}`
  const leaseToken = claimGenerationTaskLease(task, 'workspace-worker', 60_000)
  await store.mutateRuntimeCachesAsync(
    (state) => {
      state.tasks = [structuredClone(task)]
      state.assets = [structuredClone(asset)]
      state.shots = [{ ...structuredClone(shot), ...(foreignShot ? { tenantId: 'unrelated-tenant' } : {}) }]
    },
    ['generationTasks', 'projectWorkspace'],
  )
  const before = store.read((state) => structuredClone({ assets: state.assets, shots: state.shots }))
  const repository = new GenerationTaskRepository(store, null, database)
  await repository.importFromStore()
  await store.replaceGenerationTaskRuntimeCacheAsync([structuredClone(task)])
  const writeback = new GenerationResultWriteback(store, { put: vi.fn(), get: vi.fn(), delete: vi.fn() })
  const binding = prepareImageCompletion(task, imageRequestFor(task, []))
  const descriptors = await writeback.persistImageOutputs(
    task,
    binding.views.map((view) => ({
      view,
      contentType: 'image/png',
      content: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    })),
    binding,
  )
  const completion = structuredClone(
    (await writeback.completeImageTask(task.id, 'workspace-worker', leaseToken, descriptors))!,
  )
  expect(completion.status).toBe('completed')
  const reject = () =>
    database.query(
      `UPDATE generation_tasks SET status='cancelled', lease_owner_id=null, lease_token=null, updated_at=$2 WHERE id=$1`,
      [task.id, task.updatedAt],
    )
  return { task, completion, store, repository, before, asset, shot, reject }
}

describe('rejected image completion workspace cache recovery', () => {
  it.each(['body', 'turnaround'] as const)(
    'restores rejected %s asset, appearance and shot fields atomically with task state',
    async (stage) => {
      const { task, completion, store, repository, before, reject } = await setup(stage)
      expect(store.read((state) => state.assets[0]!.imageUrl)).toBe(completion.resultUrl)
      await reject()
      expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
      expect(store.read((state) => ({ assets: state.assets, shots: state.shots }))).toEqual(before)
      expect(store.read((state) => state.tasks[0]!.status)).toBe('cancelled')
      expect(
        (await database.query('SELECT image_url FROM assets WHERE id=$1', [before.assets[0]!.id])).rows[0]
          ?.image_url,
      ).toBe(before.assets[0]!.imageUrl)
      expect(
        (await database.query('SELECT image_url FROM shots WHERE id=$1', [before.shots[0]!.id])).rows[0]
          ?.image_url,
      ).toBe(before.shots[0]!.imageUrl)
    },
  )

  it('preserves concurrent workspace edits while reverting only unchanged image fields', async () => {
    const { task, completion, store, before, reject } = await setup()
    await store.mutateRuntimeCachesAsync(
      (state) => {
        const asset = state.assets[0]!
        asset.name = 'Edited character'
        asset.updatedAt = '2030-01-01T00:00:00.000Z'
        if (asset.attributes.type === 'character') {
          asset.attributes.appearanceVariants[0]!.name = 'Edited outfit'
          asset.attributes.appearanceVariants[0]!.updatedAt = '2030-01-01T00:00:00.000Z'
        }
        state.shots[0]!.imageUrl = '/new-selection.png'
        state.shots[0]!.selectedImageTaskId = 'newer-task'
        state.shots[0]!.updatedAt = '2030-01-01T00:00:00.000Z'
        state.tasks[0] = { ...structuredClone(task), leaseOwnerId: 'new-worker', leaseToken: 'new-token' }
      },
      ['generationTasks', 'projectWorkspace'],
    )
    await reject()
    // Persist the captured completion directly while a newer task mutation owns the cache.
    const { persistRuntimeTaskSnapshots } = await import('./taskRuntimePersistence.js')
    expect(await persistRuntimeTaskSnapshots(store, database, [{ task: structuredClone(completion) }])).toBe(
      0,
    )
    const saved = store.read((state) => ({
      asset: state.assets[0]!,
      shot: state.shots[0]!,
      task: state.tasks[0]!,
    }))
    expect(saved.asset).toMatchObject({
      name: 'Edited character',
      updatedAt: '2030-01-01T00:00:00.000Z',
      imageUrl: before.assets[0]!.imageUrl,
    })
    expect(saved.asset.attributes).toMatchObject({
      appearanceVariants: [
        { name: 'Edited outfit', bodyReference: null, updatedAt: '2030-01-01T00:00:00.000Z' },
      ],
    })
    expect(saved.shot).toMatchObject({
      imageUrl: '/new-selection.png',
      selectedImageTaskId: 'newer-task',
      updatedAt: '2030-01-01T00:00:00.000Z',
    })
    expect(saved.task.leaseToken).toBe('new-token')
  })

  it('does not overwrite a concurrently replaced appearance reference', async () => {
    const { task, store, repository, reject } = await setup()
    await store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
      const attributes = state.assets[0]!.attributes
      if (attributes.type === 'character')
        attributes.appearanceVariants[0]!.bodyReference = {
          id: 'new-body',
          url: '/new-body.png',
          name: 'New body',
        }
    })
    await reject()
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    expect(store.read((state) => state.assets[0]!.attributes)).toMatchObject({
      appearanceVariants: [{ bodyReference: { id: 'new-body', url: '/new-body.png' } }],
    })
  })

  it('retains rollback state after a transaction failure, then restores it on a rejected retry', async () => {
    const { task, completion, store, repository, before, reject } = await setup()
    const transaction = database.transaction.bind(database)
    const spy = vi.spyOn(database, 'transaction').mockImplementation((operation) =>
      transaction(async (client) => {
        await operation(client)
        throw new Error('Synthetic workspace rollback')
      }),
    )
    try {
      await expect(repository.flushRuntimeTaskToDatabase(task.id)).rejects.toThrow(
        'Synthetic workspace rollback',
      )
    } finally {
      spy.mockRestore()
    }
    expect(store.read((state) => state.assets[0]!.imageUrl)).toBe(completion.resultUrl)
    await reject()
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    expect(store.read((state) => ({ assets: state.assets, shots: state.shots }))).toEqual(before)
  })

  it('clears rollback state after commit so later rejected snapshots cannot undo confirmed results', async () => {
    const { task, completion, store, repository } = await setup()
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(true)
    const committed = store.read((state) => structuredClone({ assets: state.assets, shots: state.shots }))
    await store.mutateRuntimeCachesAsync(
      (state) => restoreRejectedImageWorkspaceWriteback(store, state, completion),
      ['projectWorkspace'],
    )
    expect(store.read((state) => ({ assets: state.assets, shots: state.shots }))).toEqual(committed)
  })

  it('does not target a same-project shot from another tenant', async () => {
    const { completion, store, before } = await setup('body', true)
    expect(store.read((state) => state.shots)).toEqual(before.shots)
    clearImageWorkspaceWriteback(store, completion)
  })

  it.each([1, 2])(
    'does not roll back a later completed receipt at attempt %s reusing task output URLs',
    async (attempts) => {
      const { completion, store, reject } = await setup()
      await store.mutateRuntimeCachesAsync(
        (state) => {
          const current = state.tasks[0]!
          current.attempts = attempts
          current.updatedAt = '2030-01-01T00:00:00.000Z'
          current.metadata.providerCompletionReceipt = {
            ...(current.metadata.providerCompletionReceipt as Record<string, unknown>),
            attempts,
            completedAt: current.updatedAt,
          }
          state.assets[0]!.updatedAt = current.updatedAt
          state.shots[0]!.updatedAt = current.updatedAt
        },
        ['generationTasks', 'projectWorkspace'],
      )
      const newer = store.read((state) =>
        structuredClone({ assets: state.assets, shots: state.shots, tasks: state.tasks }),
      )
      await reject()
      const { persistRuntimeTaskSnapshots } = await import('./taskRuntimePersistence.js')
      expect(
        await persistRuntimeTaskSnapshots(store, database, [{ task: structuredClone(completion) }]),
      ).toBe(0)
      expect(
        store.read((state) => ({ assets: state.assets, shots: state.shots, tasks: state.tasks })),
      ).toEqual(newer)
    },
  )

  it('keeps workspace results when a newer DB version already contains the identical completed receipt', async () => {
    const { task, completion, store, repository } = await setup()
    const accepted = store.read((state) => structuredClone({ assets: state.assets, shots: state.shots }))
    await database.query(
      `UPDATE generation_tasks SET status='completed', metadata=$2::jsonb, result_url=$3, outputs=$4::jsonb, updated_at='2030-01-01T00:00:00.000Z' WHERE id=$1`,
      [
        task.id,
        JSON.stringify(completion.metadata),
        completion.resultUrl,
        JSON.stringify(completion.outputs),
      ],
    )
    expect(await repository.flushRuntimeTaskToDatabase(task.id)).toBe(false)
    expect(store.read((state) => ({ assets: state.assets, shots: state.shots }))).toEqual(accepted)
    expect(store.read((state) => state.tasks[0]!.metadata.providerCompletionReceipt)).toEqual(
      completion.metadata.providerCompletionReceipt,
    )
  })
})
