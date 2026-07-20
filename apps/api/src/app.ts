import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import { resolve } from 'node:path'
import type { AppConfig } from './config.js'
import { installAuth } from './core/auth/installAuth.js'
import { createAuthProvider } from './core/auth/provider.js'
import { AppError } from './core/errors.js'
import { AideosSeedanceProvider } from './core/generation/aideosSeedanceProvider.js'
import type { VideoGenerationProvider } from './core/generation/videoProvider.js'
import { GenerationTaskRunner } from './core/jobs/taskDispatcher.js'
import { createObjectStorage } from './infra/objectStorage.js'
import { PostgresStateStore } from './infra/postgresStore.js'
import { AppStore, type StateStore } from './infra/store.js'
import { registerAdminRoutes } from './modules/admin/routes.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { AuthService } from './modules/auth/service.js'
import { registerBillingRoutes } from './modules/billing/routes.js'
import { StoreCreditLedger } from './modules/billing/creditLedger.js'
import { registerGenerationRoutes } from './modules/generation/routes.js'
import { GenerationTaskRepository } from './modules/generation/repository.js'
import { GenerationService } from './modules/generation/service.js'
import { MediaRepository } from './modules/media/repository.js'
import { registerMediaRoutes } from './modules/media/routes.js'
import { MediaService } from './modules/media/service.js'
import { registerProjectRoutes } from './modules/projects/routes.js'
import { ProjectRepository } from './modules/projects/repository.js'
import { ProjectService } from './modules/projects/service.js'
import { UserRepository } from './modules/users/repository.js'

type BuildAppOptions = {
  config: AppConfig
  logger?: boolean
  store?: StateStore
  startWorker?: boolean
  videoProvider?: VideoGenerationProvider | null
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false })
  const store = options.store ?? createStateStore(options.config)
  await store.initialize()

  await app.register(cookie)
  await app.register(cors, { origin: options.config.WEB_ORIGIN, credentials: true })
  await app.register(multipart, {
    limits: { files: 1, fileSize: options.config.MAX_UPLOAD_BYTES, parts: 2 },
  })

  const users = new UserRepository(store)
  const authService = new AuthService(users, options.config.AUTH_SECRET)
  const creditLedger = new StoreCreditLedger(store)
  const videoProvider =
    options.videoProvider === undefined ? createVideoProvider(options.config) : options.videoProvider
  const taskRunner = new GenerationTaskRunner(store, videoProvider, options.config.SEEDANCE_POLL_INTERVAL_MS)
  const generationService = new GenerationService(
    new GenerationTaskRepository(store),
    taskRunner,
    videoProvider,
  )
  const projectService = new ProjectService(new ProjectRepository(store))
  const mediaService = new MediaService(new MediaRepository(store), createObjectStorage(options.config))

  installAuth(app, createAuthProvider(options.config, users))

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
    providers: { seedance: videoProvider ? 'configured' : 'local-mock' },
  }))
  await app.register(
    async (api) => {
      await registerAuthRoutes(api, authService, options.config.NODE_ENV === 'production')
      await registerProjectRoutes(api, projectService)
      await registerMediaRoutes(
        api,
        mediaService,
        options.config.MAX_UPLOAD_BYTES,
        options.config.AUTH_SECRET,
      )
      await registerGenerationRoutes(api, generationService)
      await registerBillingRoutes(api, creditLedger)
      await registerAdminRoutes(api, store)
    },
    { prefix: '/api/v1' },
  )

  if (options.startWorker !== false) taskRunner.start()
  app.addHook('onClose', async () => {
    taskRunner.stop()
    await store.close?.()
  })
  return app
}

function createStateStore(config: AppConfig): StateStore {
  if (config.DATA_STORE === 'postgres') return new PostgresStateStore(config.DATABASE_URL)
  return new AppStore(config.DATA_FILE === ':memory:' ? null : resolve(config.DATA_FILE))
}

function createVideoProvider(config: AppConfig): VideoGenerationProvider | null {
  if (!config.SEEDANCE_API_KEY) return null
  return new AideosSeedanceProvider({
    baseUrl: config.SEEDANCE_API_BASE_URL,
    apiKey: config.SEEDANCE_API_KEY,
    defaultModel: config.SEEDANCE_MODEL,
    requestTimeoutMs: config.SEEDANCE_REQUEST_TIMEOUT_MS,
  })
}
