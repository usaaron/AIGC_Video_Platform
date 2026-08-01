import type { GenerationTask } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { VideoGenerationProvider, VideoProviderName } from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../../modules/billing/creditLedger.js'
import {
  DependencyResolver,
  ImageTaskExecutor,
  ProviderPoller,
  TaskClaimer,
  TaskRefundService,
  TaskWritebackService,
  VideoTaskExecutor,
} from './taskRunnerComponents.js'
import { noopTaskRunnerLock, type TaskRunnerLock } from './taskRunnerLock.js'

export interface TaskDispatcher {
  dispatch(task: { id: string; tenantId: string; updatedAt: string }): Promise<void>
}

export const noopTaskDispatcher: TaskDispatcher = {
  async dispatch() {},
}

type GenerationTaskRunnerOptions = {
  videoProvider?: VideoGenerationProvider | null
  videoProviderName?: VideoProviderName
  imageProvider?: ImageGenerationProvider | null
  objectStorage?: ObjectStorage | null
  creditLedger?: CreditLedger | null
  providerPollIntervalMs?: number
  leaseTtlMs?: number
  beforeTick?: () => Promise<void>
  taskRunnerLock?: TaskRunnerLock | null
  onVideoCompleted?: (task: GenerationTask) => Promise<void>
}

export class GenerationTaskRunner implements TaskDispatcher {
  private timer: NodeJS.Timeout | null = null
  private tickPromise: Promise<void> | null = null
  private readonly beforeTick: (() => Promise<void>) | null
  private readonly taskRunnerLock: TaskRunnerLock
  private readonly refundService: TaskRefundService
  private readonly writeback: TaskWritebackService
  private readonly claimer: TaskClaimer
  private readonly videoExecutor: VideoTaskExecutor
  private readonly imageExecutor: ImageTaskExecutor
  private readonly providerPoller: ProviderPoller
  private readonly activeExecutions = new Set<string>()

  constructor(
    private readonly store: AppStore,
    options: GenerationTaskRunnerOptions = {},
  ) {
    const videoProvider = options.videoProvider ?? null
    const videoProviderName = options.videoProviderName ?? 'stringx-seedance'
    const imageProvider = options.imageProvider ?? null
    const objectStorage = options.objectStorage ?? null
    const leaseTtlMs = options.leaseTtlMs ?? 120_000
    const leaseOwnerId = `generation-task-runner-${process.pid}-${randomUUID()}`
    const dependencyResolver = new DependencyResolver()

    this.beforeTick = options.beforeTick ?? null
    this.taskRunnerLock = options.taskRunnerLock ?? noopTaskRunnerLock
    this.refundService = new TaskRefundService(store, options.creditLedger ?? null)
    this.writeback = new TaskWritebackService(
      store,
      objectStorage,
      leaseOwnerId,
      leaseTtlMs,
      this.refundService,
    )
    this.claimer = new TaskClaimer(store, dependencyResolver, {
      leaseOwnerId,
      leaseTtlMs,
      videoProviderName,
      hasVideoProvider: Boolean(videoProvider),
      hasImageProvider: Boolean(imageProvider),
      hasObjectStorage: Boolean(objectStorage),
    })
    this.videoExecutor = new VideoTaskExecutor(store, {
      videoProvider,
      objectStorage,
      leaseOwnerId,
      leaseTtlMs,
      writeback: this.writeback,
    })
    this.imageExecutor = new ImageTaskExecutor(store, {
      imageProvider,
      objectStorage,
      leaseOwnerId,
      leaseTtlMs,
      writeback: this.writeback,
    })
    this.providerPoller = new ProviderPoller(store, {
      videoProvider,
      videoProviderName,
      providerPollIntervalMs: options.providerPollIntervalMs ?? 5_000,
      leaseOwnerId,
      leaseTtlMs,
      objectStorage,
      writeback: this.writeback,
      onVideoCompleted: options.onVideoCompleted ?? null,
    })
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 900)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async dispatch(_task: { id: string; tenantId: string; updatedAt: string }): Promise<void> {
    void this.tick().catch(() => {})
  }

  async tick(): Promise<void> {
    if (this.tickPromise) return this.tickPromise

    const tickPromise = this.taskRunnerLock.runExclusive(() => this.runTick()).then(() => undefined)
    this.tickPromise = tickPromise

    try {
      await tickPromise
    } finally {
      if (this.tickPromise === tickPromise) this.tickPromise = null
    }
  }

  async recoverInterrupted(): Promise<void> {
    await this.tick()
  }

  private async runTick(): Promise<void> {
    await this.beforeTick?.()
    await this.providerPoller.recoverStatusParseFailures()
    const recoveredSubmissions = await this.claimer.recoverStaleRunningTasks()
    await this.providerPoller.reconcileCancelledRemoteTasks()
    await this.refundService.refundTerminalTasks()
    const hasActiveTasks = this.store.read((state) =>
      state.tasks.some((task) => task.status === 'queued' || task.status === 'running'),
    )
    if (!hasActiveTasks) return

    const remoteTasks = await this.claimer.claimQueuedTasks()

    await this.refundService.refundTerminalTasks()
    this.scheduleRemoteExecutions([...recoveredSubmissions.video, ...remoteTasks.video], (task) =>
      this.videoExecutor.execute(task),
    )
    this.scheduleRemoteExecutions([...recoveredSubmissions.image, ...remoteTasks.image], (task) =>
      this.imageExecutor.execute(task),
    )

    await this.writeback.advanceLocalTasks()
    await this.providerPoller.pollRemoteVideos()
  }

  private scheduleRemoteExecutions(
    tasks: GenerationTask[],
    execute: (task: GenerationTask) => Promise<void>,
  ): void {
    for (const task of tasks) {
      if (this.activeExecutions.has(task.id)) continue
      this.activeExecutions.add(task.id)
      void this.writeback.runWithHeartbeat(task, execute).finally(() => {
        this.activeExecutions.delete(task.id)
      })
    }
  }
}
