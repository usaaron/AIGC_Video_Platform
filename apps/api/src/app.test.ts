import type { GenerationTask } from '@seqora/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { buildApp } from './app.js'
import type { AppConfig } from './config.js'
import type { VideoGenerationProvider } from './core/generation/videoProvider.js'
import { AppStore } from './infra/store.js'
import { createSignedMediaUrl } from './modules/media/signedUrl.js'

const testConfig: AppConfig = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: 8787,
  API_PUBLIC_BASE_URL: 'http://localhost:8787',
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_MODE: 'demo',
  AUTH_SECRET: 'test-secret-with-at-least-32-characters',
  OIDC_ISSUER_URL: '',
  OIDC_JWKS_URL: '',
  OIDC_AUDIENCE: '',
  OIDC_EMAIL_CLAIM: 'email',
  OIDC_SUBJECT_CLAIM: 'sub',
  OIDC_CLOCK_TOLERANCE_SECONDS: 30,
  AUTH_LOGIN_RATE_LIMIT: 10,
  TASK_CREATE_RATE_LIMIT: 30,
  MEDIA_UPLOAD_RATE_LIMIT: 15,
  DATA_STORE: 'json',
  DATA_FILE: ':memory:',
  DATABASE_URL: '',
  TASK_QUEUE_DRIVER: 'inline',
  REDIS_URL: '',
  TASK_WORKER_CONCURRENCY: 4,
  TASK_QUEUE_TICK_INTERVAL_MS: 1_000,
  STORAGE_DRIVER: 'local',
  UPLOAD_DIR: resolve('./data/test-uploads'),
  GCS_BUCKET: '',
  OSS_REGION: '',
  OSS_BUCKET: '',
  OSS_ACCESS_KEY_ID: '',
  OSS_ACCESS_KEY_SECRET: '',
  OSS_ENDPOINT: '',
  OSS_INTERNAL: false,
  OSS_SECURE: true,
  MAX_UPLOAD_BYTES: 10_485_760,
  GENERATED_ASSET_MAX_BYTES: 104_857_600,
  SEEDANCE_API_BASE_URL: 'https://aideos.openrouter.icu',
  SEEDANCE_API_KEY: '',
  SEEDANCE_MODEL: 'doubao-seedance-2-0-260128',
  SEEDANCE_POLL_INTERVAL_MS: 5_000,
  SEEDANCE_REQUEST_TIMEOUT_MS: 30_000,
  IMG2_API_BASE_URL: 'https://aideos.openrouter.icu',
  IMG2_API_KEY: '',
  IMG2_MODEL: 'img2-default',
  IMG2_REQUEST_TIMEOUT_MS: 30_000,
  AUDIO_API_BASE_URL: 'https://aideos.openrouter.icu',
  AUDIO_API_KEY: '',
  AUDIO_MODEL: 'audio-default',
  AUDIO_REQUEST_TIMEOUT_MS: 30_000,
  FILM_EXPORT_FFMPEG_PATH: 'ffmpeg',
  FILM_EXPORT_TIMEOUT_MS: 300_000,
}

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  vi.unstubAllGlobals()
  await rm(testConfig.UPLOAD_DIR, { recursive: true, force: true })
})

describe('API authorization', () => {
  it('allows creators to submit generation tasks', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: {
        clientRequestId: 'client-1',
        projectId: 'project-midnight-film',
        kind: 'image',
        label: '角色定妆',
        estimatedCredits: 6,
      },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ projectId: 'project-midnight-film', status: 'queued' })
  })

  it('cancels queued tasks and refunds reserved credits once', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const task = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'cancel-test',
        projectId: 'project-midnight-film',
        kind: 'image',
        label: '取消测试',
        estimatedCredits: 6,
      },
    })
    expect(task.statusCode).toBe(202)

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/generation/tasks/${task.json().id}/cancel`,
      headers,
    })
    expect(cancelled.statusCode).toBe(202)
    expect(cancelled.json()).toMatchObject({
      status: 'cancelled',
      progress: 100,
      metadata: {
        refundCredits: 6,
        refundPolicy: 'full-before-provider-start',
      },
    })

    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/generation/tasks/${task.json().id}/cancel`,
      headers,
    })
    expect(repeated.statusCode).toBe(202)
    expect(repeated.json()).toMatchObject({ id: task.json().id, status: 'cancelled' })

    const billing = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(billing.json()).toMatchObject({ credits: 286 })
  })

  it('retries failed generation tasks and clears stale provider state', async () => {
    const store = new AppStore(null)
    app = await buildApp({ config: testConfig, store, startWorker: false })
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'failed-video-task',
      clientRequestId: 'failed-video-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '失败镜头',
      prompt: '雨夜车站',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        shotId: 'shot-1',
        providerName: 'aideos-seedance',
        providerState: 'failed',
        providerTaskId: 'remote-failed-task',
        providerPolledAt: Date.now(),
        providerPollErrors: 3,
      },
      status: 'failed',
      progress: 100,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: '/api/v1/generation/tasks/failed-video-task/content',
      outputs: [{ id: 'failed-video-task-video', url: '/stale.mp4', mediaType: 'video', view: 'single' }],
      error: 'Seedance 请求失败',
    }
    await store.mutate((state) => state.tasks.unshift(task))

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks/failed-video-task/retry',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({
      id: 'failed-video-task',
      status: 'queued',
      progress: 0,
      error: null,
      resultUrl: null,
      outputs: [],
      metadata: { shotId: 'shot-1' },
    })
    const stored = await store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(stored).toMatchObject({ status: 'queued', progress: 0, metadata: { shotId: 'shot-1' } })
    expect(stored?.metadata.providerTaskId).toBeUndefined()
  })

  it('rejects retry for completed generation tasks', async () => {
    const store = new AppStore(null)
    app = await buildApp({ config: testConfig, store, startWorker: false })
    const now = new Date().toISOString()
    await store.mutate((state) =>
      state.tasks.unshift({
        id: 'completed-image-task',
        clientRequestId: 'completed-image-client',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        userId: 'user-creator',
        kind: 'image',
        label: '已完成图片',
        prompt: '角色定妆',
        negativePrompt: '',
        provider: 'img2',
        model: null,
        metadata: {},
        status: 'completed',
        progress: 100,
        estimatedCredits: 6,
        createdAt: now,
        updatedAt: now,
        resultUrl: '/demo/lin.jpg',
        outputs: [
          { id: 'completed-image-task-single', url: '/demo/lin.jpg', mediaType: 'image', view: 'single' },
        ],
        error: null,
      }),
    )

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks/completed-image-task/retry',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: 'TASK_NOT_RETRYABLE' } })
  })

  it('denies the admin dashboard to member accounts', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { 'x-demo-role': 'member' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })
  })

  it('allows admin accounts to read the admin dashboard', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { 'x-demo-role': 'admin' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ users: 2, activeTasks: 0 })
  })

  it('proxies completed Seedance video content through the authenticated API', async () => {
    const getContent = vi.fn(async () => ({
      stream: Readable.from([Buffer.from('video-content')]),
      contentType: 'video/mp4',
      contentLength: '13',
    }))
    const provider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(),
      getContent,
    }
    const store = new AppStore(null)
    app = await buildApp({ config: testConfig, store, videoProvider: provider, startWorker: false })
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'completed-video-task',
      clientRequestId: 'completed-video-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '已完成镜头',
      prompt: '雨夜车站',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: { providerTaskId: 'remote-video-task' },
      status: 'completed',
      progress: 100,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: '/api/v1/generation/tasks/completed-video-task/content',
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(task))

    const response = await app.inject({
      method: 'GET',
      url: task.resultUrl!,
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('video/mp4')
    expect(response.body).toBe('video-content')
    expect(getContent).toHaveBeenCalledWith('remote-video-task')
  })
})

describe('local authentication', () => {
  it('creates and clears an HttpOnly session', async () => {
    app = await buildApp({ config: { ...testConfig, AUTH_MODE: 'local' }, startWorker: false })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'creator@seqora.local', password: 'Creator123!' },
    })

    expect(login.statusCode).toBe(200)
    expect(login.json()).toMatchObject({ account: { email: 'creator@seqora.local', plan: 'free' } })
    const cookie = login.cookies.find((item) => item.name === 'seqora_session')
    expect(cookie?.httpOnly).toBe(true)

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `seqora_session=${cookie?.value}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({ account: { name: '林夏' } })

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `seqora_session=${cookie?.value}` },
    })
    expect(logout.statusCode).toBe(204)
  })

  it('persists project, asset, task and billing mutations', async () => {
    app = await buildApp({ config: { ...testConfig, AUTH_MODE: 'local' }, startWorker: false })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'creator@seqora.local', password: 'Creator123!' },
    })
    const sessionCookie = login.cookies.find((item) => item.name === 'seqora_session')
    const headers = { cookie: `seqora_session=${sessionCookie?.value}` }

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/projects/project-midnight-film',
      headers,
      payload: { synopsis: '新的故事简介' },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ synopsis: '新的故事简介' })

    const asset = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/assets',
      headers,
      payload: {
        kind: 'audio',
        sourceMode: 'generate',
        name: '风声',
        description: '环境音',
        prompt: '夜晚风声',
        imageUrl: null,
        attributes: {
          type: 'audio',
          audioType: 'ambience',
          gender: 'unspecified',
          ageGroup: 'young',
          emotion: 'neutral',
          tone: 'warm',
          speed: 'normal',
          language: 'none',
          duration: 15,
          loop: true,
        },
      },
    })
    expect(asset.statusCode).toBe(201)
    expect(asset.json()).toMatchObject({
      projectId: 'project-midnight-film',
      kind: 'audio',
      name: '风声',
      status: 'draft',
    })
    expect(asset.json().id).toEqual(expect.any(String))

    const task = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'billing-test',
        projectId: 'project-midnight-film',
        kind: 'audio',
        label: '生成风声',
        estimatedCredits: 6,
      },
    })
    expect(task.statusCode).toBe(202)

    const duplicateTask = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'billing-test',
        projectId: 'project-midnight-film',
        kind: 'audio',
        label: '鐢熸垚椋庡０',
        estimatedCredits: 6,
      },
    })
    expect(duplicateTask.statusCode).toBe(202)
    expect(duplicateTask.json().id).toBe(task.json().id)

    const billing = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(billing.json()).toMatchObject({ credits: 280 })
  })

  it('uploads and serves authenticated project media', async () => {
    app = await buildApp({ config: { ...testConfig, AUTH_MODE: 'local' }, startWorker: false })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'creator@seqora.local', password: 'Creator123!' },
    })
    const sessionCookie = login.cookies.find((item) => item.name === 'seqora_session')
    const cookie = `seqora_session=${sessionCookie?.value}`
    const boundary = 'seqora-test-boundary'
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      Buffer.from('demo-image-content'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/media',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    })

    expect(upload.statusCode).toBe(201)
    expect(upload.json()).toMatchObject({ kind: 'image', name: 'reference.png' })
    const media = await app.inject({ method: 'GET', url: upload.json().url, headers: { cookie } })
    expect(media.statusCode).toBe(200)
    expect(media.headers['content-type']).toContain('image/png')
    expect(media.body).toBe('demo-image-content')

    const signedUrl = new URL(
      createSignedMediaUrl(testConfig.API_PUBLIC_BASE_URL, upload.json().id, testConfig.AUTH_SECRET, 60),
    )
    const signed = await app.inject({ method: 'GET', url: `${signedUrl.pathname}${signedUrl.search}` })
    expect(signed.statusCode).toBe(200)
    expect(signed.headers['content-type']).toContain('image/png')
    expect(signed.body).toBe('demo-image-content')
  })
})

describe('production security controls', () => {
  it('authenticates OIDC bearer JWTs through local user records and disables password login', async () => {
    const { fetchMock, token } = createOidcToken({ email: 'creator@seqora.local' })
    vi.stubGlobal('fetch', fetchMock)

    app = await buildApp({ config: oidcConfig(), startWorker: false })

    const disabledLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'creator@seqora.local', password: 'Creator123!' },
    })
    expect(disabledLogin.statusCode).toBe(501)
    expect(disabledLogin.json()).toMatchObject({ error: { code: 'OIDC_LOGIN_DISABLED' } })

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({
      account: { email: 'creator@seqora.local', tenantId: 'tenant-seqora-demo' },
    })
    expect(fetchMock).toHaveBeenCalled()
  })

  it('denies cross-tenant project and task access', async () => {
    const store = new AppStore(null)
    app = await buildApp({ config: testConfig, store, startWorker: false })
    const now = new Date().toISOString()
    await store.mutate((state) => {
      state.users.push({
        id: 'user-other',
        email: 'other@seqora.local',
        name: 'Other User',
        passwordHash: 'hash',
        tenantId: 'tenant-other',
        roles: ['creator'],
        plan: 'free',
        credits: 100,
      })
      state.projects.push({
        id: 'project-other',
        tenantId: 'tenant-other',
        ownerId: 'user-other',
        name: 'Other Project',
        contentType: 'short-drama',
        aspectRatio: '9:16',
        status: 'draft',
        synopsis: '',
        script: '',
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      state.tasks.unshift({
        id: 'task-other',
        clientRequestId: 'foreign-client',
        projectId: 'project-other',
        tenantId: 'tenant-other',
        userId: 'user-other',
        kind: 'image',
        label: 'Foreign task',
        prompt: '',
        negativePrompt: '',
        provider: 'img2',
        model: null,
        metadata: {},
        status: 'queued',
        progress: 0,
        estimatedCredits: 6,
        createdAt: now,
        updatedAt: now,
        resultUrl: null,
        outputs: [],
        error: null,
      })
    })

    const project = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-other',
      headers: demoCreatorHeaders(),
    })
    expect(project.statusCode).toBe(404)

    const cancel = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks/task-other/cancel',
      headers: demoCreatorHeaders(),
    })
    expect(cancel.statusCode).toBe(404)
    expect(cancel.json()).toMatchObject({ error: { code: 'TASK_NOT_FOUND' } })
  })

  it('adds tracing headers, records audit logs and exposes readiness and metrics', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const traceId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const projectList = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: {
        ...demoCreatorHeaders(),
        traceparent: `00-${traceId}-bbbbbbbbbbbbbbbb-01`,
      },
    })

    expect(projectList.statusCode).toBe(200)
    expect(projectList.headers['x-request-id']).toBe(traceId)
    expect(projectList.headers.traceparent).toEqual(expect.stringContaining(traceId))

    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs',
      headers: demoAdminHeaders(),
    })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: 'tenant-seqora-demo',
          userId: 'user-creator',
          path: '/api/v1/projects',
          outcome: 'success',
        }),
      ]),
    )

    const ready = await app.inject({ method: 'GET', url: '/api/v1/health/ready' })
    expect(ready.statusCode).toBe(200)
    expect(ready.json()).toMatchObject({ status: 'ok', checks: { database: 'memory' } })

    const metrics = await app.inject({ method: 'GET', url: '/api/v1/metrics' })
    expect(metrics.statusCode).toBe(200)
    expect(metrics.body).toContain('seqora_http_requests_total')
    expect(metrics.body).toContain('/api/v1/projects')
  })

  it('rate limits local password login attempts by IP', async () => {
    app = await buildApp({
      config: { ...testConfig, AUTH_MODE: 'local', AUTH_LOGIN_RATE_LIMIT: 1 },
      startWorker: false,
    })

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'creator@seqora.local', password: 'Creator123!' },
    })
    expect(first.statusCode).toBe(200)

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'creator@seqora.local', password: 'Creator123!' },
    })
    expect(second.statusCode).toBe(429)
    expect(second.headers['retry-after']).toBeDefined()
    expect(second.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
  })

  it('rate limits generation task mutations by authenticated user', async () => {
    app = await buildApp({
      config: { ...testConfig, TASK_CREATE_RATE_LIMIT: 1 },
      startWorker: false,
    })

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: demoCreatorHeaders(),
      payload: {
        clientRequestId: 'rate-limit-task-1',
        projectId: 'project-midnight-film',
        kind: 'image',
        label: 'Rate limit task 1',
        estimatedCredits: 6,
      },
    })
    expect(first.statusCode).toBe(202)

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: demoCreatorHeaders(),
      payload: {
        clientRequestId: 'rate-limit-task-2',
        projectId: 'project-midnight-film',
        kind: 'image',
        label: 'Rate limit task 2',
        estimatedCredits: 6,
      },
    })
    expect(second.statusCode).toBe(429)
    expect(second.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
  })

  it('rate limits media uploads by authenticated user', async () => {
    app = await buildApp({
      config: { ...testConfig, MEDIA_UPLOAD_RATE_LIMIT: 1 },
      startWorker: false,
    })

    const firstBoundary = 'seqora-rate-limit-upload-1'
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/media',
      headers: {
        ...demoCreatorHeaders(),
        'content-type': `multipart/form-data; boundary=${firstBoundary}`,
      },
      payload: multipartPayload(firstBoundary),
    })
    expect(first.statusCode).toBe(201)

    const secondBoundary = 'seqora-rate-limit-upload-2'
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/media',
      headers: {
        ...demoCreatorHeaders(),
        'content-type': `multipart/form-data; boundary=${secondBoundary}`,
      },
      payload: multipartPayload(secondBoundary),
    })
    expect(second.statusCode).toBe(429)
    expect(second.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
  })
})

function oidcConfig(): AppConfig {
  return {
    ...testConfig,
    AUTH_MODE: 'oidc',
    OIDC_ISSUER_URL: 'https://issuer.example.com',
    OIDC_JWKS_URL: 'https://issuer.example.com/jwks',
    OIDC_AUDIENCE: 'seqora-api',
  }
}

function createOidcToken(overrides: Record<string, unknown> = {}): {
  fetchMock: ReturnType<typeof vi.fn>
  token: string
} {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const kid = 'seqora-test-key'
  const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey & {
    alg: string
    kid: string
    use: string
  }
  publicJwk.alg = 'RS256'
  publicJwk.kid = kid
  publicJwk.use = 'sig'
  const now = Math.floor(Date.now() / 1_000)
  const token = signJwt(
    {
      iss: 'https://issuer.example.com',
      aud: 'seqora-api',
      sub: 'oidc-subject-1',
      email: 'creator@seqora.local',
      iat: now,
      exp: now + 300,
      ...overrides,
    },
    privateKey,
    kid,
  )

  return {
    fetchMock: vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })),
    token,
  }
}

function signJwt(payload: Record<string, unknown>, privateKey: KeyObject, kid: string): string {
  const encodedHeader = encodeJwtPart({ alg: 'RS256', kid, typ: 'JWT' })
  const encodedPayload = encodeJwtPart(payload)
  const input = `${encodedHeader}.${encodedPayload}`
  const signer = createSign('RSA-SHA256')
  signer.update(input)
  signer.end()
  const signature = signer.sign(privateKey).toString('base64url')
  return `${input}.${signature}`
}

function encodeJwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function demoCreatorHeaders(): Record<string, string> {
  return {
    'x-demo-role': 'creator',
    'x-demo-user-id': 'user-creator',
    'x-demo-tenant-id': 'tenant-seqora-demo',
  }
}

function demoAdminHeaders(): Record<string, string> {
  return {
    'x-demo-role': 'admin',
    'x-demo-user-id': 'user-admin',
    'x-demo-tenant-id': 'tenant-seqora-demo',
  }
}

function multipartPayload(boundary: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    Buffer.from('demo-image-content'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
}
