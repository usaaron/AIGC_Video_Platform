import type { CreateGenerationTask, Principal } from '@seqora/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { FilmPreviewComposer } from '../film/filmPreviewComposer.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from '../../modules/generation/repository.js'
import { ProjectRepository } from '../../modules/projects/repository.js'
import { UserRepository } from '../../modules/users/repository.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

const principal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

let postgres: PostgresAuthFixture | undefined

beforeAll(async () => {
  postgres = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await postgres?.reset()
})

afterAll(async () => {
  await postgres?.close()
})

describe('worker generation task DB writeback', { timeout: 30_000 }, () => {
  it('flushes taskWriteback image completion into generation_tasks and reloads it after restart', async () => {
    const { database, store, tasks } = await createGenerationContext()
    try {
      const objectStorage = memoryObjectStorage()
      const imageProvider: ImageGenerationProvider = {
        generate: vi.fn(async () => [
          { view: 'single', contentType: 'image/png', content: Buffer.from('image-content') },
        ]),
      }
      const task = await tasks.create(
        generationInput({
          clientRequestId: 'r2-task-writeback-image',
          kind: 'image',
          label: 'R2 task writeback image',
          provider: 'img2',
          model: 'img2-default',
          metadata: {
            assetId: 'asset-station',
            assetKind: 'scene',
            shotId: 'shot-1',
            aspectRatio: '16:9',
          },
        }),
        principal,
      )
      const runner = new GenerationTaskRunner(store, {
        imageProvider,
        objectStorage,
        beforeTick: () => tasks.refreshRuntimeCacheFromDatabase(),
        persistTickTasks: (taskIds) => tasks.flushRuntimeTasksToDatabase(taskIds).then(() => {}),
        persistTask: (taskId) => tasks.flushRuntimeTaskToDatabase(taskId).then(() => {}),
      })

      await runner.tick()
      await vi.waitFor(async () => {
        expect(await generationTaskRow(database, task.id, 'asset-station', 'shot-1')).toMatchObject({
          status: 'completed',
          progress: 100,
          result_url: `/api/v1/generation/tasks/${task.id}/outputs/single`,
          asset_image_url: `/api/v1/generation/tasks/${task.id}/outputs/single`,
          shot_image_url: `/api/v1/generation/tasks/${task.id}/outputs/single`,
          lease_owner_id: null,
          lease_token: null,
        })
      })

      const recovered = await recoverTasks(database)
      expect(recovered.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
        status: 'completed',
        progress: 100,
        resultUrl: `/api/v1/generation/tasks/${task.id}/outputs/single`,
        metadata: {
          providerState: 'completed',
          generatedOutputs: [
            {
              view: 'single',
              storageKey: `tenant-seqora-demo/project-midnight-film/generated/${task.id}-single.png`,
              contentType: 'image/png',
              size: Buffer.byteLength('image-content'),
            },
          ],
        },
      })
    } finally {
      await database.close()
    }
  })

  it('persists filmPreviewComposer startup recovery into generation_tasks and reloads it', async () => {
    const { database, store, tasks } = await createGenerationContext()
    try {
      const task = await tasks.create(
        generationInput({
          clientRequestId: 'r2-film-preview-recovery',
          kind: 'video',
          label: 'R2 film preview recovery',
          provider: 'local-compose',
          metadata: {
            generationStage: 'film-preview',
            providerState: 'composing',
            sourceVideoTaskIds: ['source-video-1'],
            aspectRatio: '16:9',
          },
        }),
        principal,
      )
      const now = new Date().toISOString()
      await store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (!stored) throw new Error('Preview task was not mirrored to runtime cache')
        stored.status = 'running'
        stored.progress = 41
        stored.leaseOwnerId = 'old-film-composer'
        stored.leaseToken = 'old-lease-token'
        stored.leaseAcquiredAt = now
        stored.leaseHeartbeatAt = now
        stored.leaseExpiresAt = now
        stored.updatedAt = now
      })
      await tasks.flushRuntimeCacheToDatabase()

      const composer = new FilmPreviewComposer(
        store,
        {} as VideoGenerationProvider,
        memoryObjectStorage(),
        'ffmpeg',
        60_000,
        'stringx-seedance',
        {
          onStateChange: async () => {
            await tasks.flushRuntimeCacheToDatabase()
          },
        },
      )

      await composer.recoverInterrupted()

      await vi.waitFor(async () => {
        const row = await generationTaskRow(database, task.id)
        expect(row).toMatchObject({
          status: 'failed',
          progress: 100,
          lease_owner_id: null,
          lease_token: null,
        })
        expect(row.error).toEqual(expect.any(String))
      })

      const recovered = await recoverTasks(database)
      expect(recovered.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
        status: 'failed',
        progress: 100,
        leaseOwnerId: null,
        leaseToken: null,
        error: expect.any(String),
      })
    } finally {
      await database.close()
    }
  })
})

async function createGenerationContext(): Promise<{
  database: AccountDatabase
  store: AppStore
  tasks: GenerationTaskRepository
}> {
  if (!postgres) throw new Error('Postgres fixture is not ready')
  const store = new AppStore(null)
  await store.initialize()
  const database = new AccountDatabase(postgres.connectionString)
  const users = new UserRepository(store, database)
  await users.bootstrapFromStore()
  const projects = new ProjectRepository(store, database)
  await projects.importFromStore()
  const tasks = new GenerationTaskRepository(store, null, database)
  await tasks.refreshRuntimeCacheFromDatabase()
  return { database, store, tasks }
}

function generationInput(overrides: Partial<CreateGenerationTask> = {}): CreateGenerationTask {
  return {
    clientRequestId: 'r2-generation-task',
    projectId: 'project-midnight-film',
    kind: 'image',
    label: 'R2 generation task',
    prompt: 'R2 image prompt',
    negativePrompt: '',
    provider: 'img2',
    model: 'img2-default',
    estimatedCredits: 1,
    metadata: {},
    ...overrides,
  }
}

function memoryObjectStorage(): ObjectStorage {
  const files = new Map<string, Buffer>()
  return {
    async put(key, content) {
      files.set(key, content)
    },
    async get(key) {
      return files.get(key) ?? Buffer.alloc(0)
    },
    async delete(key) {
      files.delete(key)
    },
  }
}

async function generationTaskRow(
  database: AccountDatabase,
  taskId: string,
  assetId = 'asset-station',
  shotId = 'shot-1',
): Promise<{
  status: string
  progress: number
  result_url: string | null
  error: string | null
  lease_owner_id: string | null
  lease_token: string | null
  asset_image_url: string | null
  shot_image_url: string | null
}> {
  const result = await database.query<{
    status: string
    progress: number
    result_url: string | null
    error: string | null
    lease_owner_id: string | null
    lease_token: string | null
    asset_image_url: string | null
    shot_image_url: string | null
  }>(
    `
    SELECT
      t.status,
      t.progress,
      t.result_url,
      t.error,
      t.lease_owner_id,
      t.lease_token,
      a.image_url AS asset_image_url,
      s.image_url AS shot_image_url
    FROM generation_tasks t
    LEFT JOIN assets a ON a.id = $2 AND a.project_id = t.project_id AND a.tenant_id = t.tenant_id
    LEFT JOIN shots s ON s.id = $3 AND s.project_id = t.project_id AND s.tenant_id = t.tenant_id
    WHERE t.id = $1
    LIMIT 1
    `,
    [taskId, assetId, shotId],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`Generation task ${taskId} was not persisted`)
  return row
}

async function recoverTasks(database: AccountDatabase): Promise<AppStore> {
  const recoveredStore = new AppStore(null)
  await recoveredStore.initialize()
  const recoveredRepository = new GenerationTaskRepository(recoveredStore, null, database)
  await recoveredRepository.refreshRuntimeCacheFromDatabase()
  return recoveredStore
}
