import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildApp } from '../../app.js'
import { loadConfig, type AppConfig } from '../../config.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore, defaultAssetAttributes } from '../../infra/store.js'
import { ProjectRepository } from './repository.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { UserRepository } from '../users/repository.js'

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
  it('covers project workspace lifecycle and tenant boundaries', async () => {
    const store = new AppStore(null)
    app = await buildApp({ config: localAuthConfig(), store, startWorker: false })
    const memberCookie = await login('member@seqora.local', 'MemberPassword123!')

    const createdProject = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: memberCookie },
      payload: { name: 'Lifecycle Project', contentType: 'short-drama', aspectRatio: '9:16' },
    })
    expect(createdProject.statusCode).toBe(201)
    expect(createdProject.json()).toMatchObject({
      id: expect.any(String),
      tenantId: 'tenant-seqora-demo',
      ownerId: 'user-member',
      name: 'Lifecycle Project',
      status: 'draft',
    })
    const projectId = createdProject.json().id as string

    const script = [
      'Scene 01: A locked studio opens at sunrise.',
      'Scene 02: The director finds a marked storyboard.',
    ].join('\n')
    const savedScript = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: memberCookie },
      payload: { synopsis: 'Lifecycle synopsis', script },
    })
    expect(savedScript.statusCode).toBe(200)
    expect(savedScript.json()).toMatchObject({ id: projectId, synopsis: 'Lifecycle synopsis', script })

    const projectList = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { cookie: memberCookie },
    })
    expect(projectList.statusCode).toBe(200)
    expect(projectList.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: projectId, script: '' })]),
    )

    const createdAsset = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/assets`,
      headers: { cookie: memberCookie },
      payload: {
        kind: 'character',
        sourceMode: 'generate',
        name: 'Lifecycle Lead',
        description: 'Lead character for the lifecycle test',
        prompt: 'A cinematic CG lead character, neutral expression, clean silhouette',
        attributes: defaultAssetAttributes('character'),
      },
    })
    expect(createdAsset.statusCode).toBe(201)
    expect(createdAsset.json()).toMatchObject({
      id: expect.any(String),
      projectId,
      kind: 'character',
      status: 'draft',
    })
    const assetId = createdAsset.json().id as string

    const createdShot = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/shots`,
      headers: { cookie: memberCookie },
      payload: {
        title: 'Opening shot',
        framing: 'Wide',
        duration: 5,
        prompt: 'Wide shot of the studio door opening at sunrise',
      },
    })
    expect(createdShot.statusCode).toBe(201)
    expect(createdShot.json()).toMatchObject({ id: expect.any(String), projectId, order: 1 })
    const shotId = createdShot.json().id as string

    const updatedShot = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/shots/${shotId}`,
      headers: { cookie: memberCookie },
      payload: {
        title: 'Updated opening shot',
        duration: 6,
        continuityNote: 'Keep the door half-open between cuts.',
        selectedImageTaskId: 'image-version-1',
        selectedVideoTaskId: 'video-version-1',
      },
    })
    expect(updatedShot.statusCode).toBe(200)
    expect(updatedShot.json()).toMatchObject({
      id: shotId,
      title: 'Updated opening shot',
      duration: 6,
      continuityNote: 'Keep the door half-open between cuts.',
      selectedImageTaskId: 'image-version-1',
      selectedVideoTaskId: 'video-version-1',
    })

    const insertedShot = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/shots`,
      headers: { cookie: memberCookie },
      payload: {
        title: 'Inserted middle shot',
        framing: 'Close',
        duration: 5,
        prompt: 'The marked storyboard is revealed.',
        insertAfterShotId: shotId,
      },
    })
    expect(insertedShot.statusCode).toBe(201)
    expect(insertedShot.json()).toMatchObject({ order: 2, title: 'Inserted middle shot' })

    const deletedShot = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/shots/${insertedShot.json().id}`,
      headers: { cookie: memberCookie },
    })
    expect(deletedShot.statusCode).toBe(204)
    const afterDelete = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: memberCookie },
    })
    expect(afterDelete.json().shots).toEqual([
      expect.objectContaining({
        id: shotId,
        order: 1,
        selectedImageTaskId: 'image-version-1',
        selectedVideoTaskId: 'video-version-1',
      }),
    ])

    await withDatabase(async (database) => {
      const persisted = await database.query<{
        script: string
        asset_count: string
        shot_count: string
      }>(
        `
        SELECT
          p.script,
          (SELECT count(*)::text FROM assets WHERE project_id = p.id) AS asset_count,
          (SELECT count(*)::text FROM shots WHERE project_id = p.id) AS shot_count
        FROM projects p
        WHERE p.id = $1
        `,
        [projectId],
      )
      expect(persisted.rows[0]).toEqual({ script, asset_count: '1', shot_count: '1' })
    })

    const otherTenant = await createMemberWithWorkspace(
      'project-boundary@example.com',
      'BoundaryPassword123!',
      'Boundary Workspace',
    )
    const crossTenantRead = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: otherTenant.cookie },
    })
    expect([403, 404]).toContain(crossTenantRead.statusCode)
    expect(crossTenantRead.json()).toMatchObject({
      error: { code: expect.stringMatching(/PROJECT_NOT_FOUND|PERMISSION_DENIED|TENANT_SCOPE_MISMATCH/) },
    })

    const crossTenantWrite = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: otherTenant.cookie },
      payload: { synopsis: 'Cross tenant overwrite attempt' },
    })
    expect([403, 404]).toContain(crossTenantWrite.statusCode)
    expect(crossTenantWrite.json()).toMatchObject({
      error: { code: expect.stringMatching(/PROJECT_NOT_FOUND|PERMISSION_DENIED|TENANT_SCOPE_MISMATCH/) },
    })

    const missingMediaId = '00000000-0000-4000-8000-000000000000'
    const missingMedia = await app.inject({
      method: 'GET',
      url: `/api/v1/media/${missingMediaId}`,
      headers: { cookie: memberCookie, 'user-agent': 'MediaAuditTest/1.0' },
    })
    expect(missingMedia.statusCode).toBe(404)

    const archived = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: memberCookie },
    })
    expect(archived.statusCode).toBe(204)

    const deletedAsset = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/assets/${assetId}`,
      headers: { cookie: memberCookie },
    })
    expect(deletedAsset.statusCode).toBe(204)

    const workspace = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: memberCookie },
    })
    expect(workspace.statusCode).toBe(200)
    expect(workspace.json()).toMatchObject({ project: { id: projectId, status: 'archived' } })
    expect(workspace.json().assets).toEqual([])
    expect(workspace.json().shots).toEqual([expect.objectContaining({ id: shotId })])

    await withDatabase(async (database) => {
      const deleted = await database.query<{
        project_status: string
        asset_count: string
        shot_count: string
      }>(
        `
        SELECT
          (SELECT status FROM projects WHERE id = $1) AS project_status,
          (SELECT count(*)::text FROM assets WHERE id = $2) AS asset_count,
          (SELECT count(*)::text FROM shots WHERE id = $3) AS shot_count
        `,
        [projectId, assetId, shotId],
      )
      expect(deleted.rows[0]).toEqual({ project_status: 'archived', asset_count: '0', shot_count: '1' })

      const audit = await database.query<{
        action: string
        resource_type: string
        resource_id: string
        actor_user_id: string
        metadata: Record<string, unknown>
      }>(
        `
        SELECT action, resource_type, resource_id, actor_user_id, metadata
        FROM audit_log_entries
        WHERE action = 'project.archived'
          AND resource_id = $1
        LIMIT 1
        `,
        [projectId],
      )
      expect(audit.rows[0]).toMatchObject({
        action: 'project.archived',
        resource_type: 'project',
        resource_id: projectId,
        actor_user_id: 'user-member',
        metadata: expect.objectContaining({ status: 'archived', traceId: expect.any(String) }),
      })

      const mediaAudit = await database.query<{
        action: string
        resource_type: string
        resource_id: string
        user_id: string
        user_agent: string
        metadata: Record<string, unknown>
      }>(
        `
        SELECT action, resource_type, resource_id, user_id, user_agent, metadata
        FROM audit_log_entries
        WHERE action = 'media.access.failed'
          AND resource_id = $1
        LIMIT 1
        `,
        [missingMediaId],
      )
      expect(mediaAudit.rows[0]).toMatchObject({
        action: 'media.access.failed',
        resource_type: 'media_object',
        resource_id: missingMediaId,
        user_id: 'user-member',
        user_agent: 'MediaAuditTest/1.0',
        metadata: expect.objectContaining({ reason: 'media_not_found', traceId: expect.any(String) }),
      })
    })
  })

  it('serves seed project workspace after explicit postgres import', async () => {
    const store = await importJsonWorkspaceToPostgres()
    app = await buildApp({ config: localAuthConfig(), store, startWorker: false })
    const cookie = await login('member@seqora.local', 'MemberPassword123!')

    const workspace = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers: { cookie },
    })

    expect(workspace.statusCode).toBe(200)
    expect(workspace.json()).toMatchObject({
      project: {
        id: 'project-midnight-film',
        ownerId: 'user-member',
        tenantId: 'tenant-seqora-demo',
      },
      assets: expect.any(Array),
      shots: expect.any(Array),
    })
    expect(workspace.json().assets).toHaveLength(4)
    expect(workspace.json().shots).toHaveLength(5)

    const workspaceVersion = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film/workspace/version',
      headers: { cookie },
    })
    expect(workspaceVersion.statusCode).toBe(200)
    expect(workspaceVersion.json()).toMatchObject({ version: expect.any(String) })
    expect(workspaceVersion.headers.etag).toEqual(expect.any(String))

    const unchangedWorkspaceVersion = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film/workspace/version',
      headers: { cookie, 'if-none-match': workspaceVersion.headers.etag },
    })
    expect(unchangedWorkspaceVersion.statusCode).toBe(304)

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
    const cookie = await login('member@seqora.local', 'MemberPassword123!')

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie },
      payload: {
        name: 'Database Project',
        contentType: 'animation',
        visualStyle: 'photorealistic',
        episodeDurationSeconds: 42,
        aspectRatio: '16:9',
      },
    })
    expect(created.statusCode).toBe(201)
    const projectId = created.json().id as string
    expect(store.read((state) => state.projects.some((project) => project.id === projectId))).toBe(true)

    const script = ['Scene one action.', 'Scene two action.', 'Scene three action.'].join('\n')
    const updatedProject = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie },
      payload: {
        synopsis: 'Stored in postgres',
        script,
        visualStyle: 'chinese-2d',
        episodeDurationSeconds: 55,
      },
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
        visual_style: string
        episode_duration_seconds: number
      }>(
        'SELECT name, synopsis, script, version, visual_style, episode_duration_seconds FROM projects WHERE id = $1',
        [projectId],
      )
      expect(project.rows[0]).toMatchObject({
        name: 'Database Project',
        synopsis: 'Stored in postgres',
        script,
        version: 2,
        visual_style: 'chinese-2d',
        episode_duration_seconds: 55,
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

    expect(store.read((state) => state.assets.find((asset) => asset.id === assetId)?.imageUrl)).toBe(
      '/generated/database-scene.png',
    )
    expect(
      store
        .read((state) => state.shots.filter((shot) => shot.projectId === projectId))
        .map((shot) => shot.order),
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

  it('keeps the JSON project workspace as a backup after postgres writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seqora-project-json-backup-'))
    const dataFile = join(directory, 'app.json')
    const store = new AppStore(dataFile)
    app = await buildApp({ config: localAuthConfig({ DATA_FILE: dataFile }), store, startWorker: false })
    const before = await readFile(dataFile, 'utf8')
    const cookie = await login('member@seqora.local', 'MemberPassword123!')

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie },
      payload: { name: 'Postgres Only Project', contentType: 'animation', aspectRatio: '16:9' },
    })
    expect(created.statusCode).toBe(201)

    const after = await readFile(dataFile, 'utf8')
    expect(after).toBe(before)

    await withDatabase(async (database) => {
      const project = await database.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM projects WHERE name = $1',
        ['Postgres Only Project'],
      )
      expect(project.rows[0]).toEqual({ count: '1' })
    })

    await rm(directory, { recursive: true, force: true })
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

async function createMemberWithWorkspace(
  email: string,
  password: string,
  workspaceName: string,
): Promise<{ cookie: string; userId: string; tenantId: string }> {
  if (!app) throw new Error('App is not ready')
  const ownerCookie = await login('owner@seqora.local', 'OwnerPassword123!')
  const workspace = await app.inject({
    method: 'POST',
    url: '/api/v1/organizations',
    headers: { cookie: ownerCookie },
    payload: { name: workspaceName },
  })
  expect(workspace.statusCode).toBe(201)
  const tenantId = workspace.json().workspace.id as string

  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/organizations/${tenantId}/users`,
    headers: { cookie: ownerCookie },
    payload: {
      name: email.split('@')[0],
      email,
      password,
      role: 'member',
    },
  })
  expect(created.statusCode).toBe(201)

  const loginResponse = await activateProvisionedAccount(email, password)
  expect(loginResponse.statusCode).toBe(200)
  expect(loginResponse.json().account.roles).toEqual(['member'])
  return {
    cookie: cookieValue(loginResponse),
    userId: created.json().userId as string,
    tenantId,
  }
}

async function activateProvisionedAccount(email: string, temporaryPassword: string) {
  if (!app) throw new Error('App is not ready')
  const initialLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: '10.0.0.2',
    payload: { email, password: temporaryPassword },
  })
  expect(initialLogin.statusCode).toBe(200)
  expect(initialLogin.json()).toMatchObject({ account: { passwordResetRequired: true } })

  const newPassword = `Ready-${temporaryPassword}`
  const changed = await app.inject({
    method: 'PUT',
    url: '/api/v1/auth/password',
    remoteAddress: '10.0.0.2',
    headers: { cookie: cookieValue(initialLogin) },
    payload: { currentPassword: temporaryPassword, newPassword },
  })
  expect(changed.statusCode).toBe(204)

  const readyLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: '10.0.0.2',
    payload: { email, password: newPassword },
  })
  expect(readyLogin.statusCode).toBe(200)
  expect(readyLogin.json()).toMatchObject({ account: { passwordResetRequired: false } })
  return readyLogin
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

async function importJsonWorkspaceToPostgres(): Promise<AppStore> {
  const store = new AppStore(null)
  await store.initialize()
  await withDatabase(async (database) => {
    const users = new UserRepository(store, database)
    await users.bootstrapFromStore()
    const projects = new ProjectRepository(store, database)
    const result = await projects.importFromStore()
    expect(result).toEqual({
      projects: { inserted: 1, skipped: 0 },
      assets: { inserted: 4, skipped: 0 },
      shots: { inserted: 5, skipped: 0 },
    })
  })
  return store
}

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}
