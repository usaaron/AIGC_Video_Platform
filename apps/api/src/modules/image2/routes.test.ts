import { afterEach, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { IMAGE2_CREDITS_PER_IMAGE, IMAGE2_MODEL_ID, IMAGE2_PROVIDER_DISPLAY_NAME } from '@seqora/contracts'
import { buildApp } from '../../app.js'
import { loadConfig, type AppConfig } from '../../config.js'
import { noopTaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { ImageGenerationProvider } from '../../core/generation/imageProvider.js'
import { AppStore } from '../../infra/store.js'

const configuredImageProvider: ImageGenerationProvider = {
  async generate() {
    throw new Error('image2 route tests should not call the provider')
  },
}

let app: Awaited<ReturnType<typeof buildApp>> | undefined
let store: AppStore | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  store = undefined
})

describe('image2 batch api', { timeout: 30_000 }, () => {
  it('creates image tasks with server-owned pricing and provider metadata', async () => {
    const projectId = await startConfiguredAppAndCreateProject()
    const cookie = await login('member@seqora.local', 'MemberPassword123!')

    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/image2/batches',
      headers: { cookie },
      payload: {
        clientRequestId: 'image2-server-priced',
        projectId,
        prompt: 'A still frame from a quiet rehearsal room',
        negativePrompt: 'watermark',
        aspectRatio: '16:9',
        quality: 'high',
        imageCount: 3,
      },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({
      batchId: 'image2-image2-server-priced',
      providerName: IMAGE2_PROVIDER_DISPLAY_NAME,
      model: IMAGE2_MODEL_ID,
      creditsPerImage: IMAGE2_CREDITS_PER_IMAGE,
      estimatedCredits: IMAGE2_CREDITS_PER_IMAGE * 3,
    })
    expect(response.json().tasks).toHaveLength(3)
    expect(response.json().tasks[0]).toMatchObject({
      provider: 'img2',
      model: IMAGE2_MODEL_ID,
      estimatedCredits: IMAGE2_CREDITS_PER_IMAGE,
      metadata: expect.objectContaining({
        image2BatchId: 'image2-image2-server-priced',
        batchSize: 3,
        aspectRatio: '16:9',
        quality: 'high',
        providerDisplayName: IMAGE2_PROVIDER_DISPLAY_NAME,
      }),
    })

    expect(
      store!.read((state) =>
        state.tasks.filter((task) => task.metadata.image2BatchId === 'image2-image2-server-priced'),
      ),
    ).toHaveLength(3)
    expect(
      store!.read((state) =>
        state.ledger.filter((entry) => entry.id.startsWith('generation-image2-image2-server-priced-')),
      ),
    ).toHaveLength(3)
    expect(memberCredits()).toBe(268)
  })

  it('rejects browser-supplied provider credentials and estimated credits', async () => {
    const projectId = await startConfiguredAppAndCreateProject()
    const cookie = await login('member@seqora.local', 'MemberPassword123!')

    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/image2/batches',
      headers: { cookie },
      payload: {
        projectId,
        prompt: 'A still frame from a quiet rehearsal room',
        provider: 'img2',
        apiBase: 'https://provider.example.com',
        apiKey: 'browser-key',
        estimatedCredits: 0,
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('does not partially create or charge tasks when credits are insufficient', async () => {
    const projectId = await startConfiguredAppAndCreateProject()
    const cookie = await login('member@seqora.local', 'MemberPassword123!')
    await setMemberCredits(10)

    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/image2/batches',
      headers: { cookie },
      payload: {
        clientRequestId: 'image2-insufficient',
        projectId,
        prompt: 'A still frame from a quiet rehearsal room',
        imageCount: 2,
      },
    })

    expect(response.statusCode).toBe(402)
    expect(response.json().error.code).toBe('INSUFFICIENT_CREDITS')
    expect(
      store!.read((state) =>
        state.tasks.filter((task) => task.clientRequestId.startsWith('image2-image2-insufficient-')),
      ),
    ).toHaveLength(0)
    expect(
      store!.read((state) =>
        state.ledger.filter((entry) => entry.id.startsWith('generation-image2-image2-insufficient-')),
      ),
    ).toHaveLength(0)
    expect(memberCredits()).toBe(10)
  })

  it('replays client request ids without charging twice', async () => {
    const projectId = await startConfiguredAppAndCreateProject()
    const cookie = await login('member@seqora.local', 'MemberPassword123!')
    const payload = {
      clientRequestId: 'image2-replay',
      projectId,
      prompt: 'A still frame from a quiet rehearsal room',
      imageCount: 2,
    }

    const first = await app!.inject({
      method: 'POST',
      url: '/api/v1/image2/batches',
      headers: { cookie },
      payload,
    })
    const second = await app!.inject({
      method: 'POST',
      url: '/api/v1/image2/batches',
      headers: { cookie },
      payload,
    })

    expect(first.statusCode).toBe(202)
    expect(second.statusCode).toBe(202)
    expect(second.json().tasks.map((task: { id: string }) => task.id)).toEqual(
      first.json().tasks.map((task: { id: string }) => task.id),
    )
    expect(
      store!.read((state) =>
        state.tasks.filter((task) => task.clientRequestId.startsWith('image2-image2-replay-')),
      ),
    ).toHaveLength(2)
    expect(
      store!.read((state) =>
        state.ledger.filter((entry) => entry.id.startsWith('generation-image2-image2-replay-')),
      ),
    ).toHaveLength(2)
    expect(memberCredits()).toBe(274)
  })

  it('returns clear errors for missing provider configuration and invalid references', async () => {
    const unavailableProjectId = await startConfiguredAppAndCreateProject({ imageProvider: null })
    const unavailableCookie = await login('member@seqora.local', 'MemberPassword123!')

    const unavailable = await app!.inject({
      method: 'POST',
      url: '/api/v1/image2/batches',
      headers: { cookie: unavailableCookie },
      payload: {
        projectId: unavailableProjectId,
        prompt: 'A still frame from a quiet rehearsal room',
      },
    })

    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json().error.code).toBe('IMAGE2_PROVIDER_NOT_CONFIGURED')

    const projectId = await startConfiguredAppAndCreateProject()
    const cookie = await login('member@seqora.local', 'MemberPassword123!')
    const invalidReference = await app!.inject({
      method: 'POST',
      url: '/api/v1/image2/batches',
      headers: { cookie },
      payload: {
        projectId,
        prompt: 'A still frame from a quiet rehearsal room',
        referenceMediaIds: ['00000000-0000-4000-8000-000000000001'],
      },
    })

    expect(invalidReference.statusCode).toBe(404)
    expect(invalidReference.json().error.code).toBe('REFERENCE_MEDIA_NOT_FOUND')
  })
})

async function startConfiguredAppAndCreateProject(
  overrides: { imageProvider?: ImageGenerationProvider | null } = {},
): Promise<string> {
  store = new AppStore(null)
  await store.initialize()
  app = await buildApp({
    config: localConfig(),
    store,
    startWorker: false,
    taskDispatcher: noopTaskDispatcher,
    imageProvider: overrides.imageProvider === undefined ? configuredImageProvider : overrides.imageProvider,
  })
  const cookie = await login('member@seqora.local', 'MemberPassword123!')
  const createdProject = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: { cookie },
    payload: { name: 'Image2 Batch Project', contentType: 'short-drama', aspectRatio: '9:16' },
  })
  expect(createdProject.statusCode).toBe(201)
  return createdProject.json().id as string
}

function localConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    DATABASE_URL: '',
    DATA_FILE: ':memory:',
    TASK_QUEUE_DRIVER: 'inline',
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

function memberCredits(): number {
  if (!store) throw new Error('Store is not ready')
  const user = store.read((state) => state.users.find((item) => item.id === 'user-member' && item.tenantId === 'tenant-seqora-demo'))
  if (!user) throw new Error('Member user not found')
  return user.credits
}

async function setMemberCredits(credits: number): Promise<void> {
  if (!store) throw new Error('Store is not ready')
  await store.mutate((state) => {
    const user = state.users.find((item) => item.id === 'user-member' && item.tenantId === 'tenant-seqora-demo')
    if (!user) throw new Error('Member user not found')
    user.credits = credits
  })
}

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}
