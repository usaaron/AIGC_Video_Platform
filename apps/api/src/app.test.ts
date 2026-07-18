import type { GenerationTask } from '@seqora/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { buildApp } from './app.js'
import type { AppConfig } from './config.js'
import type { VideoGenerationProvider } from './core/generation/videoProvider.js'
import { AppStore } from './infra/store.js'

const testConfig: AppConfig = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: 8787,
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_MODE: 'demo',
  AUTH_SECRET: 'test-secret-with-at-least-32-characters',
  DATA_FILE: ':memory:',
  STORAGE_DRIVER: 'local',
  UPLOAD_DIR: resolve('./data/test-uploads'),
  GCS_BUCKET: '',
  MAX_UPLOAD_BYTES: 10_485_760,
  SEEDANCE_API_BASE_URL: 'https://aideos.openrouter.icu',
  SEEDANCE_API_KEY: '',
  SEEDANCE_MODEL: 'doubao-seedance-2-0-260128',
  SEEDANCE_POLL_INTERVAL_MS: 5_000,
  SEEDANCE_REQUEST_TIMEOUT_MS: 30_000,
}

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
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
  })
})
