import 'dotenv/config'
import { resolve } from 'node:path'
import {
  createBullMqGenerationWorker,
  createBullMqTaskDispatcher,
  type BullMqGenerationWorker,
  type BullMqTaskDispatcher,
} from './core/jobs/bullMqQueue.js'
import { OutboxRelay, OutboxRepository } from './core/jobs/outbox.js'
import { createAutoFilmPreviewCallback } from './core/jobs/taskCompletion.js'
import { createLocalGenerationTaskHandler } from './core/jobs/localTaskHandler.js'
import { AiJobRunner } from './core/jobs/aiJobRunner.js'
import {
  GenerationTaskRunner,
  noopTaskDispatcher,
  type TaskDispatchContext,
} from './core/jobs/taskDispatcher.js'
import { PostgresAdvisoryTaskRunnerLock } from './core/jobs/taskRunnerLock.js'
import { FilmPreviewComposer } from './core/film/filmPreviewComposer.js'
import { loadConfig } from './config.js'
import { AccountDatabase } from './infra/postgres.js'
import { AppStore } from './infra/store.js'
import { createObjectStorage } from './infra/objectStorage.js'
import { StoreCreditLedger } from './modules/billing/creditLedger.js'
import { AiJobRepository } from './modules/aiJobs/repository.js'
import { GenerationTaskRepository } from './modules/generation/repository.js'
import { GenerationService } from './modules/generation/service.js'
import { NovelRepository } from './modules/novels/repository.js'
import { NovelService } from './modules/novels/service.js'
import { ProjectRepository } from './modules/projects/repository.js'
import { ProjectService } from './modules/projects/service.js'
import { TrustedAssetService } from './modules/trustedAssets/service.js'
import { UserRepository } from './modules/users/repository.js'
import {
  createImageProvider,
  createAssetLibraryProvider,
  createTextProvider,
  createVideoProvider,
  videoProviderName,
} from './runtime/providers.js'

const config = loadConfig()
const store = new AppStore(
  config.DATA_FILE === ':memory:' ? null : resolve(config.DATA_FILE),
  {
    memberName: config.BOOTSTRAP_MEMBER_NAME,
    memberEmail: config.BOOTSTRAP_MEMBER_EMAIL,
    memberPassword: config.BOOTSTRAP_MEMBER_PASSWORD,
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
  config.NODE_ENV !== 'production',
  config.NODE_ENV !== 'production',
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
if (config.BOOTSTRAP_ACCOUNTS_ON_START) {
  await users.bootstrapFromStore()
}
await users.refreshRuntimeCacheFromDatabase()
const projectRepository = new ProjectRepository(store, database)
await projectRepository.refreshRuntimeCacheFromDatabase()

const objectStorage = createObjectStorage(config)
const videoProvider = createVideoProvider(config)
const imageProvider = createImageProvider(config)
const textProvider = createTextProvider(config)
const assetLibraryProvider = createAssetLibraryProvider(config)
const creditLedger = new StoreCreditLedger(store, users, false, database)
if (config.BOOTSTRAP_ACCOUNTS_ON_START) {
  await creditLedger.bootstrapFromStore()
}
const outboxRepository =
  database && config.TASK_QUEUE_DRIVER === 'bullmq' ? new OutboxRepository(database) : null
const generationTaskRepository = new GenerationTaskRepository(store, creditLedger, database, outboxRepository)
await generationTaskRepository.refreshRuntimeCacheFromDatabase()
const aiJobRepository = new AiJobRepository(store, creditLedger, database, outboxRepository)
await aiJobRepository.refreshRuntimeCacheFromDatabase()
const refreshProjectDomainRuntimeCache = database
  ? async () => {
      await projectRepository.refreshRuntimeCacheFromDatabase()
      await users.refreshRuntimeCacheFromDatabase()
      await generationTaskRepository.refreshRuntimeCacheFromDatabase()
      await aiJobRepository.refreshRuntimeCacheFromDatabase()
    }
  : null
const filmPreviewComposer =
  videoProvider && objectStorage
    ? new FilmPreviewComposer(
        store,
        videoProvider,
        objectStorage,
        config.FFMPEG_PATH,
        config.FILM_PREVIEW_TIMEOUT_MS,
        videoProviderName(config),
        { onStateChange: () => generationTaskRepository.flushRuntimeCacheToDatabase().then(() => {}) },
      )
    : null
await filmPreviewComposer?.recoverInterrupted()

let generationService: GenerationService | null = null
const projectService = new ProjectService(projectRepository, textProvider, creditLedger)
const trustedAssetService = new TrustedAssetService(
  store,
  assetLibraryProvider,
  objectStorage,
  config.AUTH_SECRET,
  config.PUBLIC_API_BASE_URL.replace(/\/+$/, ''),
  config.VOLC_ARK_PROJECT_NAME,
  config.ASSET_LIBRARY_CONSOLE_URL,
  projectRepository,
)
const novelService = new NovelService(
  new NovelRepository(store, database, objectStorage),
  textProvider,
  creditLedger,
  aiJobRepository,
  noopTaskDispatcher,
)
const taskRunner = new GenerationTaskRunner(store, {
  videoProvider,
  videoProviderName: videoProviderName(config),
  imageProvider,
  objectStorage,
  creditLedger,
  providerPollIntervalMs: config.VIDEO_POLL_INTERVAL_MS,
  providerStallTimeoutMs: config.VIDEO_PROCESSING_STALL_TIMEOUT_MS,
  ...(refreshProjectDomainRuntimeCache ? { beforeTick: refreshProjectDomainRuntimeCache } : {}),
  ...(database
    ? {
        afterTick: async () => {
          await generationTaskRepository.flushRuntimeCacheToDatabase()
        },
      }
    : {}),
  ...(database ? { taskRunnerLock: new PostgresAdvisoryTaskRunnerLock(database) } : {}),
  onVideoCompleted: createAutoFilmPreviewCallback(store, () => generationService),
  localTaskHandler: createLocalGenerationTaskHandler(store, {
    projectService: () => projectService,
    trustedAssetService: () => trustedAssetService,
  }),
})
const aiJobRunner = new AiJobRunner(aiJobRepository, {
  concurrency: config.TASK_QUEUE_WORKER_CONCURRENCY,
  ...(refreshProjectDomainRuntimeCache ? { beforeTick: refreshProjectDomainRuntimeCache } : {}),
  ...(database
    ? { taskRunnerLock: new PostgresAdvisoryTaskRunnerLock(database, 'seqora:ai-job-runner') }
    : {}),
  handler: novelService,
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
let outboxDispatcher: BullMqTaskDispatcher | null = null
let outboxRelay: OutboxRelay | null = null
if (config.TASK_QUEUE_DRIVER === 'bullmq') {
  await taskRunner.recoverInterrupted()
  await aiJobRunner.recoverInterrupted()
  if (outboxRepository) {
    outboxDispatcher = createBullMqTaskDispatcher(config)
    await outboxDispatcher.waitUntilReady()
    outboxRelay = new OutboxRelay(outboxRepository, outboxDispatcher, {
      ownerId: `worker-outbox-relay-${process.pid}`,
      intervalMs: 1_000,
      leaseTtlMs: 60_000,
      batchSize: 50,
    })
    outboxRelay.start()
  }
  queueWorker = createBullMqGenerationWorker(config, {
    async tick(context?: TaskDispatchContext & { reason?: string }) {
      await taskRunner.tick(context)
      await aiJobRunner.tick(context)
    },
  })
  await queueWorker.start()
  process.stdout.write(
    `[worker] BullMQ worker listening on ${config.TASK_QUEUE_NAME} (${config.REDIS_URL})\n`,
  )
} else if (config.TASK_QUEUE_DRIVER === 'inline') {
  taskRunner.start()
  aiJobRunner.start()
  process.stdout.write('[worker] inline task runner started\n')
} else {
  process.stdout.write('[worker] task queue disabled\n')
}

const shutdown = async (signal: string) => {
  process.stdout.write(`[worker] shutting down on ${signal}\n`)
  taskRunner.stop()
  aiJobRunner.stop()
  outboxRelay?.stop()
  await queueWorker?.close().catch(() => {})
  await outboxDispatcher?.close().catch(() => {})
  if (database) {
    await database.close().catch(() => {})
  }
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
