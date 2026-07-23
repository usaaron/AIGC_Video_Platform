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
import { AideosSeedanceProvider } from './core/generation/aideosSeedanceProvider.js'
import type { ImageGenerationProvider } from './core/generation/imageProvider.js'
import type { AssetLibraryProvider } from './core/generation/volcArkAssetLibraryProvider.js'
import { VolcArkAssetLibraryProvider } from './core/generation/volcArkAssetLibraryProvider.js'
import type { TextGenerationProvider } from './core/generation/textProvider.js'
import { TokenAdventImageProvider } from './core/generation/tokenAdventImageProvider.js'
import { TokenAdventTextProvider } from './core/generation/tokenAdventTextProvider.js'
import { TextGenerationProviderError } from './core/generation/textProvider.js'
import type { VideoGenerationProvider } from './core/generation/videoProvider.js'
import type { VideoProviderName } from './core/generation/videoProvider.js'
import { StringXSeedanceProvider } from './core/generation/stringXSeedanceProvider.js'
import { VolcArkSeedanceProvider } from './core/generation/volcArkSeedanceProvider.js'
import { FilmPreviewComposer, type FilmPreviewDispatcher } from './core/film/filmPreviewComposer.js'
import { GenerationTaskRunner } from './core/jobs/taskDispatcher.js'
import { AppStore } from './infra/store.js'
import { createObjectStorage } from './infra/objectStorage.js'
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
import { registerQuickStartRoutes } from './modules/quickStart/routes.js'
import { QuickStartService } from './modules/quickStart/service.js'
import { registerTrustedAssetRoutes } from './modules/trustedAssets/routes.js'
import { TrustedAssetService } from './modules/trustedAssets/service.js'
import { UserRepository } from './modules/users/repository.js'

type BuildAppOptions = {
  config: AppConfig
  logger?: boolean
  store?: AppStore
  startWorker?: boolean
  videoProvider?: VideoGenerationProvider | null
  imageProvider?: ImageGenerationProvider | null
  textProvider?: TextGenerationProvider | null
  assetLibraryProvider?: AssetLibraryProvider | null
  filmPreviewComposer?: FilmPreviewDispatcher | null
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: options.config.TRUST_PROXY })
  const store =
    options.store ??
    new AppStore(
      options.config.DATA_FILE === ':memory:' ? null : resolve(options.config.DATA_FILE),
      {
        creatorName: options.config.BOOTSTRAP_CREATOR_NAME,
        creatorEmail: options.config.BOOTSTRAP_CREATOR_EMAIL,
        creatorPassword: options.config.BOOTSTRAP_CREATOR_PASSWORD,
        adminName: options.config.BOOTSTRAP_ADMIN_NAME,
        adminEmail: options.config.BOOTSTRAP_ADMIN_EMAIL,
        adminPassword: options.config.BOOTSTRAP_ADMIN_PASSWORD,
      },
      options.config.BOOTSTRAP_DEMO_WORKSPACE,
    )
  await store.initialize()

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

  const users = new UserRepository(store)
  const authService = new AuthService(users, options.config.AUTH_SECRET)
  const creditLedger = new StoreCreditLedger(store, options.config.NODE_ENV !== 'production')
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
  const taskRunner = new GenerationTaskRunner(store, {
    videoProvider,
    videoProviderName: videoProviderName(options.config),
    imageProvider,
    objectStorage,
    providerPollIntervalMs: options.config.VIDEO_POLL_INTERVAL_MS,
    onVideoCompleted: async (task) => {
      const service = generationService
      if (!service) return
      const principal = store.read((state) => {
        const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
        return user ? { userId: user.id, tenantId: user.tenantId, roles: user.roles } : null
      })
      if (!principal) return
      const allShotsReady = store.read((state) => {
        const shots = state.shots.filter(
          (shot) => shot.projectId === task.projectId && shot.tenantId === task.tenantId,
        )
        return (
          shots.length > 0 &&
          shots.every((shot) =>
            state.tasks.some(
              (source) =>
                source.projectId === task.projectId &&
                source.tenantId === task.tenantId &&
                source.kind === 'video' &&
                source.provider === 'seedance' &&
                source.status === 'completed' &&
                source.metadata.shotId === shot.id &&
                typeof source.metadata.providerTaskId === 'string',
            ),
          )
        )
      })
      if (allShotsReady) await service.createFilmPreview(task.projectId, principal, 'full')
    },
  })
  generationService = new GenerationService(
    new GenerationTaskRepository(store),
    creditLedger,
    taskRunner,
    videoProvider,
    videoProviderName(options.config),
    objectStorage,
    filmPreviewComposer,
  )
  const projectService = new ProjectService(new ProjectRepository(store), textProvider, creditLedger)
  const quickStartService = new QuickStartService(store, textProvider, taskRunner, Boolean(imageProvider))
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

  installAuth(app, createAuthProvider(options.config, users))

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
      assetLibrary: assetLibraryProvider ? 'stringx-maas' : 'unavailable',
    },
  }))
  await app.register(
    async (api) => {
      await registerAuthRoutes(api, authService, options.config.NODE_ENV === 'production')
      await registerProjectRoutes(api, projectService)
      await registerQuickStartRoutes(api, quickStartService)
      await registerMediaRoutes(api, mediaService, options.config.MAX_UPLOAD_BYTES)
      await registerTrustedAssetRoutes(api, trustedAssetService)
      await registerGenerationRoutes(api, generationService)
      await registerBillingRoutes(api, creditLedger)
      await registerAdminRoutes(api, store)
    },
    { prefix: '/api/v1' },
  )

  if (options.startWorker !== false) taskRunner.start()
  app.addHook('onClose', async () => taskRunner.stop())
  return app
}

function createVideoProvider(config: AppConfig): VideoGenerationProvider | null {
  if (config.VIDEO_PROVIDER === 'stringx') {
    if (!config.STRINGX_API_KEY) return null
    return new StringXSeedanceProvider({
      baseUrl: config.STRINGX_BASE_URL,
      apiKey: config.STRINGX_API_KEY,
      defaultModel: config.STRINGX_VIDEO_MODEL,
      requestTimeoutMs: config.STRINGX_REQUEST_TIMEOUT_MS,
    })
  }
  if (config.VIDEO_PROVIDER === 'aideos') {
    if (!config.AIDEOS_API_KEY) return null
    return new AideosSeedanceProvider({
      baseUrl: config.AIDEOS_BASE_URL,
      apiKey: config.AIDEOS_API_KEY,
      defaultModel: config.AIDEOS_VIDEO_MODEL,
      requestTimeoutMs: config.AIDEOS_REQUEST_TIMEOUT_MS,
      ffmpegPath: config.FFMPEG_PATH,
      lastFrameTimeoutMs: config.FILM_PREVIEW_TIMEOUT_MS,
    })
  }
  if (!config.ARK_API_KEY) return null
  return new VolcArkSeedanceProvider({
    baseUrl: config.ARK_API_BASE_URL,
    apiKey: config.ARK_API_KEY,
    defaultModel: config.ARK_VIDEO_MODEL,
    requestTimeoutMs: config.ARK_REQUEST_TIMEOUT_MS,
  })
}

function videoProviderName(config: AppConfig): VideoProviderName {
  if (config.VIDEO_PROVIDER === 'stringx') return 'stringx-seedance'
  return config.VIDEO_PROVIDER === 'aideos' ? 'aideos-seedance' : 'volc-ark-seedance'
}

function createImageProvider(config: AppConfig): ImageGenerationProvider | null {
  if (!config.TOKENADVENT_API_KEY) return null
  return new TokenAdventImageProvider({
    baseUrl: config.TOKENADVENT_BASE_URL,
    apiKey: config.TOKENADVENT_API_KEY,
    model: config.IMG2_MODEL,
    quality: config.IMG2_QUALITY,
    requestTimeoutMs: config.TOKENADVENT_REQUEST_TIMEOUT_MS,
  })
}

function createTextProvider(config: AppConfig): TextGenerationProvider | null {
  if (!config.TOKENADVENT_API_KEY) return null
  return new TokenAdventTextProvider({
    baseUrl: config.TOKENADVENT_BASE_URL,
    apiKey: config.TOKENADVENT_API_KEY,
    model: config.TEXT_MODEL,
    requestTimeoutMs: config.TOKENADVENT_REQUEST_TIMEOUT_MS,
  })
}

function createAssetLibraryProvider(config: AppConfig): AssetLibraryProvider | null {
  if (!config.VOLC_ACCESS_KEY || !config.VOLC_SECRET_KEY) return null
  return new VolcArkAssetLibraryProvider({
    baseUrl: config.VOLC_ASSET_BASE_URL,
    accessKey: config.VOLC_ACCESS_KEY,
    secretKey: config.VOLC_SECRET_KEY,
    projectName: config.VOLC_ARK_PROJECT_NAME,
    requestTimeoutMs: config.VOLC_ASSET_REQUEST_TIMEOUT_MS,
  })
}
