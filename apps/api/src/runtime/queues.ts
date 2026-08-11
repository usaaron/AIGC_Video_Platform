import type { AppConfig } from '../config.js'
import { AiJobRunner } from '../core/jobs/aiJobRunner.js'
import { createBullMqTaskDispatcher, type BullMqTaskDispatcher } from '../core/jobs/bullMqQueue.js'
import { OutboxRelay, OutboxTaskDispatcher } from '../core/jobs/outbox.js'
import { createAutoFilmPreviewCallback } from '../core/jobs/taskCompletion.js'
import { GenerationTaskRunner, noopTaskDispatcher, type TaskDispatcher } from '../core/jobs/taskDispatcher.js'
import { PostgresAdvisoryTaskRunnerLock } from '../core/jobs/taskRunnerLock.js'
import type { ObjectStorage } from '../infra/objectStorage.js'
import type { AccountDatabase } from '../infra/postgres.js'
import type { AppStore } from '../infra/store.js'
import type { GenerationService } from '../modules/generation/service.js'
import type { NovelService } from '../modules/novels/service.js'
import { videoProviderName, type RuntimeProviders } from './providers.js'
import type { RuntimeRepositories } from './services.js'
import { createLocalGenerationTaskHandler } from '../core/jobs/localTaskHandler.js'
import type { ProjectService } from '../modules/projects/service.js'
import type { TrustedAssetService } from '../modules/trustedAssets/service.js'

export type ManagedTaskDispatcher = TaskDispatcher & {
  close?: () => Promise<void>
}

export type RuntimeQueues = {
  taskDispatcher: ManagedTaskDispatcher
  aiJobDispatcher: ManagedTaskDispatcher
  bullMqDispatcher: BullMqTaskDispatcher | null
  outboxRelay: OutboxRelay | null
  inlineRunners: Array<GenerationTaskRunner | AiJobRunner>
}

export async function createRuntimeQueues(input: {
  config: AppConfig
  store: AppStore
  database: AccountDatabase | null
  objectStorage: ObjectStorage
  providers: RuntimeProviders
  repositories: RuntimeRepositories
  taskDispatcherOverride?: TaskDispatcher
  getGenerationService: () => GenerationService | null
  getNovelService: () => NovelService | null
  getProjectService: () => ProjectService | null
  getTrustedAssetService: () => TrustedAssetService | null
}): Promise<RuntimeQueues> {
  const {
    config,
    store,
    database,
    objectStorage,
    providers,
    repositories,
    taskDispatcherOverride,
    getGenerationService,
    getNovelService,
    getProjectService,
    getTrustedAssetService,
  } = input

  if (taskDispatcherOverride) {
    return {
      taskDispatcher: taskDispatcherOverride,
      aiJobDispatcher: taskDispatcherOverride,
      bullMqDispatcher: null,
      outboxRelay: null,
      inlineRunners: [],
    }
  }

  if (config.TASK_QUEUE_DRIVER === 'bullmq') {
    const bullMqDispatcher = createBullMqTaskDispatcher(config)
    try {
      await bullMqDispatcher.waitUntilReady()
    } catch (error) {
      await bullMqDispatcher.close().catch(() => {})
      throw error
    }
    const outboxRelay = repositories.outboxRepository
      ? new OutboxRelay(repositories.outboxRepository, bullMqDispatcher, {
          ownerId: `api-outbox-relay-${process.pid}`,
          intervalMs: 1_000,
          leaseTtlMs: 60_000,
          batchSize: 50,
        })
      : null
    const outboxDispatcher = outboxRelay ? new OutboxTaskDispatcher(outboxRelay) : null
    return {
      taskDispatcher: outboxDispatcher ?? bullMqDispatcher,
      aiJobDispatcher: outboxDispatcher ?? bullMqDispatcher,
      bullMqDispatcher,
      outboxRelay,
      inlineRunners: [],
    }
  }

  if (config.TASK_QUEUE_DRIVER === 'none') {
    return {
      taskDispatcher: noopTaskDispatcher,
      aiJobDispatcher: noopTaskDispatcher,
      bullMqDispatcher: null,
      outboxRelay: null,
      inlineRunners: [],
    }
  }

  const generationRunner = new GenerationTaskRunner(store, {
    videoProvider: providers.videoProvider,
    videoProviderName: videoProviderName(config),
    imageProvider: providers.imageProvider,
    objectStorage,
    creditLedger: repositories.creditLedger,
    providerPollIntervalMs: config.VIDEO_POLL_INTERVAL_MS,
    providerStallTimeoutMs: config.VIDEO_PROCESSING_STALL_TIMEOUT_MS,
    ...(repositories.refreshProjectDomainRuntimeCache
      ? { beforeTick: repositories.refreshProjectDomainRuntimeCache }
      : {}),
    ...(database
      ? {
          afterTick: async () => {
            await repositories.generationTaskRepository.flushRuntimeCacheToDatabase()
          },
        }
      : {}),
    ...(database ? { taskRunnerLock: new PostgresAdvisoryTaskRunnerLock(database) } : {}),
    onVideoCompleted: createAutoFilmPreviewCallback(store, getGenerationService),
    localTaskHandler: createLocalGenerationTaskHandler(store, {
      projectService: getProjectService,
      trustedAssetService: getTrustedAssetService,
    }),
  })
  const aiJobRunner = new AiJobRunner(repositories.aiJobRepository, {
    concurrency: config.TASK_QUEUE_WORKER_CONCURRENCY,
    ...(repositories.refreshProjectDomainRuntimeCache
      ? { beforeTick: repositories.refreshProjectDomainRuntimeCache }
      : {}),
    ...(database
      ? { taskRunnerLock: new PostgresAdvisoryTaskRunnerLock(database, 'seqora:ai-job-runner') }
      : {}),
    handler: {
      canHandle: (job) => getNovelService()?.canHandle(job) ?? false,
      execute: (job) => {
        const novelService = getNovelService()
        if (!novelService) throw new Error('Novel service is not ready')
        return novelService.execute(job)
      },
    },
  })

  return {
    taskDispatcher: generationRunner,
    aiJobDispatcher: aiJobRunner,
    bullMqDispatcher: null,
    outboxRelay: null,
    inlineRunners: [generationRunner, aiJobRunner],
  }
}
