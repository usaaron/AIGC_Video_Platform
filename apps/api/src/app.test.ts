import {
  type AiJob,
  NOVEL_IMPORT_MAX_FILE_BYTES,
  type GenerationTask,
  type NovelSummaryQueueResult,
} from '@seqora/contracts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { readFile, rm, stat } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { TextDecoder } from 'node:util'
import { buildApp } from './app.js'
import type { AppConfig } from './config.js'
import type { VideoGenerationProvider } from './core/generation/videoProvider.js'
import type { ImageGenerationProvider } from './core/generation/imageProvider.js'
import { TextGenerationProviderError, type TextGenerationProvider } from './core/generation/textProvider.js'
import type { AssetLibraryProvider, ProviderPortrait } from './core/generation/volcArkAssetLibraryProvider.js'
import type { FilmPreviewDispatcher } from './core/film/filmPreviewComposer.js'
import { GenerationTaskRunner, noopTaskDispatcher } from './core/jobs/taskDispatcher.js'
import { createPublicMediaToken } from './core/media/publicMediaToken.js'
import { AppStore, defaultAssetAttributes } from './infra/store.js'
import { AccountDatabase } from './infra/postgres.js'
import { ProjectRepository } from './modules/projects/repository.js'
import { UserRepository } from './modules/users/repository.js'
import { LocalObjectStorage } from './infra/objectStorage.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from './testing/postgresAuth.js'

const testConfig: AppConfig = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: 8787,
  WEB_ORIGIN: 'http://localhost:5173',
  PUBLIC_API_BASE_URL: '',
  TRUST_PROXY: false,
  RATE_LIMIT_MAX: 300,
  TASK_QUEUE_DRIVER: 'inline',
  TASK_QUEUE_NAME: 'seqora-generation-test',
  TASK_QUEUE_WORKER_CONCURRENCY: 2,
  TASK_QUEUE_POLL_INTERVAL_MS: 5_000,
  REDIS_URL: '',
  AUTH_MODE: 'demo',
  AUTH_SECRET: 'test-secret-with-at-least-32-characters',
  BILLING_WEBHOOK_SECRET: 'test-billing-webhook-secret-32-chars',
  EMAIL_PROVIDER: 'console',
  EMAIL_FROM: 'Seqora <no-reply@seqora.local>',
  EMAIL_REPLY_TO: '',
  RESEND_API_KEY: '',
  AUTH_PASSWORD_RESET_URL: 'http://localhost:5173/reset-password',
  AUTH_INVITATION_URL: 'http://localhost:5173/register',
  PAYMENT_PROVIDER: 'none',
  BILLING_SUCCESS_URL: '',
  BILLING_CANCEL_URL: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  STRIPE_MEMBER_PRICE_ID: '',
  STRIPE_CREDIT_PRICE_ID: '',
  STRIPE_CREDIT_PACK_CREDITS: 100,
  BOOTSTRAP_MEMBER_NAME: '默认 C 端用户',
  BOOTSTRAP_MEMBER_EMAIL: 'member@seqora.local',
  BOOTSTRAP_MEMBER_PASSWORD: 'MemberPassword123!',
  BOOTSTRAP_OWNER_NAME: '平台所有者',
  BOOTSTRAP_OWNER_EMAIL: 'owner@seqora.local',
  BOOTSTRAP_OWNER_PASSWORD: 'OwnerPassword123!',
  BOOTSTRAP_SUPER_ADMIN_NAME: '超级管理员',
  BOOTSTRAP_SUPER_ADMIN_EMAIL: 'superadmin@seqora.local',
  BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'SuperAdmin123!',
  BOOTSTRAP_ADMIN_NAME: '平台管理员',
  BOOTSTRAP_ADMIN_EMAIL: 'admin@seqora.local',
  BOOTSTRAP_ADMIN_PASSWORD: 'Admin123!',
  BOOTSTRAP_ACCOUNTS_ON_START: true,
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
  STRINGX_SEEDANCE_DEFAULT_TIER: 'fast',
  STRINGX_SEEDANCE_MINI_MODEL: 'doubao-seedance-2-0-260128',
  STRINGX_SEEDANCE_FAST_MODEL: 'doubao-seedance-2-0-260128',
  STRINGX_SEEDANCE_PRO_MODEL: 'doubao-seedance-2-0-260128',
  STRINGX_REQUEST_TIMEOUT_MS: 30_000,
  VIDEO_POLL_INTERVAL_MS: 5_000,
  VIDEO_STATUS_TIMEOUT_MS: 10_000,
  VIDEO_POLL_CONCURRENCY: 6,
  VIDEO_PROCESSING_STALL_TIMEOUT_MS: 360_000,
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
  DEEPSEEK_BASE_URL: 'https://maas.stringx.top',
  DEEPSEEK_API_KEY: '',
  DEEPSEEK_MODEL: 'deepseekV3',
  DEEPSEEK_CHAT_COMPLETIONS_PATH: '/api/v1/chat/completions',
  DEEPSEEK_REQUEST_TIMEOUT_MS: 180_000,
  DEEPSEEK_V4_BASE_URL: 'https://hk.shanyoucloud.com',
  DEEPSEEK_V4_API_KEY: '',
  DEEPSEEK_V4_MODEL: 'deepseek-v4-flash',
  DEEPSEEK_V4_CHAT_COMPLETIONS_PATH: '/chat/completions',
  DEEPSEEK_V4_REQUEST_TIMEOUT_MS: 180_000,
  DASHSCOPE_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_API_KEY: '',
  DASHSCOPE_MODEL: 'deepseek-v4-flash-0731',
  DASHSCOPE_CHAT_COMPLETIONS_PATH: '/chat/completions',
  DASHSCOPE_REQUEST_TIMEOUT_MS: 180_000,
  REHDASU_BASE_URL: 'https://tokenadvent.com',
  REHDASU_API_KEY: '',
  REHDASU_MODEL: 'glm-5.2',
  REHDASU_CHAT_COMPLETIONS_PATH: '/v1/chat/completions',
  REHDASU_REQUEST_TIMEOUT_MS: 180_000,
  TOKENADVENT_BASE_URL: 'https://tokenadvent.com',
  TOKENADVENT_API_KEY: '',
  SEQORA_IMAGE2_BASE_URL: 'https://tokenadvent.com',
  SEQORA_IMAGE2_API_KEY: '',
  SEQORA_IMAGE2_MODEL: 'gpt-image-2',
  IMG2_MODEL: 'gpt-image-2',
  IMG2_QUALITY: 'low',
  TEXT_MODEL: 'gpt-5.6',
  TOKENADVENT_REQUEST_TIMEOUT_MS: 180_000,
}

type MemoryLogEntry = {
  level: string
  args: unknown[]
}

class MemoryLogger {
  public readonly entries: MemoryLogEntry[] = []
  public level = 'info'
  public silent = false

  child(): MemoryLogger {
    return this
  }

  trace(...args: unknown[]): void {
    this.entries.push({ level: 'trace', args })
  }

  debug(...args: unknown[]): void {
    this.entries.push({ level: 'debug', args })
  }

  info(...args: unknown[]): void {
    this.entries.push({ level: 'info', args })
  }

  warn(...args: unknown[]): void {
    this.entries.push({ level: 'warn', args })
  }

  error(...args: unknown[]): void {
    this.entries.push({ level: 'error', args })
  }

  fatal(...args: unknown[]): void {
    this.entries.push({ level: 'fatal', args })
  }
}

let app: FastifyInstance | undefined
const runLocalNovelRegression = process.env.RUN_NOVEL_FIXTURE_REGRESSION === '1'
const localNovelRegression = runLocalNovelRegression ? describe : describe.skip
const localNovelFixturePaths = {
  biancheng: process.env.NOVEL_REGRESSION_BIANCHENG_PATH ?? 'E:\\Firefox下载\\边城.txt',
  tower: process.env.NOVEL_REGRESSION_TOWER_PATH ?? 'C:\\Users\\Admin\\Downloads\\倾覆之塔.txt',
}

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
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
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

  it('keeps the personal organization and current device available without Postgres', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }

    const [organizations, sessions] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/organizations', headers }),
      app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers }),
    ])

    expect(organizations.statusCode).toBe(200)
    expect(organizations.json()).toMatchObject([
      {
        organization: { id: 'tenant-seqora-demo', name: '个人创作空间' },
        membership: { userId: 'user-member', isPrimary: true, roles: ['member'] },
      },
    ])
    expect(sessions.statusCode).toBe(200)
    expect(sessions.json()).toMatchObject([
      {
        userId: 'user-member',
        tenantId: 'tenant-seqora-demo',
        current: true,
        deviceLabel: '当前浏览器（本地模式）',
      },
    ])
  })

  it('returns the persisted shot when creating a shot', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/shots',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
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

  it('configures StringX as the default Seedance provider', async () => {
    app = await buildApp({
      config: { ...testConfig, STRINGX_API_KEY: 'test-stringx-token' },
      startWorker: false,
    })

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      providers: { seedance: 'configured' },
      providerNames: { seedance: 'stringx-seedance', img2: 'local-mock' },
      readiness: {
        database: { status: 'disabled' },
        redis: { status: 'disabled' },
        queue: { driver: 'inline', name: 'seqora-generation-test' },
        worker: { status: 'missing' },
      },
    })
    expect(response.headers['x-request-id']).toEqual(expect.any(String))
  })

  it('returns readiness failures from the dedicated readiness endpoint', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/readiness' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      ready: false,
      database: { status: 'disabled' },
      redis: { status: 'disabled' },
      queue: { status: 'ready', driver: 'inline' },
      worker: { status: 'missing' },
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
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
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

  it('rejects StringX MaaS portraits on VolcArk before charging', async () => {
    const assetLibraryProvider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'group-aigc-1',
      createVirtualAsset: async () => portrait('AIGC'),
      getPortrait: async () => ({ ...portrait('AIGC'), assetId: 'maas-active-character-1' }),
      listPortraits: async (groupType) => [portrait(groupType)],
      listAuthorizedPortraits: async () => [portrait('LivenessFace')],
    }
    app = await buildApp({
      config: { ...testConfig, VIDEO_PROVIDER: 'volc-ark', ARK_API_KEY: 'official-ark-token' },
      assetLibraryProvider,
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
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

  it('allows members to submit generation tasks', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
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
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
    const staleLeaseTime = new Date().toISOString()
    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)!
      task.leaseOwnerId = 'old-runner'
      task.leaseToken = 'old-token'
      task.leaseAcquiredAt = staleLeaseTime
      task.leaseHeartbeatAt = staleLeaseTime
      task.leaseExpiresAt = staleLeaseTime
    })

    const paused = await app.inject({
      method: 'POST',
      url: `/api/v1/generation/tasks/${taskId}/pause`,
      headers,
    })
    expect(paused.statusCode).toBe(200)
    expect(paused.json()).toMatchObject({
      status: 'paused',
      leaseOwnerId: null,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
      metadata: { pausedAt: expect.any(String) },
    })
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
    expect(resumed.json()).toMatchObject({
      status: 'queued',
      leaseOwnerId: null,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
      metadata: { resumedAt: expect.any(String) },
    })

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/generation/tasks/${taskId}`,
      headers,
    })
    expect(deleted.statusCode).toBe(204)
    const stored = store.read((state) => state.tasks.find((task) => task.id === taskId))
    expect(stored).toMatchObject({
      status: 'paused',
      leaseOwnerId: null,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
      metadata: {
        pausedAt: expect.any(String),
        deletedAt: expect.any(String),
        queueHiddenAt: expect.any(String),
      },
    })
    const visibleAfterDelete = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film/generation/tasks',
      headers,
    })
    expect(visibleAfterDelete.json()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: taskId })]),
    )
    const pendingRefund = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(pendingRefund.json().credits).toBe(startingCredits - 7)

    await new GenerationTaskRunner(store).tick()
    expect(store.read((state) => state.tasks.find((task) => task.id === taskId))).toMatchObject({
      metadata: { creditsRefundedAt: expect.any(String) },
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

  it('rejects pause and requests cancellation while a third-party task is running', async () => {
    const store = new AppStore(null)
    app = await buildApp({ config: testConfig, store, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
    expect(deleted.statusCode).toBe(204)
    expect(store.read((state) => state.tasks.find((item) => item.id === taskId))).toMatchObject({
      status: 'cancelled',
      metadata: {
        providerCancelRequestedAt: expect.any(String),
        cancelledAt: expect.any(String),
        queueHiddenAt: expect.any(String),
      },
    })
  })

  it('marks a running StringX task for cancellation without calling the Provider directly', async () => {
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
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
      const now = new Date().toISOString()
      task.status = 'running'
      task.leaseOwnerId = 'old-runner'
      task.leaseToken = 'old-token'
      task.leaseAcquiredAt = now
      task.leaseHeartbeatAt = now
      task.leaseExpiresAt = now
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
    expect(cancel).not.toHaveBeenCalled()
    expect(store.read((state) => state.tasks.find((task) => task.id === taskId))).toMatchObject({
      status: 'cancelled',
      leaseOwnerId: null,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
      metadata: {
        providerCancelRequestedAt: expect.any(String),
        cancelledAt: expect.any(String),
        queueHiddenAt: expect.any(String),
      },
    })
    const after = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(after.json().credits).toBe(before.json().credits - 18)
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
      headers: { 'x-demo-role': 'admin', 'x-demo-tenant-id': 'tenant-seqora-demo' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ users: 4, activeTasks: 0 })
  })

  it('allows admin accounts to load the user-side billing summary', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: {
        'x-demo-role': 'admin',
        'x-demo-user-id': 'user-admin',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      credits: expect.any(Number),
      monthlyUsage: expect.any(Object),
    })
  })

  it('protects observability metrics and returns operational counters to admins', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers: { 'x-demo-role': 'member' },
    })
    expect(denied.statusCode).toBe(403)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers: { 'x-demo-role': 'admin', 'x-demo-tenant-id': 'tenant-seqora-demo' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      metrics: {
        process: { pid: expect.any(Number), uptimeSeconds: expect.any(Number) },
        http: expect.any(Object),
        queue: expect.any(Object),
        tasks: expect.any(Object),
        aiJobs: expect.any(Object),
        providers: expect.any(Object),
        refunds: expect.any(Object),
        filmPreview: expect.any(Object),
      },
      daily: {
        creditsConsumed: expect.any(Number),
        generationTasks: expect.any(Object),
        aiJobs: expect.any(Object),
        filmPreview: expect.any(Object),
      },
    })
  })

  it('prints trace ids in request logs and exposes Prometheus metrics', async () => {
    const memoryLogger = new MemoryLogger()
    app = await buildApp({
      config: testConfig,
      loggerInstance: memoryLogger as unknown as FastifyBaseLogger,
      startWorker: false,
    })

    const readiness = await app.inject({ method: 'GET', url: '/api/v1/health/readiness' })
    expect(readiness.statusCode).toBe(503)
    expect(readiness.headers['x-request-id']).toEqual(expect.any(String))
    expect(readiness.headers['x-trace-id']).toEqual(expect.any(String))

    const requestLog = memoryLogger.entries.find(
      (entry) =>
        entry.level === 'info' &&
        entry.args[1] === 'request completed' &&
        typeof entry.args[0] === 'object' &&
        entry.args[0] !== null &&
        (entry.args[0] as Record<string, unknown>).route === '/api/v1/health/readiness',
    )
    expect(requestLog).toBeDefined()
    expect(requestLog?.args[0]).toMatchObject({
      requestId: expect.any(String),
      traceId: expect.any(String),
      method: 'GET',
      route: '/api/v1/health/readiness',
      statusCode: 503,
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics/prometheus',
      headers: { 'x-demo-role': 'admin', 'x-demo-tenant-id': 'tenant-seqora-demo' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/plain')
    expect(response.body).toContain('# TYPE seqora_http_request_duration_ms_failures counter')
    expect(response.body).toMatch(
      /seqora_http_request_duration_ms_failures\{method="GET",route="\/api\/v1\/health\/readiness",status="5xx"\} [1-9]\d*/,
    )
    expect(response.body).toContain('# TYPE seqora_refunds_total counter')
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
      userId: 'user-member',
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
      url: `${task.resultUrl}?download=1&filename=${encodeURIComponent('奋斗青年-第1集.mp4')}`,
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
        range: 'bytes=0-12',
      },
    })

    expect(response.statusCode).toBe(206)
    expect(response.headers['content-type']).toContain('video/mp4')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(response.headers['content-range']).toBe('bytes 0-12/100')
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('奋斗青年-第1集.mp4')}`,
    )
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
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
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
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })
    expect(archived.statusCode).toBe(200)
    expect(archived.json()).toEqual({ cleared: 1 })

    const contentAfterArchive = await app.inject({
      method: 'GET',
      url: task.resultUrl!,
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })
    expect(contentAfterArchive.statusCode).toBe(206)
    expect(contentAfterArchive.body).toBe('video-content')
  })

  it('suggests reusable assets from the current script without creating them', async () => {
    const generate = vi.fn(async () => scriptAssetSuggestionsJson())
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/asset-suggestions',
      headers,
      payload: {
        script: '场次：1｜场景：边城药铺｜角色：女剑客、药师｜关键物件：旧长剑｜服装：女剑客雪夜衣装',
        direction: {
          style: 'cinematic-cg',
          composition: 'rule-of-thirds',
          lighting: 'low-key',
          camera: 'restrained',
          focus: 'character',
        },
      },
    })
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      summary: expect.stringContaining('主角'),
      generatedAt: expect.any(String),
      warnings: [],
    })
    expect(response.json().assets.map((asset: { kind: string }) => asset.kind)).toEqual(
      expect.arrayContaining(['character', 'prop', 'scene', 'costume']),
    )
    expect(
      response
        .json()
        .assets.some(
          (asset: { kind: string; name: string }) => asset.kind === 'character' && asset.name === '药师',
        ),
    ).toBe(true)
    expect(after.json().assets).toHaveLength(before.json().assets.length)
    expect(after.json().project.script).toBe(before.json().project.script)
    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0][0]).toMatchObject({
      systemPrompt: expect.stringContaining('资产制片'),
      userPrompt: expect.stringContaining('已有资产'),
    })
    expect(generate.mock.calls[0][0].maxOutputTokens).toBeGreaterThanOrEqual(2_200)
    expect(generate.mock.calls[0][0].maxOutputTokens).toBeLessThanOrEqual(3_200)
    expect(generate.mock.calls[0][0].systemPrompt).toContain('不要返回完整生产提示词')
    expect(generate.mock.calls[0][0].userPrompt).toContain('全剧结构化字段索引')
    expect(generate.mock.calls[0][0].userPrompt).toContain('服装候选：女剑客雪夜衣装')
  })

  it('keeps late-scene asset evidence while compacting a long script suggestion request', async () => {
    const generate = vi.fn(async () =>
      JSON.stringify({
        summary: '优先建立贯穿全剧和结尾揭晓所需的核心资产。',
        assets: [
          {
            kind: 'prop',
            name: '星图密钥',
            description: '结尾揭晓真相所需的关键物件。',
            visualNotes: '黑色金属圆盘，表面有星轨刻线和蓝色微光。',
            reason: '承担结尾转折，后续镜头必须保持外观一致。',
            priority: 5,
          },
        ],
      }),
    )
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const middleScenes = Array.from(
      { length: 40 },
      (_, index) =>
        `场次：${index + 2}｜剧情：调查继续推进，线索发生第${index + 1}次变化。｜场景：调查室｜角色：林川｜动作：林川核对记录并标记疑点。｜对白：[内心独白]林川：还缺最后一块证据。`,
    )
    const script = [
      '场次：1｜剧情：林川开始调查。｜场景：档案馆｜角色：林川｜动作：林川打开旧档案。',
      ...middleScenes,
      '场次：42｜剧情：真相在天台揭晓。｜场景：观星台｜角色：林川｜关键物件：星图密钥｜动作：林川举起黑色金属圆盘，蓝色星轨亮起。',
    ].join('\n')

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/asset-suggestions',
      headers,
      payload: {
        script,
        direction: {
          style: 'cinematic-cg',
          composition: 'rule-of-thirds',
          lighting: 'low-key',
          camera: 'restrained',
          focus: 'character',
        },
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'prop',
          name: '星图密钥',
          prompt: expect.stringContaining('蓝色微光'),
        }),
      ]),
    )
    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0][0].userPrompt).toContain('星图密钥')
    expect(generate.mock.calls[0][0].userPrompt.length).toBeLessThan(script.length)
    expect(generate.mock.calls[0][0].maxOutputTokens).toBeLessThanOrEqual(4_000)
  })

  it('samples the ending of an unstructured long script for asset suggestions', async () => {
    const generate = vi.fn(async () =>
      JSON.stringify({
        summary: '已覆盖全文筛选核心资产。',
        assets: [
          {
            kind: 'brand',
            name: '启明计划',
            description: '结尾出现的公益计划品牌。',
            visualNotes: '准确文字“启明计划”，蓝绿色组合标识。',
            reason: '片尾需要准确复用品牌标识。',
            priority: 5,
            attributes: { exactText: '启明计划' },
          },
        ],
      }),
    )
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const script = `林川开始调查。${'调查经过反复推进，人物关系逐渐变化。'.repeat(500)}片尾出现启明计划品牌标识。`
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/asset-suggestions',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: {
        script,
        direction: {
          style: 'cinematic-cg',
          composition: 'rule-of-thirds',
          lighting: 'low-key',
          camera: 'restrained',
          focus: 'character',
        },
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(generate.mock.calls[0][0].userPrompt).toContain('启明计划品牌标识')
    expect(generate.mock.calls[0][0].userPrompt.length).toBeLessThan(script.length)
  })

  it('fills all structured asset categories when the compact provider result is empty', async () => {
    const generate = vi.fn(async () => JSON.stringify({ summary: '未识别出核心资产。', assets: [] }))
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const rows = Array.from({ length: 42 }, (_, index) => {
      const scene = index < 14 ? '旧城档案馆' : index < 28 ? '地下交通站' : '天台观星台'
      const prop = index === 41 ? '星图密钥' : index % 5 === 0 ? '旧档案盒' : '加密记录本'
      return `场次：S${String(index + 1).padStart(2, '0')}｜剧情：林川与苏遥继续调查。｜场景：${scene}，夜晚｜角色：林川、苏遥｜关键物件：${prop}｜服装：林川深色调查员外套、苏遥浅灰研究员制服｜动作：林川核对记录，苏遥移动关键物件。`
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/asset-suggestions',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: {
        script: rows.join('\n'),
        direction: {
          style: 'cinematic-cg',
          composition: 'rule-of-thirds',
          lighting: 'low-key',
          camera: 'restrained',
          focus: 'character',
        },
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().warnings).toEqual([expect.stringContaining('模型未返回可用资产')])
    expect(response.json().assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'character', name: '林川' }),
        expect.objectContaining({ kind: 'scene', name: '天台观星台' }),
        expect.objectContaining({ kind: 'prop', name: '星图密钥' }),
        expect.objectContaining({ kind: 'costume', name: '苏遥浅灰研究员制服' }),
      ]),
    )
  })

  it('normalizes usable script asset JSON instead of falling back when optional provider fields are missing', async () => {
    const generate = vi.fn(async () =>
      JSON.stringify({
        summary: '建议围绕翠翠、渡口和渡船建立核心资产。',
        assets: [
          {
            kind: 'character',
            name: '翠翠',
            priority: '5',
            attributes: {
              gender: 'female',
              ageGroup: 'young',
              exactAge: null,
              visualStyle: 'cinematic-cg',
            },
          },
          {
            kind: 'character',
            name: '黄狗',
            description: '陪伴翠翠和老船夫的 yellow dog。',
            prompt: 'yellow dog, loyal animal companion, standing near the ferry boat.',
            reason: '黄狗会在渡口镜头反复出现。',
            priority: 4,
            attributes: {
              subjectType: 'animal',
              species: 'dog',
              ageGroup: 'young',
              visualStyle: 'cinematic-cg',
            },
          },
          {
            kind: 'scene',
            name: '茶峒渡口',
            description: '翠翠与老船夫生活的核心外景。',
            prompt: '湘西茶峒渡口空场景，溪水、白塔、渡船和岸边木屋。',
            reason: '渡口会在多个镜头复用。',
            priority: 4,
            attributes: {
              space: 'exterior',
              sceneType: 'nature',
              era: 'recent',
              visualStyle: 'cinematic-cg',
            },
          },
          {
            kind: 'prop',
            name: '渡船',
            description: '老船夫摆渡使用的小船。',
            prompt: '旧木渡船道具，木纹清晰，正面展示。',
            reason: '渡船是场景行动核心物件。',
            attributes: {
              category: 'vehicle',
              material: 'wood',
            },
          },
          {
            kind: 'costume',
            name: '翠翠日常衣装',
            description: '翠翠在渡口生活的朴素日常服装。',
            prompt: '十三岁湘西少女朴素日常衣装，布料自然，完整平铺展示。',
            reason: '角色造型需要跨镜头保持一致。',
            attributes: {
              audience: 'female',
              category: 'daily',
              design: 'chinese',
            },
          },
        ],
      }),
    )
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/asset-suggestions',
      headers,
      payload: {
        script:
          '场次：1｜剧情：茶峒渡口的日常生活。｜场景：茶峒渡口｜角色：十三岁的孙女翠翠、七十岁的老船夫、黄狗｜动作：翠翠坐在渡船旁望向溪水，黄狗守在船头。｜关键道具：渡船｜服装：翠翠日常衣装',
        direction: {
          style: 'cinematic-cg',
          composition: 'rule-of-thirds',
          lighting: 'natural-soft',
          camera: 'restrained',
          focus: 'character',
        },
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      summary: expect.stringContaining('翠翠'),
      warnings: [],
    })
    expect(response.json().assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'character',
          name: '翠翠',
          prompt: expect.stringContaining('翠翠'),
          priority: 5,
          attributes: expect.objectContaining({
            type: 'character',
            subjectType: 'human',
            gender: 'female',
            ageGroup: 'teen',
            exactAge: 13,
            faceReference: null,
            trustedPortrait: null,
          }),
        }),
        expect.objectContaining({
          kind: 'character',
          name: '黄狗',
          description: expect.stringContaining('黄狗'),
          prompt: expect.stringContaining('狗'),
          attributes: expect.objectContaining({
            type: 'character',
            subjectType: 'animal',
            species: 'dog',
            anthropomorphic: false,
          }),
        }),
        expect.objectContaining({
          kind: 'scene',
          name: '茶峒渡口',
          attributes: expect.objectContaining({
            type: 'scene',
            space: 'exterior',
            sceneType: 'nature',
            emptyScene: true,
            activitySpace: true,
          }),
        }),
        expect.objectContaining({
          kind: 'prop',
          name: '渡船',
          attributes: expect.objectContaining({
            type: 'prop',
            category: 'vehicle',
            material: 'wood',
            condition: 'used',
          }),
        }),
        expect.objectContaining({
          kind: 'costume',
          name: '翠翠日常衣装',
          attributes: expect.objectContaining({
            type: 'costume',
            audience: 'female',
            season: 'all-season',
            turnaround: false,
          }),
        }),
      ]),
    )
    expect(generate).toHaveBeenCalledOnce()
  })

  it('falls back to readable character suggestions when the script asset provider returns invalid JSON', async () => {
    const generate = vi.fn(async () => '这不是有效 JSON')
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/asset-suggestions',
      headers,
      payload: {
        script:
          '场次：1｜剧情：茶峒渡口的日常生活。｜场景：茶峒渡口｜角色：七十岁的老船夫、十三岁的翠翠、黄狗｜动作：老船夫撑船，翠翠望向河面，黄狗守在船头。｜对白：无台词',
        direction: {
          style: 'cinematic-cg',
          composition: 'rule-of-thirds',
          lighting: 'low-key',
          camera: 'restrained',
          focus: 'character',
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      summary: expect.stringContaining('提取角色'),
      warnings: [expect.stringContaining('格式异常')],
    })
    expect(response.json().assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'character',
          name: '老船夫',
          description: expect.stringContaining('男性'),
          prompt: expect.stringContaining('船夫/摆渡人'),
          attributes: expect.objectContaining({
            gender: 'male',
            ageGroup: 'senior',
            exactAge: 70,
            subjectType: 'human',
          }),
        }),
        expect.objectContaining({
          kind: 'character',
          name: '翠翠',
          description: expect.stringContaining('女性'),
          prompt: expect.stringContaining('湘西少女'),
          attributes: expect.objectContaining({
            gender: 'female',
            ageGroup: 'teen',
            exactAge: 13,
            subjectType: 'human',
          }),
        }),
        expect.objectContaining({
          kind: 'character',
          name: '黄狗',
          prompt: expect.stringContaining('黄狗'),
          attributes: expect.objectContaining({
            gender: 'unspecified',
            ageGroup: 'young',
            exactAge: null,
            subjectType: 'animal',
            species: '黄狗',
            anthropomorphic: false,
          }),
        }),
      ]),
    )
    expect(generate).toHaveBeenCalledOnce()
  })

  it('imports a novel and splits explicit chapter headings without changing the script', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers,
      payload: {
        clientRequestId: 'novel-import-1',
        name: '雨夜旧站',
        content: [
          '第一章 雨夜来信',
          '林夏收到一封没有署名的信，信里写着午夜旧站的名字。',
          '',
          '第二章 旧车站',
          '她抵达废弃站台，在长椅下发现一只生锈铁盒。',
        ].join('\n'),
      },
    })
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json()).toMatchObject({
      document: {
        id: expect.any(String),
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        name: '雨夜旧站',
        format: 'txt',
        chapterCount: 2,
      },
      chapters: [
        expect.objectContaining({ order: 1, title: '第一章 雨夜来信' }),
        expect.objectContaining({ order: 2, title: '第二章 旧车站' }),
      ],
    })
    expect(response.json().chapters[0].preview).toContain('林夏收到')
    expect(response.json().chapters[0]).toMatchObject({
      splitMode: 'heading',
      sourceStartOffset: 0,
      sourceChapterTitle: '第一章 雨夜来信',
      overlapBeforeChars: 0,
      overlapAfterChars: 0,
      crossesChapterBoundary: false,
    })
    expect(after.json().project.script).toBe(before.json().project.script)

    const documents = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film/novels',
      headers,
    })
    expect(documents.json()).toEqual([expect.objectContaining({ name: '雨夜旧站', chapterCount: 2 })])

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${response.json().document.id}`,
      headers,
    })
    expect(detail.json().chapters).toHaveLength(2)
    expect(detail.body).not.toContain('content')
  })

  it('previews novel splitting without importing a document', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const payload = {
      name: '预览切分',
      format: 'txt',
      splitOptions: {
        mode: 'auto',
        targetChars: 3_000,
        overlapChars: 300,
      },
      content: [
        '第一章 雨夜来信',
        '林夏收到一封没有署名的信，信里写着午夜旧站的名字。',
        '',
        '第二章 旧车站',
        '她抵达废弃站台，在长椅下发现一只生锈铁盒。',
      ].join('\n'),
    }

    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/preview-split',
      headers,
      payload,
    })
    const documentsAfterPreview = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film/novels',
      headers,
    })
    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers,
      payload: { ...payload, clientRequestId: 'preview-then-import' },
    })

    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json()).toMatchObject({
      previewId: expect.any(String),
      name: '预览切分',
      characterCount: expect.any(Number),
      chapterCount: 2,
      splitMode: 'heading',
      splitOptions: {
        mode: 'auto',
        targetChars: 3_000,
        overlapChars: 300,
      },
      coveragePassed: true,
      warnings: [],
      chapters: expect.arrayContaining([
        expect.objectContaining({
          id: 'preview-chapter-1',
          order: 1,
          title: '第一章 雨夜来信',
          splitMode: 'heading',
          sourceChapterTitle: '第一章 雨夜来信',
        }),
      ]),
    })
    expect(preview.body).not.toContain('"content"')
    expect(documentsAfterPreview.json()).toHaveLength(0)
    expect(imported.statusCode, imported.body).toBe(201)
    expect(imported.json().document.chapterCount).toBe(preview.json().chapterCount)
  })

  it('keeps repeated novel imports idempotent by client request id', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const payload = {
      clientRequestId: 'same-novel-import',
      name: '重复导入',
      content: '第一章 开端\n主角发现线索。\n\n第二章 追踪\n主角确认线索。',
    }

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers,
      payload,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers,
      payload,
    })
    const documents = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film/novels',
      headers,
    })

    expect(second.statusCode, second.body).toBe(201)
    expect(second.json().document.id).toBe(first.json().document.id)
    expect(documents.json()).toHaveLength(1)
  })

  it('auto-splits a chapterless novel into bounded segments', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const longContent = '没有章节标题的一段连续剧情。'.repeat(800)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: {
        name: '无标题长文',
        splitOptions: {
          mode: 'auto',
          targetChars: 3_000,
          overlapChars: 300,
        },
        content: longContent,
      },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().document.chapterCount).toBeGreaterThan(1)
    expect(response.json().chapters[0]).toMatchObject({
      title: '自动分段 01',
      order: 1,
      splitMode: 'fixed',
      sourceStartOffset: 0,
      overlapBeforeChars: 0,
      overlapAfterChars: 300,
      crossesChapterBoundary: false,
    })
    expect(response.json().document.characterCount).toBe(longContent.length)
  })

  it('splits oversized detected chapters into ordered source-covered chunks', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const longChapter = '甲'.repeat(2_500)
    const shortChapter = '乙'.repeat(80)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: {
        name: '长章节',
        splitOptions: {
          mode: 'heading',
          targetChars: 1_000,
          overlapChars: 300,
        },
        content: ['第一章 长章', longChapter, '', '第二章 短章', shortChapter].join('\n'),
      },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().document.chapterCount).toBeGreaterThan(2)
    expect(response.json().document.characterCount).toBe(
      response
        .json()
        .chapters.reduce(
          (total: number, chapter: { characterCount: number }) => total + chapter.characterCount,
          0,
        ),
    )
    expect(response.json().chapters[0]).toMatchObject({
      order: 1,
      title: '第一章 长章 · 分段 1',
      splitMode: 'heading',
      sourceChapterTitle: '第一章 长章',
      sourceStartOffset: 0,
      overlapBeforeChars: 0,
      overlapAfterChars: 300,
    })
    expect(response.json().chapters[1]).toMatchObject({
      order: 2,
      sourceChapterTitle: '第一章 长章',
      overlapBeforeChars: 300,
    })
    expect(response.json().chapters.at(-1)).toMatchObject({
      sourceChapterTitle: '第二章 短章',
      crossesChapterBoundary: false,
    })
  })

  it('strips common txt download boilerplate before chapter splitting', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: {
        name: '边城',
        content: [
          '声明：本书为八零电子书(txt02.com)的用户自网络收集整理制作,仅供预览交流学习使用。',
          '---------------------------用户上传之内容开始--------------------------------',
          '',
          '边城',
          '作者：沈从文',
          '内容简介',
          '《边城》展示湘西世界和谐的生命形态。',
          '',
          '第一章 一',
          '由四川过湖南去，靠东有一条官路。',
          '(   重要提示：如果书友们打不开t x t 8 0. c o m 老域名，可以访问本站。   )',
          '',
          '第二章 二',
          '茶峒地方凭水依山筑城。',
        ].join('\n'),
      },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().chapters[0]).toMatchObject({ title: '开篇' })
    expect(response.json().chapters[0].preview).toContain('边城\n作者：沈从文')
    expect(response.body).not.toContain('声明：本书为')
    expect(response.body).not.toContain('重要提示')
  })

  it('accepts large novel imports beyond the old client-only limit', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const largeContent = 'A'.repeat(1_250_000)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: {
        name: '大体量导入',
        content: largeContent,
      },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().document.characterCount).toBe(1_250_000)
    expect(response.json().document.chapterCount).toBeGreaterThan(100)
  })

  it('detects suspicious novel chunk boundaries without changing chapter content', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers,
      payload: {
        name: '边界检测样本',
        splitOptions: {
          mode: 'fixed',
          targetChars: 1_000,
          overlapChars: 300,
        },
        content: '她推开门看见一个陌生人站在雨里'.repeat(180),
      },
    })
    const detected = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}/boundaries/detect`,
      headers,
      payload: { maxBoundaries: 10 },
    })
    const readback = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}/boundaries`,
      headers,
    })
    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}/boundaries/detect`,
      headers,
      payload: { maxBoundaries: 10 },
    })

    expect(imported.statusCode, imported.body).toBe(201)
    expect(imported.json().document.chapterCount).toBeGreaterThan(1)
    expect(detected.statusCode, detected.body).toBe(200)
    expect(detected.json().boundaries.length).toBeGreaterThan(0)
    expect(detected.json().boundaries[0]).toMatchObject({
      previousOrder: 1,
      nextOrder: 2,
      status: 'pending',
      severity: 'medium',
      issues: ['sentence-fragment'],
      note: null,
    })
    expect(detected.json().boundaries[0].previousTail).toContain('她推开门')
    expect(readback.json().boundaries).toHaveLength(detected.json().boundaries.length)
    expect(repeated.json().boundaries[0].id).toBe(detected.json().boundaries[0].id)
  })

  it('generates boundary reconciliation notes without changing original chunks', async () => {
    const generate = vi.fn(async () =>
      JSON.stringify({
        notes: [
          {
            boundaryId: 'provider-can-return-stale-id',
            note: {
              finding: '上一段停在她推开门看见，下一段继续补足看见的对象。',
              caution: '后续摘要时保持同一动作，不要把边界当成新场景。',
            },
          },
        ],
        batchNotes: { sourceType: '边界衔接', cautions: ['对象字段需要被规范化'] },
      }),
    )
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers,
      payload: {
        name: '边界说明样本',
        splitOptions: {
          mode: 'fixed',
          targetChars: 1_000,
          overlapChars: 300,
        },
        content: '她推开门看见一个陌生人站在雨里'.repeat(180),
      },
    })
    const detailBefore = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}`,
      headers,
    })
    const detected = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}/boundaries/detect`,
      headers,
      payload: { maxBoundaries: 1 },
    })
    const boundaryId = detected.json().boundaries[0].id

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}/boundaries/notes/generate`,
      headers,
      payload: {
        clientRequestId: 'boundary-note-1',
        batchSize: 1,
      },
    })
    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}/boundaries/notes/generate`,
      headers,
      payload: {
        clientRequestId: 'boundary-note-1-repeat',
        batchSize: 1,
      },
    })
    const detailAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}`,
      headers,
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      generatedBoundaryIds: [boundaryId],
      missingNoteCount: Math.max(0, detected.json().boundaries.length - 1),
      boundaries: expect.arrayContaining([
        expect.objectContaining({
          id: boundaryId,
          status: 'resolved',
          note: expect.stringContaining('上一段停在她推开门看见'),
        }),
      ]),
      warnings: [expect.stringContaining('来源：边界衔接')],
    })
    expect(repeated.json()).toMatchObject({ generatedBoundaryIds: [] })
    expect(detailAfter.json().chapters).toEqual(detailBefore.json().chapters)
    expect(generate).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('长篇小说切分边界校对员'),
        userPrompt: expect.stringContaining(`boundaryId：${boundaryId}`),
      }),
    )
    const billing = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(billing.json().entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ amount: -2, description: '生成小说边界衔接说明' })]),
    )
  })

  it('rejects obviously unreadable mojibake novel content', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: {
        name: '乱码小说',
        content: '����������Ϊ���������(txt02.com)������������'.repeat(40),
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'NOVEL_CONTENT_UNREADABLE' } })
  })

  it('blocks novel imports across tenants', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-other',
        'x-demo-tenant-id': 'tenant-other',
      },
      payload: {
        name: '越权小说',
        content: '第一章 开端\n这份小说不应导入。',
      },
    })

    expect(response.statusCode).toBe(404)
  })

  it('creates a durable novel summary queue without calling the text provider', async () => {
    const generate = vi.fn(async () => novelChapterSummariesJson())
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue`,
      headers,
      payload: {
        clientRequestId: 'summary-queue-1',
        batchSize: 2,
        maxAttempts: 2,
      },
    })
    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue`,
      headers,
      payload: {
        clientRequestId: 'summary-queue-1',
        batchSize: 2,
        maxAttempts: 2,
      },
    })
    const readback = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue`,
      headers,
    })
    const summaries = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries`,
      headers,
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      document: { id: imported.document.id, chapterCount: 2 },
      queue: {
        id: expect.any(String),
        documentId: imported.document.id,
        status: 'queued',
        batchSize: 2,
        force: false,
        totalItems: 2,
        pendingCount: 2,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
        skippedCount: 0,
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          chapterId: imported.chapters[0].id,
          order: 1,
          status: 'pending',
          attempts: 0,
          maxAttempts: 2,
          sourceChapterTitle: '第一章 雨夜来信',
        }),
      ]),
      summaryCount: 0,
      missingSummaryCount: 2,
    })
    expect(response.body).not.toContain('clientRequestId')
    expect(repeated.json().queue.id).toBe(response.json().queue.id)
    expect(readback.json().queue.id).toBe(response.json().queue.id)
    expect(summaries.json().summaries).toHaveLength(0)
    expect(generate).not.toHaveBeenCalled()
  })

  it('enqueues novel summary queue batches as AI jobs without calling the text provider', async () => {
    const generate = vi.fn(async () => novelChapterSummariesJson())
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      taskDispatcher: noopTaskDispatcher,
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue`,
      headers,
      payload: {
        clientRequestId: 'summary-queue-worker-create',
        batchSize: 2,
        maxAttempts: 2,
      },
    })
    const queueId = created.json().queue.id

    const run = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/run-batch`,
      headers,
      payload: { clientRequestId: 'summary-queue-worker-run', batchSize: 2 },
    })
    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/run-batch`,
      headers,
      payload: { clientRequestId: 'summary-queue-worker-run-again', batchSize: 2 },
    })
    const taskList = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film/ai-jobs',
      headers,
    })
    const billing = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })

    expect(run.statusCode, run.body).toBe(200)
    expect(run.json()).toMatchObject({
      processedItemIds: [],
      failedItemIds: [],
      task: expect.objectContaining({
        kind: 'novel.summaryQueueBatch',
        provider: 'text',
        status: 'queued',
        costCredits: 4,
        input: expect.objectContaining({
          documentId: imported.document.id,
          queueId,
          batchSize: 2,
          pendingItemIds: [created.json().items[0].id, created.json().items[1].id],
        }),
      }),
    })
    expect(repeated.statusCode, repeated.body).toBe(200)
    expect(repeated.json().task.id).toBe(run.json().task.id)
    expect(taskList.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: run.json().task.id,
          kind: 'novel.summaryQueueBatch',
          provider: 'text',
          status: 'queued',
        }),
      ]),
    )
    expect(taskList.json().filter((task: AiJob) => task.kind === 'novel.summaryQueueBatch')).toHaveLength(1)
    expect(billing.json().entries.filter((entry: { amount: number }) => entry.amount === -4)).toHaveLength(1)
    expect(generate).not.toHaveBeenCalled()
  })

  it('runs novel summary queue batches and supports pause, retry and skip', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(novelChapterSummariesJson())
      .mockRejectedValueOnce(new Error('provider down'))
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue`,
      headers,
      payload: {
        clientRequestId: 'summary-queue-run',
        batchSize: 2,
        maxAttempts: 2,
      },
    })
    const queueId = created.json().queue.id
    const firstItemId = created.json().items[0].id
    const secondItemId = created.json().items[1].id

    const paused = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/pause`,
      headers,
    })
    const pausedRun = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/run-batch`,
      headers,
      payload: { clientRequestId: 'summary-queue-paused-run' },
    })
    const resumed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/resume`,
      headers,
    })
    const run = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/run-batch`,
      headers,
      payload: { clientRequestId: 'summary-queue-run-batch', batchSize: 2 },
    })

    let queueAfterRun: NovelSummaryQueueResult | null = null
    await vi.waitFor(async () => {
      const response = await app!.inject({
        method: 'GET',
        url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue`,
        headers,
      })
      queueAfterRun = response.json()
      expect(queueAfterRun).toMatchObject({
        queue: {
          status: 'failed',
          completedCount: 1,
          failedCount: 1,
        },
        items: expect.arrayContaining([
          expect.objectContaining({
            id: firstItemId,
            status: 'completed',
            attempts: 1,
            result: expect.objectContaining({
              summary: expect.stringContaining('林夏收到匿名来信'),
            }),
          }),
          expect.objectContaining({
            id: secondItemId,
            status: 'failed',
            attempts: 1,
            errorMessage: 'provider down',
          }),
        ]),
      })
    })

    const summariesAfterRun = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries`,
      headers,
    })
    const retried = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/items/${secondItemId}/retry`,
      headers,
    })
    const skipped = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/items/${secondItemId}/skip`,
      headers,
    })

    expect(paused.statusCode, paused.body).toBe(200)
    expect(paused.json().queue.status).toBe('paused')
    expect(pausedRun.statusCode).toBe(409)
    expect(pausedRun.json()).toMatchObject({ error: { code: 'NOVEL_SUMMARY_QUEUE_PAUSED' } })
    expect(resumed.json().queue.status).toBe('queued')
    expect(run.statusCode, run.body).toBe(200)
    expect(run.json()).toMatchObject({
      processedItemIds: [],
      failedItemIds: [],
      task: expect.objectContaining({
        kind: 'novel.summaryQueueBatch',
        provider: 'text',
        input: expect.objectContaining({
          documentId: imported.document.id,
          queueId,
        }),
      }),
    })
    expect(summariesAfterRun.json().summaries).toHaveLength(0)
    expect(retried.json()).toMatchObject({
      queue: { status: 'queued', pendingCount: 1 },
      items: expect.arrayContaining([
        expect.objectContaining({ id: secondItemId, status: 'pending', attempts: 1 }),
      ]),
    })
    expect(skipped.json()).toMatchObject({
      queue: { status: 'completed', completedCount: 1, skippedCount: 1 },
      items: expect.arrayContaining([expect.objectContaining({ id: secondItemId, status: 'skipped' })]),
    })
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('commits completed summary queue results into the chapter summary fact store', async () => {
    const generate = vi.fn(async () => novelChapterSummariesJson())
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue`,
      headers,
      payload: {
        clientRequestId: 'summary-queue-commit',
        batchSize: 2,
      },
    })
    const queueId = created.json().queue.id
    const run = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/run-batch`,
      headers,
      payload: { clientRequestId: 'summary-queue-commit-run', batchSize: 2 },
    })

    let queueAfterRun: NovelSummaryQueueResult | null = null
    await vi.waitFor(async () => {
      const response = await app!.inject({
        method: 'GET',
        url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue`,
        headers,
      })
      queueAfterRun = response.json()
      expect(queueAfterRun.queue).toMatchObject({
        status: 'completed',
        completedCount: 2,
      })
    })

    const committed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/commit-results`,
      headers,
      payload: {},
    })
    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summary-queue/${queueId}/commit-results`,
      headers,
      payload: {},
    })
    const summaries = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries`,
      headers,
    })
    const storyBibleReadiness = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/story-bible`,
      headers,
    })
    const committedItemIds = queueAfterRun!.items.map((item) => item.id)

    expect(run.statusCode, run.body).toBe(200)
    expect(run.json()).toMatchObject({
      processedItemIds: [],
      failedItemIds: [],
      task: expect.objectContaining({ kind: 'novel.summaryQueueBatch', provider: 'text' }),
    })
    expect(committed.statusCode, committed.body).toBe(200)
    expect(committed.json()).toMatchObject({
      committedItemIds,
      skippedItemIds: [],
      summaryCount: 2,
      missingSummaryCount: 0,
      summaries: expect.arrayContaining([
        expect.objectContaining({
          chapterId: imported.chapters[0].id,
          summary: expect.stringContaining('林夏收到匿名来信'),
        }),
      ]),
      items: expect.arrayContaining([
        expect.objectContaining({
          id: committedItemIds[0],
          summaryId: expect.any(String),
        }),
      ]),
    })
    expect(repeated.json().summaries).toHaveLength(2)
    expect(summaries.json().summaries).toHaveLength(2)
    expect(storyBibleReadiness.json()).toMatchObject({
      summaryCount: 2,
      chapterCount: 2,
      missingSummaryCount: 0,
    })
  })

  it('generates chapter summaries in batches without exposing chapter content', async () => {
    const generate = vi.fn(async () => novelChapterSummariesJson())
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries/generate`,
      headers,
      payload: {
        clientRequestId: 'chapter-summary-batch',
        batchSize: 2,
      },
    })
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      completed: true,
      generatedSummaries: [
        expect.objectContaining({ order: 1, title: '第一章 雨夜来信' }),
        expect.objectContaining({ order: 2, title: '第二章 旧车站' }),
      ],
      warnings: ['两章都可作为悬疑开场事实源。'],
    })
    expect(response.json().summaries).toHaveLength(2)
    expect(response.body).not.toContain('content')
    expect(after.json().project.script).toBe(before.json().project.script)
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('长篇小说改编统筹'),
        userPrompt: expect.stringContaining('章节序号：1'),
        maxOutputTokens: 4_800,
      }),
    )

    const summaries = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries`,
      headers,
    })
    expect(summaries.json()).toMatchObject({
      completed: true,
      missingSummaryCount: 0,
      summaries: expect.arrayContaining([
        expect.objectContaining({ characters: [expect.stringContaining('林夏：年轻导演')] }),
      ]),
    })
    const billing = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(billing.json().entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ amount: -4, description: '生成小说章节摘要' })]),
    )
  })

  it('normalizes richer provider chapter summary JSON into stable string arrays', async () => {
    const generate = vi.fn(async () => novelChapterSummariesRichJson())
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries/generate`,
      headers,
      payload: {
        clientRequestId: 'chapter-summary-rich-json',
        batchSize: 1,
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().generatedSummaries[0]).toMatchObject({
      title: '第一章 雨夜来信',
      characters: [expect.stringContaining('林夏')],
      locations: [expect.stringContaining('废弃旧车站')],
      keyProps: [expect.stringContaining('匿名来信')],
      adaptationNotes: expect.stringContaining('改编重点'),
    })
  })

  it('reports truncated provider chapter summary JSON as incomplete output', async () => {
    const generate = vi.fn(async () => '{"summaries":[{"order":1,"title":"第一章","summary":"摘要尚未写完"')
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries/generate`,
      headers,
      payload: {
        clientRequestId: 'chapter-summary-truncated-json',
        batchSize: 1,
      },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      error: {
        code: 'PROVIDER_RESPONSE_INVALID',
        message: expect.stringContaining('模型输出被截断'),
      },
    })
  })

  it('generates a story overview only after all chapter summaries are ready', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(novelChapterSummariesJson())
      .mockResolvedValueOnce(novelStoryBibleJson())
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/story-bible/generate`,
      headers,
      payload: { clientRequestId: 'story-bible-before-summaries' },
    })
    expect(blocked.statusCode).toBe(409)

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries/generate`,
      headers,
      payload: { clientRequestId: 'chapter-summary-for-bible', batchSize: 2 },
    })
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/story-bible/generate`,
      headers,
      payload: { clientRequestId: 'story-bible' },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      storyBible: {
        title: '雨夜旧站',
        sourceSummaryCount: 2,
        chapterCount: 2,
        characters: expect.arrayContaining([expect.objectContaining({ name: '林夏' })]),
        locations: expect.arrayContaining([expect.objectContaining({ name: '旧车站' })]),
        keyProps: expect.arrayContaining([expect.objectContaining({ name: '匿名来信' })]),
        worldRules: [expect.stringContaining('胶片')],
      },
      missingSummaryCount: 0,
    })
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/story-bible`,
      headers,
    })
    expect(read.json()).toMatchObject({
      summaryCount: 2,
      missingSummaryCount: 0,
      storyBible: expect.objectContaining({ title: '雨夜旧站' }),
    })
    expect(generate.mock.calls[1][0]).toMatchObject({
      systemPrompt: expect.stringContaining('故事概要编辑'),
      userPrompt: expect.stringContaining('本次使用章节摘要数量：2 / 2'),
      maxOutputTokens: 6_000,
    })
    const billing = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(billing.json().entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ amount: -6, description: '生成小说故事概要' })]),
    )
  })

  it('generates a partial story overview from the selected number of chapter summaries', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(novelChapterSummariesJson())
      .mockResolvedValueOnce(novelStoryBibleJson())
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries/generate`,
      headers,
      payload: { clientRequestId: 'partial-chapter-summary-for-bible', batchSize: 1 },
    })
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/story-bible/generate`,
      headers,
      payload: { clientRequestId: 'partial-story-bible', summaryLimit: 1 },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      storyBible: {
        sourceSummaryCount: 1,
        chapterCount: 2,
      },
      missingSummaryCount: 1,
      warnings: [expect.stringContaining('1 / 2 章摘要')],
    })
    expect(generate.mock.calls[1][0]).toMatchObject({
      userPrompt: expect.stringContaining('本次使用章节摘要数量：1 / 2'),
      maxOutputTokens: 6_000,
    })
    expect(generate.mock.calls[1][0].userPrompt).toContain('开篇权重：高')
  })

  it('normalizes richer provider story overview JSON into stable content', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(novelChapterSummariesJson())
      .mockResolvedValueOnce(novelStoryBibleRichJson())
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries/generate`,
      headers,
      payload: { clientRequestId: 'chapter-summary-for-rich-bible', batchSize: 2 },
    })
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/story-bible/generate`,
      headers,
      payload: { clientRequestId: 'story-bible-rich-json' },
    })

    expect(response.statusCode, response.body).toBe(200)
    const storyBible = response.json().storyBible
    expect(storyBible.characters[0]).toMatchObject({
      name: 'Cuicui',
      role: 'lead',
      description: expect.stringContaining('innocent'),
      storyFunction: expect.stringContaining('grandfather'),
      motivation: expect.stringContaining('waiting'),
      arc: expect.stringContaining('learns'),
    })
    expect(storyBible.locations[0]).toMatchObject({
      name: 'Chadong',
      description: expect.stringContaining('ferry'),
      storyFunction: expect.stringContaining('community'),
    })
    expect(storyBible.keyProps[0]).toMatchObject({
      name: 'Ferry boat',
      description: expect.stringContaining('public boat'),
      storyFunction: expect.stringContaining('connects'),
    })
    expect(storyBible.foreshadowing[0]).toMatchObject({ status: 'ambiguous' })
    expect(storyBible.worldRules[0]).toContain('Ferry is public')
    expect(storyBible.adaptationStrategy).toContain('lyrical')
    expect(storyBible.risks).toHaveLength(10)
  })

  it('suggests reusable assets from novel facts and infers old ferryman attributes', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(bianchengChapterSummariesJson())
      .mockResolvedValueOnce('不是 JSON')
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/summaries/generate`,
      headers,
      payload: { clientRequestId: 'biancheng-summary-for-assets', batchSize: 2 },
    })
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/asset-suggestions`,
      headers,
      payload: { clientRequestId: 'biancheng-novel-assets', maxAssets: 12 },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      summary: expect.stringContaining('资产建议'),
      generatedAt: expect.any(String),
      warnings: [expect.stringContaining('格式异常')],
    })
    const oldFerryman = response
      .json()
      .assets.find(
        (asset: { kind: string; name: string }) => asset.kind === 'character' && asset.name === '老船夫',
      )
    expect(oldFerryman).toMatchObject({
      kind: 'character',
      description: expect.stringContaining('男性'),
      prompt: expect.stringContaining('船夫/摆渡人'),
      attributes: {
        gender: 'male',
        ageGroup: 'senior',
        exactAge: 70,
        subjectType: 'human',
        framing: 'full',
      },
    })
    const cuicui = response
      .json()
      .assets.find(
        (asset: { kind: string; name: string }) => asset.kind === 'character' && asset.name === '翠翠',
      )
    expect(cuicui).toMatchObject({
      kind: 'character',
      description: expect.stringContaining('女性'),
      prompt: expect.stringContaining('湘西少女'),
      attributes: {
        gender: 'female',
        ageGroup: 'teen',
        exactAge: 13,
        subjectType: 'human',
      },
    })
    const yellowDog = response
      .json()
      .assets.find(
        (asset: { kind: string; name: string }) => asset.kind === 'character' && asset.name === '黄狗',
      )
    expect(yellowDog).toMatchObject({
      kind: 'character',
      description: expect.stringContaining('动物角色'),
      prompt: expect.stringContaining('黄狗/家犬'),
      attributes: {
        gender: 'unspecified',
        ageGroup: 'young',
        exactAge: null,
        subjectType: 'animal',
        species: '黄狗',
      },
    })
    expect(
      response.json().assets.some((asset: { kind: string; name: string }) => asset.name === '茶峒渡口'),
    ).toBe(true)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[1][0]).toMatchObject({
      systemPrompt: expect.stringContaining('资产制片'),
      userPrompt: expect.stringContaining('老船夫/祖父/摆渡老人'),
      maxOutputTokens: 6_000,
    })
  })

  it('adapts selected novel chapters into a video script without returning private source content', async () => {
    const adaptedScript =
      '场次：1｜剧情：林夏收到匿名来信并决定赴约。｜场景：雨夜室内｜角色：林夏｜动作：她拆开信纸，抬头看向窗外雨线。｜对白：林夏：旧车站？你到底是谁？｜风格：写实悬疑｜构图：近景手部转中景人物｜光影：冷色低调光｜运镜：缓慢推进｜衔接：雨声压入旧站台远景'
    const generate = vi.fn(async () => adaptedScript)
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)
    const chapterId = imported.chapters[0].id

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/adapt-script`,
      headers,
      payload: {
        clientRequestId: 'adapt-selected-chapter',
        chapterIds: [chapterId],
        targetSeconds: 60,
        mode: 'scene',
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      document: { id: imported.document.id },
      script: adaptedScript,
      targetSeconds: 60,
      mode: 'scene',
      warnings: [expect.stringContaining('尚无摘要'), expect.stringContaining('故事概要')],
    })
    expect(response.json().chapters).toHaveLength(1)
    expect(response.json().chapters[0]).not.toHaveProperty('content')
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('AI 视频改编编剧'),
        userPrompt: expect.stringContaining('林夏收到匿名来信'),
        maxOutputTokens: 6_000,
      }),
    )
  })

  it('requires matching chapter summaries when chapter summary source is selected', async () => {
    const generate = vi.fn(async () => '不会被调用')
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const imported = await importShortNovel(app, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.document.id}/adapt-script`,
      headers,
      payload: {
        clientRequestId: 'adapt-requires-matching-summary',
        chapterIds: [imported.chapters[0].id],
        targetSeconds: 60,
        mode: 'scene',
        sourceOptions: {
          storyBible: false,
          chapterSummaries: true,
          chapterContent: true,
        },
      },
    })

    expect(response.statusCode, response.body).toBe(409)
    expect(response.json()).toMatchObject({
      error: {
        code: 'NOVEL_CHAPTER_SUMMARIES_REQUIRED',
      },
    })
    expect(generate).not.toHaveBeenCalled()
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
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
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
        maxOutputTokens: 4_800,
      }),
    )
  })

  it('preserves a long source script without sending an oversized provider request', async () => {
    const longSource = Array.from(
      { length: 160 },
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
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
      payload: { draft: longSource, clientRequestId: 'long-script-preserve' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      script: longSource,
      warnings: [expect.stringContaining('按段续写')],
    })
    expect(generate).not.toHaveBeenCalled()
    const billing = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: {
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
        'x-demo-tenant-id': 'tenant-seqora-demo',
      },
    })
    expect(billing.json().entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'generation-script-generate-long-script-preserve' }),
      ]),
    )
  })

  it('generates and appends only the next long-form segment', async () => {
    const nextSegment = [
      '场次：3｜剧情：林夏带着旧铁盒进入地下档案室，发现父亲留下的编号被人抹去。｜场景：地下档案室。｜角色：林夏。｜动作：她用手电扫过文件架，在空缺编号前停住。｜对白：林夏：“有人比我先来过。”',
      '场次：4｜剧情：门外脚步逼近，林夏必须藏起铁盒并决定是否继续追查。｜场景：地下档案室门口。｜角色：林夏、陌生看守。｜动作：她关掉手电躲进文件架阴影，铁盒被压在怀里。｜对白：陌生看守：“编号七的档案不能留。”',
    ].join('\n')
    const generate = vi.fn(async () => nextSegment)
    app = await buildApp({
      config: testConfig,
      textProvider: { generate },
      startWorker: false,
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const existing =
      '场次：1｜剧情：林夏找到旧铁盒。｜场景：雨夜车站。｜角色：林夏。｜动作：她打开铁盒。｜对白：无台词。'

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/generate',
      headers,
      payload: {
        draft: existing,
        clientRequestId: 'long-script-segment',
        mode: 'segment',
        segment: { goal: '让林夏进入地下档案室并遇到新阻力', targetMinutes: 5 },
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      mode: 'segment',
      segment: nextSegment,
      script: `${existing}\n\n${nextSegment}`,
    })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('分段编剧'),
        userPrompt: expect.stringContaining('不要重写已有内容'),
        maxOutputTokens: 3250,
      }),
    )
    const project = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })
    expect(project.json().project.script).toBe(`${existing}\n\n${nextSegment}`)
    const billing = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(billing.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'generation-script-generate-long-script-segment', amount: -3 }),
      ]),
    )
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
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
    const generate = vi
      .fn()
      .mockResolvedValueOnce(quickScript)
      .mockResolvedValueOnce(detailedScript)
      .mockRejectedValueOnce(new TextGenerationProviderError('上游暂时不可用'))
    app = await buildApp({ config: testConfig, textProvider: { generate }, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
      plan: 'free',
      credits: 278,
      concurrency: 1,
      planSelfServiceEnabled: false,
      monthlyUsage: {
        consumedCredits: 11,
        refundedCredits: 3,
        netCredits: 8,
        generationCount: 3,
        includedCredits: 0,
      },
    })
    expect(billing.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'generation-script-generate-script-credit-generate', amount: -3 }),
        expect.objectContaining({ id: 'generation-script-enrich-script-credit-enrich', amount: -5 }),
        expect.objectContaining({ id: 'refund-script-generate-script-credit-refund', amount: 3 }),
      ]),
    )
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('does not call the text provider when script credits are insufficient', async () => {
    const store = new AppStore(null)
    const generate = vi.fn(async () => '不应调用')
    app = await buildApp({ config: testConfig, store, textProvider: { generate }, startWorker: false })
    await store.mutate((state) => {
      const user = state.users.find((item) => item.id === 'user-member')!
      user.credits = 2
    })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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

  it('blocks frontend plan changes in every environment', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }

    const changed = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/plan',
      headers,
      payload: { plan: 'member' },
    })
    expect(changed.statusCode).toBe(403)
    expect(changed.json()).toMatchObject({ error: { code: 'PLAN_CHANGE_REQUIRES_BILLING_WEBHOOK' } })
    const testSummary = await app.inject({ method: 'GET', url: '/api/v1/billing/summary', headers })
    expect(testSummary.json()).toMatchObject({ plan: 'free', credits: 286, planSelfServiceEnabled: false })

    await app.close()
    app = await buildApp({ config: { ...testConfig, NODE_ENV: 'production' }, startWorker: false })
    const blocked = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/plan',
      headers,
      payload: { plan: 'member' },
    })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json()).toMatchObject({ error: { code: 'PLAN_CHANGE_REQUIRES_BILLING_WEBHOOK' } })
  })

  it('splits the script into at most eight predictable shots without calling the text provider', async () => {
    const generate = vi.fn(async () => '不应调用')
    app = await buildApp({ config: testConfig, textProvider: { generate }, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const script = Array.from({ length: 10 }, (_, index) => `剧本段落 ${index + 1}`).join('\n')
    const workspace = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })
    const episodeId = workspace.json().scriptEpisodes[0].id
    const updated = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/episodes/save',
      headers,
      payload: { episodeId, content: script },
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
      continuityMode: 'continue',
      continuityNote: expect.stringContaining('上一场已完成'),
      imageUrl: null,
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('preserves omitted asset and shot fields during partial updates', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const scene = (number: number) =>
      [
        `场次：${number}`,
        '剧情：人物抵达车站并发现异常',
        '场景：雨夜旧站台，湿润铁轨和冷白顶灯',
        '角色：林夏，黑色长发，深色轻甲',
        '动作：林夏踏入积水；她举起信封确认地址；她抬头看向倒转的挂钟',
        '对白：[对白]林夏：地址没错。；[内心独白]林夏：有人来过。；[音效]脚步溅水声；[环境声]雨声。',
        '风格：国漫二维',
        '构图：9:16大全景',
        '光影：冷白顶光',
        '运镜：稳定缓慢推进',
        '衔接：动作方向保持一致',
      ].join('｜')
    const workspace = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })
    const episodeId = workspace.json().scriptEpisodes[0].id
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/episodes/save',
      headers,
      payload: { episodeId, content: `${scene(1)}\n${scene(2)}` },
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
      duration: 4,
      continuityMode: 'independent',
      prompt: expect.stringContaining('动作：林夏踏入积水'),
    })
    expect(response.json()[0].prompt).toContain('[对白]林夏：地址没错。')
    expect(response.json()[0].prompt).toContain('[音效]脚步溅水声')
    expect(response.json()[0].prompt).not.toContain('[内心独白]林夏：有人来过。')
    expect(response.json()[1]).toMatchObject({
      title: '场次 1 · 动作 2',
      framing: '特写',
      continuityMode: 'continue',
      continuityNote: expect.stringContaining('上一镜已完成'),
      prompt: expect.stringContaining('动作：她举起信封确认地址'),
    })
    expect(response.json()[1].prompt).toContain('[内心独白]林夏：有人来过。')
    expect(response.json()[1].prompt).not.toContain('[音效]脚步溅水声')
    expect(response.json()[1].prompt).not.toContain('配角 黑色长发')
    expect(response.json()[2]).toMatchObject({
      title: '场次 1 · 动作 3',
      framing: '近景',
      prompt: expect.not.stringContaining('她举起信封确认地址'),
    })
    expect(response.json()[3]).toMatchObject({
      title: '场次 2 · 动作 1',
      continuityMode: 'continue',
      continuityNote: expect.stringContaining('上一场已完成'),
    })
  })

  it('continues shots in one location but starts a clean visual lane after place or time changes', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const scene = (number: number, location: string, action: string) =>
      [
        `场次：${number}`,
        `场景：${location}`,
        '角色：林夏，黑色长发，深色风衣',
        `动作：${action}`,
        '入场状态：林夏保持上一动作结束姿态',
        `出场状态：${action}已经完成`,
      ].join('｜')
    const workspace = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })
    const episodeId = workspace.json().scriptEpisodes[0].id
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/episodes/save',
      headers,
      payload: {
        episodeId,
        content: [
          scene(1, '雨夜旧站台，冷白顶灯', '林夏推开候车室木门'),
          scene(2, '雨夜旧站台，冷白顶灯', '林夏走到长椅前拿起信封'),
          scene(3, '清晨出租屋，窗外天光', '林夏把信封放到书桌上'),
          scene(4, '夜晚出租屋，暖色台灯', '林夏重新拿起信封'),
        ].join('\n'),
      },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/shots/generate',
      headers,
      payload: { mode: 'scene', maxShots: 12, episodeId },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(4)
    expect(response.json()[0]).toMatchObject({ continuityMode: 'independent' })
    expect(response.json()[1]).toMatchObject({
      continuityMode: 'continue',
      continuityNote: expect.stringContaining('上一镜终态'),
    })
    expect(response.json()[1].continuityNote).toContain('本镜动作起点')
    expect(response.json()[2]).toMatchObject({
      continuityMode: 'independent',
      continuityNote: expect.stringContaining('只承接剧情状态，不携带上一场画面构图'),
    })
    expect(response.json()[2].continuityNote).toContain('人物位置、构图与光线按本镜新场景重新建立')
    expect(response.json()[3]).toMatchObject({ continuityMode: 'independent' })
  })

  it('regenerates one episode without replacing other episodes and carries narrative state without a tail frame', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
      'x-demo-tenant-id': 'tenant-seqora-demo',
    }
    const initialWorkspace = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })
    const firstEpisodeId = initialWorkspace.json().scriptEpisodes[0].id
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/episodes/save',
      headers,
      payload: {
        episodeId: firstEpisodeId,
        title: '失踪的信封',
        content: '场次：S01｜场景：雨夜旧站台｜角色：林夏｜动作：林夏发现信封已经被人取走',
      },
    })
    const firstShots = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/shots/generate',
      headers,
      payload: { mode: 'scene', maxShots: 12, episodeId: firstEpisodeId },
    })
    const secondEpisode = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/script/episodes/save',
      headers,
      payload: {
        title: '追踪者',
        content: '场次：S01｜场景：清晨出租屋｜角色：林夏｜动作：林夏根据线索拨通陌生号码',
      },
    })

    const secondShots = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/shots/generate',
      headers,
      payload: { mode: 'scene', maxShots: 12, episodeId: secondEpisode.json().id },
    })
    const finalWorkspace = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers,
    })

    expect(firstShots.statusCode).toBe(200)
    expect(secondShots.statusCode).toBe(200)
    expect(secondShots.json()[0]).toMatchObject({
      scriptEpisodeId: secondEpisode.json().id,
      episodeNumber: 2,
      continuityMode: 'independent',
      continuityNote: expect.stringContaining('上一集剧情终态'),
    })
    expect(secondShots.json()[0].continuityNote).toContain('不得读取上一集尾帧作为视觉参考')
    expect(finalWorkspace.json().shots).toHaveLength(firstShots.json().length + secondShots.json().length)
    expect(
      finalWorkspace
        .json()
        .shots.some((shot: { scriptEpisodeId: string }) => shot.scriptEpisodeId === firstEpisodeId),
    ).toBe(true)
  })

  it('serves a generated image after the background task completes', async () => {
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => [
        { view: 'single', contentType: 'image/png', content: Buffer.from('generated-png') },
      ]),
    }
    app = await buildApp({ config: testConfig, imageProvider, startWorker: false })
    const headers = {
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
        userId: 'user-member',
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
      'x-demo-role': 'member',
      'x-demo-user-id': 'user-member',
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
        userId: 'user-member',
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
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
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
        userId: 'user-member',
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
        'x-demo-role': 'member',
        'x-demo-user-id': 'user-member',
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
    'x-demo-role': 'member',
    'x-demo-user-id': 'user-member',
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
    expect(store.read((state) => state.users.find((user) => user.id === 'user-member')!.credits)).toBe(270)

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
    expect(store.read((state) => state.users.find((user) => user.id === 'user-member')!.credits)).toBe(270)

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
      state.users.find((user) => user.id === 'user-member')!.credits = 5
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
  let authDatabase: PostgresAuthFixture | undefined

  beforeAll(async () => {
    authDatabase = await startPostgresAuthFixture()
  }, 120_000)

  beforeEach(async () => {
    await authDatabase?.reset()
  })

  afterAll(async () => {
    await authDatabase?.close()
  })

  function localAuthConfig(overrides: Partial<AppConfig> = {}): AppConfig {
    if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
    return {
      ...testConfig,
      ...overrides,
      AUTH_MODE: 'local',
      DATABASE_URL: authDatabase.connectionString,
    }
  }

  it('uses deployment-provided bootstrap credentials for an empty store', async () => {
    app = await buildApp({
      config: localAuthConfig({
        BOOTSTRAP_MEMBER_EMAIL: 'tester@example.com',
        BOOTSTRAP_MEMBER_PASSWORD: 'UniqueMemberPassword123!',
      }),
      startWorker: false,
    })

    const oldCredentials = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local', password: 'MemberPassword123!' },
    })
    expect(oldCredentials.statusCode).toBe(401)

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'tester@example.com', password: 'UniqueMemberPassword123!' },
    })
    expect(login.statusCode).toBe(200)
    expect(login.json()).toMatchObject({ account: { email: 'tester@example.com' } })
  })

  it('rate limits repeated failed login attempts', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
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
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local', password: 'MemberPassword123!' },
    })

    expect(login.statusCode).toBe(200)
    expect(login.json()).toMatchObject({ account: { email: 'member@seqora.local', plan: 'free' } })
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
    expect(me.json()).toMatchObject({ account: { name: '默认 C 端用户' } })

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `seqora_session=${cookie?.value}` },
    })
    expect(logout.statusCode).toBe(204)
  })

  it('applies signed billing webhooks and ignores duplicate payment events', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local', password: 'MemberPassword123!' },
    })
    const sessionCookie = login.cookies.find((item) => item.name === 'seqora_session')
    const sessionHeaders = { cookie: `seqora_session=${sessionCookie?.value}` }
    const subscriptionPayload = {
      eventId: 'evt-subscription-activated-1',
      type: 'subscription.activated',
      membershipId: 'membership-tenant-seqora-demo-user-member',
      occurredAt: '2026-07-01T00:00:00.000Z',
      metadata: { subscriptionId: 'sub_1' },
    }

    const unsigned = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/testpay',
      payload: subscriptionPayload,
    })
    expect(unsigned.statusCode).toBe(401)

    const activated = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/testpay',
      headers: signedWebhookHeaders(subscriptionPayload),
      payload: subscriptionPayload,
    })
    expect(activated.statusCode, activated.body).toBe(200)
    expect(activated.json()).toMatchObject({
      duplicate: false,
      eventId: 'evt-subscription-activated-1',
      plan: 'member',
      credits: 786,
      ledgerEntry: { type: 'grant', amount: 500 },
    })

    const duplicateSubscription = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/testpay',
      headers: signedWebhookHeaders(subscriptionPayload),
      payload: subscriptionPayload,
    })
    expect(duplicateSubscription.statusCode).toBe(200)
    expect(duplicateSubscription.json()).toMatchObject({ duplicate: true, plan: 'member' })

    const purchasePayload = {
      eventId: 'evt-credits-purchased-1',
      type: 'credits.purchased',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      credits: 120,
      referenceId: 'payment-order-1',
      description: 'Credit purchase',
      metadata: { orderId: 'order_1' },
    }
    const purchased = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/testpay',
      headers: signedWebhookHeaders(purchasePayload),
      payload: purchasePayload,
    })
    expect(purchased.statusCode, purchased.body).toBe(200)
    expect(purchased.json()).toMatchObject({
      duplicate: false,
      credits: 906,
      ledgerEntry: { type: 'grant', amount: 120, description: 'Credit purchase' },
    })

    const duplicatePurchase = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/testpay',
      headers: signedWebhookHeaders(purchasePayload),
      payload: purchasePayload,
    })
    expect(duplicatePurchase.statusCode).toBe(200)
    expect(duplicatePurchase.json()).toMatchObject({ duplicate: true })

    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: sessionHeaders,
    })
    expect(summary.json()).toMatchObject({
      plan: 'member',
      credits: 906,
      planSelfServiceEnabled: false,
      monthlyUsage: { includedCredits: 500 },
    })
    expect(summary.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 500, type: 'grant' }),
        expect.objectContaining({ amount: 120, type: 'grant', description: 'Credit purchase' }),
      ]),
    )
  })

  it('changes an authenticated account password without accepting the old password afterward', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local', password: 'MemberPassword123!' },
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
      payload: { currentPassword: 'MemberPassword123!', newPassword: 'ReplacementPassword123!' },
    })
    expect(changed.statusCode).toBe(204)
    expect(changed.headers['cache-control']).toBe('no-store')

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local', password: 'MemberPassword123!' },
    })
    expect(oldLogin.statusCode).toBe(401)

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local', password: 'ReplacementPassword123!' },
    })
    expect(newLogin.statusCode).toBe(200)
  })

  it('persists project, asset, task and billing mutations', async () => {
    app = await buildApp({
      config: localAuthConfig(),
      store: await importedProjectStore(),
      startWorker: false,
    })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local', password: 'MemberPassword123!' },
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

  it('persists novel metadata in Postgres and source text in object storage', async () => {
    app = await buildApp({
      config: localAuthConfig(),
      store: await importedProjectStore(),
      startWorker: false,
    })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local', password: 'MemberPassword123!' },
    })
    const sessionCookie = login.cookies.find((item) => item.name === 'seqora_session')
    const headers = { cookie: `seqora_session=${sessionCookie?.value}` }
    const hiddenTail = '不可公开的长尾正文'
    const content = [
      '第一章 河岸',
      '黄昏时，河岸的灯亮了。翠翠听见渡船靠岸，风从水面吹来。',
      '',
      '第二章 山雨',
      `山雨落下，老船夫收起竹篙。${'山路'.repeat(1700)}${hiddenTail}`,
    ].join('\n')

    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers,
      payload: {
        clientRequestId: 'postgres-novel-import',
        name: '河岸故事',
        format: 'txt',
        content,
        splitOptions: { mode: 'heading', targetChars: 3000, overlapChars: 0 },
      },
    })

    expect(imported.statusCode, imported.body).toBe(201)
    expect(imported.json()).toMatchObject({
      document: {
        projectId: 'project-midnight-film',
        name: '河岸故事',
        chapterCount: 2,
      },
      chapters: expect.arrayContaining([
        expect.objectContaining({ title: '第一章 河岸', preview: expect.any(String) }),
      ]),
    })
    expect(imported.body).not.toContain(hiddenTail)

    const database = new AccountDatabase(authDatabase!.connectionString)
    try {
      const documentRows = await database.query<{
        content_storage_key: string
        content_sha256: string
      }>(
        `
        SELECT content_storage_key, content_sha256
        FROM novel_documents
        WHERE id = $1
        `,
        [imported.json().document.id],
      )
      expect(documentRows.rows[0]).toMatchObject({
        content_storage_key: expect.stringContaining('/novels/'),
        content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      const chapterRows = await database.query<{ table_name: string | null }>(
        "SELECT to_regclass('novel_chapters')::text AS table_name",
      )
      expect(chapterRows.rows[0]?.table_name).toBe('novel_chapters')
      const stored = await new LocalObjectStorage(testConfig.UPLOAD_DIR).get(
        documentRows.rows[0]!.content_storage_key,
      )
      expect(stored.toString('utf8')).toBe(content)
    } finally {
      await database.close()
    }

    await app.close()
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local', password: 'MemberPassword123!' },
    })
    const reloadedCookie = relogin.cookies.find((item) => item.name === 'seqora_session')
    const reloaded = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}`,
      headers: { cookie: `seqora_session=${reloadedCookie?.value}` },
    })

    expect(reloaded.statusCode, reloaded.body).toBe(200)
    expect(reloaded.json()).toMatchObject({
      document: { name: '河岸故事', chapterCount: 2 },
      chapters: expect.arrayContaining([expect.objectContaining({ title: '第二章 山雨' })]),
    })
    expect(reloaded.body).not.toContain(hiddenTail)
  }, 30_000)

  it('uploads and serves authenticated project media', async () => {
    app = await buildApp({
      config: localAuthConfig(),
      store: await importedProjectStore(),
      startWorker: false,
    })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local', password: 'MemberPassword123!' },
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

  it('serves long public source tokens for trusted asset registration', async () => {
    app = await buildApp({ config: testConfig, startWorker: false })
    const storageKey =
      'tenant-seqora-demo/project-midnight-film/generated/4b1916b0-6676-4950-a2da-ba053ba5ebd1-single.png'
    await new LocalObjectStorage(testConfig.UPLOAD_DIR).put(
      storageKey,
      Buffer.from('public-source'),
      'image/png',
    )
    const token = createPublicMediaToken(
      { storageKey, contentType: 'image/png' },
      testConfig.AUTH_SECRET,
      Date.now() + 60_000,
    )

    expect(token.length).toBeGreaterThan(100)
    const source = await app.inject({ method: 'GET', url: `/api/v1/trusted-assets/source/${token}` })

    expect(source.statusCode).toBe(200)
    expect(source.headers['content-type']).toContain('image/png')
    expect(source.body).toBe('public-source')
  })

  async function importedProjectStore(): Promise<AppStore> {
    if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
    const store = new AppStore(null)
    await store.initialize()
    const database = new AccountDatabase(authDatabase.connectionString)
    try {
      const users = new UserRepository(store, database)
      await users.bootstrapFromStore()
      await new ProjectRepository(store, database).importFromStore()
    } finally {
      await database.close()
    }
    return store
  }
})

localNovelRegression('local novel fixture regression', () => {
  const headers = {
    'x-demo-role': 'member',
    'x-demo-user-id': 'user-member',
    'x-demo-tenant-id': 'tenant-seqora-demo',
  }

  it('imports 边城 as the medium quality sample and keeps content private', async () => {
    const content = await readLocalNovelFixture('biancheng')
    app = await buildApp({ config: testConfig, startWorker: false })

    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/preview-split',
      headers,
      payload: {
        name: '边城',
        content,
        splitOptions: { mode: 'auto', targetChars: 6_000, overlapChars: 300 },
      },
    })
    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json()).toMatchObject({ coveragePassed: true })
    expect(preview.json().characterCount).toBeGreaterThan(40_000)
    expect(preview.json().chapterCount).toBeGreaterThan(5)
    expect(preview.body).not.toContain('声明：本书')

    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers,
      payload: {
        clientRequestId: 'local-biancheng-import',
        name: '边城',
        content,
        splitOptions: { mode: 'auto', targetChars: 6_000, overlapChars: 300 },
      },
    })
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}`,
      headers,
    })
    const queue = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}/summary-queue`,
      headers,
      payload: {
        clientRequestId: 'local-biancheng-summary-queue',
        batchSize: 4,
      },
    })

    expect(imported.statusCode, imported.body).toBe(201)
    expect(imported.json().document.chapterCount).toBe(preview.json().chapterCount)
    expect(detail.body).not.toContain('"content"')
    expect(queue.json()).toMatchObject({
      queue: {
        status: 'queued',
        totalItems: imported.json().document.chapterCount,
        pendingCount: imported.json().document.chapterCount,
      },
      summaryCount: 0,
    })
  })

  it('accepts 倾覆之塔 as the current long novel size ceiling and creates resumable work', async () => {
    const content = await readLocalNovelFixture('tower')
    const size = (await stat(localNovelFixturePaths.tower)).size
    app = await buildApp({ config: testConfig, startWorker: false })

    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-midnight-film/novels/import',
      headers,
      payload: {
        clientRequestId: 'local-tower-import',
        name: '倾覆之塔',
        content,
        splitOptions: { mode: 'fixed', targetChars: 6_000, overlapChars: 300 },
      },
    })

    expect(size).toBeLessThanOrEqual(NOVEL_IMPORT_MAX_FILE_BYTES)
    expect(size).toBeGreaterThan(5_500_000)
    expect(imported.statusCode, imported.body).toBe(201)
    expect(imported.json().document.characterCount).toBeLessThanOrEqual(NOVEL_IMPORT_MAX_FILE_BYTES)
    expect(imported.json().document.chapterCount).toBeGreaterThan(100)
    expect(
      imported
        .json()
        .chapters.reduce(
          (total: number, chapter: { characterCount: number }) => total + chapter.characterCount,
          0,
        ),
    ).toBe(imported.json().document.characterCount)
    expect(
      imported
        .json()
        .chapters.some((chapter: { overlapAfterChars: number }) => chapter.overlapAfterChars > 0),
    ).toBe(true)

    const boundaries = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}/boundaries/detect`,
      headers,
      payload: { maxBoundaries: 10 },
    })
    const queue = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/project-midnight-film/novels/${imported.json().document.id}/summary-queue`,
      headers,
      payload: {
        clientRequestId: 'local-tower-summary-queue',
        batchSize: 24,
      },
    })

    expect(boundaries.statusCode, boundaries.body).toBe(200)
    expect(boundaries.json().boundaries.length).toBeLessThanOrEqual(10)
    expect(queue.json()).toMatchObject({
      queue: {
        status: 'queued',
        batchSize: 24,
        totalItems: imported.json().document.chapterCount,
      },
      summaryCount: 0,
      missingSummaryCount: imported.json().document.chapterCount,
    })
  })
})

async function readLocalNovelFixture(name: keyof typeof localNovelFixturePaths): Promise<string> {
  const path = localNovelFixturePaths[name]
  const buffer = await readFile(path)
  const text = decodeLocalNovelBuffer(buffer).replace(/^\uFEFF/u, '')
  if (!text.trim()) throw new Error(`Local novel fixture is empty: ${path}`)
  return text
}

function decodeLocalNovelBuffer(buffer: Buffer): string {
  for (const encoding of ['utf-8', 'gb18030', 'gbk']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer)
    } catch {
      // Try the next common Chinese plain-text encoding.
    }
  }
  return buffer.toString('utf8')
}

function scriptAssetSuggestionsJson(): string {
  return JSON.stringify({
    summary: '建议先建立主角、关键道具、核心场景和主服装，保障后续分镜一致性。',
    assets: [
      {
        kind: 'character',
        name: '女剑客',
        description: '贯穿主线的退隐女剑客，从复仇者转向守护者。',
        prompt: '退隐女剑客，清晰五官，克制神情，古风武侠角色，全身造型统一。',
        negativePrompt: '',
        reason: '主角贯穿所有关键场次，需要优先建立角色一致性。',
        priority: 5,
        attributes: {
          type: 'character',
          subjectType: 'human',
          gender: 'female',
          ageGroup: 'young',
          exactAge: null,
          species: '',
          anthropomorphic: false,
          visualStyle: 'cinematic-cg',
          framing: 'full',
          bodyType: 'balanced',
          background: 'solid',
          faceStatus: 'pending',
          bodyStatus: 'pending',
          faceReference: null,
          bodyReference: null,
          portraitSource: 'ai-virtual',
          trustedPortrait: null,
          legStretch: false,
          turnaround: false,
          turnaroundLayout: 'sheet',
        },
      },
      {
        kind: 'scene',
        name: '边城药铺',
        description: '婚约与旧敌逼近的核心室内场景。',
        prompt: '古风边城药铺空场景，木柜、药屉、暖色油灯，窗外雪夜，预留人物表演空间。',
        negativePrompt: '',
        reason: '开场和人物关系建立会重复使用。',
        priority: 4,
        attributes: {
          type: 'scene',
          space: 'interior',
          sceneType: 'ancient',
          era: 'ancient',
          time: 'night',
          weather: 'snow',
          mood: 'romantic',
          camera: 'wide',
          visualStyle: 'cinematic-cg',
          emptyScene: true,
          activitySpace: true,
        },
      },
      {
        kind: 'prop',
        name: '旧长剑',
        description: '女剑客身份和选择的核心物件。',
        prompt: '古风旧长剑道具，金属剑身有使用痕迹，朴素剑柄，正面展示，纯色背景。',
        negativePrompt: '',
        reason: '长剑作为关键物件跨场出现，影响动作和连续性。',
        priority: 5,
        attributes: {
          type: 'prop',
          category: 'weapon',
          material: 'metal',
          condition: 'aged',
          view: 'front',
          background: 'solid',
          visualStyle: 'cinematic-cg',
        },
      },
      {
        kind: 'costume',
        name: '女剑客雪夜衣装',
        description: '主角在雪夜行动段落使用的核心服装。',
        prompt: '古风女剑客深色冬季衣装，布料与皮革混合，轻便护腕，完整平铺展示。',
        negativePrompt: '',
        reason: '主角服装需要跨场统一，避免生成时造型漂移。',
        priority: 4,
        attributes: {
          type: 'costume',
          audience: 'female',
          category: 'ancient',
          season: 'autumn-winter',
          design: 'chinese',
          presentation: 'flat',
          visualStyle: 'cinematic-cg',
          turnaround: false,
        },
      },
    ],
  })
}

async function importShortNovel(app: FastifyInstance, headers: Record<string, string>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/project-midnight-film/novels/import',
    headers,
    payload: {
      clientRequestId: crypto.randomUUID(),
      name: '雨夜旧站',
      content: [
        '第一章 雨夜来信',
        '林夏收到匿名来信，信中要求她午夜前往废弃旧车站寻找父亲留下的胶片。',
        '',
        '第二章 旧车站',
        '她在旧站台长椅下找到铁盒，里面的胶片第一格竟然是此刻的自己。',
      ].join('\n'),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json()
}

function novelChapterSummariesJson(): string {
  return JSON.stringify({
    summaries: [
      {
        order: 1,
        title: '第一章 雨夜来信',
        summary: '林夏收到匿名来信，被引向废弃旧车站，开始追查父亲留下的胶片线索。',
        keyEvents: ['匿名来信出现', '林夏决定前往旧车站'],
        characters: ['林夏：年轻导演，被父亲留下的线索牵引'],
        locations: ['废弃旧车站'],
        timeline: ['雨夜，故事开端'],
        keyProps: ['匿名来信', '父亲留下的胶片线索'],
        foreshadowing: ['来信没有署名，说明背后有人操控相见地点'],
        worldRules: ['胶片与父亲失踪存在关联，但机制尚未揭示'],
        adaptationNotes: '适合作为短视频开场钩子，突出雨夜赴约和匿名来信。',
      },
      {
        order: 2,
        title: '第二章 旧车站',
        summary: '林夏抵达旧站台并找到铁盒，胶片第一格显示此刻的自己，建立未来影像疑点。',
        keyEvents: ['林夏找到铁盒', '胶片显示此刻的林夏'],
        characters: ['林夏：从被动赴约转为主动调查'],
        locations: ['旧站台', '长椅下方'],
        timeline: ['午夜前后，线索被正式打开'],
        keyProps: ['铁盒', '旧胶片'],
        foreshadowing: ['胶片第一格显示当下，暗示影像不只记录过去'],
        worldRules: ['旧胶片可能记录现在或未来影像'],
        adaptationNotes: '应重点资产化旧站台、铁盒和胶片，形成稳定悬疑视觉符号。',
      },
    ],
    batchNotes: '两章都可作为悬疑开场事实源。',
  })
}

function bianchengChapterSummariesJson(): string {
  return JSON.stringify({
    summaries: [
      {
        order: 1,
        title: '第一章 茶峒渡口',
        summary: '翠翠和老船夫守着茶峒溪边渡口，渡船、白塔和河岸生活构成故事的核心环境。',
        keyEvents: ['翠翠随祖父在渡口生活', '老船夫负责摆渡往来行人'],
        characters: [
          '老船夫：男性，七十岁，翠翠的祖父，茶峒渡口船夫/摆渡人',
          '翠翠：女性，十三岁少女，老船夫的外孙女',
          '黄狗：陪伴老船夫和翠翠的家犬，会协助牵船拖绳',
        ],
        locations: ['茶峒渡口：溪边渡船停靠处，连接两岸日常往来', '白塔：渡口附近的重要地标'],
        timeline: ['近代湘西边城日常生活开端'],
        keyProps: ['渡船：老船夫日常摆渡的核心工具', '白塔：反复出现的地标'],
        foreshadowing: ['渡船和白塔会承载人物等待与离别'],
        worldRules: ['渡船服务往来行人，是边城日常秩序的一部分'],
        adaptationNotes: '应优先资产化老船夫、翠翠、茶峒渡口、渡船和白塔。',
      },
      {
        order: 2,
        title: '第二章 端午相遇',
        summary: '端午节热闹人群中，翠翠与青年相遇，河边风俗和地方节庆推动人物关系。',
        keyEvents: ['端午节人群聚集', '翠翠在河边与青年相遇'],
        characters: [
          '翠翠：女性，十三岁少女，纯净羞涩，依恋祖父',
          '老船夫：男性，七十岁，关心翠翠未来的摆渡老人',
        ],
        locations: ['茶峒河岸：节庆人群和船只聚集处'],
        timeline: ['端午节，人物关系开始发生变化'],
        keyProps: ['渡船：连接节庆动线和日常摆渡'],
        foreshadowing: ['节庆相遇会引出后续情感等待'],
        worldRules: ['地方节庆、唱歌和水上交通共同塑造边城人情关系'],
        adaptationNotes: '人物资产要保持年龄、身份和乡土气质一致，场景以渡口和河岸为中心。',
      },
    ],
    batchNotes: '边城前两章事实源强调渡口、老船夫、翠翠和地方风俗。',
  })
}

function novelChapterSummariesRichJson(): string {
  return JSON.stringify({
    summaries: [
      {
        order: 1,
        title: '第一章 雨夜来信：开端',
        summary: '林夏收到匿名来信，被引向废弃旧车站，开始追查父亲留下的胶片线索。',
        keyEvents: [{ event: '匿名来信出现' }, { event: '林夏决定前往旧车站' }],
        characters: [
          {
            name: '林夏',
            role: '年轻导演',
            traits: ['警觉', '执着'],
            relationships: ['与父亲失踪线索相关'],
          },
        ],
        locations: [{ name: '废弃旧车站', description: '雨夜中的核心悬疑场景' }],
        timeline: [{ stage: '故事开端', event: '雨夜收到匿名来信' }],
        keyProps: [{ name: '匿名来信', significance: '把主角引向旧车站' }],
        foreshadowing: [{ event: '来信没有署名', significance: '暗示背后有人操控' }],
        worldRules: [{ description: '胶片与父亲失踪有关，但机制尚未揭示' }],
        adaptationNotes: {
          adaptationFocus: ['突出雨夜赴约', '建立旧车站悬疑氛围'],
          cautions: ['不要提前补完胶片机制'],
        },
      },
    ],
    batchNotes: { sourceType: '章节摘要', cautions: ['对象字段应被平台规范化'] },
  })
}

function novelStoryBibleJson(): string {
  return JSON.stringify({
    title: '雨夜旧站',
    logline: '年轻导演在雨夜旧站追查父亲胶片，发现影像可能记录未来。',
    premise: '匿名来信把林夏带回废弃车站，迫使她面对父亲失踪和异常胶片的秘密。',
    synopsis:
      '林夏收到没有署名的来信，被要求在午夜前往废弃旧车站寻找父亲留下的胶片。她在雨夜抵达旧站台，在长椅下发现铁盒和旧胶片。胶片第一格显示的不是过去，而是此刻的自己，这让她意识到父亲留下的线索涉及异常影像。故事由被动赴约转为主动调查，后续应围绕寄信人、胶片机制和父亲失踪真相继续推进。',
    themes: ['记忆与未来', '亲情悬疑', '被操控的真相'],
    characters: [
      {
        name: '林夏',
        role: '主角',
        description: '年轻导演，被匿名来信引向父亲留下的胶片线索。',
        storyFunction: '承担调查主线，推动胶片秘密被逐步揭开。',
        visualNotes: '雨夜风衣、克制但警觉的表情。',
        motivation: '弄清父亲留下胶片和失踪真相。',
        arc: '从被动赴约转为主动追查异常影像的秘密。',
      },
    ],
    locations: [
      {
        name: '旧车站',
        description: '废弃多年、雨夜空旷的核心悬疑场景。',
        storyFunction: '承载匿名来信、铁盒和胶片发现。',
        visualNotes: '潮湿站台、冷色灯光、空长椅。',
      },
    ],
    timeline: [
      { order: 1, label: '雨夜来信', event: '林夏收到匿名来信并决定前往旧车站。' },
      { order: 2, label: '旧站发现', event: '林夏在长椅下找到铁盒和旧胶片。' },
    ],
    keyProps: [
      {
        name: '匿名来信',
        description: '引导林夏前往旧车站的触发物。',
        storyFunction: '启动调查并隐藏幕后操控者。',
        visualNotes: '无署名纸信，雨水边缘。',
      },
      {
        name: '旧胶片',
        description: '父亲留下的关键异常物件。',
        storyFunction: '揭示影像可能记录当下或未来的核心设定。',
        visualNotes: '老式胶片卷，银盐质感。',
      },
    ],
    foreshadowing: [
      { setup: '匿名来信没有署名', payoff: '寄信人与父亲秘密有关', status: 'open' },
      { setup: '胶片第一格显示此刻林夏', payoff: '胶片机制需要后续解释', status: 'open' },
    ],
    worldRules: ['旧胶片可能记录现在或未来影像，但触发方式和代价尚未揭示。'],
    adaptationStrategy:
      '先保留雨夜旧站、匿名来信、铁盒和旧胶片四个核心视觉符号，再围绕胶片异常机制设计多套短剧改编方向。',
    risks: ['现有章节只覆盖开场，不能提前确定父亲失踪真相。'],
    nextStep: '生成 3 到 5 个改编方向。',
  })
}

function novelStoryBibleRichJson(): string {
  return JSON.stringify({
    title: 'Biancheng',
    logline: 'A ferry girl waits at the edge of a river town while love, custom, and loss reshape her life.',
    premise:
      'The story follows a young ferry girl and her grandfather in a river town where courtship routes, songs, and boat work decide how people express love and duty.',
    synopsis:
      'Cuicui grows up with her grandfather beside a public ferry in the river town of Chadong. The old ferryman serves travelers without asking for payment and hopes to arrange a stable future for the girl before age overtakes him. During festival seasons, Cuicui meets two brothers from the boatman family. Their affection is carried through formal proposal customs, night songs, family obligations, and misunderstandings. The elder brother steps away and later dies on the water, while the younger brother leaves after grief and resentment complicate the marriage question. A storm takes the grandfather and destroys the old ferry setting, leaving Cuicui to keep the ferry and wait for a return that may or may not happen.',
    themes: ['waiting', 'duty', 'custom'],
    characters: [
      {
        name: 'Cuicui',
        role: 'lead',
        traits: ['innocent', 'shy', 'attached to grandfather'],
        arc: 'She learns to live with waiting after family loss and unresolved love.',
        relations: 'Raised by her grandfather; loved by two brothers.',
      },
    ],
    locations: [
      {
        name: 'Chadong',
        type: 'river town',
        features: ['ferry crossing', 'wharf', 'festival streets'],
        storyFunction: 'A community space where news, courtship, and water work intersect.',
      },
    ],
    timeline: [{ stage: 'festival meeting', event: 'Cuicui first meets the younger brother by the river.' }],
    keyProps: [
      {
        name: 'Ferry boat',
        visualFeatures: ['public boat', 'rope crossing', 'bamboo pole'],
        use: 'It connects daily duty with Cuicui and her grandfather.',
      },
    ],
    foreshadowing: [
      {
        setup: 'Night songs carry the courtship.',
        payoff: 'The chosen love remains unresolved.',
        status: 'partial payoff',
      },
    ],
    worldRules: [{ description: 'Ferry is public and travelers are not charged by default.' }],
    adaptationStrategy: {
      tone: 'lyrical',
      adaptationFocus: ['keep the ferry as the core visual symbol', 'keep the ending unresolved'],
      cautions: ['do not invent a final reunion'],
    },
    risks: [
      'Some ages are inconsistent in summaries.',
      'The ending must remain unresolved.',
      'Local customs need clear visual explanation.',
      'Water accident scenes need restraint.',
      'Do not over-modernize the town.',
      'Keep dialogue sparse.',
      'Avoid adding unrelated villains.',
      'Keep family relationships clear.',
      'Avoid turning the story into pure romance.',
      'Preserve the ferry duty.',
      'This extra risk should be trimmed.',
    ],
    nextStep: 'Generate several adaptation outline options from this fact source.',
  })
}

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

function signedWebhookHeaders(payload: unknown): Record<string, string> {
  const signature = createHmac('sha256', testConfig.BILLING_WEBHOOK_SECRET)
    .update(canonicalJson(payload))
    .digest('hex')
  return { 'x-seqora-signature': `sha256=${signature}` }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value)) ?? ''
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([key, item]) => [key, sortJsonValue(item)]),
  )
}
