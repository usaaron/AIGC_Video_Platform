import 'dotenv/config'
import { resolve } from 'node:path'
import { createAutoFilmPreviewCallback } from './core/jobs/taskCompletion.js'
import { GenerationTaskRunner, noopTaskDispatcher } from './core/jobs/taskDispatcher.js'
import { createScriptTaskHandler } from './core/jobs/scriptTaskHandler.js'
import { createTrustedAssetTaskHandler } from './core/jobs/trustedAssetTaskHandler.js'
import { FilmPreviewComposer } from './core/film/filmPreviewComposer.js'
import { loadConfig } from './config.js'
import { AppStore } from './infra/store.js'
import { createObjectStorage } from './infra/objectStorage.js'
import { GenerationTaskRepository } from './modules/generation/repository.js'
import { GenerationService } from './modules/generation/service.js'
import { StoreCreditLedger } from './modules/billing/creditLedger.js'
import { ProjectRepository } from './modules/projects/repository.js'
import { ProjectService } from './modules/projects/service.js'
import { TrustedAssetService } from './modules/trustedAssets/service.js'
import {
  createAssetLibraryProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
  videoProviderName,
} from './runtime/providers.js'

const config = loadConfig()
const store = new AppStore(
  config.DATA_FILE === ':memory:' ? null : resolve(config.DATA_FILE),
  {
    creatorName: config.BOOTSTRAP_CREATOR_NAME,
    creatorEmail: config.BOOTSTRAP_CREATOR_EMAIL,
    creatorPassword: config.BOOTSTRAP_CREATOR_PASSWORD,
    adminName: config.BOOTSTRAP_ADMIN_NAME,
    adminEmail: config.BOOTSTRAP_ADMIN_EMAIL,
    adminPassword: config.BOOTSTRAP_ADMIN_PASSWORD,
  },
  config.BOOTSTRAP_DEMO_WORKSPACE,
)
await store.initialize()

const objectStorage = createObjectStorage(config)
const videoProvider = createVideoProvider(config)
const imageProvider = createImageProvider(config)
const textProvider = createTextProvider(config)
const assetLibraryProvider = createAssetLibraryProvider(config)
const creditLedger = new StoreCreditLedger(
  store,
  config.NODE_ENV !== 'production',
  config.DEMO_UNLIMITED_GENERATION_CONCURRENCY,
)
const projectService = new ProjectService(new ProjectRepository(store), textProvider, creditLedger)
const trustedAssetService = new TrustedAssetService(
  store,
  assetLibraryProvider,
  objectStorage,
  config.AUTH_SECRET,
  config.PUBLIC_API_BASE_URL.replace(/\/+$/, ''),
  config.VOLC_ARK_PROJECT_NAME,
  config.ASSET_LIBRARY_CONSOLE_URL,
)
const filmPreviewComposer =
  videoProvider && objectStorage
    ? new FilmPreviewComposer(
        store,
        videoProvider,
        objectStorage,
        config.FFMPEG_PATH,
        config.FILM_PREVIEW_TIMEOUT_MS,
        videoProviderName(config),
      )
    : null
await filmPreviewComposer?.recoverInterrupted()

let generationService: GenerationService | null = null
const taskRunner = new GenerationTaskRunner(store, {
  videoProvider,
  videoProviderName: videoProviderName(config),
  imageProvider,
  objectStorage,
  providerPollIntervalMs: config.VIDEO_POLL_INTERVAL_MS,
  demoUnlimitedConcurrency: config.DEMO_UNLIMITED_GENERATION_CONCURRENCY,
  onVideoCompleted: createAutoFilmPreviewCallback(store, () => generationService),
  textTaskHandler: createScriptTaskHandler(store, projectService),
  trustedAssetTaskHandler: createTrustedAssetTaskHandler(store, trustedAssetService),
})
generationService = new GenerationService(
  new GenerationTaskRepository(store),
  noopTaskDispatcher,
  videoProvider,
  videoProviderName(config),
  objectStorage,
  filmPreviewComposer,
)

taskRunner.start()

const shutdown = async (signal: string) => {
  process.stdout.write(`[worker] shutting down on ${signal}\n`)
  taskRunner.stop()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
