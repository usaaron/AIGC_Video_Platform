import type { GenerationTask } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { TextGenerationTiming } from '../generation/textProvider.js'
import type { VideoGenerationProvider, VideoProviderName } from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../../modules/billing/creditLedger.js'
import type { MediaRepository } from '../../modules/media/repository.js'
import { usageCollector } from '../observability/usage.js'
import { traceIdFromGenerationTask } from '../observability/trace.js'
import {
  type ClaimedRemoteTasks,
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
  mediaRepository?: Pick<MediaRepository, 'findSourceById'> | null
  objectStorage?: ObjectStorage | null
  creditLedger?: CreditLedger | null
  providerPollIntervalMs?: number
  providerStallTimeoutMs?: number
  providerStatusTimeoutMs?: number
  providerPollConcurrency?: number
  leaseTtlMs?: number
  taskMutationLockTimeoutMs?: number
  beforeTick?: () => Promise<void>
  afterTick?: () => Promise<void>
  refreshTask?: (taskId: string) => Promise<void>
  persistTask?: (taskId: string) => Promise<void>
  taskRunnerLock?: TaskRunnerLock | null
  onVideoCompleted?: (task: GenerationTask) => Promise<void>
  localTaskHandler?: LocalGenerationTaskHandler | null
}

type ProviderMaintenanceWork = {
  videoPolls: GenerationTask[]
  cancellations: GenerationTask[]
}

type ProviderMaintenanceTask =
  { kind: 'video-poll'; task: GenerationTask } | { kind: 'video-cancellation'; task: GenerationTask }

export class GenerationTaskRunner implements TaskDispatcher {
  private timer: NodeJS.Timeout | null = null
  private tickPromise: Promise<void> | null = null
  private tickRequested = false
  private readonly beforeTick: (() => Promise<void>) | null
  private readonly afterTick: (() => Promise<void>) | null
  private readonly refreshTask: ((taskId: string) => Promise<void>) | null
  private readonly persistTask: ((taskId: string) => Promise<void>) | null
  private readonly taskRunnerLock: TaskRunnerLock
  private readonly refundService: TaskRefundService
  private readonly writeback: TaskWritebackService
  private readonly claimer: TaskClaimer
  private readonly videoExecutor: VideoTaskExecutor
  private readonly imageExecutor: ImageTaskExecutor
  private readonly providerPoller: ProviderPoller
  private readonly localTaskHandler: LocalGenerationTaskHandler | null
  private readonly activeExecutions = new Set<string>()
  private readonly providerMaintenanceQueue: ProviderMaintenanceTask[] = []
  private readonly scheduledProviderPolls = new Set<string>()
  private readonly scheduledProviderCancellations = new Set<string>()
  private providerMaintenancePromise: Promise<void> | null = null
  private readonly providerPollConcurrency: number
  private readonly leaseTtlMs: number
  private readonly taskMutationLockTimeoutMs: number

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
    this.providerPollConcurrency = Math.max(1, Math.floor(options.providerPollConcurrency ?? 6))
    this.taskMutationLockTimeoutMs = Math.max(1, options.taskMutationLockTimeoutMs ?? 30_000)
    const leaseOwnerId = `generation-task-runner-${process.pid}-${randomUUID()}`
    const dependencyResolver = new DependencyResolver()

    this.beforeTick = options.beforeTick ?? null
    this.afterTick = options.afterTick ?? null
    this.refreshTask = options.refreshTask ?? null
    this.persistTask = options.persistTask ?? null
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
      mediaRepository: options.mediaRepository ?? null,
      objectStorage,
      leaseOwnerId,
      leaseTtlMs,
      writeback: this.writeback,
    })
    this.providerPoller = new ProviderPoller(store, {
      videoProvider,
      videoProviderName,
      providerPollIntervalMs: options.providerPollIntervalMs ?? 5_000,
      providerStallTimeoutMs: options.providerStallTimeoutMs ?? 6 * 60_000,
      providerStatusTimeoutMs: options.providerStatusTimeoutMs ?? 10_000,
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
    if (this.tickPromise) {
      this.tickRequested = true
      return this.tickPromise
    }

    let maintenanceWork: ProviderMaintenanceWork = { videoPolls: [], cancellations: [] }
    const tickPromise = this.taskRunnerLock
      .runExclusive(async () => {
        maintenanceWork = await this.runTick(context)
      })
      .then(() => undefined)
    this.tickPromise = tickPromise

    let maintenancePromise: Promise<void> | null = null
    try {
      await tickPromise
      this.enqueueProviderMaintenance(maintenanceWork)
      maintenancePromise = this.providerMaintenancePromise
    } finally {
      if (this.tickPromise === tickPromise) this.tickPromise = null
    }
    if (this.tickRequested) {
      this.tickRequested = false
      void this.tick(context).catch(() => {})
    }
    await maintenancePromise
  }

  async recoverInterrupted(): Promise<void> {
    await this.tick()
  }

  private async runTick(_context?: TaskDispatchContext): Promise<ProviderMaintenanceWork> {
    const maintenanceWork: ProviderMaintenanceWork = { videoPolls: [], cancellations: [] }
    await this.beforeTick?.()
    try {
      await this.providerPoller.recoverStatusParseFailures()
      const recoveredSubmissions = await this.claimer.recoverStaleRunningTasks()
      const availableMaintenanceSlots = this.availableProviderMaintenanceSlots()
      maintenanceWork.cancellations = await this.providerPoller.claimCancelledRemoteTasks(
        availableMaintenanceSlots,
        this.scheduledProviderCancellations,
      )
      await this.refundService.refundTerminalTasks()
      const hasActiveTasks = this.store.read((state) =>
        state.tasks.some((task) => task.status === 'queued' || task.status === 'running'),
      )
      if (!hasActiveTasks) return maintenanceWork

      const remoteTasks = await this.claimer.claimQueuedTasks()

      await this.refundService.refundTerminalTasks()
      this.scheduleClaimedTasks({
        video: [...recoveredSubmissions.video, ...remoteTasks.video],
        image: [...recoveredSubmissions.image, ...remoteTasks.image],
        local: [...recoveredSubmissions.local, ...remoteTasks.local],
      })

      await this.writeback.advanceLocalTasks((task) => this.localTaskHandler?.canHandle(task) ?? false)
      maintenanceWork.videoPolls = await this.providerPoller.claimRemoteVideoPolls(
        Math.max(0, availableMaintenanceSlots - maintenanceWork.cancellations.length),
        this.scheduledProviderPolls,
      )
      return maintenanceWork
    } finally {
      await this.afterTick?.()
    }
  }

  private availableProviderMaintenanceSlots(): number {
    return Math.max(
      0,
      this.providerPollConcurrency -
        this.scheduledProviderPolls.size -
        this.scheduledProviderCancellations.size,
    )
  }

  private enqueueProviderMaintenance(work: ProviderMaintenanceWork): void {
    for (const task of work.cancellations) {
      if (this.scheduledProviderCancellations.has(task.id)) continue
      this.scheduledProviderCancellations.add(task.id)
      this.providerMaintenanceQueue.push({ kind: 'video-cancellation', task })
    }
    for (const task of work.videoPolls) {
      if (this.scheduledProviderPolls.has(task.id)) continue
      this.scheduledProviderPolls.add(task.id)
      this.providerMaintenanceQueue.push({ kind: 'video-poll', task })
    }
    this.startProviderMaintenanceBatch()
  }

  private startProviderMaintenanceBatch(): void {
    if (this.providerMaintenancePromise || this.providerMaintenanceQueue.length === 0) return
    const batch = this.drainProviderMaintenance().catch((error) => {
      this.warnTaskRunnerFailure('provider maintenance batch', 'batch', error)
    })
    this.providerMaintenancePromise = batch
    void batch.then(() => {
      if (this.providerMaintenancePromise === batch) this.providerMaintenancePromise = null
      this.startProviderMaintenanceBatch()
    })
  }

  private async drainProviderMaintenance(): Promise<void> {
    const worker = async () => {
      while (true) {
        const work = this.providerMaintenanceQueue.shift()
        if (!work) return
        let shouldRunFollowUpTick = false
        try {
          shouldRunFollowUpTick =
            work.kind === 'video-poll'
              ? await this.processProviderVideoPoll(work.task)
              : await this.processProviderCancellation(work.task)
        } catch (error) {
          this.warnTaskRunnerFailure('provider maintenance', work.task.id, error)
        } finally {
          if (work.kind === 'video-poll') this.scheduledProviderPolls.delete(work.task.id)
          else this.scheduledProviderCancellations.delete(work.task.id)
          if (shouldRunFollowUpTick) void this.tick().catch(() => {})
        }
      }
    }
    await Promise.all(Array.from({ length: this.providerPollConcurrency }, () => worker()))
  }

  private async processProviderVideoPoll(task: GenerationTask): Promise<boolean> {
    const leaseToken = task.leaseToken
    if (!leaseToken) return false
    const stopHeartbeat = this.startTaskHeartbeat(task.id, leaseToken)
    try {
      const outcome = await this.providerPoller.requestRemoteVideoPoll(task)
      const applied = await this.runLocalTaskMutation(
        task.id,
        () => this.providerPoller.applyRemoteVideoPoll(task, outcome),
        true,
      )
      if (applied.stalledProviderTaskId) {
        this.providerPoller.cancelStalledProviderTask(applied.stalledProviderTaskId)
      }
      if (applied.completedTask) {
        await this.providerPoller.notifyVideoCompleted(applied.completedTask)
      }
      return Boolean(
        applied.completedTask ||
        applied.stalledProviderTaskId ||
        (outcome.kind === 'status' && outcome.status.status === 'failed'),
      )
    } finally {
      stopHeartbeat()
    }
  }

  private async processProviderCancellation(task: GenerationTask): Promise<boolean> {
    const outcome = await this.providerPoller.requestRemoteCancellation(task)
    await this.runLocalTaskMutation(
      task.id,
      async () => {
        await this.providerPoller.applyRemoteCancellation(task, outcome)
        await this.refundService.refundTerminalTasks()
      },
      true,
    )
    return true
  }

  private scheduleClaimedTasks(tasks: ClaimedRemoteTasks): void {
    this.scheduleRemoteExecutions(tasks.video, (task) => this.videoExecutor.execute(task))
    this.scheduleRemoteExecutions(tasks.image, (task) => this.imageExecutor.execute(task))
    this.scheduleRemoteExecutions(
      tasks.local.filter((task) => this.localTaskHandler?.canHandle(task)),
      (task) => this.executeLocalTask(task),
      false,
    )
  }

  private scheduleRemoteExecutions(
    tasks: GenerationTask[],
    execute: (task: GenerationTask) => Promise<void>,
    withHeartbeat = true,
  ): void {
    for (const task of tasks) {
      if (this.activeExecutions.has(task.id)) continue
      this.activeExecutions.add(task.id)
      usageCollector.startJob({
        jobId: task.id,
        source: 'generation_task',
        kind: task.kind,
        tenantId: task.tenantId,
        organizationId: task.tenantId,
        userId: task.userId,
        traceId: traceIdFromGenerationTask(task),
      })
      const execution = withHeartbeat ? this.executeRemoteTask(task, execute) : execute(task)
      void execution.then(
        () => this.finishScheduledExecution(task),
        (error) => {
          this.warnTaskRunnerFailure('execution', task.id, error)
          this.finishScheduledExecution(task)
        },
      )
    }
  }

  private finishScheduledExecution(task: GenerationTask): void {
    try {
      const stored = this.store.read((state) => state.tasks.find((item) => item.id === task.id) ?? task)
      const status = usageStatusForTask(stored)
      usageCollector.finishJob({
        jobId: task.id,
        source: 'generation_task',
        kind: task.kind,
        status,
        creditsUsed: status === 'completed' ? stored.estimatedCredits : 0,
        recordUsage: false,
        tenantId: stored.tenantId,
        organizationId: stored.tenantId,
        userId: stored.userId,
        traceId: traceIdFromGenerationTask(stored),
      })
    } catch (error) {
      this.warnTaskRunnerFailure('execution cleanup', task.id, error)
    } finally {
      this.activeExecutions.delete(task.id)
    }
  }

  private async executeRemoteTask(
    task: GenerationTask,
    execute: (task: GenerationTask) => Promise<void>,
  ): Promise<void> {
    const leaseToken = task.leaseToken
    if (!leaseToken) return
    const stopHeartbeat = this.startTaskHeartbeat(task.id, leaseToken)
    try {
      await execute(task)
    } finally {
      stopHeartbeat()
      try {
        await this.runTaskMutation(async () => {}, false)
      } catch (error) {
        this.warnTaskRunnerFailure('final state refresh', task.id, error)
      }
    }
  }

  private async executeLocalTask(task: GenerationTask): Promise<void> {
    const leaseToken = task.leaseToken
    const handler = this.localTaskHandler
    if (!leaseToken || !handler) return
    const stopHeartbeat = this.startTaskHeartbeat(task.id, leaseToken)
    const executionStartedAtMs = Date.now()
    let firstPreviewAtMs: number | null = null
    const textTimings: TextGenerationTiming[] = []
    let latestPreview = ''
    let latestPreviewStage = 'first-draft'
    let persistedPreview = ''
    let persistedPreviewStage = ''
    let previewTimer: NodeJS.Timeout | null = null
    let previewWrite = Promise.resolve()
    const flushPreview = (): Promise<void> => {
      const preview = latestPreview
      const stage = latestPreviewStage
      if (!preview || (preview === persistedPreview && stage === persistedPreviewStage)) return previewWrite
      previewWrite = previewWrite
        .catch(() => {})
        .then(() =>
          this.runLocalTaskMutation(
            task.id,
            () => this.writeback.updateLocalTextPreview(task.id, leaseToken, preview, stage),
            false,
          ),
        )
        .then(() => {
          persistedPreview = preview
          persistedPreviewStage = stage
        })
      return previewWrite
    }
    const schedulePreview = (text: string, stage = 'first-draft') => {
      const preview = text.trimStart().slice(0, 24_000)
      if (!preview || (preview === latestPreview && stage === latestPreviewStage)) return
      firstPreviewAtMs ??= Date.now()
      latestPreview = preview
      latestPreviewStage = stage
      if (previewTimer) return
      previewTimer = setTimeout(() => {
        previewTimer = null
        void flushPreview().catch((error) => this.warnTaskRunnerFailure('text preview', task.id, error))
      }, 800)
      previewTimer.unref?.()
    }
    try {
      const result = await handler.execute(
        task,
        task.kind === 'text'
          ? {
              onTextProgress: schedulePreview,
              onTextTiming: (timing) => textTimings.push(timing),
            }
          : undefined,
      )
      if (previewTimer) {
        clearTimeout(previewTimer)
        previewTimer = null
      }
      await flushPreview()
      await this.runLocalTaskMutation(
        task.id,
        () =>
          this.writeback.completeLocalTask(task.id, leaseToken, result, {
            executionStartedAtMs,
            firstPreviewAtMs,
            textTimings,
          }),
        true,
      )
    } catch (error) {
      if (previewTimer) {
        clearTimeout(previewTimer)
        previewTimer = null
      }
      await flushPreview().catch(() => {})
      await this.runLocalTaskMutation(
        task.id,
        () =>
          this.writeback.failTask(task.id, localTaskError(error), leaseToken, {
            executionStartedAtMs,
            firstPreviewAtMs,
            textTimings,
          }),
        true,
      )
    } finally {
      if (previewTimer) clearTimeout(previewTimer)
      stopHeartbeat()
    }
  }

  private startTaskHeartbeat(taskId: string, leaseToken: string): () => void {
    let heartbeatRunning = false
    const heartbeat = async () => {
      if (heartbeatRunning) return
      heartbeatRunning = true
      try {
        await this.runLocalTaskMutation(
          taskId,
          () => this.writeback.renewLocalTaskLease(taskId, leaseToken),
          true,
        )
      } catch (error) {
        this.warnTaskRunnerFailure('lease heartbeat', taskId, error)
      } finally {
        heartbeatRunning = false
      }
    }
    const timer = setInterval(() => void heartbeat(), Math.max(1_000, Math.floor(this.leaseTtlMs / 3)))
    timer.unref?.()
    return () => clearInterval(timer)
  }

  private async runTaskMutation(operation: () => Promise<void>, refreshFirst = true): Promise<void> {
    const deadline = Date.now() + this.taskMutationLockTimeoutMs
    do {
      const acquired = await this.taskRunnerLock.runExclusive(async () => {
        if (refreshFirst) await this.beforeTick?.()
        await operation()
        await this.afterTick?.()
      })
      if (acquired) return
      const remainingMs = deadline - Date.now()
      if (remainingMs > 0) await delay(Math.min(100, remainingMs))
    } while (Date.now() < deadline)
    throw new Error('Timed out while persisting local generation task state')
  }

  private async runLocalTaskMutation<T>(
    taskId: string,
    operation: () => Promise<T>,
    refreshFirst: boolean,
  ): Promise<T> {
    const deadline = Date.now() + this.taskMutationLockTimeoutMs
    do {
      let result: T | undefined
      const acquired = await this.taskRunnerLock.runExclusive(async () => {
        if (refreshFirst) {
          if (this.refreshTask) await this.refreshTask(taskId)
          else await this.beforeTick?.()
        }
        result = await operation()
        if (this.persistTask) await this.persistTask(taskId)
        else await this.afterTick?.()
      })
      if (acquired) return result as T
      const remainingMs = deadline - Date.now()
      if (remainingMs > 0) await delay(Math.min(100, remainingMs))
    } while (Date.now() < deadline)
    throw new Error('Timed out while persisting local generation task state')
  }

  private warnTaskRunnerFailure(operation: string, taskId: string, error: unknown): void {
    process.emitWarning(`Generation task ${operation} failed for ${taskId}: ${localTaskError(error)}`, {
      code: 'SEQORA_GENERATION_TASK_BACKGROUND_FAILURE',
    })
  }
}

function localTaskError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function usageStatusForTask(task: GenerationTask): 'completed' | 'failed' | 'cancelled' | 'unknown' {
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    return task.status
  }
  return 'unknown'
}
