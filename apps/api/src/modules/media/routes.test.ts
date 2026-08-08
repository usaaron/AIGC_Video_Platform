import type { AssetLibraryProvider } from '../../core/generation/volcArkAssetLibraryProvider.js'
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

describe('media postgres api', { timeout: 30_000 }, () => {
  it('stores uploads in media_objects and uses them for trusted asset source URLs', async () => {
    const store = new AppStore(null)
    let submittedSourceUrl = ''
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'group-media-db',
      createVirtualAsset: async (groupId, name, sourceUrl) => {
        submittedSourceUrl = sourceUrl
        return {
          assetId: 'asset-media-db',
          groupId,
          groupType: 'AIGC',
          name,
          assetType: 'Image',
          status: 'processing',
          previewUrl: null,
          errorCode: null,
          errorMessage: null,
        }
      },
      getPortrait: async () => {
        throw new Error('not used')
      },
      listPortraits: async () => [],
      listAuthorizedPortraits: async () => [],
    }
    app = await buildApp({
      config: localAuthConfig({ PUBLIC_API_BASE_URL: 'https://api.example.com' }),
      store,
      assetLibraryProvider: provider,
      startWorker: false,
    })
    const cookie = await login('member@seqora.local', 'MemberPassword123!')

    const createdProject = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie },
      payload: { name: 'Media DB Project', contentType: 'short-drama', aspectRatio: '9:16' },
    })
    expect(createdProject.statusCode).toBe(201)
    const projectId = createdProject.json().id as string

    const boundary = 'seqora-media-db-boundary'
    const uploadPayload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="face.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      Buffer.from('db-face-image'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/media`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: uploadPayload,
    })
    expect(upload.statusCode).toBe(201)
    expect(upload.json()).toMatchObject({ kind: 'image', name: 'face.png', url: expect.any(String) })
    const mediaId = upload.json().id as string
    expect(store.read((state) => state.media)).toHaveLength(0)

    const read = await app.inject({ method: 'GET', url: `/api/v1/media/${mediaId}`, headers: { cookie } })
    expect(read.statusCode).toBe(200)
    expect(read.headers['content-type']).toContain('image/png')
    expect(read.body).toBe('db-face-image')

    await withDatabase(async (database) => {
      const persisted = await database.query<{
        project_id: string
        media_type: string
        storage_key: string
        content_type: string
      }>(
        `
        SELECT project_id, media_type, storage_key, content_type
        FROM media_objects
        WHERE id = $1
        `,
        [mediaId],
      )
      expect(persisted.rows[0]).toMatchObject({
        project_id: projectId,
        media_type: 'image',
        content_type: 'image/png',
      })
    })

    const faceReference = { id: mediaId, url: `/api/v1/media/${mediaId}`, name: 'face.png' }
    const asset = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/assets`,
      headers: { cookie },
      payload: {
        kind: 'character',
        sourceMode: 'import',
        name: 'Media DB Face Character',
        references: [faceReference],
        imageUrl: faceReference.url,
        attributes: {
          ...defaultAssetAttributes('character'),
          faceStatus: 'approved',
          faceReference,
        },
      },
    })
    expect(asset.statusCode).toBe(201)

    const registered = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/assets/${asset.json().id}/trusted-portrait/register`,
      headers: { cookie },
    })
    expect(registered.statusCode).toBe(200)
    expect(submittedSourceUrl).toMatch(/^https:\/\/api\.example\.com\/api\/v1\/trusted-assets\/source\//)

    const token = submittedSourceUrl.split('/').pop()!
    const source = await app.inject({ method: 'GET', url: `/api/v1/trusted-assets/source/${token}` })
    expect(source.statusCode).toBe(200)
    expect(source.headers['content-type']).toContain('image/png')
    expect(source.body).toBe('db-face-image')
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
