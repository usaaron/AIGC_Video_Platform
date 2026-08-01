import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import type { AppConfig } from './config.js'
import type { FilmPreviewDispatcher } from './core/film/filmPreviewComposer.js'
import type { TaskDispatcher } from './core/jobs/taskDispatcher.js'
import { installObservabilityHooks } from './core/observability/hooks.js'
import type { AppStore } from './infra/store.js'
import { createRuntimeDatabase } from './runtime/database.js'
import { createRuntimeProviders, type RuntimeProviderOverrides } from './runtime/providers.js'
import { createRuntimeQueues } from './runtime/queues.js'
import {
  installRuntimeErrorHandler,
  registerRuntimeHealthRoute,
  registerRuntimeRoutes,
} from './runtime/routes.js'
import {
  createRuntimeFilmPreviewComposer,
  createRuntimeRepositories,
  createRuntimeServices,
} from './runtime/services.js'
import { createRuntimeStorage } from './runtime/storage.js'

type BuildAppOptions = RuntimeProviderOverrides & {
  config: AppConfig
  logger?: boolean
  store?: AppStore
  startWorker?: boolean
  taskDispatcher?: TaskDispatcher
  filmPreviewComposer?: FilmPreviewDispatcher | null
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.config.TRUST_PROXY,
    bodyLimit: options.config.MAX_UPLOAD_BYTES,
    routerOptions: {
      maxParamLength: 4_096,
    },
  })
  installObservabilityHooks(app)

  const { store, database } = await createRuntimeDatabase(options.config, options.store)
  await registerHttpPlugins(app, options.config)

  const storage = createRuntimeStorage(options.config)
  const providers = createRuntimeProviders(options.config, options)
  const repositories = await createRuntimeRepositories({
    config: options.config,
    store,
    database,
  })
  const filmPreviewComposer = createRuntimeFilmPreviewComposer({
    config: options.config,
    store,
    objectStorage: storage.objectStorage,
    providers,
    ...(options.filmPreviewComposer !== undefined
      ? { filmPreviewComposerOverride: options.filmPreviewComposer }
      : {}),
  })
  await filmPreviewComposer?.recoverInterrupted()

  let runtimeServices: ReturnType<typeof createRuntimeServices> | null = null
  const queues = await createRuntimeQueues({
    config: options.config,
    store,
    database,
    objectStorage: storage.objectStorage,
    providers,
    repositories,
    ...(options.taskDispatcher ? { taskDispatcherOverride: options.taskDispatcher } : {}),
    getGenerationService: () => runtimeServices?.generationService ?? null,
    getNovelService: () => runtimeServices?.novelService ?? null,
  })
  runtimeServices = createRuntimeServices({
    config: options.config,
    store,
    database,
    objectStorage: storage.objectStorage,
    providers,
    repositories,
    dispatchers: {
      taskDispatcher: queues.taskDispatcher,
      aiJobDispatcher: queues.aiJobDispatcher,
    },
    filmPreviewComposer,
  })

  installRuntimeErrorHandler(app)
  registerRuntimeHealthRoute(app, options.config, providers, {
    database,
    queues,
    inlineWorkersStarted: options.startWorker !== false && queues.inlineRunners.length > 0,
  })
  await registerRuntimeRoutes({
    app,
    config: options.config,
    store,
    repositories,
    services: runtimeServices,
  })

  if (queues.inlineRunners.length && options.startWorker !== false) {
    queues.inlineRunners.forEach((runner) => runner.start())
    app.addHook('onClose', async () => queues.inlineRunners.forEach((runner) => runner.stop()))
  }
  queues.outboxRelay?.start()
  app.addHook('onClose', async () => {
    queues.outboxRelay?.stop()
    await queues.bullMqDispatcher?.close()
    await database?.close()
  })

  return app
}

async function registerHttpPlugins(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
  })
  await app.register(cookie)
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true })
  await app.register(multipart, {
    limits: { files: 1, fileSize: config.MAX_UPLOAD_BYTES, parts: 2 },
  })
}
