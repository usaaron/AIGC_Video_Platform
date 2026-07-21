import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import type { AppConfig } from './config.js'
import { installAuth } from './core/auth/installAuth.js'
import { createAuthProvider } from './core/auth/provider.js'
import { AppError } from './core/errors.js'
import type { AudioGenerationProvider } from './core/generation/audioProvider.js'
import type { ImageGenerationProvider } from './core/generation/imageProvider.js'
import type { VideoGenerationProvider } from './core/generation/videoProvider.js'
import { BullMqTaskDispatcher } from './core/jobs/bullmqQueue.js'
import { NoopTaskDispatcher } from './core/jobs/taskDispatcher.js'
import type { TaskDispatcher } from './core/jobs/taskDispatcher.js'
import {
  createRateLimiter,
  rateLimitKeyFromIp,
  rateLimitKeyFromRequest,
  type RateLimiter,
} from './core/rateLimit.js'
import { installObservability, ObservabilityMetrics } from './core/observability.js'
import { PostgresStateStore } from './infra/postgresStore.js'
import type { StateStore } from './infra/store.js'
import { PostgresAuditLogRepository, StoreAuditLogRepository } from './modules/admin/auditRepository.js'
import { PostgresAdminRepository, StoreAdminRepository } from './modules/admin/repository.js'
import { registerAdminRoutes } from './modules/admin/routes.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { AuthService } from './modules/auth/service.js'
import { registerBillingRoutes } from './modules/billing/routes.js'
import { StoreCreditLedger } from './modules/billing/creditLedger.js'
import { PostgresCreditLedger } from './modules/billing/postgresCreditLedger.js'
import { registerGenerationRoutes } from './modules/generation/routes.js'
import { PostgresGenerationTaskRepository } from './modules/generation/postgresRepository.js'
import { GenerationTaskRepository } from './modules/generation/repository.js'
import { GenerationService } from './modules/generation/service.js'
import { MediaRepository } from './modules/media/repository.js'
import { PostgresMediaRepository } from './modules/media/postgresRepository.js'
import { registerMediaRoutes } from './modules/media/routes.js'
import { MediaService } from './modules/media/service.js'
import { PostgresProjectRepository } from './modules/projects/postgresRepository.js'
import { registerProjectRoutes } from './modules/projects/routes.js'
import { ProjectRepository } from './modules/projects/repository.js'
import { ProjectService } from './modules/projects/service.js'
import { PostgresUserRepository } from './modules/users/postgresRepository.js'
import { UserRepository } from './modules/users/repository.js'
import {
  createAudioProvider,
  createImageProvider,
  createRuntimeObjectStorage,
  createStateStore,
  createTaskRunner,
  createVideoProvider,
} from './runtime.js'

type BuildAppOptions = {
  config: AppConfig
  logger?: boolean
  store?: StateStore
  startWorker?: boolean
  videoProvider?: VideoGenerationProvider | null
  imageProvider?: ImageGenerationProvider | null
  audioProvider?: AudioGenerationProvider | null
  taskDispatcher?: TaskDispatcher
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false })
  const store = options.store ?? createStateStore(options.config)
  await store.initialize()
  const isPostgres = store instanceof PostgresStateStore
  const metrics = new ObservabilityMetrics()
  const rateLimiter = createRateLimiter(options.config.REDIS_URL || undefined)

  await app.register(cookie)
  await app.register(cors, { origin: options.config.WEB_ORIGIN, credentials: true })
  await app.register(multipart, {
    limits: { files: 1, fileSize: options.config.MAX_UPLOAD_BYTES, parts: 2 },
  })

  const users = isPostgres ? new PostgresUserRepository(store) : new UserRepository(store)
  const authService = new AuthService(users, options.config.AUTH_SECRET)
  const creditLedger = isPostgres ? new PostgresCreditLedger(store) : new StoreCreditLedger(store)
  const objectStorage = createRuntimeObjectStorage(options.config)
  const videoProvider =
    options.videoProvider === undefined ? createVideoProvider(options.config) : options.videoProvider
  const imageProvider =
    options.imageProvider === undefined ? createImageProvider(options.config) : options.imageProvider
  const audioProvider =
    options.audioProvider === undefined ? createAudioProvider(options.config) : options.audioProvider
  const taskRunner = createTaskRunner(
    options.config,
    store,
    objectStorage,
    videoProvider,
    imageProvider,
    audioProvider,
  )
  const taskDispatcher: TaskDispatcher =
    options.taskDispatcher ??
    (options.config.TASK_QUEUE_DRIVER === 'bullmq'
      ? new BullMqTaskDispatcher(options.config.REDIS_URL)
      : new NoopTaskDispatcher())
  const generationRepository = isPostgres
    ? new PostgresGenerationTaskRepository(store)
    : new GenerationTaskRepository(store)
  const generationService = new GenerationService(generationRepository, taskDispatcher, videoProvider)
  const projectRepository = isPostgres ? new PostgresProjectRepository(store) : new ProjectRepository(store)
  const mediaRepository = isPostgres ? new PostgresMediaRepository(store) : new MediaRepository(store)
  const adminRepository = isPostgres ? new PostgresAdminRepository(store) : new StoreAdminRepository(store)
  const auditLogs = isPostgres ? new PostgresAuditLogRepository(store) : new StoreAuditLogRepository(store)
  const projectService = new ProjectService(projectRepository)
  const mediaService = new MediaService(mediaRepository, objectStorage)

  installAuth(app, createAuthProvider(options.config, users))
  installObservability(app, { auditLogWriter: auditLogs, metrics })
  app.addHook('preHandler', async (request, reply) => {
    await enforceRouteRateLimit(request, reply, rateLimiter, options.config, metrics)
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
    }
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'FILE_TOO_LARGE', message: '上传文件超过大小限制' } })
    }
    request.log.error(error)
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } })
  })

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'seqora-api',
    dataStore: options.config.DATA_STORE,
    taskQueue: options.config.TASK_QUEUE_DRIVER,
    storage: options.config.STORAGE_DRIVER,
    providers: {
      seedance: videoProvider ? 'configured' : 'local-mock',
      img2: imageProvider ? 'configured' : 'local-mock',
      audio: audioProvider ? 'configured' : 'local-mock',
    },
  }))
  app.get('/api/v1/health/ready', async () => {
    const checks: Record<string, string> = {
      database: isPostgres ? 'ok' : 'memory',
      queue: typeof taskDispatcher.ping === 'function' ? 'ok' : 'skipped',
    }

    if (store instanceof PostgresStateStore) {
      await store.withTransaction(async (client) => {
        await client.query('select 1')
      })
    }
    if (typeof taskDispatcher.ping === 'function') {
      await taskDispatcher.ping()
    }

    return {
      status: 'ok',
      checks,
      dataStore: options.config.DATA_STORE,
      taskQueue: options.config.TASK_QUEUE_DRIVER,
    }
  })
  app.get('/api/v1/metrics', async (_request, reply) => {
    reply.type('text/plain; version=0.0.4')
    return metrics.render()
  })
  const secureCookies =
    options.config.SESSION_COOKIE_SECURE === 'auto'
      ? options.config.NODE_ENV === 'production'
      : options.config.SESSION_COOKIE_SECURE

  await app.register(
    async (api) => {
      await registerAuthRoutes(api, authService, secureCookies, options.config.AUTH_MODE)
      await registerProjectRoutes(api, projectService)
      await registerMediaRoutes(
        api,
        mediaService,
        options.config.MAX_UPLOAD_BYTES,
        options.config.AUTH_SECRET,
      )
      await registerGenerationRoutes(api, generationService)
      await registerBillingRoutes(api, creditLedger)
      await registerAdminRoutes(api, adminRepository, auditLogs)
    },
    { prefix: '/api/v1' },
  )

  app.addHook('onClose', async () => {
    taskRunner.stop()
    if ('close' in taskDispatcher && typeof taskDispatcher.close === 'function') {
      await taskDispatcher.close()
    }
    const closableRateLimiter = rateLimiter as RateLimiter & { close?: () => Promise<void> }
    if (typeof closableRateLimiter.close === 'function') {
      await closableRateLimiter.close()
    }
    await store.close?.()
  })
  return app
}

async function enforceRouteRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  limiter: RateLimiter,
  config: AppConfig,
  metrics: ObservabilityMetrics,
): Promise<void> {
  const route = request.routeOptions.url
  if (!route) return

  if (request.method === 'POST' && routeMatches(route, '/api/v1/auth/login', '/auth/login')) {
    await consumeRateLimit(
      limiter,
      reply,
      metrics,
      'auth.login',
      rateLimitKeyFromIp(request),
      config.AUTH_LOGIN_RATE_LIMIT,
    )
    return
  }

  if (
    request.method === 'POST' &&
    (route.startsWith('/api/v1/generation/tasks') || route.startsWith('/generation/tasks'))
  ) {
    await consumeRateLimit(
      limiter,
      reply,
      metrics,
      'generation.tasks',
      rateLimitKeyFromRequest(request),
      config.TASK_CREATE_RATE_LIMIT,
    )
    return
  }

  if (
    request.method === 'POST' &&
    routeMatches(route, '/api/v1/projects/:projectId/media', '/projects/:projectId/media')
  ) {
    await consumeRateLimit(
      limiter,
      reply,
      metrics,
      'media.upload',
      rateLimitKeyFromRequest(request),
      config.MEDIA_UPLOAD_RATE_LIMIT,
    )
  }
}

function routeMatches(route: string, ...candidates: string[]): boolean {
  return candidates.includes(route)
}

async function consumeRateLimit(
  limiter: RateLimiter,
  reply: FastifyReply,
  metrics: ObservabilityMetrics,
  scope: string,
  key: string,
  limit: number,
): Promise<void> {
  const decision = await limiter.consume(`${scope}:${key}`, limit)
  reply.header('x-rate-limit-limit', String(limit))
  reply.header('x-rate-limit-remaining', String(decision.remaining))
  reply.header('x-rate-limit-reset', String(Math.ceil(decision.resetAt / 1000)))

  if (decision.allowed) return

  metrics.recordRateLimit(scope)
  reply.header('Retry-After', String(Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000))))
  throw new AppError(429, 'RATE_LIMITED', `Rate limit exceeded for ${scope}`)
}
