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
import type { LocalGenerationTaskHandler } from './localTaskHandler.js'

export interface TaskDispatcher {
  dispatch(
    task: { id: string; tenantId: string; updatedAt: string },
    context?: TaskDispatchContext,
  ): Promise<void>
}

export type TaskDispatchContext = {
  traceId?: string | null
}

export const noopTaskDispatcher: TaskDispatcher = {
  async dispatch(
    _task?: { id: string; tenantId: string; updatedAt: string },
    _context?: TaskDispatchContext,
  ) {},
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
  afterTick?: () => Promise<void>
  taskRunnerLock?: TaskRunnerLock | null
  onVideoCompleted?: (task: GenerationTask) => Promise<void>
  localTaskHandler?: LocalGenerationTaskHandler | null
}

export class GenerationTaskRunner implements TaskDispatcher {
  private timer: NodeJS.Timeout | null = null
  private tickPromise: Promise<void> | null = null
  private readonly beforeTick: (() => Promise<void>) | null
  private readonly afterTick: (() => Promise<void>) | null
  private readonly taskRunnerLock: TaskRunnerLock
  private readonly refundService: TaskRefundService
  private readonly writeback: TaskWritebackService
  private readonly claimer: TaskClaimer
  private readonly videoExecutor: VideoTaskExecutor
  private readonly imageExecutor: ImageTaskExecutor
  private readonly providerPoller: ProviderPoller
  private readonly localTaskHandler: LocalGenerationTaskHandler | null
  private readonly activeExecutions = new Set<string>()
  private readonly leaseTtlMs: number

  constructor(
    private readonly store: AppStore,
    options: GenerationTaskRunnerOptions = {},
  ) {
    const videoProvider = options.videoProvider ?? null
    const videoProviderName = options.videoProviderName ?? 'stringx-seedance'
    const imageProvider = options.imageProvider ?? null
    const objectStorage = options.objectStorage ?? null
    const leaseTtlMs = options.leaseTtlMs ?? 120_000
    this.leaseTtlMs = leaseTtlMs
    const leaseOwnerId = `generation-task-runner-${process.pid}-${randomUUID()}`
    const dependencyResolver = new DependencyResolver()

    this.beforeTick = options.beforeTick ?? null
    this.afterTick = options.afterTick ?? null
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
    this.localTaskHandler = options.localTaskHandler ?? null
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

  async dispatch(
    _task: { id: string; tenantId: string; updatedAt: string },
    context?: TaskDispatchContext,
  ): Promise<void> {
    void this.tick(context).catch(() => {})
  }

  async tick(context?: TaskDispatchContext): Promise<void> {
    if (this.tickPromise) return this.tickPromise

    const tickPromise = this.taskRunnerLock.runExclusive(() => this.runTick(context)).then(() => undefined)
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

  private async runTick(_context?: TaskDispatchContext): Promise<void> {
    await this.beforeTick?.()
    try {
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
      const localTasks = [...recoveredSubmissions.local, ...remoteTasks.local].filter((task) =>
        this.localTaskHandler?.canHandle(task),
      )
      this.scheduleRemoteExecutions(localTasks, (task) => this.executeLocalTask(task), false)

      await this.writeback.advanceLocalTasks((task) => this.localTaskHandler?.canHandle(task) ?? false)
      await this.providerPoller.pollRemoteVideos()
    } finally {
      await this.afterTick?.()
    }
  }

  private scheduleRemoteExecutions(
    tasks: GenerationTask[],
    execute: (task: GenerationTask) => Promise<void>,
    withHeartbeat = true,
  ): void {
    for (const task of tasks) {
      if (this.activeExecutions.has(task.id)) continue
      this.activeExecutions.add(task.id)
      const execution = withHeartbeat ? this.writeback.runWithHeartbeat(task, execute) : execute(task)
      void execution.finally(() => {
        this.activeExecutions.delete(task.id)
      })
    }
  }

  private async executeLocalTask(task: GenerationTask): Promise<void> {
    const leaseToken = task.leaseToken
    const handler = this.localTaskHandler
    if (!leaseToken || !handler) return
    const stopHeartbeat = this.startLocalTaskHeartbeat(task.id, leaseToken)
    try {
      const result = await handler.execute(task)
      await this.runLocalTaskMutation(() => this.writeback.completeLocalTask(task.id, leaseToken, result))
    } catch (error) {
      await this.runLocalTaskMutation(() =>
        this.writeback.failTask(task.id, localTaskError(error), leaseToken),
      )
    } finally {
      stopHeartbeat()
    }
  }

  private startLocalTaskHeartbeat(taskId: string, leaseToken: string): () => void {
    let heartbeatRunning = false
    const heartbeat = async () => {
      if (heartbeatRunning) return
      heartbeatRunning = true
      try {
        await this.runLocalTaskMutation(() => this.writeback.renewLocalTaskLease(taskId, leaseToken))
      } finally {
        heartbeatRunning = false
      }
    }
    const timer = setInterval(() => void heartbeat(), Math.max(1_000, Math.floor(this.leaseTtlMs / 3)))
    timer.unref?.()
    return () => clearInterval(timer)
  }

  private async runLocalTaskMutation(operation: () => Promise<void>): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const acquired = await this.taskRunnerLock.runExclusive(async () => {
        await this.beforeTick?.()
        await operation()
        await this.afterTick?.()
      })
      if (acquired) return
      await delay(100)
    }
    throw new Error('Timed out while persisting local generation task state')
  }
}

function localTaskError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
