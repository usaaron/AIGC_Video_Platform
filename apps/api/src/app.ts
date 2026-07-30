import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import { resolve } from 'node:path'
import type { AppConfig } from './config.js'
import { installAuth } from './core/auth/installAuth.js'
import { createAuthProvider } from './core/auth/provider.js'
import { AppError } from './core/errors.js'
import type { ImageGenerationProvider } from './core/generation/imageProvider.js'
import type { AssetLibraryProvider } from './core/generation/volcArkAssetLibraryProvider.js'
import type { TextGenerationProvider } from './core/generation/textProvider.js'
import { TextGenerationProviderError } from './core/generation/textProvider.js'
import type { VideoGenerationProvider } from './core/generation/videoProvider.js'
import { FilmPreviewComposer, type FilmPreviewDispatcher } from './core/film/filmPreviewComposer.js'
import { GenerationTaskRunner, type TaskDispatcher } from './core/jobs/taskDispatcher.js'
import { createAutoFilmPreviewCallback } from './core/jobs/taskCompletion.js'
import { AccountDatabase } from './infra/postgres.js'
import { AppStore } from './infra/store.js'
import { createObjectStorage } from './infra/objectStorage.js'
import { AccountManagementRepository } from './modules/accountManagement/repository.js'
import { registerAccountManagementRoutes } from './modules/accountManagement/routes.js'
import { AccountManagementService } from './modules/accountManagement/service.js'
import { AdminRepository } from './modules/admin/repository.js'
import { registerAdminRoutes } from './modules/admin/routes.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { AuthRepository } from './modules/auth/repository.js'
import { AuthService } from './modules/auth/service.js'
import { registerBillingRoutes } from './modules/billing/routes.js'
import { StoreCreditLedger } from './modules/billing/creditLedger.js'
import { registerGenerationRoutes } from './modules/generation/routes.js'
import { GenerationTaskRepository } from './modules/generation/repository.js'
import { GenerationService } from './modules/generation/service.js'
import { MediaRepository } from './modules/media/repository.js'
import { registerMediaRoutes } from './modules/media/routes.js'
import { MediaService } from './modules/media/service.js'
import { NovelRepository } from './modules/novels/repository.js'
import { registerNovelRoutes } from './modules/novels/routes.js'
import { NovelService } from './modules/novels/service.js'
import { registerProjectRoutes } from './modules/projects/routes.js'
import { ProjectRepository } from './modules/projects/repository.js'
import { ProjectService } from './modules/projects/service.js'
import { registerQuickStartRoutes } from './modules/quickStart/routes.js'
import { QuickStartService } from './modules/quickStart/service.js'
import { registerTrustedAssetRoutes } from './modules/trustedAssets/routes.js'
import { TrustedAssetService } from './modules/trustedAssets/service.js'
import { UserRepository } from './modules/users/repository.js'
import {
  createAssetLibraryProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
  textProviderName,
  videoProviderName,
} from './runtime/providers.js'

type BuildAppOptions = {
  config: AppConfig
  logger?: boolean
  store?: AppStore
  startWorker?: boolean
  taskDispatcher?: TaskDispatcher
  videoProvider?: VideoGenerationProvider | null
  imageProvider?: ImageGenerationProvider | null
  textProvider?: TextGenerationProvider | null
  assetLibraryProvider?: AssetLibraryProvider | null
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
  const store =
    options.store ??
    new AppStore(
      options.config.DATA_FILE === ':memory:' ? null : resolve(options.config.DATA_FILE),
      {
        creatorName: options.config.BOOTSTRAP_CREATOR_NAME,
        creatorEmail: options.config.BOOTSTRAP_CREATOR_EMAIL,
        creatorPassword: options.config.BOOTSTRAP_CREATOR_PASSWORD,
        ownerName: options.config.BOOTSTRAP_OWNER_NAME,
        ownerEmail: options.config.BOOTSTRAP_OWNER_EMAIL,
        ownerPassword: options.config.BOOTSTRAP_OWNER_PASSWORD,
        adminName: options.config.BOOTSTRAP_ADMIN_NAME,
        adminEmail: options.config.BOOTSTRAP_ADMIN_EMAIL,
        adminPassword: options.config.BOOTSTRAP_ADMIN_PASSWORD,
      },
      options.config.BOOTSTRAP_DEMO_WORKSPACE,
    )
  await store.initialize()
  const database = options.config.DATABASE_URL ? new AccountDatabase(options.config.DATABASE_URL) : null
  if (database) {
    if (options.config.NODE_ENV === 'production') {
      await database.ensureLatestMigrations()
    } else {
      await database.migrate()
    }
  }

  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(rateLimit, {
    max: options.config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
  })
  await app.register(cookie)
  await app.register(cors, { origin: options.config.WEB_ORIGIN, credentials: true })
  await app.register(multipart, {
    limits: { files: 1, fileSize: options.config.MAX_UPLOAD_BYTES, parts: 2 },
  })

  const users = new UserRepository(store, database)
  await users.bootstrapFromStore()
  const authAccounts = database ? new AuthRepository(database) : users
  const authService = new AuthService(authAccounts, options.config.AUTH_SECRET, {
    exposePasswordResetTokens: options.config.NODE_ENV !== 'production',
  })
  const accountManagementService = database
    ? new AccountManagementService(
        new AccountManagementRepository(database),
        users,
        store,
        options.config.AUTH_SECRET,
        options.config.WEB_ORIGIN,
      )
    : null
  const adminRepository = database ? new AdminRepository(database) : null
  const creditLedger = new StoreCreditLedger(store, users, options.config.NODE_ENV !== 'production', database)
  await creditLedger.bootstrapFromStore()
  const objectStorage = createObjectStorage(options.config)
  const videoProvider =
    options.videoProvider === undefined ? createVideoProvider(options.config) : options.videoProvider
  const imageProvider =
    options.imageProvider === undefined ? createImageProvider(options.config) : options.imageProvider
  const textProvider =
    options.textProvider === undefined ? createTextProvider(options.config) : options.textProvider
  const assetLibraryProvider =
    options.assetLibraryProvider === undefined
      ? createAssetLibraryProvider(options.config)
      : options.assetLibraryProvider
  const filmPreviewComposer =
    options.filmPreviewComposer === undefined && videoProvider
      ? new FilmPreviewComposer(
          store,
          videoProvider,
          objectStorage,
          options.config.FFMPEG_PATH,
          options.config.FILM_PREVIEW_TIMEOUT_MS,
          videoProviderName(options.config),
        )
      : (options.filmPreviewComposer ?? null)
  await filmPreviewComposer?.recoverInterrupted()
  let generationService: GenerationService | null = null
  const taskDispatcher =
    options.taskDispatcher ??
    new GenerationTaskRunner(store, {
      videoProvider,
      videoProviderName: videoProviderName(options.config),
      imageProvider,
      objectStorage,
      creditLedger,
      providerPollIntervalMs: options.config.VIDEO_POLL_INTERVAL_MS,
      onVideoCompleted: createAutoFilmPreviewCallback(store, () => generationService),
    })
  generationService = new GenerationService(
    new GenerationTaskRepository(store, creditLedger),
    taskDispatcher,
    videoProvider,
    videoProviderName(options.config),
    objectStorage,
    filmPreviewComposer,
  )
  const projectService = new ProjectService(new ProjectRepository(store), textProvider, creditLedger)
  const novelService = new NovelService(new NovelRepository(store), textProvider, creditLedger)
  const quickStartService = new QuickStartService(
    store,
    textProvider,
    taskDispatcher,
    Boolean(imageProvider),
    creditLedger,
  )
  const mediaService = new MediaService(new MediaRepository(store), objectStorage)
  const trustedAssetService = new TrustedAssetService(
    store,
    assetLibraryProvider,
    objectStorage,
    options.config.AUTH_SECRET,
    options.config.PUBLIC_API_BASE_URL.replace(/\/+$/, ''),
    options.config.VOLC_ARK_PROJECT_NAME,
    options.config.ASSET_LIBRARY_CONSOLE_URL,
  )

  installAuth(app, createAuthProvider(options.config, authAccounts))

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

  app.get('/api/v1/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    service: 'seqora-api',
    providers: {
      seedance: videoProvider ? 'configured' : 'local-mock',
      img2: imageProvider ? 'configured' : 'local-mock',
      text: textProvider ? 'configured' : 'unavailable',
      assetLibrary: assetLibraryProvider ? 'configured' : 'unavailable',
    },
    providerNames: {
      seedance: videoProvider ? videoProviderName(options.config) : 'local-mock',
      img2: imageProvider ? 'tokenadvent-img2' : 'local-mock',
      text: textProvider ? textProviderName(options.config) : 'unavailable',
      assetLibrary: assetLibraryProvider ? 'stringx-maas' : 'unavailable',
    },
  }))
  await app.register(
    async (api) => {
      await registerAuthRoutes(api, authService, options.config.NODE_ENV === 'production')
      await registerAccountManagementRoutes(
        api,
        accountManagementService,
        options.config.NODE_ENV === 'production',
      )
      await registerProjectRoutes(api, projectService)
      await registerNovelRoutes(api, novelService)
      await registerQuickStartRoutes(api, quickStartService)
      await registerMediaRoutes(api, mediaService, options.config.MAX_UPLOAD_BYTES)
      await registerTrustedAssetRoutes(api, trustedAssetService)
      await registerGenerationRoutes(api, generationService)
      await registerBillingRoutes(api, creditLedger)
      await registerAdminRoutes(api, store, creditLedger, adminRepository)
    },
    { prefix: '/api/v1' },
  )

  if (options.taskDispatcher === undefined && options.startWorker !== false) {
    const inProcessRunner = taskDispatcher as GenerationTaskRunner
    inProcessRunner.start()
    app.addHook('onClose', async () => inProcessRunner.stop())
  }
  app.addHook('onClose', async () => {
    if (database) {
      await database.close()
    }
  })
  return app
}
