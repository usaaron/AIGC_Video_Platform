import type { GenerationTask } from '@seqora/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { buildApp } from './app.js'
import type { AppConfig } from './config.js'
import type { VideoGenerationProvider } from './core/generation/videoProvider.js'
import type { ImageGenerationProvider } from './core/generation/imageProvider.js'
import { TextGenerationProviderError, type TextGenerationProvider } from './core/generation/textProvider.js'
import type { AssetLibraryProvider, ProviderPortrait } from './core/generation/volcArkAssetLibraryProvider.js'
import type { FilmPreviewDispatcher } from './core/film/filmPreviewComposer.js'
import { AppStore, defaultAssetAttributes } from './infra/store.js'
import { LocalObjectStorage } from './infra/objectStorage.js'

const testConfig: AppConfig = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: 8787,
  WEB_ORIGIN: 'http://localhost:5173',
  PUBLIC_API_BASE_URL: '',
  TRUST_PROXY: false,
  RATE_LIMIT_MAX: 300,
  AUTH_MODE: 'demo',
  AUTH_SECRET: 'test-secret-with-at-least-32-characters',
  BOOTSTRAP_CREATOR_NAME: '林夏',
  BOOTSTRAP_CREATOR_EMAIL: 'creator@seqora.local',
  BOOTSTRAP_CREATOR_PASSWORD: 'Creator123!',
  BOOTSTRAP_ADMIN_NAME: '平台管理员',
  BOOTSTRAP_ADMIN_EMAIL: 'admin@seqora.local',
  BOOTSTRAP_ADMIN_PASSWORD: 'Admin123!',
  BOOTSTRAP_DEMO_WORKSPACE: true,
  DATA_FILE: ':memory:',
  STORAGE_DRIVER: 'local',
  UPLOAD_DIR: resolve('./data/test-uploads'),
  GCS_BUCKET: '',
  MAX_UPLOAD_BYTES: 10_485_760,
  VIDEO_PROVIDER: 'stringx',
  STRINGX_BASE_URL: 'https://maas.stringx.top/api/v3',
  STRINGX_API_KEY: '',
  STRINGX_VIDEO_MODEL: 'doubao-seedance-2-0-260128',
  STRINGX_REQUEST_TIMEOUT_MS: 30_000,
  AIDEOS_BASE_URL: 'https://aideos.openrouter.icu',
  AIDEOS_API_KEY: '',
  AIDEOS_VIDEO_MODEL: 'doubao-seedance-2-0-260128',
  AIDEOS_REQUEST_TIMEOUT_MS: 30_000,
  VIDEO_POLL_INTERVAL_MS: 5_000,
  ARK_API_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3',
  ARK_API_KEY: '',
  ARK_VIDEO_MODEL: 'doubao-seedance-2-0-260128',
  ARK_REQUEST_TIMEOUT_MS: 30_000,
  VOLC_ASSET_BASE_URL: 'https://maas-ark.stringx.top',
  VOLC_ACCESS_KEY: '',
  VOLC_SECRET_KEY: '',
  VOLC_ARK_PROJECT_NAME: 'default',
  ASSET_LIBRARY_CONSOLE_URL: '',
  VOLC_ASSET_REQUEST_TIMEOUT_MS: 30_000,
  FFMPEG_PATH: 'ffmpeg',
  FILM_PREVIEW_TIMEOUT_MS: 60_000,
  TOKENADVENT_BASE_URL: 'https://tokenadvent.com',
  TOKENADVENT_API_KEY: '',
  IMG2_MODEL: 'gpt-image-2',
  IMG2_QUALITY: 'low',
  TEXT_MODEL: 'gpt-5.4',
  TOKENADVENT_REQUEST_TIMEOUT_MS: 180_000,
}

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  await rm(testConfig.UPLOAD_DIR, { recursive: true, force: true })
})

describe('API authorization', () => {
  it('returns the persisted project when creating a project', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: { name: 'CG 展示片', contentType: 'animation', aspectRatio: '16:9' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      id: expect.any(String),
      name: 'CG 展示片',
      contentType: 'animation',
      aspectRatio: '16:9',
      status: 'draft',
    })
  })

  it('returns the persisted shot when creating a shot', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/shots',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: {
        title: 'CG 展示镜头',
        framing: '大全景',
        duration: 5,
        prompt: '人物站在云海上方。',
        continuityMode: 'independent',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      id: expect.any(String),
      projectId: 'project-midnight-film',
      title: 'CG 展示镜头',
      order: expect.any(Number),
      duration: 5,
    })
  })

  it('keeps Aideos available as an explicit fallback provider', async () => {
    app = await buildApp({
      config: { ...testConfig, VIDEO_PROVIDER: 'aideos', AIDEOS_API_KEY: 'test-aideos-token' },
      startWorker: false,
    })

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      providers: { seedance: 'configured' },
      providerNames: { seedance: 'aideos-seedance' },
    })
  })

  it('configures StringX as the default Seedance provider', async () => {
    app = await buildApp({
      config: { ...testConfig, STRINGX_API_KEY: 'test-stringx-token' },
      startWorker: false,
    })

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      providers: { seedance: 'configured' },
      providerNames: { seedance: 'stringx-seedance' },
    })
  })

  it('blocks photorealistic video references before charging, then accepts an active portrait binding', async () => {
    const assetLibraryProvider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'group-aigc-1',
      createVirtualAsset: async () => portrait('AIGC'),
      getPortrait: async () => portrait('LivenessFace'),
      getPortraitPreview: async () => ({
        content: Buffer.from('whitelist-preview'),
        contentType: 'image/png',
      }),
      listPortraits: async (groupType) => [portrait(groupType)],
      listAuthorizedPortraits: async () => [portrait('LivenessFace')],
    }
    app = await buildApp({
      config: testConfig,
      assetLibraryProvider,
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const whitelist = await app.inject({
      method: 'GET',
      url: '/api/v1/trusted-assets/portraits?groupType=LivenessFace',
      headers,
    })
    expect(whitelist.statusCode).toBe(200)
    expect(whitelist.json()).toMatchObject([
      { assetId: 'asset-live-1', groupType: 'LivenessFace', status: 'active' },
    ])
    const whitelistPreview = await app.inject({
      method: 'GET',
      url: '/api/v1/trusted-assets/portraits/asset-live-1/preview',
      headers,
    })
    expect(whitelistPreview.statusCode).toBe(200)
    expect(whitelistPreview.headers['content-type']).toContain('image/png')
    expect(whitelistPreview.body).toBe('whitelist-preview')
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/assets',
      headers,
      payload: {
        kind: 'character',
        sourceMode: 'generate',
        name: '演员甲',
        attributes: {
          ...defaultAssetAttributes('character'),
          visualStyle: 'photorealistic',
        },
      },
    })
    expect(created.statusCode).toBe(201)
    const assetId = created.json().id as string
    const before = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'blocked-face-video',
        projectId: 'project-midnight-film',
        kind: 'video',
        label: '仿真人镜头',
        provider: 'seedance',
        estimatedCredits: 18,
        metadata: { referenceAssetIds: [assetId] },
      },
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toMatchObject({ error: { code: 'TRUSTED_PORTRAIT_REQUIRED' } })
    const afterBlocked = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(afterBlocked.json().credits).toBe(before.json().credits)

    const bound = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/assets/${assetId}/trusted-portrait/bind`,
      headers,
      payload: { providerAssetId: 'asset-live-1' },
    })
    expect(bound.statusCode).toBe(200)
    expect(bound.json()).toMatchObject({
      attributes: {
        portraitSource: 'authorized-real',
        trustedPortrait: { assetId: 'asset-live-1', groupType: 'LivenessFace', status: 'active' },
      },
    })

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'trusted-face-video',
        projectId: 'project-midnight-film',
        kind: 'video',
        label: '可信真人镜头',
        provider: 'seedance',
        estimatedCredits: 18,
        metadata: { referenceAssetIds: [assetId] },
      },
    })
    expect(accepted.statusCode).toBe(202)
  })

  it('rejects StringX MaaS portraits on Aideos before charging', async () => {
    const assetLibraryProvider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'group-aigc-1',
      createVirtualAsset: async () => portrait('AIGC'),
      getPortrait: async () => ({ ...portrait('AIGC'), assetId: 'maas-active-character-1' }),
      listPortraits: async (groupType) => [portrait(groupType)],
      listAuthorizedPortraits: async () => [portrait('LivenessFace')],
    }
    app = await buildApp({
      config: { ...testConfig, VIDEO_PROVIDER: 'aideos', AIDEOS_API_KEY: 'third-party-token' },
      assetLibraryProvider,
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/assets',
      headers,
      payload: {
        kind: 'character',
        sourceMode: 'generate',
        name: '弦序虚拟人物',
        attributes: defaultAssetAttributes('character'),
      },
    })
    const assetId = created.json().id as string
    const bound = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/assets/${assetId}/trusted-portrait/bind`,
      headers,
      payload: { providerAssetId: 'maas-active-character-1' },
    })
    expect(bound.statusCode).toBe(200)
    const before = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'cross-provider-video',
        projectId: 'project-midnight-film',
        kind: 'video',
        label: '跨 Provider 人物镜头',
        provider: 'seedance',
        estimatedCredits: 18,
        metadata: { referenceAssetIds: [assetId] },
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: 'VIDEO_ASSET_PROVIDER_MISMATCH' } })
    const after = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(after.json().credits).toBe(before.json().credits)
  })

  it('does not expose the removed demo character assets', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().assets).toHaveLength(4)
    expect(response.json().assets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'asset-lin' }),
        expect.objectContaining({ id: 'asset-zhou' }),
      ]),
    )
  })

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

  it('blocks a second active video batch for the same shot without charging, then allows a terminal retry', async () => {
    const store = new AppStore(null)
    app = await buildApp({ config: testConfig, store, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const before = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    const startingCredits = before.json().credits as number

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'batch-parallel-shot-1',
        projectId: 'project-midnight-film',
        kind: 'video',
        label: '并发批次 · 镜头 01',
        provider: 'seedance',
        estimatedCredits: 18,
        metadata: {
          shotId: 'shot-1',
          batchId: 'batch-parallel',
          batchMode: 'parallel',
          resolution: '720p',
          continuityMode: 'independent',
        },
      },
    })
    expect(first.statusCode).toBe(202)
    const firstTaskId = first.json().id as string
    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === firstTaskId)!
      task.status = 'paused'
    })

    const conflicting = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'batch-continuity-shot-1',
        projectId: 'project-midnight-film',
        kind: 'video',
        label: '串联批次 · 镜头 01',
        provider: 'seedance',
        estimatedCredits: 18,
        metadata: {
          shotId: 'shot-1',
          batchId: 'batch-continuity',
          batchMode: 'continuity',
          resolution: '720p',
          continuityMode: 'independent',
        },
      },
    })
    expect(conflicting.statusCode).toBe(409)
    expect(conflicting.json()).toMatchObject({ error: { code: 'VIDEO_SHOT_BATCH_CONFLICT' } })
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })).json().credits,
    ).toBe(startingCredits - 18)

    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === firstTaskId)!
      task.status = 'failed'
    })
    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'batch-retry-shot-1',
        projectId: 'project-midnight-film',
        kind: 'video',
        label: '重试批次 · 镜头 01',
        provider: 'seedance',
        estimatedCredits: 18,
        metadata: {
          shotId: 'shot-1',
          batchId: 'batch-retry',
          batchMode: 'continuity',
          resolution: '720p',
          continuityMode: 'independent',
        },
      },
    })
    expect(retry.statusCode).toBe(202)
    expect(store.read((state) => state.ledger.map((entry) => entry.id))).toEqual(
      expect.arrayContaining(['generation-batch-parallel-shot-1', 'generation-batch-retry-shot-1']),
    )
    expect(store.read((state) => state.ledger.map((entry) => entry.id))).not.toContain(
      'generation-batch-continuity-shot-1',
    )
  })

  it('pauses, resumes and softly deletes queued tasks with an idempotent refund', async () => {
    const store = new AppStore(null)
    app = await buildApp({ config: testConfig, store, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const before = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    const startingCredits = before.json().credits as number
    const startingUsage = before.json().monthlyUsage as {
      consumedCredits: number
      refundedCredits: number
      netCredits: number
      generationCount: number
    }
    await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'task-control-blocker',
        projectId: 'project-midnight-film',
        kind: 'image',
        label: '占用并发任务',
        estimatedCredits: 1,
      },
    })
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'task-control-client',
        projectId: 'project-midnight-film',
        kind: 'image',
        label: '可暂停任务',
        estimatedCredits: 6,
      },
    })
    const taskId = created.json().id as string

    const paused = await app.inject({
      method: 'POST',
      url: `/api/v1/generation/tasks/${taskId}/pause`,
      headers,
    })
    expect(paused.statusCode).toBe(200)
    expect(paused.json()).toMatchObject({ status: 'paused', metadata: { pausedAt: expect.any(String) } })
    const reserved = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(reserved.json().credits).toBe(startingCredits - 7)
    expect(reserved.json().monthlyUsage).toMatchObject({
      consumedCredits: startingUsage.consumedCredits + 7,
      refundedCredits: startingUsage.refundedCredits,
      netCredits: startingUsage.netCredits + 7,
      generationCount: startingUsage.generationCount + 2,
    })

    const resumed = await app.inject({
      method: 'POST',
      url: `/api/v1/generation/tasks/${taskId}/resume`,
      headers,
    })
    expect(resumed.statusCode).toBe(200)
    expect(resumed.json()).toMatchObject({ status: 'queued', metadata: { resumedAt: expect.any(String) } })

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/generation/tasks/${taskId}`,
      headers,
    })
    expect(deleted.statusCode).toBe(204)
    const stored = store.read((state) => state.tasks.find((task) => task.id === taskId))
    expect(stored).toMatchObject({
      status: 'paused',
      metadata: {
        pausedAt: expect.any(String),
        deletedAt: expect.any(String),
        queueHiddenAt: expect.any(String),
        creditsRefundedAt: expect.any(String),
      },
    })
    const refunded = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(refunded.json().credits).toBe(startingCredits - 1)
    expect(refunded.json().monthlyUsage).toMatchObject({
      consumedCredits: startingUsage.consumedCredits + 7,
      refundedCredits: startingUsage.refundedCredits + 6,
      netCredits: startingUsage.netCredits + 1,
      generationCount: startingUsage.generationCount + 2,
    })
    expect(
      refunded.json().entries.filter((entry: { id: string }) => entry.id === `refund-${taskId}`),
    ).toHaveLength(1)

    const deletedAgain = await app.inject({
      method: 'DELETE',
      url: `/api/v1/generation/tasks/${taskId}`,
      headers,
    })
    expect(deletedAgain.statusCode).toBe(204)
    const afterSecondDelete = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(
      afterSecondDelete.json().entries.filter((entry: { id: string }) => entry.id === `refund-${taskId}`),
    ).toHaveLength(1)
  })

  it('rejects pause and delete while a third-party task is running', async () => {
    const store = new AppStore(null)
    app = await buildApp({ config: testConfig, store, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'running-control-client',
        projectId: 'project-midnight-film',
        kind: 'video',
        label: '第三方运行任务',
        estimatedCredits: 18,
      },
    })
    const taskId = created.json().id as string
    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)!
      task.status = 'running'
      task.metadata = { providerTaskId: 'remote-running-task' }
    })

    const paused = await app.inject({
      method: 'POST',
      url: `/api/v1/generation/tasks/${taskId}/pause`,
      headers,
    })
    expect(paused.statusCode).toBe(409)
    expect(paused.json()).toMatchObject({ error: { code: 'TASK_NOT_PAUSABLE' } })
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/generation/tasks/${taskId}`,
      headers,
    })
    expect(deleted.statusCode).toBe(409)
    expect(deleted.json()).toMatchObject({ error: { code: 'TASK_NOT_DELETABLE' } })
  })

  it('cancels a running StringX task before deleting and refunding it', async () => {
    const cancel = vi.fn(async () => {})
    const videoProvider: VideoGenerationProvider = {
      submit: vi.fn(async () => ({ providerTaskId: 'unused', status: 'queued', progress: 0 })),
      getStatus: vi.fn(async () => ({ status: 'running', progress: 20, error: null })),
      getContent: vi.fn(),
      cancel,
    }
    const store = new AppStore(null)
    app = await buildApp({ config: testConfig, store, videoProvider, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const before = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'running-stringx-cancel',
        projectId: 'project-midnight-film',
        kind: 'video',
        label: '弦序运行任务',
        provider: 'seedance',
        estimatedCredits: 18,
      },
    })
    const taskId = created.json().id as string
    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)!
      task.status = 'running'
      task.metadata = {
        providerName: 'stringx-seedance',
        providerTaskId: 'remote-stringx-running',
      }
    })

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/generation/tasks/${taskId}`,
      headers,
    })

    expect(deleted.statusCode).toBe(204)
    expect(cancel).toHaveBeenCalledWith('remote-stringx-running')
    expect(store.read((state) => state.tasks.find((task) => task.id === taskId))).toMatchObject({
      status: 'cancelled',
      metadata: {
        providerState: 'cancelled',
        cancelledAt: expect.any(String),
        queueHiddenAt: expect.any(String),
        creditsRefundedAt: expect.any(String),
      },
    })
    const after = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(after.json().credits).toBe(before.json().credits)
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
      statusCode: 206,
      acceptRanges: 'bytes',
      contentRange: 'bytes 0-12/100',
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
        range: 'bytes=0-12',
      },
    })

    expect(response.statusCode).toBe(206)
    expect(response.headers['content-type']).toContain('video/mp4')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(response.headers['content-range']).toBe('bytes 0-12/100')
    expect(response.body).toBe('video-content')
    expect(getContent).toHaveBeenCalledWith('remote-video-task', 'bytes=0-12')

    await store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)!
      stored.metadata = { ...stored.metadata, providerName: 'volc-ark-seedance' }
    })
    const mismatched = await app.inject({
      method: 'GET',
      url: task.resultUrl!,
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })
    expect(mismatched.statusCode).toBe(409)
    expect(mismatched.json()).toMatchObject({ error: { code: 'VIDEO_PROVIDER_MISMATCH' } })
    expect(getContent).toHaveBeenCalledTimes(1)
    await store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)!
      stored.metadata = { ...stored.metadata, providerName: 'stringx-seedance' }
    })

    const archived = await app.inject({
      method: 'DELETE',
      url: '/api/v1/projects/project-midnight-film/generation/tasks/completed',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })
    expect(archived.statusCode).toBe(200)
    expect(archived.json()).toEqual({ cleared: 1 })

    const contentAfterArchive = await app.inject({
      method: 'GET',
      url: task.resultUrl!,
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })
    expect(contentAfterArchive.statusCode).toBe(206)
    expect(contentAfterArchive.body).toBe('video-content')
  })

  it('generates a quick script once and returns warnings instead of retrying', async () => {
    const quickScript = Array.from(
      { length: 4 },
      (_, index) =>
        `场次：${index + 1}｜剧情：林夏必须在列车离站前找回父亲留下的胶片，线索突然中断。｜场景：雨夜旧车站站台，冷色灯光映在积水上。｜角色：林夏，短发导演，穿深色风衣，焦急寻找。｜动作：她沿着站台快步搜索，在长椅下发现一只旧铁盒并抬头看向远处。｜对白：林夏（压低声音）“你到底把它藏在哪儿？”`,
    ).join('\n')
    const generate = vi.fn(async () => quickScript)
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/generate',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: {
        draft: '一名导演在雨夜寻找父亲留下的胶片。',
        direction: {
          style: 'photorealistic',
          composition: 'rule-of-thirds',
          lighting: 'low-key',
          camera: 'suspense',
          focus: 'character',
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ script: quickScript, mode: 'quick' })
    expect(response.json().warnings).toEqual([expect.stringContaining('548')])
    expect(generate).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('15 到 30 秒视频'),
        userPrompt: expect.stringContaining('风格：仿真人电影感'),
        maxOutputTokens: 2_400,
      }),
    )
  })

  it('preserves a long source script when the quick output is unexpectedly short', async () => {
    const longSource = Array.from(
      { length: 80 },
      (_, index) =>
        `场次：${index + 1}｜剧情：主角沿着旧线索继续调查并发现新的阻力。｜场景：雨夜车站。｜角色：林夏。｜动作：她打开铁盒确认线索。｜对白：我必须查清楚。`,
    ).join('\n')
    const generate = vi.fn(async () => '场次：1｜剧情：过短')
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/generate',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: { draft: longSource, clientRequestId: 'long-script-preserve' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      script: longSource,
      warnings: [expect.stringContaining('保留原稿')],
    })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('保留原稿'),
        maxOutputTokens: expect.any(Number),
      }),
    )
    expect(generate.mock.calls[0][0].maxOutputTokens).toBeGreaterThanOrEqual(6_000)
  })

  it('enriches the saved quick script only after an explicit request', async () => {
    const quickScript =
      '场次：1｜剧情：林夏寻找胶片。｜场景：雨夜车站。｜角色：林夏。｜动作：她打开铁盒。｜对白：林夏：“找到了。”'
    const detail = '明确目标、视觉执行、人物动作和镜头衔接的具体制作细节'.repeat(2)
    const detailedScript = Array.from({ length: 4 }, (_, index) =>
      [
        `场次：${index + 1}`,
        `剧情：${detail}`,
        `场景：${detail}`,
        `角色：${detail}`,
        `动作：${detail}`,
        `对白：${detail}`,
        `风格：${detail}`,
        `构图：${detail}`,
        `光影：${detail}`,
        `运镜：${detail}`,
        `衔接：${detail}`,
      ].join('｜'),
    ).join('\n')
    const generate = vi.fn().mockResolvedValueOnce(quickScript).mockResolvedValueOnce(detailedScript)
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }

    const quickResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/generate',
      headers,
      payload: { draft: '雨夜重逢的故事。' },
    })
    const enrichedResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/enrich',
      headers,
      payload: { script: quickResponse.json().script },
    })

    expect(quickResponse.statusCode).toBe(200)
    expect(enrichedResponse.statusCode).toBe(200)
    expect(enrichedResponse.json()).toMatchObject({ script: detailedScript, mode: 'detailed', warnings: [] })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        systemPrompt: expect.stringContaining('补齐为可直接用于资产设计'),
        userPrompt: expect.stringContaining(quickScript),
        maxOutputTokens: 4_000,
      }),
    )
  })

  it('preserves the current script and returns an actionable error when text generation is unavailable', async () => {
    app = await buildApp({
      config: testConfig,
      textProvider: {
        generate: vi.fn(async () => {
          throw new TextGenerationProviderError('AI 文本服务连接中断，请稍后重试；原剧本未被修改')
        }),
      },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/generate',
      headers,
      payload: { draft: '需要扩写但不能丢失的原稿。' },
    })
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      error: { code: 'TEXT_PROVIDER_FAILED', message: expect.stringContaining('原剧本未被修改') },
    })
    expect(after.json().project.script).toBe(before.json().project.script)
  })

  it('charges script operations, refunds provider failures and rejects duplicate requests', async () => {
    const quickScript =
      '场次：1｜剧情：主角找到线索。｜场景：雨夜车站。｜角色：林夏。｜动作：打开铁盒。｜对白：找到了。'
    const detailedScript = `${quickScript}｜风格：电影 CG｜构图：三分法｜光影：低调光｜运镜：缓慢推进｜衔接：动作匹配`
    const review = JSON.stringify({
      score: 84,
      verdict: '故事目标清楚，镜头衔接仍可加强。',
      dimensions: ['plot', 'character', 'dialogue', 'style', 'composition', 'lighting', 'camera'].map(
        (key) => ({ key, score: 84, finding: `${key} 检查结果`, suggestion: `${key} 修改建议` }),
      ),
      priorityActions: ['强化动作衔接'],
    })
    const generate = vi
      .fn()
      .mockResolvedValueOnce(quickScript)
      .mockResolvedValueOnce(detailedScript)
      .mockResolvedValueOnce(review)
      .mockRejectedValueOnce(new TextGenerationProviderError('上游暂时不可用'))
    app = await buildApp({ config: testConfig, textProvider: { generate }, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }

    const quick = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/generate',
      headers,
      payload: { clientRequestId: 'script-credit-generate', draft: '雨夜寻找失踪胶片。' },
    })
    expect(quick.statusCode, quick.body).toBe(200)

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/generate',
      headers,
      payload: { clientRequestId: 'script-credit-generate', draft: '不能免费重复生成。' },
    })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json()).toMatchObject({ error: { code: 'DUPLICATE_REQUEST' } })

    const enriched = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/enrich',
      headers,
      payload: { clientRequestId: 'script-credit-enrich', script: quickScript },
    })
    expect(enriched.statusCode, enriched.body).toBe(200)

    const upgraded = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/plan',
      headers,
      payload: { plan: 'member' },
    })
    expect(upgraded.statusCode, upgraded.body).toBe(200)

    const reviewed = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/review',
      headers,
      payload: { clientRequestId: 'script-credit-review', script: detailedScript },
    })
    expect(reviewed.statusCode, reviewed.body).toBe(200)

    const failed = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/generate',
      headers,
      payload: { clientRequestId: 'script-credit-refund', draft: '这次上游会失败。' },
    })
    expect(failed.statusCode).toBe(502)

    const billing = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(billing.statusCode).toBe(200)
    expect(billing.json()).toMatchObject({
      plan: 'member',
      credits: 775,
      concurrency: 3,
      planSelfServiceEnabled: true,
      monthlyUsage: {
        consumedCredits: 14,
        refundedCredits: 3,
        netCredits: 11,
        generationCount: 4,
        includedCredits: 500,
      },
    })
    expect(billing.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'generation-script-generate-script-credit-generate', amount: -3 }),
        expect.objectContaining({ id: 'generation-script-enrich-script-credit-enrich', amount: -5 }),
        expect.objectContaining({ id: 'generation-script-review-script-credit-review', amount: -3 }),
        expect.objectContaining({ id: 'refund-script-generate-script-credit-refund', amount: 3 }),
      ]),
    )
    expect(generate).toHaveBeenCalledTimes(4)
  })

  it('does not call the text provider when script credits are insufficient', async () => {
    const store = new AppStore(null)
    const generate = vi.fn(async () => '不应调用')
    app = await buildApp({ config: testConfig, store, textProvider: { generate }, startWorker: false })
    await store.mutate((state) => {
      const user = state.users.find((item) => item.id === 'user-creator')!
      user.credits = 2
    })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/generate',
      headers,
      payload: { clientRequestId: 'script-insufficient', draft: '余额不足。' },
    })

    expect(response.statusCode).toBe(402)
    expect(response.json()).toMatchObject({ error: { code: 'INSUFFICIENT_CREDITS' } })
    expect(generate).not.toHaveBeenCalled()
  })

  it('grants monthly member credits only once and disables plan self-service in production', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }

    for (const plan of ['member', 'free', 'member'] as const) {
      const changed = await app.inject({
        method: 'PUT',
        url: '/api/v1/billing/plan',
        headers,
        payload: { plan },
      })
      expect(changed.statusCode, changed.body).toBe(200)
    }
    const testSummary = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(testSummary.json()).toMatchObject({ plan: 'member', credits: 786, planSelfServiceEnabled: true })

    await app.close()
    app = await buildApp({ config: { ...testConfig, NODE_ENV: 'production' }, startWorker: false })
    const blocked = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/plan',
      headers,
      payload: { plan: 'member' },
    })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json()).toMatchObject({ error: { code: 'PLAN_CHANGE_REQUIRES_ADMIN' } })
    const productionSummary = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(productionSummary.json()).toMatchObject({ planSelfServiceEnabled: false })
  })

  it('requires membership for a structured professional script review', async () => {
    const generate = vi.fn(async () =>
      JSON.stringify({
        score: 82,
        verdict: '剧情目标清楚，但中段视觉转折不足。',
        dimensions: ['plot', 'character', 'dialogue', 'style', 'composition', 'lighting', 'camera'].map(
          (key) => ({ key, score: 82, finding: `${key}检查结果`, suggestion: `${key}修改建议` }),
        ),
        priorityActions: ['强化中段反转', '明确主角动作目标'],
      }),
    )
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const payload = { script: '场景：雨夜车站\n角色：林夏\n动作：她走入站台。' }

    const freeReview = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/review',
      headers,
      payload,
    })
    expect(freeReview.statusCode).toBe(403)
    expect(freeReview.json()).toMatchObject({ error: { code: 'MEMBERSHIP_REQUIRED' } })
    expect(generate).not.toHaveBeenCalled()

    await app.inject({ method: 'PUT', url: '/api/v1/billing/plan', headers, payload: { plan: 'member' } })
    const memberReview = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/review',
      headers,
      payload,
    })
    expect(memberReview.statusCode).toBe(200)
    expect(memberReview.json()).toMatchObject({
      score: 82,
      verdict: expect.stringContaining('视觉转折'),
      dimensions: expect.arrayContaining([expect.objectContaining({ key: 'camera' })]),
      generatedAt: expect.any(String),
    })
  })

  it('splits the script into at most eight predictable shots without calling the text provider', async () => {
    const generate = vi.fn(async () => '不应调用')
    app = await buildApp({ config: testConfig, textProvider: { generate }, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const script = Array.from({ length: 10 }, (_, index) => `剧本段落 ${index + 1}`).join('\n')
    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/projects/project-midnight-film',
      headers,
      payload: { script },
    })
    expect(updated.statusCode).toBe(200)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/shots/generate',
      headers,
      payload: { maxShots: 8 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(8)
    expect(response.json()[0]).toMatchObject({
      title: '镜头 01',
      prompt: '剧本段落 1',
      continuityMode: 'independent',
      continuityNote: '',
      imageUrl: null,
    })
    expect(response.json()[7]).toMatchObject({
      title: '镜头 08',
      prompt: '剧本段落 8',
      continuityMode: 'independent',
      continuityNote: expect.stringContaining('上一场收束：剧本段落 7'),
      imageUrl: null,
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('preserves omitted asset and shot fields during partial updates', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const workspace = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })
    const asset = workspace.json().assets[0]
    const shot = workspace.json().shots[1]

    const updatedAsset = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/project-midnight-film/assets/${asset.id}`,
      headers,
      payload: { status: 'confirmed' },
    })
    expect(updatedAsset.statusCode).toBe(200)
    expect(updatedAsset.json()).toMatchObject({
      status: 'confirmed',
      prompt: asset.prompt,
      promptMode: asset.promptMode,
      imageUrl: asset.imageUrl,
    })

    const updatedShot = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/project-midnight-film/shots/${shot.id}`,
      headers,
      payload: { prompt: '只修改这一个字段' },
    })
    expect(updatedShot.statusCode).toBe(200)
    expect(updatedShot.json()).toMatchObject({
      prompt: '只修改这一个字段',
      framing: shot.framing,
      duration: shot.duration,
      continuityMode: shot.continuityMode,
    })
  })

  it('splits structured scenes into one continuous shot per action beat', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const scene = (number: number) =>
      [
        `场次：${number}`,
        '剧情：人物抵达车站并发现异常',
        '场景：雨夜旧站台，湿润铁轨和冷白顶灯',
        '角色：林夏，黑色长发，深色轻甲',
        '动作：林夏踏入积水；她举起信封确认地址；她抬头看向倒转的挂钟',
        '对白：林夏低声读信；她停止说话；她屏住呼吸',
        '风格：国漫二维',
        '构图：9:16大全景',
        '光影：冷白顶光',
        '运镜：稳定缓慢推进',
        '衔接：动作方向保持一致',
      ].join('｜')
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/projects/project-midnight-film',
      headers,
      payload: { script: `${scene(1)}\n${scene(2)}` },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/shots/generate',
      headers,
      payload: { mode: 'beat', maxShots: 12 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(6)
    expect(response.json()[0]).toMatchObject({
      title: '场次 1 · 动作 1',
      framing: '大全景',
      duration: 5,
      continuityMode: 'independent',
      prompt: expect.stringContaining('动作：林夏踏入积水'),
    })
    expect(response.json()[1]).toMatchObject({
      title: '场次 1 · 动作 2',
      framing: '中景',
      continuityMode: 'continue',
      continuityNote: expect.stringContaining('上一镜收束：林夏踏入积水'),
      prompt: expect.stringContaining('动作：她举起信封确认地址'),
    })
    expect(response.json()[2]).toMatchObject({
      title: '场次 1 · 动作 3',
      framing: '特写',
      prompt: expect.not.stringContaining('她举起信封确认地址'),
    })
    expect(response.json()[3]).toMatchObject({
      title: '场次 2 · 动作 1',
      continuityMode: 'independent',
      continuityNote: expect.stringContaining('上一场收束：林夏踏入积水'),
    })
  })

  it('serves a generated image after the background task completes', async () => {
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => [
        { view: 'single', contentType: 'image/png', content: Buffer.from('generated-png') },
      ]),
    }
    app = await buildApp({ config: testConfig, imageProvider, startWorker: false })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers,
      payload: {
        clientRequestId: 'image-api-integration',
        projectId: 'project-midnight-film',
        kind: 'image',
        label: '分镜图 01',
        provider: 'img2',
        estimatedCredits: 6,
        prompt: '雨夜车站',
        metadata: { shotId: 'shot-1', aspectRatio: '9:16', references: [] },
      },
    })
    expect(created.statusCode).toBe(202)

    let completed: GenerationTask | undefined
    for (let attempt = 0; attempt < 20 && !completed; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
      const tasks = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/project-midnight-film/generation/tasks',
        headers,
      })
      completed = (tasks.json() as GenerationTask[]).find(
        (task) => task.clientRequestId === 'image-api-integration' && task.status === 'completed',
      )
    }
    expect(completed?.resultUrl).toBeTruthy()
    const output = await app.inject({ method: 'GET', url: completed!.resultUrl!, headers })
    expect(output.statusCode).toBe(200)
    expect(output.headers['content-type']).toContain('image/png')
    expect(output.body).toBe('generated-png')
  })
})

function portrait(groupType: ProviderPortrait['groupType']): ProviderPortrait {
  return {
    assetId: groupType === 'LivenessFace' ? 'asset-live-1' : 'asset-aigc-1',
    groupId: groupType === 'LivenessFace' ? 'group-live-1' : 'group-aigc-1',
    groupType,
    name: '演员甲',
    assetType: 'Image',
    status: 'active',
    previewUrl: 'https://assets.example/portrait.jpg',
    errorCode: null,
    errorMessage: null,
  }
}

describe('film preview composition', () => {
  it('creates a zero-credit composition task from every completed shot video', async () => {
    const store = new AppStore(null)
    const composer: FilmPreviewDispatcher = {
      recoverInterrupted: vi.fn(async () => {}),
      start: vi.fn(async (task) => ({ ...task, status: 'running', progress: 1 })),
    }
    app = await buildApp({ config: testConfig, store, startWorker: false, filmPreviewComposer: composer })
    const now = new Date().toISOString()
    const sourceIds = await store.mutate((state) => {
      const shots = state.shots
        .filter((shot) => shot.projectId === 'project-midnight-film')
        .sort((left, right) => left.order - right.order)
      const tasks = shots.map((shot, index): GenerationTask => ({
        id: `preview-source-${index + 1}`,
        clientRequestId: `preview-source-client-${index + 1}`,
        projectId: shot.projectId,
        tenantId: shot.tenantId,
        userId: 'user-creator',
        kind: 'video',
        label: `${shot.title}视频`,
        prompt: shot.prompt,
        negativePrompt: '',
        provider: 'seedance',
        model: 'doubao-seedance-2-0-260128',
        metadata: { shotId: shot.id, providerTaskId: `provider-${index + 1}` },
        status: 'completed',
        progress: 100,
        estimatedCredits: 18,
        createdAt: now,
        updatedAt: now,
        resultUrl: `/api/v1/generation/tasks/preview-source-${index + 1}/content`,
        outputs: [],
        error: null,
      }))
      state.tasks.unshift(...tasks)
      return tasks.map((task) => task.id)
    })
    const headers = {
      'x-demo-role': 'creator',
      'x-demo-user-id': 'user-creator',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const before = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/film-preview',
      headers,
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({
      provider: 'local-compose',
      status: 'running',
      progress: 1,
      estimatedCredits: 0,
      metadata: {
        generationStage: 'film-preview',
        previewMode: 'full',
        sourceShotCount: sourceIds.length,
        sourceVideoTaskIds: sourceIds,
      },
    })
    expect(composer.start).toHaveBeenCalledOnce()
    const after = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(after.json().credits).toBe(before.json().credits)
  })

  it('composes only the contiguous completed prefix for a partial preview', async () => {
    const store = new AppStore(null)
    const composer: FilmPreviewDispatcher = {
      recoverInterrupted: vi.fn(async () => {}),
      start: vi.fn(async (task) => ({ ...task, status: 'running', progress: 1 })),
    }
    app = await buildApp({ config: testConfig, store, startWorker: false, filmPreviewComposer: composer })
    const now = new Date().toISOString()
    const sourceIds = await store.mutate((state) => {
      const shots = state.shots
        .filter((shot) => shot.projectId === 'project-midnight-film')
        .sort((left, right) => left.order - right.order)
        .slice(0, 2)
      const tasks = shots.map((shot, index): GenerationTask => ({
        id: `partial-preview-source-${index + 1}`,
        clientRequestId: `partial-preview-client-${index + 1}`,
        projectId: shot.projectId,
        tenantId: shot.tenantId,
        userId: 'user-creator',
        kind: 'video',
        label: `${shot.title}视频`,
        prompt: shot.prompt,
        negativePrompt: '',
        provider: 'seedance',
        model: 'doubao-seedance-2-0-260128',
        metadata: { shotId: shot.id, providerTaskId: `partial-provider-${index + 1}` },
        status: 'completed',
        progress: 100,
        estimatedCredits: 18,
        createdAt: now,
        updatedAt: now,
        resultUrl: `/api/v1/generation/tasks/partial-preview-source-${index + 1}/content`,
        outputs: [],
        error: null,
      }))
      state.tasks.unshift(...tasks)
      return tasks.map((task) => task.id)
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/film-preview',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: { mode: 'partial' },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({
      provider: 'local-compose',
      status: 'running',
      estimatedCredits: 0,
      metadata: {
        generationStage: 'film-preview',
        previewMode: 'partial',
        sourceShotCount: 2,
        sourceVideoTaskIds: sourceIds,
      },
    })
    expect(composer.start).toHaveBeenCalledOnce()
  })

  it('serves composed preview MP4 byte ranges from object storage', async () => {
    const store = new AppStore(null)
    app = await buildApp({
      config: testConfig,
      store,
      startWorker: false,
      filmPreviewComposer: null,
    })
    const storageKey = 'tenant-seqora-demo/project-midnight-film/generated/range-preview.mp4'
    await new LocalObjectStorage(testConfig.UPLOAD_DIR).put(
      storageKey,
      Buffer.from('0123456789'),
      'video/mp4',
    )
    const now = new Date().toISOString()
    await store.mutate((state) => {
      state.tasks.unshift({
        id: 'range-preview',
        clientRequestId: 'range-preview-client',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        userId: 'user-creator',
        kind: 'video',
        label: '完整预览',
        prompt: '',
        negativePrompt: '',
        provider: 'local-compose',
        model: null,
        metadata: { generationStage: 'film-preview', previewStorageKey: storageKey },
        status: 'completed',
        progress: 100,
        estimatedCredits: 0,
        createdAt: now,
        updatedAt: now,
        resultUrl: '/api/v1/generation/tasks/range-preview/content',
        outputs: [],
        error: null,
      })
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/generation/tasks/range-preview/content',
      headers: {
        'x-demo-role': 'creator',
        'x-demo-user-id': 'user-creator',
        'x-demo-tenant-id': 'tenant-seqora-demo',
        range: 'bytes=2-5',
      },
    })

    expect(response.statusCode).toBe(206)
    expect(response.headers['content-range']).toBe('bytes 2-5/10')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(response.body).toBe('2345')
  })
})

describe('one-click quick start', () => {
  const headers = {
    'x-demo-role': 'creator',
    'x-demo-user-id': 'user-creator',
    'x-demo-tenant-id': 'tenant-seqora-demo',
  }
  const imageProvider: ImageGenerationProvider = {
    generate: vi.fn(async () => [
      { view: 'single', contentType: 'image/png', content: Buffer.from('quick-start-image') },
    ]),
  }

  it('analyzes the script, estimates the batch and executes it idempotently', async () => {
    const store = new AppStore(null)
    const textProvider: TextGenerationProvider = { generate: vi.fn(async () => quickStartAnalysis()) }
    app = await buildApp({
      config: testConfig,
      store,
      textProvider,
      imageProvider,
      startWorker: false,
    })

    const planned = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/quick-start/plan',
      headers,
    })
    expect(planned.statusCode).toBe(200)
    expect(planned.json()).toMatchObject({
      summary: '用主角、标志服装和暗房建立最小资产闭环',
      sourceScriptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      assets: [
        expect.objectContaining({ kind: 'character', name: '张岚' }),
        expect.objectContaining({ kind: 'costume', name: '张岚的旧风衣' }),
        expect.objectContaining({ kind: 'scene', name: '胶片暗房' }),
      ],
      estimate: {
        assetCount: 3,
        taskCount: 3,
        credits: 16,
        concurrency: 1,
        queueAhead: 0,
        minSeconds: 135,
        maxSeconds: 540,
      },
    })

    const request = {
      clientRequestId: 'quick-start-idempotent',
      sourceScriptHash: planned.json().sourceScriptHash,
      assets: planned.json().assets,
    }
    const executed = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/quick-start/execute',
      headers,
      payload: request,
    })
    expect(executed.statusCode).toBe(202)
    expect(executed.json()).toMatchObject({
      createdAssets: [
        expect.objectContaining({ kind: 'character', name: '张岚' }),
        expect.objectContaining({ kind: 'costume', name: '张岚的旧风衣' }),
        expect.objectContaining({ kind: 'scene', name: '胶片暗房' }),
      ],
      tasks: [
        expect.objectContaining({
          estimatedCredits: 4,
          metadata: expect.objectContaining({ generationStage: 'face' }),
        }),
        expect.objectContaining({ estimatedCredits: 6 }),
        expect.objectContaining({ estimatedCredits: 6 }),
      ],
      replayed: false,
    })
    expect(store.read((state) => state.users.find((user) => user.id === 'user-creator')!.credits)).toBe(270)

    const replayed = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/quick-start/execute',
      headers,
      payload: request,
    })
    expect(replayed.statusCode).toBe(202)
    expect(replayed.json()).toMatchObject({ replayed: true })
    expect(
      store.read((state) => state.assets.filter((asset) => asset.projectId === 'project-midnight-film')),
    ).toHaveLength(7)
    expect(store.read((state) => state.users.find((user) => user.id === 'user-creator')!.credits)).toBe(270)

    const replanned = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/quick-start/plan',
      headers,
    })
    expect(replanned.statusCode).toBe(200)
    expect(replanned.json()).toMatchObject({
      assets: [],
      estimate: { assetCount: 0, taskCount: 0, credits: 0 },
    })
  })

  it('rejects an unaffordable batch without creating partial assets or tasks', async () => {
    const store = new AppStore(null)
    app = await buildApp({
      config: testConfig,
      store,
      textProvider: { generate: vi.fn(async () => quickStartAnalysis()) },
      imageProvider,
      startWorker: false,
    })
    const planned = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/quick-start/plan',
      headers,
    })
    await store.mutate((state) => {
      state.users.find((user) => user.id === 'user-creator')!.credits = 5
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/quick-start/execute',
      headers,
      payload: {
        clientRequestId: 'quick-start-insufficient',
        sourceScriptHash: planned.json().sourceScriptHash,
        assets: planned.json().assets,
      },
    })

    expect(response.statusCode).toBe(402)
    expect(response.json()).toMatchObject({ error: { code: 'INSUFFICIENT_CREDITS' } })
    expect(store.read((state) => state.assets)).toHaveLength(4)
    expect(store.read((state) => state.tasks)).toHaveLength(0)
  })

  it('falls back to deterministic asset extraction when the model does not return valid JSON', async () => {
    const textProvider: TextGenerationProvider = { generate: vi.fn(async () => '这不是有效 JSON') }
    const store = new AppStore(null)
    app = await buildApp({
      config: testConfig,
      store,
      textProvider,
      imageProvider,
      startWorker: false,
    })

    const planned = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/quick-start/plan',
      headers,
    })

    expect(planned.statusCode).toBe(200)
    expect(planned.json()).toMatchObject({
      summary: expect.stringContaining('格式异常'),
      assets: expect.arrayContaining([
        expect.objectContaining({ kind: 'character' }),
        expect.objectContaining({ kind: 'costume' }),
        expect.objectContaining({ kind: 'scene' }),
      ]),
      estimate: expect.objectContaining({ credits: 16 }),
    })
    expect(textProvider.generate).toHaveBeenCalledTimes(2)
  })

  it('requires a new analysis after the saved script changes', async () => {
    const store = new AppStore(null)
    app = await buildApp({
      config: testConfig,
      store,
      textProvider: { generate: vi.fn(async () => quickStartAnalysis()) },
      imageProvider,
      startWorker: false,
    })
    const planned = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/quick-start/plan',
      headers,
    })
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/projects/project-midnight-film',
      headers,
      payload: { script: '剧本已经修改，旧资产计划不能继续执行。' },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/quick-start/execute',
      headers,
      payload: {
        clientRequestId: 'quick-start-stale',
        sourceScriptHash: planned.json().sourceScriptHash,
        assets: planned.json().assets,
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: 'QUICK_START_PLAN_STALE' } })
    expect(store.read((state) => state.assets)).toHaveLength(4)
    expect(store.read((state) => state.tasks)).toHaveLength(0)
  })
})

describe('local authentication', () => {
  it('uses deployment-provided bootstrap credentials for an empty store', async () => {
    app = await buildApp({
      config: {
        ...testConfig,
        AUTH_MODE: 'local',
        BOOTSTRAP_CREATOR_EMAIL: 'tester@example.com',
        BOOTSTRAP_CREATOR_PASSWORD: 'UniqueCreatorPassword123!',
      },
      startWorker: false,
    })

    const oldCredentials = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'creator@seqora.local', password: 'Creator123!' },
    })
    expect(oldCredentials.statusCode).toBe(401)

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'tester@example.com', password: 'UniqueCreatorPassword123!' },
    })
    expect(login.statusCode).toBe(200)
    expect(login.json()).toMatchObject({ account: { email: 'tester@example.com' } })
  })

  it('rate limits repeated failed login attempts', async () => {
    app = await buildApp({ config: { ...testConfig, AUTH_MODE: 'local' }, startWorker: false })
    let response
    for (let attempt = 0; attempt < 11; attempt += 1) {
      response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'nobody@example.com', password: 'IncorrectPassword123!' },
      })
    }

    expect(response?.statusCode).toBe(429)
    expect(response?.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
    })
  })

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
    expect(cookie?.sameSite).toBe('Strict')
    expect(login.headers['cache-control']).toBe('no-store')

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

  it('changes an authenticated account password without accepting the old password afterward', async () => {
    app = await buildApp({ config: { ...testConfig, AUTH_MODE: 'local' }, startWorker: false })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'creator@seqora.local', password: 'Creator123!' },
    })
    const sessionCookie = login.cookies.find((item) => item.name === 'seqora_session')
    const headers = { cookie: `seqora_session=${sessionCookie?.value}` }

    const rejected = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/password',
      headers,
      payload: { currentPassword: 'IncorrectPassword!', newPassword: 'ReplacementPassword123!' },
    })
    expect(rejected.statusCode, rejected.body).toBe(401)
    expect(rejected.json()).toEqual({
      error: { code: 'CURRENT_PASSWORD_INVALID', message: '当前密码错误' },
    })

    const changed = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/password',
      headers,
      payload: { currentPassword: 'Creator123!', newPassword: 'ReplacementPassword123!' },
    })
    expect(changed.statusCode).toBe(204)
    expect(changed.headers['cache-control']).toBe('no-store')

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'creator@seqora.local', password: 'Creator123!' },
    })
    expect(oldLogin.statusCode).toBe(401)

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'creator@seqora.local', password: 'ReplacementPassword123!' },
    })
    expect(newLogin.statusCode).toBe(200)
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

    const importedAsset = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/assets',
      headers,
      payload: {
        kind: 'scene',
        sourceMode: 'import',
        name: '自有街道原图',
        description: '客户提供的可直接使用场景',
        prompt: '',
        imageUrl: '/api/v1/media/imported-scene',
        references: [{ id: 'imported-scene', url: '/api/v1/media/imported-scene', name: 'street.png' }],
        attributes: {
          type: 'scene',
          space: 'exterior',
          sceneType: 'street',
          era: 'modern',
          time: 'day',
          weather: 'clear',
          mood: 'warm',
          camera: 'eye-level',
          visualStyle: 'cinematic-cg',
          emptyScene: true,
          activitySpace: true,
        },
      },
    })
    expect(importedAsset.statusCode).toBe(201)
    expect(importedAsset.json()).toMatchObject({
      sourceMode: 'import',
      prompt: '',
      imageUrl: '/api/v1/media/imported-scene',
      status: 'confirmed',
    })

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

function quickStartAnalysis(): string {
  return JSON.stringify({
    summary: '用主角、标志服装和暗房建立最小资产闭环',
    visualStyle: 'cinematic-cg',
    characters: [
      {
        name: '张岚',
        description: '寻找失踪父亲的青年导演，克制而警觉',
        prompt: '青年女性导演，短发，清晰五官，冷静警觉的神情',
        subjectType: 'human',
        gender: 'female',
        ageGroup: 'young',
        species: '',
        anthropomorphic: false,
        bodyType: 'slim',
      },
    ],
    costumes: [
      {
        name: '张岚的旧风衣',
        description: '贯穿雨夜调查段落的主角服装',
        prompt: '深灰色旧风衣，防水棉质，磨损袖口，暗红色围巾',
        audience: 'female',
        category: 'daily',
        season: 'autumn-winter',
        design: 'retro',
      },
    ],
    scenes: [
      {
        name: '胶片暗房',
        description: '主角发现胶片秘密的核心室内场景',
        prompt: '老式胶片暗房，红色安全灯，冲洗台，墙面挂着湿润胶片',
        space: 'interior',
        sceneType: 'industrial',
        era: 'modern',
        time: 'night',
        weather: 'rain',
        mood: 'mystery',
        camera: 'wide',
      },
    ],
  })
}
