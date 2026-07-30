import 'dotenv/config'
import { resolve } from 'node:path'
import { createAutoFilmPreviewCallback } from './core/jobs/taskCompletion.js'
import { GenerationTaskRunner, noopTaskDispatcher } from './core/jobs/taskDispatcher.js'
import { FilmPreviewComposer } from './core/film/filmPreviewComposer.js'
import { loadConfig } from './config.js'
import { AccountDatabase } from './infra/postgres.js'
import { AppStore } from './infra/store.js'
import { createObjectStorage } from './infra/objectStorage.js'
import { StoreCreditLedger } from './modules/billing/creditLedger.js'
import { GenerationTaskRepository } from './modules/generation/repository.js'
import { GenerationService } from './modules/generation/service.js'
import { UserRepository } from './modules/users/repository.js'
import { createImageProvider, createVideoProvider, videoProviderName } from './runtime/providers.js'

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
const database = config.DATABASE_URL ? new AccountDatabase(config.DATABASE_URL) : null
if (database) {
  if (config.NODE_ENV === 'production') {
    await database.ensureLatestMigrations()
  } else {
    await database.migrate()
  }
}
const users = new UserRepository(store, database)
await users.bootstrapFromStore()

const objectStorage = createObjectStorage(config)
const videoProvider = createVideoProvider(config)
const imageProvider = createImageProvider(config)
const creditLedger = new StoreCreditLedger(store, users, config.NODE_ENV !== 'production', database)
await creditLedger.bootstrapFromStore()
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
  creditLedger,
  providerPollIntervalMs: config.VIDEO_POLL_INTERVAL_MS,
  onVideoCompleted: createAutoFilmPreviewCallback(store, () => generationService),
})
generationService = new GenerationService(
  new GenerationTaskRepository(store, creditLedger),
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
  if (database) {
    await database.close().catch(() => {})
  }
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
