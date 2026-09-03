import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { buildApp } from '../../app.js'
import { noopTaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import { loadConfig, type AppConfig } from '../../config.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore, defaultAssetAttributes } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { ProjectRepository } from '../projects/repository.js'
import { UserRepository } from '../users/repository.js'
import { GenerationTaskRepository } from './repository.js'

let app: Awaited<ReturnType<typeof buildApp>> | undefined
let postgres: PostgresAuthFixture | undefined

beforeAll(async () => {
  postgres = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await postgres?.reset()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

afterAll(async () => {
  await postgres?.close()
})

describe('generation task postgres api', { timeout: 30_000 }, () => {
  it('imports historical JSON generation tasks into postgres', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => {
      state.tasks.unshift({
        id: 'json-task-import',
        clientRequestId: 'json-task-import-request',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        userId: 'user-member',
        kind: 'image',
        label: 'Imported JSON task',
        prompt: 'A task imported from JSON',
        negativePrompt: '',
        provider: 'img2',
        model: null,
        tier: null,
        metadata: { importedFixture: true },
        status: 'queued',
        progress: 0,
        estimatedCredits: 3,
        attempts: 0,
        maxAttempts: 3,
        leaseOwnerId: null,
        leaseToken: null,
        leaseAcquiredAt: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
        resultUrl: null,
        outputs: [],
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    })

    await withDatabase(async (database) => {
      const users = new UserRepository(store, database)
      await users.bootstrapFromStore()
      const projects = new ProjectRepository(store, database)
      await projects.importFromStore()
      const tasks = new GenerationTaskRepository(store, null, database)
      await expect(tasks.importFromStore()).resolves.toEqual({ tasks: { inserted: 1, skipped: 0 } })

      const persisted = await database.query<{ count: string; imported_fixture: string | null }>(
        `
        SELECT count(*)::text AS count, max(metadata->>'importedFixture') AS imported_fixture
        FROM generation_tasks
        WHERE id = 'json-task-import'
        `,
      )
      expect(persisted.rows[0]).toEqual({ count: '1', imported_fixture: 'true' })
    })
  })

  it('persists tasks, charges idempotently, and flushes runtime task lifecycle to postgres', async () => {
    const store = new AppStore(null)
    app = await buildApp({
      config: localAuthConfig(),
      store,
      startWorker: false,
      taskDispatcher: noopTaskDispatcher,
    })
    const cookie = await login('member@seqora.local', 'MemberPassword123!')

    const createdProject = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie },
      payload: { name: 'Task Persistence Project', contentType: 'short-drama', aspectRatio: '9:16' },
    })
    expect(createdProject.statusCode).toBe(201)
    const projectId = createdProject.json().id as string

    const createdAsset = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/assets`,
      headers: { cookie },
      payload: {
        kind: 'character',
        sourceMode: 'generate',
        name: 'Task Character',
        description: 'Character used by a task writeback test',
        prompt: 'A clear character portrait',
        attributes: defaultAssetAttributes('character'),
      },
    })
    expect(createdAsset.statusCode).toBe(201)
    const assetId = createdAsset.json().id as string

    const createdShot = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/shots`,
      headers: { cookie },
      payload: {
        title: 'Task Shot',
        framing: 'Medium',
        duration: 5,
        prompt: 'A medium shot for task persistence',
      },
    })
    expect(createdShot.statusCode).toBe(201)
    const shotId = createdShot.json().id as string

    const createdTask = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: { cookie },
      payload: {
        clientRequestId: 'postgres-task-create',
        projectId,
        kind: 'image',
        label: 'Task persistence render',
        provider: 'img2',
        estimatedCredits: 5,
        metadata: { assetId, shotId, generationStage: 'test' },
      },
    })
    expect(createdTask.statusCode).toBe(202)
    expect(createdTask.json()).toMatchObject({
      id: expect.any(String),
      clientRequestId: 'postgres-task-create',
      projectId,
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      status: 'queued',
    })
    const taskId = createdTask.json().id as string

    const replayedTask = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: { cookie },
      payload: {
        clientRequestId: 'postgres-task-create',
        projectId,
        kind: 'image',
        label: 'Task persistence render',
        provider: 'img2',
        estimatedCredits: 5,
        metadata: { assetId, shotId, generationStage: 'test' },
      },
    })
    expect(replayedTask.statusCode).toBe(202)
    expect(replayedTask.json().id).toBe(taskId)

    await withDatabase(async (database) => {
      const persisted = await database.query<{
        task_count: string
        ledger_count: string
        credits: number
      }>(
        `
        SELECT
          (SELECT count(*)::text FROM generation_tasks WHERE client_request_id = 'postgres-task-create') AS task_count,
          (SELECT count(*)::text FROM billing_ledger_entries WHERE reference_id = 'postgres-task-create') AS ledger_count,
          (
            SELECT b.credits
            FROM billing_accounts b
            JOIN tenant_memberships m ON m.id = b.membership_id
            WHERE m.user_id = 'user-member' AND m.tenant_id = 'tenant-seqora-demo'
          ) AS credits
        `,
      )
      expect(persisted.rows[0]).toEqual({ task_count: '1', ledger_count: '1', credits: 281 })
    })

    const resultUrl = `/api/v1/generation/tasks/${taskId}/outputs/single`
    const outputs = [
      {
        id: `${taskId}-single`,
        url: resultUrl,
        mediaType: 'image',
        view: 'single',
      },
    ]

    store.mutateProjectWorkspaceRuntimeCache((state) => {
      const task = state.tasks.find((item) => item.id === taskId)!
      const asset = state.assets.find((item) => item.id === assetId)!
      const shot = state.shots.find((item) => item.id === shotId)!
      const now = new Date().toISOString()
      task.status = 'completed'
      task.progress = 100
      task.resultUrl = resultUrl
      task.outputs = outputs
      task.metadata = {
        ...task.metadata,
        providerState: 'completed',
        generatedOutputs: [
          {
            view: 'single',
            storageKey: `tenant-seqora-demo/${projectId}/generated/${taskId}-single.png`,
            contentType: 'image/png',
            size: 128,
          },
        ],
      }
      task.updatedAt = now
      asset.imageUrl = resultUrl
      asset.updatedAt = now
      shot.imageUrl = resultUrl
      shot.updatedAt = now
    })

    await withDatabase(async (database) => {
      const unchanged = await database.query<{
        status: string
        progress: number
        result_url: string | null
        asset_image_url: string | null
        shot_image_url: string | null
      }>(
        `
        SELECT
          t.status,
          t.progress,
          t.result_url,
          a.image_url AS asset_image_url,
          s.image_url AS shot_image_url
        FROM generation_tasks t
        JOIN assets a ON a.id = $2
        JOIN shots s ON s.id = $3
        WHERE t.id = $1
        `,
        [taskId, assetId, shotId],
      )
      expect(unchanged.rows[0]).toEqual({
        status: 'queued',
        progress: 0,
        result_url: null,
        asset_image_url: null,
        shot_image_url: null,
      })
    })

    await withDatabase(async (database) => {
      const repository = new GenerationTaskRepository(store, null, database)
      await expect(repository.flushRuntimeCacheToDatabase()).resolves.toBeGreaterThanOrEqual(1)
    })

    await withDatabase(async (database) => {
      const flushed = await database.query<{
        status: string
        progress: number
        result_url: string | null
        generated_outputs: unknown
        asset_image_url: string | null
        shot_image_url: string | null
      }>(
        `
        SELECT
          t.status,
          t.progress,
          t.result_url,
          t.metadata->'generatedOutputs' AS generated_outputs,
          a.image_url AS asset_image_url,
          s.image_url AS shot_image_url
        FROM generation_tasks t
        JOIN assets a ON a.id = $2
        JOIN shots s ON s.id = $3
        WHERE t.id = $1
        `,
        [taskId, assetId, shotId],
      )
      expect(flushed.rows[0]).toEqual({
        status: 'completed',
        progress: 100,
        result_url: resultUrl,
        generated_outputs: [
          {
            view: 'single',
            storageKey: `tenant-seqora-demo/${projectId}/generated/${taskId}-single.png`,
            contentType: 'image/png',
            size: 128,
          },
        ],
        asset_image_url: resultUrl,
        shot_image_url: resultUrl,
      })
    })

    const cleared = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/generation/tasks/completed`,
      headers: { cookie },
    })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json()).toEqual({ cleared: 1 })

    await withDatabase(async (database) => {
      const hidden = await database.query<{ hidden: string | null }>(
        "SELECT metadata->>'queueHiddenAt' AS hidden FROM generation_tasks WHERE id = $1",
        [taskId],
      )
      expect(hidden.rows[0]?.hidden).toEqual(expect.any(String))
    })
  })

  it('returns 304 when a project task polling snapshot is unchanged', async () => {
    app = await buildApp({
      config: localAuthConfig(),
      store: new AppStore(null),
      startWorker: false,
      taskDispatcher: noopTaskDispatcher,
    })
    const cookie = await login('member@seqora.local', 'MemberPassword123!')

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film/generation/tasks/poll',
      headers: { cookie },
    })
    expect(first.statusCode).toBe(200)
    expect(first.headers.etag).toEqual(expect.any(String))

    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film/generation/tasks/poll',
      headers: { cookie, 'if-none-match': first.headers.etag },
    })
    expect(second.statusCode).toBe(304)
    expect(second.body).toBe('')
  })
})

function localAuthConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  if (!postgres) throw new Error('Postgres fixture is not ready')
  return loadConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    DATABASE_URL: postgres.connectionString,
    DATA_FILE: ':memory:',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: resolve('./data/test-uploads'),
    ...overrides,
  })
}

async function login(email: string, password: string): Promise<string> {
  if (!app) throw new Error('App is not ready')
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  })
  expect(response.statusCode).toBe(200)
  return cookieValue(response)
}

async function withDatabase(operation: (database: AccountDatabase) => Promise<void>): Promise<void> {
  if (!postgres) throw new Error('Postgres fixture is not ready')
  const database = new AccountDatabase(postgres.connectionString)
  try {
    await operation(database)
  } finally {
    await database.close()
  }
}

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}
