import type { FastifyInstance } from 'fastify'
import { IMAGE2_PROVIDER_DISPLAY_NAME } from '@seqora/contracts'
import type { AppConfig } from '../config.js'
import { installAuth } from '../core/auth/installAuth.js'
import { createAuthProvider } from '../core/auth/provider.js'
import { AppError } from '../core/errors.js'
import { TextGenerationProviderError } from '../core/generation/textProvider.js'
import { readRuntimeReadiness } from '../core/observability/readiness.js'
import { registerObservabilityRoutes } from '../core/observability/routes.js'
import type { AccountDatabase } from '../infra/postgres.js'
import type { AppStore } from '../infra/store.js'
import { registerAccountManagementRoutes } from '../modules/accountManagement/routes.js'
import { registerAiJobRoutes } from '../modules/aiJobs/routes.js'
import { registerAdminRoutes } from '../modules/admin/routes.js'
import { registerAuthRoutes } from '../modules/auth/routes.js'
import { registerBillingRoutes } from '../modules/billing/routes.js'
import { registerGenerationRoutes } from '../modules/generation/routes.js'
import { registerImage2Routes } from '../modules/image2/routes.js'
import { registerLibraryRoutes } from '../modules/library/routes.js'
import { registerMediaRoutes } from '../modules/media/routes.js'
import { registerNovelRoutes } from '../modules/novels/routes.js'
import { registerProjectRoutes } from '../modules/projects/routes.js'
import { registerQuickStartRoutes } from '../modules/quickStart/routes.js'
import { registerTrustedAssetRoutes } from '../modules/trustedAssets/routes.js'
import { textProviderName, videoProviderName, type RuntimeProviders } from './providers.js'
import type { RuntimeQueues } from './queues.js'
import type { RuntimeRepositories, RuntimeServices } from './services.js'

export function installRuntimeErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
    }
    if (error instanceof TextGenerationProviderError) {
      request.log.error(error)
      return reply.code(502).send({ error: { code: 'TEXT_PROVIDER_FAILED', message: error.message } })
    }
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'FILE_TOO_LARGE', message: '上传文件超过大小限制' } })
    }
    if ((error as { statusCode?: number }).statusCode === 415) {
      return reply
        .code(415)
        .send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '请求格式不支持，请使用 JSON 请求体' } })
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } })
    }
    request.log.error(error)
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } })
  })
}

export function registerRuntimeHealthRoute(
  app: FastifyInstance,
  config: AppConfig,
  providers: RuntimeProviders,
  readinessInput: {
    database: AccountDatabase | null
    queues: RuntimeQueues
    inlineWorkersStarted: boolean
  },
): void {
  app.get('/api/v1/health', { config: { rateLimit: false } }, async () => ({
    ...runtimeHealth(config, providers),
    readiness: await readRuntimeReadiness({
      config,
      ...readinessInput,
    }),
  }))

  app.get('/api/v1/health/readiness', { config: { rateLimit: false } }, async (_request, reply) => {
    const readiness = await readRuntimeReadiness({
      config,
      ...readinessInput,
    })
    if (!readiness.ready) reply.code(503)
    return readiness
  })
}

export async function registerRuntimeRoutes(input: {
  app: FastifyInstance
  config: AppConfig
  store: AppStore
  repositories: RuntimeRepositories
  services: RuntimeServices
}): Promise<void> {
  const { app, config, store, repositories, services } = input

  installAuth(app, createAuthProvider(config, repositories.authAccounts))

  await app.register(
    async (api) => {
      await registerAuthRoutes(api, services.authService, config.NODE_ENV === 'production')
      await registerAccountManagementRoutes(
        api,
        services.accountManagementService,
        config.NODE_ENV === 'production',
        repositories.users,
        repositories.creditLedger,
      )
      await registerProjectRoutes(api, services.projectService)
      await registerNovelRoutes(api, services.novelService)
      await registerQuickStartRoutes(api, services.quickStartService)
      await registerMediaRoutes(api, services.mediaService, config.MAX_UPLOAD_BYTES)
      await registerLibraryRoutes(api, services.assetLibraryService)
      await registerTrustedAssetRoutes(api, services.trustedAssetService)
      await registerAiJobRoutes(api, services.aiJobService)
      await registerImage2Routes(api, services.image2BatchService)
      await registerGenerationRoutes(api, services.generationService)
      await registerObservabilityRoutes(api, store, repositories.adminRepository)
      await registerBillingRoutes(api, repositories.creditLedger, {
        webhookSecret: config.BILLING_WEBHOOK_SECRET,
        paymentService: services.paymentService,
      })
      await registerAdminRoutes(
        api,
        store,
        repositories.creditLedger,
        repositories.adminRepository,
        services.accountManagementService,
        config.AUTH_SECRET,
      )
    },
    { prefix: '/api/v1' },
  )
}

function runtimeHealth(config: AppConfig, providers: RuntimeProviders) {
  return {
    status: 'ok',
    service: 'seqora-api',
    providers: {
      seedance: providers.videoProvider ? 'configured' : 'local-mock',
      img2: providers.imageProvider ? 'configured' : 'local-mock',
      text: providers.textProvider ? 'configured' : 'unavailable',
      assetLibrary: providers.assetLibraryProvider ? 'configured' : 'unavailable',
    },
    providerNames: {
      seedance: providers.videoProvider ? videoProviderName(config) : 'local-mock',
      img2: providers.imageProvider ? IMAGE2_PROVIDER_DISPLAY_NAME : 'local-mock',
      text: providers.textProvider ? textProviderName(config) : 'unavailable',
      assetLibrary: providers.assetLibraryProvider ? 'stringx-maas' : 'unavailable',
    },
    taskQueue: {
      driver: config.TASK_QUEUE_DRIVER,
      name: config.TASK_QUEUE_NAME,
    },
  }
}
