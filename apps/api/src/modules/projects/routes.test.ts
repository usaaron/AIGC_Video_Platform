import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildApp } from '../../app.js'
import { loadConfig, type AppConfig } from '../../config.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore, defaultAssetAttributes } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'

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
  await rm(resolve('./data/test-uploads'), { recursive: true, force: true })
})

afterAll(async () => {
  await postgres?.close()
})

describe('project postgres api', { timeout: 30_000 }, () => {
  it('imports the seed project workspace into postgres before serving project reads', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const cookie = await login('creator@seqora.local', 'Creator123!')

    const workspace = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers: { cookie },
    })

    expect(workspace.statusCode).toBe(200)
    expect(workspace.json()).toMatchObject({
      project: {
        id: 'project-midnight-film',
        ownerId: 'user-creator',
        tenantId: 'tenant-seqora-demo',
      },
      assets: expect.any(Array),
      shots: expect.any(Array),
    })
    expect(workspace.json().assets).toHaveLength(4)
    expect(workspace.json().shots).toHaveLength(5)

    await withDatabase(async (database) => {
      const counts = await database.query<{
        projects: string
        assets: string
        shots: string
      }>(
        `
        SELECT
          (SELECT count(*)::text FROM projects WHERE id = 'project-midnight-film') AS projects,
          (SELECT count(*)::text FROM assets WHERE project_id = 'project-midnight-film') AS assets,
          (SELECT count(*)::text FROM shots WHERE project_id = 'project-midnight-film') AS shots
        `,
      )
      expect(counts.rows[0]).toEqual({ projects: '1', assets: '4', shots: '5' })
    })
  })

  it('persists project, asset and shot writes in postgres while mirroring app store', async () => {
    const store = new AppStore(null)
    app = await buildApp({ config: localAuthConfig(), store, startWorker: false })
    const cookie = await login('creator@seqora.local', 'Creator123!')

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie },
      payload: { name: 'Database Project', contentType: 'animation', aspectRatio: '16:9' },
    })
    expect(created.statusCode).toBe(201)
    const projectId = created.json().id as string
    expect(store.read((state) => state.projects.some((project) => project.id === projectId))).toBe(true)

    const script = ['Scene one action.', 'Scene two action.', 'Scene three action.'].join('\n')
    const updatedProject = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie },
      payload: { synopsis: 'Stored in postgres', script },
    })
    expect(updatedProject.statusCode).toBe(200)

    const createdAsset = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/assets`,
      headers: { cookie },
      payload: {
        kind: 'scene',
        sourceMode: 'generate',
        name: 'Database Scene',
        description: 'A reusable scene asset',
        prompt: 'A clean test scene prompt',
        attributes: defaultAssetAttributes('scene'),
      },
    })
    expect(createdAsset.statusCode).toBe(201)
    const assetId = createdAsset.json().id as string

    const updatedAsset = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/assets/${assetId}`,
      headers: { cookie },
      payload: { status: 'confirmed', imageUrl: '/generated/database-scene.png' },
    })
    expect(updatedAsset.statusCode).toBe(200)
    expect(updatedAsset.json()).toMatchObject({
      id: assetId,
      status: 'confirmed',
      imageUrl: '/generated/database-scene.png',
    })

    const createdShot = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/shots`,
      headers: { cookie },
      payload: {
        title: 'Database Shot',
        framing: 'Wide',
        duration: 5,
        prompt: 'Initial shot prompt',
      },
    })
    expect(createdShot.statusCode).toBe(201)
    const shotId = createdShot.json().id as string

    const updatedShot = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/shots/${shotId}`,
      headers: { cookie },
      payload: { title: 'Updated Database Shot', duration: 6 },
    })
    expect(updatedShot.statusCode).toBe(200)
    expect(updatedShot.json()).toMatchObject({ id: shotId, title: 'Updated Database Shot', duration: 6 })

    const generatedShots = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/shots/generate`,
      headers: { cookie },
      payload: { mode: 'scene', maxShots: 3 },
    })
    expect(generatedShots.statusCode).toBe(200)
    expect(generatedShots.json()).toHaveLength(3)

    const savedVersion = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/versions`,
      headers: { cookie },
    })
    expect(savedVersion.statusCode).toBe(200)
    expect(savedVersion.json()).toMatchObject({ id: projectId, version: 2 })

    await withDatabase(async (database) => {
      const project = await database.query<{
        name: string
        synopsis: string
        script: string
        version: number
      }>('SELECT name, synopsis, script, version FROM projects WHERE id = $1', [projectId])
      expect(project.rows[0]).toMatchObject({
        name: 'Database Project',
        synopsis: 'Stored in postgres',
        script,
        version: 2,
      })

      const asset = await database.query<{ status: string; image_url: string | null }>(
        'SELECT status, image_url FROM assets WHERE id = $1',
        [assetId],
      )
      expect(asset.rows[0]).toEqual({ status: 'confirmed', image_url: '/generated/database-scene.png' })

      const shots = await database.query<{ count: string; first_order: number; last_order: number }>(
        'SELECT count(*)::text AS count, min(shot_order) AS first_order, max(shot_order) AS last_order FROM shots WHERE project_id = $1',
        [projectId],
      )
      expect(shots.rows[0]).toEqual({ count: '3', first_order: 1, last_order: 3 })

      const versions = await database.query<{
        version: number
        assets_snapshot: unknown
        shots_snapshot: unknown
      }>('SELECT version, assets_snapshot, shots_snapshot FROM project_versions WHERE project_id = $1', [
        projectId,
      ])
      expect(versions.rows[0]?.version).toBe(1)
      expect(versions.rows[0]?.assets_snapshot).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: assetId })]),
      )
      expect(versions.rows[0]?.shots_snapshot).toHaveLength(3)
    })

    expect(
      store.read((state) => state.assets.find((asset) => asset.id === assetId)?.imageUrl),
    ).toBe('/generated/database-scene.png')
    expect(
      store.read((state) => state.shots.filter((shot) => shot.projectId === projectId)).map((shot) => shot.order),
    ).toEqual([1, 2, 3])

    const deletedAsset = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/assets/${assetId}`,
      headers: { cookie },
    })
    expect(deletedAsset.statusCode).toBe(204)

    await withDatabase(async (database) => {
      const asset = await database.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM assets WHERE id = $1',
        [assetId],
      )
      expect(asset.rows[0]).toEqual({ count: '0' })
    })
    expect(store.read((state) => state.assets.some((asset) => asset.id === assetId))).toBe(false)
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
