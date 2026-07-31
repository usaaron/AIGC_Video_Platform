import 'dotenv/config'
import { resolve } from 'node:path'
import { createBullMqGenerationWorker, type BullMqGenerationWorker } from './core/jobs/bullMqQueue.js'
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
import { ProjectRepository } from './modules/projects/repository.js'
import { UserRepository } from './modules/users/repository.js'
import { createImageProvider, createVideoProvider, videoProviderName } from './runtime/providers.js'

const config = loadConfig()
const store = new AppStore(
  config.DATA_FILE === ':memory:' ? null : resolve(config.DATA_FILE),
  {
    creatorName: config.BOOTSTRAP_CREATOR_NAME,
    creatorEmail: config.BOOTSTRAP_CREATOR_EMAIL,
    creatorPassword: config.BOOTSTRAP_CREATOR_PASSWORD,
    ownerName: config.BOOTSTRAP_OWNER_NAME,
    ownerEmail: config.BOOTSTRAP_OWNER_EMAIL,
    ownerPassword: config.BOOTSTRAP_OWNER_PASSWORD,
    superAdminName: config.BOOTSTRAP_SUPER_ADMIN_NAME,
    superAdminEmail: config.BOOTSTRAP_SUPER_ADMIN_EMAIL,
    superAdminPassword: config.BOOTSTRAP_SUPER_ADMIN_PASSWORD,
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
const projectRepository = new ProjectRepository(store, database)
await projectRepository.refreshRuntimeCacheFromDatabase()

const objectStorage = createObjectStorage(config)
const videoProvider = createVideoProvider(config)
const imageProvider = createImageProvider(config)
const creditLedger = new StoreCreditLedger(store, users, config.NODE_ENV !== 'production', database)
await creditLedger.bootstrapFromStore()
const generationTaskRepository = new GenerationTaskRepository(store, creditLedger, database)
await generationTaskRepository.refreshRuntimeCacheFromDatabase()
if (database) {
  store.setProjectDomainRuntimePersister(async (snapshot) => {
    await projectRepository.persistRuntimeSnapshot(snapshot)
    await generationTaskRepository.persistRuntimeSnapshot(snapshot)
  })
}
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
  generationTaskRepository,
  noopTaskDispatcher,
  videoProvider,
  videoProviderName(config),
  objectStorage,
  filmPreviewComposer,
)

let queueWorker: BullMqGenerationWorker | null = null
if (config.TASK_QUEUE_DRIVER === 'bullmq') {
  queueWorker = createBullMqGenerationWorker(config, taskRunner)
  await queueWorker.start()
  process.stdout.write(
    `[worker] BullMQ worker listening on ${config.TASK_QUEUE_NAME} (${config.REDIS_URL})\n`,
  )
} else if (config.TASK_QUEUE_DRIVER === 'inline') {
  taskRunner.start()
  process.stdout.write('[worker] inline task runner started\n')
} else {
  process.stdout.write('[worker] task queue disabled\n')
}

const shutdown = async (signal: string) => {
  process.stdout.write(`[worker] shutting down on ${signal}\n`)
  taskRunner.stop()
  await queueWorker?.close().catch(() => {})
  if (database) {
    await database.close().catch(() => {})
  }
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
