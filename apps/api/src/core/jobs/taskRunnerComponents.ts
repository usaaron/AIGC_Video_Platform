import type { GenerationTask } from '@seqora/contracts'
import {
  compileQualityRules,
  compileStoryboardVideoPrompt,
  normalizedVideoDuration,
  QUALITY_RULE_VERSION,
  VIDEO_PROMPT_VERSION,
} from '@seqora/prompting'
import type {
  ImageGenerationOutput,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageReference,
} from '../generation/imageProvider.js'
import type { TextGenerationTiming } from '../generation/textProvider.js'
import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationStatus,
  VideoGenerationSubmission,
  VideoProviderName,
} from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { AppState, AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../../modules/billing/creditLedger.js'
import type { MediaRepository } from '../../modules/media/repository.js'
import { observabilityMetrics, observeProviderCall } from '../observability/metrics.js'
import { traceIdFromGenerationTask } from '../observability/trace.js'
import { usageCollector } from '../observability/usage.js'
import {
  DEFAULT_TASK_MAX_ATTEMPTS,
  claimGenerationTaskLease,
  generationTaskLeaseActive,
  generationTaskLeaseMatches,
  releaseGenerationTaskLease,
  renewGenerationTaskLease,
} from './taskLease.js'
import { cancellationResourceLockForTask, taskResourceLockId } from './taskResourceLock.js'
import {
  GenerationResultWriteback,
  generatedDescriptors,
  type GeneratedOutputDescriptor,
} from './taskWriteback.js'

export type ClaimedRemoteTasks = {
  video: GenerationTask[]
  image: GenerationTask[]
  local: GenerationTask[]
}

export type LocalTaskDiagnostics = {
  executionStartedAtMs: number
  firstPreviewAtMs: number | null
  textTimings: TextGenerationTiming[]
}

export type ProviderVideoPollOutcome =
  | {
      kind: 'status'
      status: VideoGenerationStatus
      videoDescriptor: GeneratedOutputDescriptor | null
      videoCacheError: string | null
      lastFrameDescriptor: GeneratedOutputDescriptor | null
      lastFrameError: string | null
    }
  | { kind: 'error'; error: string }

export type ProviderCancellationOutcome = { kind: 'cancelled' } | { kind: 'error'; error: string }

export type AppliedVideoPollOutcome = {
  completedTask: GenerationTask | null
  stalledProviderTaskId: string | null
}

export class DependencyResolver {
  state(task: GenerationTask, userTasks: GenerationTask[]): 'ready' | 'waiting' | 'failed' {
    const dependencyIds = Array.isArray(task.metadata.dependsOnTaskIds)
      ? task.metadata.dependsOnTaskIds.filter((value): value is string => typeof value === 'string')
      : typeof task.metadata.dependsOnTaskId === 'string'
        ? [task.metadata.dependsOnTaskId]
        : []
    if (!dependencyIds.length) return 'ready'

    let waiting = false
    for (const dependencyId of dependencyIds) {
      const dependency = userTasks.find(
        (item) =>
          item.id === dependencyId && item.projectId === task.projectId && item.tenantId === task.tenantId,
      )
      if (
        !dependency ||
        dependency.status === 'failed' ||
        dependency.status === 'cancelled' ||
        typeof dependency.metadata.queueHiddenAt === 'string'
      ) {
        return 'failed'
      }
      if (this.continuityDependencyMissingFrame(task, userTasks)) return 'failed'
      if (dependency.status !== 'completed') waiting = true
    }
    return waiting ? 'waiting' : 'ready'
  }

  continuityDependencyMissingFrame(task: GenerationTask, userTasks: GenerationTask[]): boolean {
    const sourceTaskId = task.metadata.continuitySourceTaskId
    if (typeof sourceTaskId !== 'string') return false
    const source = userTasks.find(
      (item) =>
        item.id === sourceTaskId && item.projectId === task.projectId && item.tenantId === task.tenantId,
    )
    return Boolean(
      source?.status === 'completed' &&
      !generatedDescriptors(source).some((item) => item.view === 'last-frame'),
    )
  }
}

export class TaskClaimer {
  constructor(
    private readonly store: AppStore,
    private readonly dependencyResolver: DependencyResolver,
    private readonly options: {
      leaseOwnerId: string
      leaseTtlMs: number
      videoProviderName: VideoProviderName
      hasVideoProvider: boolean
      hasImageProvider: boolean
      hasObjectStorage: boolean
    },
  ) {}

  async recoverStaleRunningTasks(): Promise<ClaimedRemoteTasks> {
    return this.store.mutate((state) => {
      const now = new Date()
      const nowIso = now.toISOString()
      const video: GenerationTask[] = []
      const image: GenerationTask[] = []
      const local: GenerationTask[] = []
      state.tasks
        .filter((task) => task.status === 'running' && task.provider !== 'local-compose')
        .forEach((task) => {
          const providerName = this.remoteProviderName(task)
          if (!this.ownsTask(task, providerName)) return
          if (generationTaskLeaseActive(task, now.getTime())) return
          if (recoverScriptTaskFromDraft(task, state, nowIso)) return
          if (providerName && !task.metadata.providerTaskId) {
            claimGenerationTaskLease(task, this.options.leaseOwnerId, this.options.leaseTtlMs, now, {
              countAttempt: false,
            })
            task.progress = Math.max(1, task.progress)
            task.error = null
            task.metadata = {
              ...task.metadata,
              providerName,
              providerState: 'submitting',
              providerIdempotencyKey: providerIdempotencyKeyFor(task),
              providerSubmissionRecoveredAt: nowIso,
            }
            task.updatedAt = nowIso
            if (this.isRemoteVideoTask(task)) video.push(task)
            if (this.isRemoteImageTask(task)) image.push(task)
            return
          }
          claimGenerationTaskLease(task, this.options.leaseOwnerId, this.options.leaseTtlMs, now, {
            countAttempt: false,
          })
          task.updatedAt = nowIso
          if (!providerName) local.push(task)
        })
      return { video, image, local }
    })
  }

  async claimQueuedTasks(): Promise<ClaimedRemoteTasks> {
    return this.store.mutate((state) => {
      const now = new Date()
      const nowIso = now.toISOString()
      const selectedVideoTasks: GenerationTask[] = []
      const selectedImageTasks: GenerationTask[] = []
      const selectedLocalTasks: GenerationTask[] = []

      // Older clients could enqueue a second script task while the first one was
      // still running. Finish those stale queue entries before they consume a
      // text slot and later collide with the first task's episode draft.
      const activeScriptTasks = state.tasks
        .filter((task) => isActiveScriptTask(task))
        .sort((left, right) => taskCreatedAt(left) - taskCreatedAt(right) || left.id.localeCompare(right.id))
      const firstScriptTaskByProject = new Map<string, GenerationTask>()
      for (const task of activeScriptTasks) {
        const key = `${task.tenantId}:${task.projectId}`
        const first = firstScriptTaskByProject.get(key)
        if (!first) {
          firstScriptTaskByProject.set(key, task)
          continue
        }
        if (task.status !== 'queued') continue
        task.status = 'failed'
        task.progress = 100
        task.error = '同一项目已有剧本任务正在执行，本次重复任务已停止；请等待前一个任务完成后再提交'
        task.updatedAt = nowIso
        releaseGenerationTaskLease(task)
        recordGenerationTaskTerminal(task, new Error(task.error))
      }

      for (const task of state.tasks) {
        if (task.status !== 'queued' || !isNextEpisodeScriptTask(task)) continue
        const hasDraft = state.scriptEpisodes.some(
          (episode) =>
            episode.projectId === task.projectId &&
            episode.tenantId === task.tenantId &&
            episode.status === 'draft' &&
            episode.draftContent.trim().length > 0,
        )
        if (!hasDraft) continue
        task.status = 'failed'
        task.progress = 100
        task.error = '当前项目已有未保存的剧集草稿，请先保存本集后再继续生成'
        task.updatedAt = nowIso
        releaseGenerationTaskLease(task)
        recordGenerationTaskTerminal(task, new Error(task.error))
      }

      for (const user of state.users) {
        const userTasks = state.tasks.filter((task) => task.userId === user.id)
        userTasks
          .filter(
            (task) => task.status === 'queued' && this.dependencyResolver.state(task, userTasks) === 'failed',
          )
          .forEach((task) => {
            task.status = 'failed'
            task.progress = 100
            task.error = this.dependencyResolver.continuityDependencyMissingFrame(task, userTasks)
              ? '上一镜已完成但没有可用尾帧，请重新生成上一镜后再继续'
              : '依赖的上一镜任务失败、已删除或不存在，请从该镜头重新生成'
            task.updatedAt = nowIso
            releaseGenerationTaskLease(task)
            recordGenerationTaskTerminal(task, new Error(task.error))
          })

        const runningTasks = userTasks.filter(
          (task) => task.status === 'running' && task.provider !== 'local-compose',
        )
        let availableTextSlots = Math.max(0, 1 - runningTasks.filter((task) => task.kind === 'text').length)
        let availableMediaSlots = Math.max(
          0,
          (user.plan === 'member' ? 3 : 1) - runningTasks.filter((task) => task.kind !== 'text').length,
        )
        const queuedTasks = userTasks
          .filter((task) => task.status === 'queued' && task.provider !== 'local-compose')
          .sort((left, right) => {
            const kindPriority = Number(left.kind !== 'text') - Number(right.kind !== 'text')
            if (kindPriority !== 0) return kindPriority
            return Date.parse(left.createdAt) - Date.parse(right.createdAt)
          })
        for (const task of queuedTasks) {
          const usesTextSlot = task.kind === 'text'
          if (usesTextSlot ? availableTextSlots <= 0 : availableMediaSlots <= 0) continue
          if (task.status !== 'queued') continue
          const retryNotBefore = Date.parse(stringValue(task.metadata.providerRetryNotBefore, ''))
          if (Number.isFinite(retryNotBefore) && retryNotBefore > now.getTime()) continue
          if (this.dependencyResolver.state(task, userTasks) !== 'ready') continue
          const providerName = this.remoteProviderName(task)
          if (!this.ownsTask(task, providerName)) continue
          if ((task.attempts ?? 0) >= (task.maxAttempts ?? DEFAULT_TASK_MAX_ATTEMPTS)) {
            task.status = 'failed'
            task.progress = 100
            task.error = 'Task exceeded maximum attempts; create a new task or retry from details'
            task.updatedAt = nowIso
            releaseGenerationTaskLease(task)
            recordGenerationTaskTerminal(task, new Error(task.error))
            continue
          }
          claimGenerationTaskLease(task, this.options.leaseOwnerId, this.options.leaseTtlMs, now)
          task.progress = providerName ? 1 : 8
          task.updatedAt = nowIso
          recordGenerationTaskQueueWait(task, now.getTime())
          if (providerName) {
            task.metadata = {
              ...task.metadata,
              providerName,
              providerState: 'submitting',
              providerIdempotencyKey: providerIdempotencyKeyFor(task),
            }
            if (this.isRemoteVideoTask(task)) selectedVideoTasks.push(task)
            if (this.isRemoteImageTask(task)) selectedImageTasks.push(task)
          } else {
            task.metadata = {
              ...task.metadata,
              localTaskStartedAt: nowIso,
              localTaskQueueWaitMs: durationSince(task.createdAt, now.getTime()),
            }
            selectedLocalTasks.push(task)
          }
          if (usesTextSlot) availableTextSlots -= 1
          else availableMediaSlots -= 1
        }
      }

      return { video: selectedVideoTasks, image: selectedImageTasks, local: selectedLocalTasks }
    })
  }

  private ownsTask(task: GenerationTask, providerName: string | null): boolean {
    if (task.provider === 'local-compose') return false
    const existingProviderName = stringValue(task.metadata.providerName, '')
    if (!providerName) return existingProviderName.length === 0
    return existingProviderName.length === 0 || existingProviderName === providerName
  }

  private remoteProviderName(task: GenerationTask): string | null {
    if (this.options.hasVideoProvider && task.kind === 'video' && task.provider === 'seedance') {
      return this.options.videoProviderName
    }
    if (
      this.options.hasImageProvider &&
      this.options.hasObjectStorage &&
      task.kind === 'image' &&
      task.provider === 'img2'
    ) {
      return 'tokenadvent-img2'
    }
    return null
  }

  private isRemoteVideoTask(task: GenerationTask): boolean {
    return this.options.hasVideoProvider && task.kind === 'video' && task.provider === 'seedance'
  }

  private isRemoteImageTask(task: GenerationTask): boolean {
    return (
      this.options.hasImageProvider &&
      this.options.hasObjectStorage &&
      task.kind === 'image' &&
      task.provider === 'img2'
    )
  }
}

export class TaskRefundService {
  constructor(
    private readonly store: AppStore,
    private readonly creditLedger: CreditLedger | null = null,
  ) {}

  async refundTerminalTasks(): Promise<void> {
    const candidates = this.store.read((state) =>
      state.tasks.filter((task) => canPotentiallyRefundTask(task)),
    )
    if (!candidates.length) return
    const creditLedger = this.creditLedger
    if (creditLedger) {
      const handledTaskIds: string[] = []
      for (const task of candidates) {
        // The Postgres ledger owns the refund transaction. Do not hold the AppStore
        // write lock while waiting on one database operation per historical task.
        await creditLedger.refundGeneration(task, refundDescription(task))
        handledTaskIds.push(task.id)
      }
      if (!handledTaskIds.length) return
      await this.store.mutate((state) => {
        const handled = new Set(handledTaskIds)
        const now = new Date().toISOString()
        for (const task of state.tasks) {
          if (!handled.has(task.id)) continue
          task.metadata = {
            ...task.metadata,
            creditsRefundedAt:
              typeof task.metadata.creditsRefundedAt === 'string' ? task.metadata.creditsRefundedAt : now,
          }
        }
      })
      return
    }

    await this.store.mutate((state) => {
      for (const task of state.tasks) {
        if (!canPotentiallyRefundTask(task)) continue
        const ledgerIds = state.ledger.map((entry) => entry.id)
        if (!canRefundTask(task, ledgerIds)) continue
        const refundId = `refund-${task.id}`
        const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
        if (!user) continue
        const now = new Date().toISOString()
        user.credits += task.estimatedCredits
        state.ledger.unshift({
          id: refundId,
          userId: user.id,
          tenantId: user.tenantId,
          amount: task.estimatedCredits,
          balance: user.credits,
          type: 'adjustment',
          description: refundDescription(task),
          createdAt: now,
        })
        task.metadata = { ...task.metadata, creditsRefundedAt: now }
        observabilityMetrics.recordRefund({ tenantId: task.tenantId, amount: task.estimatedCredits })
      }
    })
  }
}

export class TaskWritebackService {
  private readonly resultWriteback: GenerationResultWriteback

  constructor(
    private readonly store: AppStore,
    objectStorage: ObjectStorage | null,
    private readonly leaseOwnerId: string,
    private readonly leaseTtlMs: number,
    private readonly refundService: TaskRefundService,
  ) {
    this.resultWriteback = new GenerationResultWriteback(store, objectStorage)
  }

  async runWithHeartbeat(
    task: GenerationTask,
    execute: (task: GenerationTask) => Promise<void>,
  ): Promise<void> {
    const leaseToken = stringValue(task.leaseToken, '')
    if (!leaseToken) return
    const stopHeartbeat = this.startLeaseHeartbeat(task.id, leaseToken)
    try {
      await execute(task)
    } finally {
      stopHeartbeat()
    }
  }

  async advanceLocalTasks(shouldSkip: (task: GenerationTask) => boolean = () => false): Promise<void> {
    await this.store.mutate(async (state) => {
      const now = new Date().toISOString()
      state.tasks
        .filter(
          (task) =>
            task.status === 'running' &&
            task.provider !== 'local-compose' &&
            !isRemoteProviderName(task.metadata.providerName) &&
            task.leaseOwnerId === this.leaseOwnerId &&
            !shouldSkip(task),
        )
        .forEach((task) => {
          task.progress = Math.min(100, task.progress + 12)
          if (task.leaseToken && generationTaskLeaseMatches(task, this.leaseOwnerId, task.leaseToken)) {
            renewGenerationTaskLease(task, this.leaseOwnerId, task.leaseToken, this.leaseTtlMs, new Date(now))
          }
          task.updatedAt = now
          if (task.progress >= 100) {
            task.status = 'completed'
            task.outputs = outputsFor(task)
            task.resultUrl = task.outputs[0]?.url ?? null
            releaseGenerationTaskLease(task)
            recordGenerationTaskTerminal(task)
          }
        })
    })
  }

  async completeLocalTask(
    taskId: string,
    leaseToken: string,
    result: unknown,
    diagnostics?: LocalTaskDiagnostics,
  ): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.status !== 'running') return
      if (!generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return
      const nowMs = Date.now()
      const now = new Date(nowMs).toISOString()
      const {
        textPreview: _textPreview,
        textPreviewUpdatedAt: _textPreviewUpdatedAt,
        textFirstPreviewAt: _textFirstPreviewAt,
        textPreviewValidation: _textPreviewValidation,
        textPreviewStage: _textPreviewStage,
        ...metadata
      } = task.metadata
      task.status = 'completed'
      task.progress = 100
      task.error = null
      task.metadata = {
        ...metadata,
        localTaskCompletedAt: now,
        ...(diagnostics ? { textTiming: summarizeTextTiming(task, diagnostics, nowMs) } : {}),
        ...(task.kind === 'text' ? { textResult: result } : {}),
      }
      task.updatedAt = now
      releaseGenerationTaskLease(task)
      recordGenerationTaskTerminal(task)
    })
  }

  async updateLocalTextPreview(
    taskId: string,
    leaseToken: string,
    preview: string,
    stage = 'first-draft',
  ): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.kind !== 'text' || task.status !== 'running') return
      if (!generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return
      const now = new Date().toISOString()
      const boundedPreview = preview.slice(0, 24_000)
      task.progress = Math.max(task.progress, Math.min(88, 12 + Math.floor(boundedPreview.length / 40)))
      task.metadata = {
        ...task.metadata,
        textPreview: boundedPreview,
        textPreviewStage: stage,
        textPreviewUpdatedAt: now,
        textPreviewValidation: progressiveTextValidation(boundedPreview),
        textFirstPreviewAt:
          typeof task.metadata.textFirstPreviewAt === 'string' ? task.metadata.textFirstPreviewAt : now,
      }
      task.updatedAt = now
    })
  }

  async renewLocalTaskLease(taskId: string, leaseToken: string): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.status !== 'running') return
      if (!generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return
      const now = new Date()
      renewGenerationTaskLease(task, this.leaseOwnerId, leaseToken, this.leaseTtlMs, now)
      task.updatedAt = now.toISOString()
    })
  }

  async failTask(
    taskId: string,
    error: string,
    leaseToken?: string,
    diagnostics?: LocalTaskDiagnostics,
  ): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return
      if (leaseToken && !generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return
      const now = new Date().toISOString()
      task.status = 'failed'
      task.progress = 100
      task.error = error.slice(0, 1_000)
      if (diagnostics) {
        task.metadata = {
          ...task.metadata,
          textTiming: summarizeTextTiming(task, diagnostics, Date.now()),
        }
      }
      if (isRemoteProviderName(task.metadata.providerName)) {
        task.metadata = {
          ...task.metadata,
          providerState: 'failed',
          providerError: task.error,
          providerFailedAt: now,
        }
      }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      recordGenerationTaskTerminal(task, new Error(task.error))
    })
    await this.refundService.refundTerminalTasks()
  }

  async retryTimedOutVideoSubmission(taskId: string, leaseToken: string, error: string): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.status !== 'running') return
      if (!generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return
      const now = new Date()
      task.status = 'queued'
      task.progress = 0
      task.error = null
      task.metadata = {
        ...task.metadata,
        providerState: 'retry_wait',
        providerSubmissionError: error.slice(0, 1_000),
        providerSubmissionTimedOutAt: now.toISOString(),
        providerSubmissionRetries: Math.max(1, numberValue(task.attempts, 1)),
        providerRetryNotBefore: new Date(now.getTime() + 10_000).toISOString(),
      }
      releaseGenerationTaskLease(task)
      task.updatedAt = now.toISOString()
    })
  }

  async handleStalledVideoProcessing(
    taskId: string,
    leaseToken: string,
    providerTaskId: string,
  ): Promise<GenerationTask | null> {
    const result = await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.status !== 'running') return null
      if (!generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return null

      const now = new Date()
      const nowIso = now.toISOString()
      const timeoutRetries = numberValue(task.metadata.providerProcessingTimeoutRetries, 0)
      const canRetry =
        timeoutRetries < 1 && (task.attempts ?? 0) < (task.maxAttempts ?? DEFAULT_TASK_MAX_ATTEMPTS)
      const previousTaskIds = Array.isArray(task.metadata.providerPreviousTaskIds)
        ? task.metadata.providerPreviousTaskIds.filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
          )
        : []
      const {
        providerTaskId: _providerTaskId,
        providerSubmittedAt: _providerSubmittedAt,
        providerPolledAt: _providerPolledAt,
        providerProgressChangedAt: _providerProgressChangedAt,
        providerRetryNotBefore: _providerRetryNotBefore,
        ...metadata
      } = task.metadata

      if (canRetry) {
        const nextRetry = timeoutRetries + 1
        task.status = 'queued'
        task.progress = 0
        task.error = null
        task.metadata = {
          ...metadata,
          providerState: 'retry_wait',
          providerProcessingTimeoutRetries: nextRetry,
          providerProcessingTimedOutAt: nowIso,
          providerPreviousTaskIds: [...new Set([...previousTaskIds, providerTaskId])],
          providerRetryNotBefore: new Date(now.getTime() + 2_000).toISOString(),
          providerIdempotencyKey: `generation:${task.tenantId}:${task.id}:processing-retry:${nextRetry}`,
        }
      } else {
        task.status = 'failed'
        task.progress = 100
        task.error = '上游视频生成长时间无进度，自动重试后仍未恢复；本次任务已停止并退回积分'
        task.metadata = {
          ...metadata,
          providerState: 'failed',
          providerProcessingTimedOutAt: nowIso,
          providerPreviousTaskIds: [...new Set([...previousTaskIds, providerTaskId])],
          providerError: task.error,
          providerFailedAt: nowIso,
        }
      }
      releaseGenerationTaskLease(task)
      task.updatedAt = nowIso
      return task
    })

    if (result?.status === 'failed') {
      recordGenerationTaskTerminal(result, new Error(result.error ?? 'Video processing stalled'))
      await this.refundService.refundTerminalTasks()
    }
    return result
  }

  async writeVideoSubmission(
    task: GenerationTask,
    leaseToken: string,
    submission: VideoGenerationSubmission,
  ): Promise<void> {
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (!stored || stored.status !== 'running') return
      if (!generationTaskLeaseMatches(stored, this.leaseOwnerId, leaseToken)) return
      const now = new Date()
      stored.progress = Math.max(1, submission.progress)
      stored.metadata = {
        ...stored.metadata,
        providerState: submission.status,
        providerTaskId: submission.providerTaskId,
        providerSubmittedAt:
          typeof stored.metadata.providerSubmittedAt === 'string'
            ? stored.metadata.providerSubmittedAt
            : now.toISOString(),
        providerProgressChangedAt: now.toISOString(),
        providerPolledAt: Date.now(),
        providerPollErrors: 0,
      }
      renewGenerationTaskLease(stored, this.leaseOwnerId, leaseToken, this.leaseTtlMs, now)
      stored.updatedAt = now.toISOString()
    })
  }

  async persistImageOutputs(
    task: GenerationTask,
    outputs: ImageGenerationOutput[],
  ): Promise<GeneratedOutputDescriptor[]> {
    return this.resultWriteback.persistImageOutputs(task, outputs)
  }

  async completeImageTask(
    taskId: string,
    leaseToken: string,
    descriptors: GeneratedOutputDescriptor[],
  ): Promise<void> {
    const task = await this.resultWriteback.completeImageTask(
      taskId,
      this.leaseOwnerId,
      leaseToken,
      descriptors,
    )
    if (task) recordGenerationTaskTerminal(task)
  }

  async persistVideoLastFrame(
    task: GenerationTask,
    providerTaskId: string,
    videoProvider: VideoGenerationProvider,
  ): Promise<GeneratedOutputDescriptor> {
    return this.resultWriteback.persistVideoLastFrame(task, providerTaskId, videoProvider)
  }

  async persistVideoContent(
    task: GenerationTask,
    providerTaskId: string,
    videoProvider: VideoGenerationProvider,
  ): Promise<GeneratedOutputDescriptor> {
    return this.resultWriteback.persistVideoContent(task, providerTaskId, videoProvider)
  }

  async writeVideoPollResult(input: {
    taskId: string
    leaseToken: string
    status: VideoGenerationStatus
    videoDescriptor?: GeneratedOutputDescriptor | null
    videoCacheError?: string | null
    lastFrameDescriptor?: GeneratedOutputDescriptor | null
    lastFrameError?: string | null
  }): Promise<GenerationTask | null> {
    const task = await this.resultWriteback.writeVideoPollResult({
      ...input,
      leaseOwnerId: this.leaseOwnerId,
      leaseTtlMs: this.leaseTtlMs,
    })
    if (task && task.status !== 'running') {
      recordGenerationTaskTerminal(task, task.error ? new Error(task.error) : undefined)
    }
    return task
  }

  async markProviderPollError(taskId: string, leaseToken: string, attempts: number): Promise<void> {
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === taskId)
      if (!stored || !generationTaskLeaseMatches(stored, this.leaseOwnerId, leaseToken)) return
      stored.metadata = { ...stored.metadata, providerPollErrors: attempts }
      renewGenerationTaskLease(stored, this.leaseOwnerId, leaseToken, this.leaseTtlMs)
    })
  }

  private startLeaseHeartbeat(taskId: string, leaseToken: string): () => void {
    const intervalMs = Math.max(1_000, Math.floor(this.leaseTtlMs / 3))
    const heartbeat = () => {
      void this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === taskId)
        if (!stored || stored.status !== 'running') return
        if (!generationTaskLeaseMatches(stored, this.leaseOwnerId, leaseToken)) return
        const now = new Date()
        renewGenerationTaskLease(stored, this.leaseOwnerId, leaseToken, this.leaseTtlMs, now)
        stored.updatedAt = now.toISOString()
      })
    }
    const timer = setInterval(heartbeat, intervalMs)
    timer.unref?.()
    return () => clearInterval(timer)
  }
}

export class VideoTaskExecutor {
  constructor(
    private readonly store: AppStore,
    private readonly options: {
      videoProvider: VideoGenerationProvider | null
      objectStorage: ObjectStorage | null
      leaseOwnerId: string
      leaseTtlMs: number
      writeback: TaskWritebackService
    },
  ) {}

  async execute(task: GenerationTask): Promise<void> {
    const leaseToken = stringValue(task.leaseToken, '')
    if (!leaseToken || !this.options.videoProvider) return
    try {
      const preparedTask = await this.prepareStoryboardVideoTask(task)
      const request = videoRequestFor(preparedTask, await this.resolveVideoImages(preparedTask))
      const submission = await observeProviderCall(
        {
          provider: stringValue(preparedTask.metadata.providerName, 'seedance'),
          operation: 'video.submit',
          tenantId: preparedTask.tenantId,
          organizationId: preparedTask.tenantId,
          userId: preparedTask.userId,
          taskId: preparedTask.id,
          traceId: traceIdFromGenerationTask(preparedTask),
        },
        () => this.options.videoProvider!.submit(request),
      )
      await this.options.writeback.writeVideoSubmission(task, leaseToken, submission)
    } catch (error) {
      const attempts = task.attempts ?? 0
      const maxAttempts = task.maxAttempts ?? DEFAULT_TASK_MAX_ATTEMPTS
      if (error instanceof Error && isTimeoutError(error) && attempts < maxAttempts) {
        await this.options.writeback.retryTimedOutVideoSubmission(task.id, leaseToken, messageFor(error))
        return
      }
      await this.options.writeback.failTask(task.id, messageFor(error), leaseToken)
    }
  }

  private prepareStoryboardVideoTask(task: GenerationTask): Promise<GenerationTask> {
    return this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (!stored) return task
      const leaseToken = stringValue(task.leaseToken, '')
      if (leaseToken && !generationTaskLeaseMatches(stored, this.options.leaseOwnerId, leaseToken)) {
        return task
      }
      const shotId = typeof stored.metadata.shotId === 'string' ? stored.metadata.shotId : null
      const project = state.projects.find(
        (item) => item.id === stored.projectId && item.tenantId === stored.tenantId,
      )
      const shot = state.shots.find(
        (item) =>
          item.id === shotId && item.projectId === stored.projectId && item.tenantId === stored.tenantId,
      )
      if (!project || !shot) return stored

      const assets = state.assets.filter(
        (asset) => asset.projectId === stored.projectId && asset.tenantId === stored.tenantId,
      )
      const shots = state.shots
        .filter((item) => item.projectId === stored.projectId && item.tenantId === stored.tenantId)
        .sort((left, right) => left.order - right.order)
      const referenceAssetIds = Array.isArray(stored.metadata.referenceAssetIds)
        ? stored.metadata.referenceAssetIds.filter((id): id is string => typeof id === 'string')
        : []
      const referenceAssets = referenceAssetIds
        .map((id) => assets.find((asset) => asset.id === id))
        .filter((asset): asset is (typeof assets)[number] => Boolean(asset))
      const blockedPortraits = referenceAssets.filter((asset) => {
        if (asset.attributes.type !== 'character' || asset.attributes.subjectType !== 'human') return false
        const needsTrustedPortrait =
          asset.attributes.portraitSource === 'authorized-real' ||
          asset.attributes.visualStyle === 'photorealistic'
        return needsTrustedPortrait && asset.attributes.trustedPortrait?.status !== 'active'
      })
      if (blockedPortraits.length) {
        throw new Error(
          `以下仿真人物尚未完成方舟资源入库或真人授权：${blockedPortraits.map((asset) => asset.name).join('、')}`,
        )
      }
      const trustedAliases = new Map<string, string>()
      for (const asset of referenceAssets) {
        if (asset.attributes.type !== 'character') continue
        const portrait = asset.attributes.trustedPortrait
        if (portrait?.status !== 'active') continue
        const uri = `asset://${portrait.assetId}`
        for (const value of [
          asset.imageUrl,
          asset.attributes.faceReference?.url,
          asset.attributes.bodyReference?.url,
        ]) {
          if (value) trustedAliases.set(value, uri)
        }
      }
      const sourcePromptSnapshot = stringValue(stored.metadata.sourcePromptSnapshot, shot.prompt)
      const hasCurrentTaskPromptSnapshot =
        typeof stored.metadata.sourcePromptHash === 'string' &&
        typeof stored.metadata.compiledPrompt === 'string' &&
        stored.metadata.videoPromptVersion === VIDEO_PROMPT_VERSION
      const compiledPrompt = hasCurrentTaskPromptSnapshot
        ? stringValue(stored.metadata.compiledPrompt, stored.prompt)
        : compileStoryboardVideoPrompt({
            project: { ...project, visualStyle: project.visualStyle ?? 'cinematic-cg' },
            shot: { ...shot, prompt: sourcePromptSnapshot },
            shots,
            assets,
            references: referenceAssetIds.map((id) => ({ id })),
            continuityMode: stored.metadata.continuityMode === 'continue' ? 'continue' : 'independent',
          })
      const visualStyles = referenceAssets
        .map((asset) => ('visualStyle' in asset.attributes ? asset.attributes.visualStyle : null))
        .filter((style): style is NonNullable<typeof style> => typeof style === 'string')
      const scene = referenceAssets.find((asset) => asset.kind === 'scene')
      const userNegativePrompt = stringValue(stored.metadata.userNegativePrompt, stored.negativePrompt)
      const quality = compileQualityRules({
        mediaKind: 'video',
        assetKind: 'storyboard',
        contentType: project.contentType,
        visualStyles,
        emptyScene:
          scene?.attributes.type === 'scene' && scene.attributes.emptyScene
            ? !referenceAssets.some((asset) => asset.kind === 'character')
            : false,
        ...(scene?.attributes.type === 'scene' ? { weather: scene.attributes.weather } : {}),
        sourcePrompt: sourcePromptSnapshot,
        customNegativePrompt: userNegativePrompt,
      })

      stored.prompt = compiledPrompt
      stored.negativePrompt = quality.negativePrompt
      stored.metadata = {
        ...stored.metadata,
        providerIdempotencyKey: providerIdempotencyKeyFor(stored),
        ...(Array.isArray(stored.metadata.images)
          ? {
              images: stored.metadata.images.map((value) =>
                typeof value === 'string' ? (trustedAliases.get(value) ?? value) : value,
              ),
            }
          : {}),
        duration: normalizedVideoDuration(stored.metadata.duration ?? shot.duration),
        requestedDuration: stored.metadata.requestedDuration ?? shot.duration,
        compiledPrompt,
        videoPromptVersion: VIDEO_PROMPT_VERSION,
        qualityRuleVersion: QUALITY_RULE_VERSION,
        qualityPresetIds: quality.presetIds,
        compiledNegativePrompt: quality.negativePrompt,
        userNegativePrompt,
        sourceProjectVersion: project.version,
      }
      const now = new Date()
      if (leaseToken) {
        renewGenerationTaskLease(stored, this.options.leaseOwnerId, leaseToken, this.options.leaseTtlMs, now)
      }
      stored.updatedAt = now.toISOString()
      return stored
    })
  }

  private async resolveVideoImages(task: GenerationTask): Promise<VideoGenerationRequest['images']> {
    const images: VideoGenerationRequest['images'] = []
    const continuitySourceTaskId = stringValue(task.metadata.continuitySourceTaskId, '')
    const legacyStoryboardImageUrl = stringValue(task.metadata.storyboardImageUrl, '')
    if (continuitySourceTaskId) {
      if (!this.options.objectStorage) throw new Error('连续镜头需要对象存储读取上一镜头尾帧')
      const sourceTask = this.store.read(
        (state) =>
          state.tasks.find(
            (item) =>
              item.id === continuitySourceTaskId &&
              item.projectId === task.projectId &&
              item.tenantId === task.tenantId &&
              item.status === 'completed',
          ) ?? null,
      )
      const lastFrame = generatedDescriptors(sourceTask ?? undefined).find(
        (item) => item.view === 'last-frame',
      )
      if (!lastFrame) throw new Error('上一镜头没有可用尾帧，请重新生成上一镜头后再继续')
      const content = await this.options.objectStorage.get(lastFrame.storageKey)
      images.push({
        url: `data:${lastFrame.contentType};base64,${content.toString('base64')}`,
        role: 'first_frame',
      })
    }

    if (!Array.isArray(task.metadata.images)) return images
    for (const value of task.metadata.images.slice(0, Math.max(0, 9 - images.length))) {
      if (typeof value !== 'string') continue
      // Static storyboard frames are a legacy pre-video path. New videos rely on
      // asset references and the preceding real video tail frame instead.
      if (legacyStoryboardImageUrl && value === legacyStoryboardImageUrl) continue
      if (/^asset:\/\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
        images.push({ url: value, role: 'reference_image' })
        continue
      }
      if (/^https?:\/\//.test(value)) {
        images.push({ url: value, role: 'reference_image' })
        continue
      }
      if (!this.options.objectStorage) continue
      const stored = findStoredReference(this.store, task, value)
      if (!stored) continue
      const content = await this.options.objectStorage.get(stored.storageKey)
      images.push({
        url: `data:${stored.contentType};base64,${content.toString('base64')}`,
        role: 'reference_image',
      })
    }
    return images
  }
}

export class ImageTaskExecutor {
  constructor(
    private readonly store: AppStore,
    private readonly options: {
      imageProvider: ImageGenerationProvider | null
      mediaRepository: Pick<MediaRepository, 'findSourceById'> | null
      objectStorage: ObjectStorage | null
      leaseOwnerId: string
      leaseTtlMs: number
      writeback: TaskWritebackService
    },
  ) {}

  async execute(task: GenerationTask): Promise<void> {
    const leaseToken = stringValue(task.leaseToken, '')
    if (!leaseToken || !this.options.imageProvider) return
    try {
      const preparedTask = await this.prepareImageTask(task)
      const references = await this.resolveImageReferences(preparedTask)
      const request = imageRequestFor(preparedTask, references)
      const outputs = await observeProviderCall(
        {
          provider: stringValue(preparedTask.metadata.providerName, 'tokenadvent-img2'),
          operation: 'image.generate',
          tenantId: preparedTask.tenantId,
          organizationId: preparedTask.tenantId,
          userId: preparedTask.userId,
          taskId: preparedTask.id,
          traceId: traceIdFromGenerationTask(preparedTask),
        },
        () => this.options.imageProvider!.generate(request),
      )
      const descriptors = await this.options.writeback.persistImageOutputs(task, outputs)
      await this.options.writeback.completeImageTask(task.id, leaseToken, descriptors)
    } catch (error) {
      await this.options.writeback.failTask(task.id, messageFor(error), leaseToken)
    }
  }

  private prepareImageTask(task: GenerationTask): Promise<GenerationTask> {
    return this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (!stored) return task
      const leaseToken = stringValue(task.leaseToken, '')
      if (leaseToken && !generationTaskLeaseMatches(stored, this.options.leaseOwnerId, leaseToken)) {
        return task
      }
      const project = state.projects.find(
        (item) => item.id === stored.projectId && item.tenantId === stored.tenantId,
      )
      const attributes = objectValue(stored.metadata.attributes)
      const assetKind = imageAssetKind(stored)
      const userNegativePrompt = stringValue(stored.metadata.userNegativePrompt, stored.negativePrompt)
      const quality = compileQualityRules({
        mediaKind: 'image',
        assetKind,
        visualStyles: typeof attributes.visualStyle === 'string' ? [attributes.visualStyle] : [],
        emptyScene: attributes.emptyScene === true,
        sourcePrompt: stored.prompt,
        customNegativePrompt: userNegativePrompt,
        ...(project ? { contentType: project.contentType } : {}),
        ...(typeof attributes.weather === 'string' ? { weather: attributes.weather } : {}),
      })
      stored.negativePrompt = quality.negativePrompt
      stored.metadata = {
        ...stored.metadata,
        providerIdempotencyKey: providerIdempotencyKeyFor(stored),
        qualityRuleVersion: QUALITY_RULE_VERSION,
        qualityPresetIds: quality.presetIds,
        compiledNegativePrompt: quality.negativePrompt,
        userNegativePrompt,
        ...(stored.metadata.generationStage === 'image2-studio'
          ? {
              generationSnapshot: finalizeImage2GenerationSnapshot(
                stored,
                quality.negativePrompt,
                userNegativePrompt,
              ),
            }
          : {}),
      }
      const now = new Date()
      if (leaseToken) {
        renewGenerationTaskLease(stored, this.options.leaseOwnerId, leaseToken, this.options.leaseTtlMs, now)
      }
      stored.updatedAt = now.toISOString()
      return stored
    })
  }

  private async resolveImageReferences(task: GenerationTask): Promise<ImageReference[]> {
    if (!Array.isArray(task.metadata.references) || !task.metadata.references.length) return []
    if (!this.options.objectStorage) {
      throw new Error('参考图存储服务不可用，未向图片模型提交任务')
    }
    const references: ImageReference[] = []
    for (const raw of task.metadata.references.slice(0, 5)) {
      if (!raw || typeof raw !== 'object') {
        throw new Error('参考图信息格式无效，未向图片模型提交任务')
      }
      const reference = raw as {
        url?: unknown
        name?: unknown
        role?: unknown
        referenceNumber?: unknown
        visionDescription?: unknown
      }
      if (typeof reference.url !== 'string' || !reference.url) {
        throw new Error('参考图地址无效，未向图片模型提交任务')
      }
      const stored =
        findStoredReference(this.store, task, reference.url) ??
        (await this.findPersistedMediaReference(task, reference.url))
      if (!stored) {
        throw new Error('参考图读取失败，未向图片模型提交任务；请重新上传或选择有效参考图')
      }
      const content = await this.options.objectStorage.get(stored.storageKey)
      if (!content.length) {
        throw new Error('参考图内容为空，未向图片模型提交任务；请重新上传参考图')
      }
      const role = image2ReferenceRole(reference.role)
      const referenceNumber = positiveInteger(reference.referenceNumber) ?? references.length + 1
      references.push({
        name: typeof reference.name === 'string' ? reference.name : `reference-${references.length + 1}.png`,
        contentType: stored.contentType,
        content,
        ...(role ? { role } : {}),
        referenceNumber,
        ...(typeof reference.visionDescription === 'string' && reference.visionDescription.trim()
          ? { visionDescription: reference.visionDescription.trim() }
          : {}),
      })
    }
    return references
  }

  private async findPersistedMediaReference(
    task: GenerationTask,
    url: string,
  ): Promise<{ storageKey: string; contentType: string } | null> {
    const mediaId = /^\/api\/v1\/media\/([^/]+)$/.exec(url)?.[1]
    if (!mediaId || !this.options.mediaRepository) return null
    return await this.options.mediaRepository.findSourceById(mediaId, task.projectId, task.tenantId, 'image')
  }
}

export class ProviderPoller {
  constructor(
    private readonly store: AppStore,
    private readonly options: {
      videoProvider: VideoGenerationProvider | null
      videoProviderName: VideoProviderName
      providerPollIntervalMs: number
      providerStallTimeoutMs: number
      providerStatusTimeoutMs: number
      leaseOwnerId: string
      leaseTtlMs: number
      objectStorage: ObjectStorage | null
      writeback: TaskWritebackService
      onVideoCompleted: ((task: GenerationTask) => Promise<void>) | null
    },
  ) {}

  async recoverStatusParseFailures(): Promise<void> {
    await this.store.mutate((state) => {
      const now = new Date().toISOString()
      state.tasks
        .filter(
          (task) =>
            task.status === 'failed' &&
            task.metadata.providerName === this.options.videoProviderName &&
            typeof task.metadata.providerTaskId === 'string' &&
            typeof task.metadata.queueHiddenAt !== 'string' &&
            task.error?.includes('"invalid_value"') &&
            task.error.includes('"status"'),
        )
        .forEach((task) => {
          task.status = 'running'
          task.progress = 50
          task.error = null
          task.updatedAt = now
          task.metadata = {
            ...task.metadata,
            providerState: 'running',
            providerPolledAt: 0,
            providerPollErrors: 0,
            statusParseRecoveredAt: now,
          }
        })
    })
  }

  async claimCancelledRemoteTasks(
    limit: number,
    excludedTaskIds: ReadonlySet<string> = new Set(),
  ): Promise<GenerationTask[]> {
    if (!this.options.videoProvider?.cancel) {
      await this.store.mutate((state) => {
        const now = new Date().toISOString()
        for (const stored of state.tasks) {
          if (
            stored.status !== 'cancelled' ||
            stored.metadata.providerName !== this.options.videoProviderName ||
            typeof stored.metadata.providerTaskId !== 'string' ||
            typeof stored.metadata.providerCancelRequestedAt !== 'string' ||
            typeof stored.metadata.providerCancelCompletedAt === 'string' ||
            typeof stored.metadata.providerCancelSkippedAt === 'string'
          ) {
            continue
          }
          const lock = cancellationResourceLockForTask(stored)
          const {
            cancelClaimedAt: _claimedAt,
            cancelLeaseExpiresAt: _leaseExpiresAt,
            providerCancelError: _error,
            providerCancelFailedAt: _failedAt,
            ...metadata
          } = stored.metadata
          stored.metadata = {
            ...metadata,
            cancelResourceLockKind: lock.kind,
            cancelResourceLockKey: lock.key,
            providerCancelSkippedAt: now,
            providerCancelSkippedReason: 'Provider does not support remote cancellation',
          }
          stored.updatedAt = now
        }
      })
      return []
    }
    return this.claimCancelableTasks(limit, excludedTaskIds)
  }

  async claimRemoteVideoPolls(
    limit: number,
    excludedTaskIds: ReadonlySet<string> = new Set(),
  ): Promise<GenerationTask[]> {
    if (!this.options.videoProvider) return []
    const now = Date.now()
    const boundedLimit = Math.max(0, Math.floor(limit))
    if (boundedLimit === 0) return []
    return this.store.mutate((state) => {
      const tasks = state.tasks
        .filter(
          (task) =>
            !excludedTaskIds.has(task.id) &&
            task.status === 'running' &&
            task.metadata.providerName === this.options.videoProviderName &&
            task.leaseOwnerId === this.options.leaseOwnerId &&
            generationTaskLeaseActive(task, now) &&
            typeof task.metadata.providerTaskId === 'string' &&
            now - numberValue(task.metadata.providerPolledAt, 0) >= this.options.providerPollIntervalMs,
        )
        .sort(
          (left, right) =>
            numberValue(left.metadata.providerPolledAt, 0) -
              numberValue(right.metadata.providerPolledAt, 0) ||
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, boundedLimit)

      for (const stored of tasks) {
        const leaseToken = stringValue(stored.leaseToken, '')
        if (!leaseToken) continue
        stored.metadata = { ...stored.metadata, providerPolledAt: now }
        renewGenerationTaskLease(stored, this.options.leaseOwnerId, leaseToken, this.options.leaseTtlMs)
        stored.updatedAt = new Date().toISOString()
      }
      return tasks
    })
  }

  async requestRemoteVideoPoll(task: GenerationTask): Promise<ProviderVideoPollOutcome> {
    if (!this.options.videoProvider) return { kind: 'error', error: 'Video provider is not configured' }
    const providerTaskId = stringValue(task.metadata.providerTaskId, '')
    if (!providerTaskId) return { kind: 'error', error: 'Video provider task ID is missing' }
    try {
      const status = await observeProviderCall(
        {
          provider: this.options.videoProviderName,
          operation: 'video.getStatus',
          tenantId: task.tenantId,
          organizationId: task.tenantId,
          userId: task.userId,
          taskId: task.id,
          traceId: traceIdFromGenerationTask(task),
        },
        () =>
          withTimeout(
            () => this.options.videoProvider!.getStatus(providerTaskId),
            this.options.providerStatusTimeoutMs,
            'Video provider status request timed out',
          ),
      )
      let videoDescriptor: GeneratedOutputDescriptor | null = null
      let videoCacheError: string | null = null
      const hasCachedVideo = generatedDescriptors(task).some(
        (item) => item.view === 'single' && item.contentType.startsWith('video/'),
      )
      if (status.status === 'completed' && !hasCachedVideo && this.options.objectStorage) {
        try {
          videoDescriptor = await observeProviderCall(
            {
              provider: this.options.videoProviderName,
              operation: 'video.getContent',
              tenantId: task.tenantId,
              organizationId: task.tenantId,
              userId: task.userId,
              taskId: task.id,
              traceId: traceIdFromGenerationTask(task),
            },
            () =>
              this.options.writeback.persistVideoContent(task, providerTaskId, this.options.videoProvider!),
          )
        } catch (error) {
          videoCacheError = messageFor(error)
        }
      }
      let lastFrameDescriptor: GeneratedOutputDescriptor | null = null
      let lastFrameError: string | null = null
      const hasLastFrame = generatedDescriptors(task).some((item) => item.view === 'last-frame')
      if (
        status.status === 'completed' &&
        !hasLastFrame &&
        this.options.videoProvider.getLastFrameContent &&
        this.options.objectStorage
      ) {
        try {
          lastFrameDescriptor = await observeProviderCall(
            {
              provider: this.options.videoProviderName,
              operation: 'video.getLastFrameContent',
              tenantId: task.tenantId,
              organizationId: task.tenantId,
              userId: task.userId,
              taskId: task.id,
              traceId: traceIdFromGenerationTask(task),
            },
            () =>
              this.options.writeback.persistVideoLastFrame(task, providerTaskId, this.options.videoProvider!),
          )
        } catch (error) {
          lastFrameError = messageFor(error)
        }
      }
      return {
        kind: 'status',
        status,
        videoDescriptor,
        videoCacheError,
        lastFrameDescriptor,
        lastFrameError,
      }
    } catch (error) {
      return { kind: 'error', error: messageFor(error) }
    }
  }

  async applyRemoteVideoPoll(
    task: GenerationTask,
    outcome: ProviderVideoPollOutcome,
  ): Promise<AppliedVideoPollOutcome> {
    const leaseToken = stringValue(task.leaseToken, '')
    const providerTaskId = stringValue(task.metadata.providerTaskId, '')
    if (!leaseToken || !providerTaskId) {
      return { completedTask: null, stalledProviderTaskId: null }
    }
    if (outcome.kind === 'error') {
      const attempts = this.store.read((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        return numberValue(stored?.metadata.providerPollErrors, 0) + 1
      })
      if (attempts >= 3) {
        await this.options.writeback.failTask(task.id, outcome.error, leaseToken)
      } else {
        await this.options.writeback.markProviderPollError(task.id, leaseToken, attempts)
      }
      return { completedTask: null, stalledProviderTaskId: null }
    }
    if (
      outcome.status.status === 'running' &&
      videoProcessingStalled(task, outcome.status, this.options.providerStallTimeoutMs)
    ) {
      const stalled = await this.options.writeback.handleStalledVideoProcessing(
        task.id,
        leaseToken,
        providerTaskId,
      )
      return {
        completedTask: null,
        stalledProviderTaskId: stalled ? providerTaskId : null,
      }
    }
    const completedTask = await this.options.writeback.writeVideoPollResult({
      taskId: task.id,
      leaseToken,
      status: outcome.status,
      videoDescriptor: outcome.videoDescriptor,
      videoCacheError: outcome.videoCacheError,
      lastFrameDescriptor: outcome.lastFrameDescriptor,
      lastFrameError: outcome.lastFrameError,
    })
    return {
      completedTask: completedTask?.status === 'completed' ? completedTask : null,
      stalledProviderTaskId: null,
    }
  }

  async requestRemoteCancellation(task: GenerationTask): Promise<ProviderCancellationOutcome> {
    const providerTaskId = stringValue(task.metadata.providerTaskId, '')
    if (!providerTaskId || !this.options.videoProvider?.cancel) {
      return { kind: 'error', error: 'Video provider cancellation is not configured' }
    }
    try {
      await observeProviderCall(
        {
          provider: this.options.videoProviderName,
          operation: 'video.cancel',
          tenantId: task.tenantId,
          organizationId: task.tenantId,
          userId: task.userId,
          taskId: task.id,
          traceId: traceIdFromGenerationTask(task),
        },
        () => this.options.videoProvider!.cancel!(providerTaskId),
      )
      return { kind: 'cancelled' }
    } catch (error) {
      return { kind: 'error', error: messageFor(error) }
    }
  }

  async applyRemoteCancellation(task: GenerationTask, outcome: ProviderCancellationOutcome): Promise<void> {
    const claimToken = stringValue(task.metadata.cancelClaimedAt, '')
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (
        !stored ||
        stored.status !== 'cancelled' ||
        stringValue(stored.metadata.cancelClaimedAt, '') !== claimToken
      ) {
        return
      }
      const now = new Date().toISOString()
      if (outcome.kind === 'cancelled') {
        const {
          providerCancelError: _error,
          providerCancelFailedAt: _failedAt,
          cancelClaimedAt: _claimedAt,
          cancelLeaseExpiresAt: _leaseExpiresAt,
          ...metadata
        } = stored.metadata
        stored.metadata = {
          ...metadata,
          providerState: 'cancelled',
          providerCancelCompletedAt: now,
        }
      } else {
        stored.metadata = {
          ...stored.metadata,
          providerCancelError: outcome.error,
          providerCancelFailedAt: now,
        }
      }
      stored.updatedAt = now
    })
  }

  async notifyVideoCompleted(task: GenerationTask): Promise<void> {
    await this.options.onVideoCompleted?.(task).catch(() => {})
  }

  cancelStalledProviderTask(providerTaskId: string): void {
    if (!this.options.videoProvider?.cancel) return
    void this.options.videoProvider.cancel(providerTaskId).catch(() => {})
  }

  private async claimCancelableTasks(
    limit: number,
    excludedTaskIds: ReadonlySet<string>,
  ): Promise<GenerationTask[]> {
    const boundedLimit = Math.max(0, Math.floor(limit))
    if (boundedLimit === 0) return []
    return this.store.mutate((state) => {
      const now = new Date()
      const nowIso = now.toISOString()
      const leaseExpiresAt = new Date(now.getTime() + this.options.leaseTtlMs).toISOString()
      const eligible = state.tasks
        .filter(
          (task) =>
            !excludedTaskIds.has(task.id) &&
            task.status === 'cancelled' &&
            task.metadata.providerName === this.options.videoProviderName &&
            typeof task.metadata.providerTaskId === 'string' &&
            typeof task.metadata.providerCancelRequestedAt === 'string' &&
            typeof task.metadata.providerCancelCompletedAt !== 'string' &&
            typeof task.metadata.providerCancelSkippedAt !== 'string',
        )
        .sort((left, right) => {
          const createdAt = left.createdAt.localeCompare(right.createdAt)
          if (createdAt !== 0) return createdAt
          const updatedAt = left.updatedAt.localeCompare(right.updatedAt)
          if (updatedAt !== 0) return updatedAt
          return left.id.localeCompare(right.id)
        })

      const activeLocks = new Set<string>()
      for (const task of eligible) {
        const lock = cancellationResourceLockForTask(task)
        if (this.cancelClaimActive(task, now.getTime())) activeLocks.add(taskResourceLockId(lock))
      }

      const claimedLocks = new Set<string>()
      const claimedTasks: GenerationTask[] = []
      for (const task of eligible) {
        if (claimedTasks.length >= boundedLimit) break
        const lock = cancellationResourceLockForTask(task)
        const lockId = taskResourceLockId(lock)
        if (activeLocks.has(lockId) || claimedLocks.has(lockId)) continue
        if (this.cancelClaimActive(task, now.getTime())) {
          activeLocks.add(lockId)
          continue
        }
        const {
          providerCancelError: _error,
          providerCancelFailedAt: _failedAt,
          providerCancelCompletedAt: _completedAt,
          providerCancelSkippedAt: _skippedAt,
          providerCancelSkippedReason: _skippedReason,
          cancelClaimedAt: _claimedAt,
          cancelLeaseExpiresAt: _leaseExpiresAt,
          ...metadata
        } = task.metadata
        task.metadata = {
          ...metadata,
          cancelResourceLockKind: lock.kind,
          cancelResourceLockKey: lock.key,
          cancelClaimedAt: nowIso,
          cancelLeaseExpiresAt: leaseExpiresAt,
        }
        task.updatedAt = nowIso
        claimedLocks.add(lockId)
        claimedTasks.push(task)
      }

      return claimedTasks
    })
  }

  private cancelClaimActive(task: GenerationTask, now: number): boolean {
    const claimedAt = stringValue(task.metadata.cancelClaimedAt, '')
    const expiresAt = task.metadata.cancelLeaseExpiresAt
    return Boolean(
      claimedAt &&
      typeof expiresAt === 'string' &&
      expiresAt.length > 0 &&
      Number.isFinite(Date.parse(expiresAt)) &&
      Date.parse(expiresAt) > now,
    )
  }
}

function imageRequestFor(task: GenerationTask, references: ImageReference[]): ImageGenerationRequest {
  const outputs: ImageGenerationRequest['outputs'] =
    task.metadata.turnaround === true ? ['front', 'side', 'back'] : ['single']
  const quality = image2Quality(task.metadata.quality)
  return {
    taskId: task.id,
    idempotencyKey: providerIdempotencyKeyFor(task),
    assetId: stringValue(task.metadata.assetId, ''),
    model: task.model,
    aspectRatio: stringValue(task.metadata.aspectRatio, '1:1'),
    ...(quality ? { quality } : {}),
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    references,
    outputs,
  }
}

function videoRequestFor(
  task: GenerationTask,
  images: VideoGenerationRequest['images'],
): VideoGenerationRequest {
  const seed = optionalInteger(task.metadata.seed)
  const watermark = optionalBoolean(task.metadata.watermark)
  const cameraFixed = optionalBoolean(task.metadata.cameraFixed)
  return {
    taskId: task.id,
    idempotencyKey: providerIdempotencyKeyFor(task),
    model: task.model,
    tier: task.tier ?? null,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    seconds: boundedInteger(task.metadata.duration, 5, 4, 15),
    ratio: stringValue(task.metadata.aspectRatio, '16:9'),
    resolution: videoResolution(task.metadata.resolution),
    images,
    generateAudio: task.metadata.generateAudio === true,
    returnLastFrame: task.metadata.returnLastFrame !== false,
    ...(seed === null ? {} : { seed }),
    ...(watermark === null ? {} : { watermark }),
    ...(cameraFixed === null ? {} : { cameraFixed }),
  }
}

function findStoredReference(
  store: AppStore,
  task: GenerationTask,
  url: string,
): { storageKey: string; contentType: string } | null {
  const mediaId = /^\/api\/v1\/media\/([^/]+)$/.exec(url)?.[1]
  if (mediaId) {
    return store.read((state) => {
      const media = state.media.find(
        (item) => item.id === mediaId && item.projectId === task.projectId && item.tenantId === task.tenantId,
      )
      return media ? { storageKey: media.storageKey, contentType: media.contentType } : null
    })
  }

  const generated = /^\/api\/v1\/generation\/tasks\/([^/]+)\/outputs\/([^/]+)$/.exec(url)
  if (!generated) return null
  return store.read((state) => {
    const sourceTask = state.tasks.find(
      (item) =>
        item.id === generated[1] && item.projectId === task.projectId && item.tenantId === task.tenantId,
    )
    const descriptor = generatedDescriptors(sourceTask).find((item) => item.view === generated[2])
    return descriptor ? { storageKey: descriptor.storageKey, contentType: descriptor.contentType } : null
  })
}

function providerIdempotencyKeyFor(task: GenerationTask): string {
  return stringValue(task.metadata.providerIdempotencyKey, `generation:${task.tenantId}:${task.id}`)
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function image2ReferenceRole(value: unknown): ImageReference['role'] {
  return value === 'subject' ||
    value === 'clothing' ||
    value === 'accessory' ||
    value === 'style' ||
    value === 'composition' ||
    value === 'color'
    ? value
    : undefined
}

function image2Quality(value: unknown): ImageGenerationRequest['quality'] {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

function finalizeImage2GenerationSnapshot(
  task: GenerationTask,
  negativePrompt: string,
  userNegativePrompt: string,
): Record<string, unknown> {
  const existing = objectValue(task.metadata.generationSnapshot)
  const existingReferences = Array.isArray(existing.references) ? existing.references : null
  const references =
    existingReferences ?? (Array.isArray(task.metadata.references) ? task.metadata.references : [])
  const existingAssist = objectValue(existing.assist)
  const existingAssistResults = objectValue(existing.assistResults)
  const promptOptimization = objectValue(task.metadata.promptOptimization)
  const referenceVision = objectValue(task.metadata.referenceVision)

  return {
    ...existing,
    version: 1,
    finalized: true,
    model: stringValue(existing.model, task.model ?? 'seqora-image2'),
    prompt: task.prompt,
    originalPrompt: stringValue(
      existing.originalPrompt,
      stringValue(task.metadata.originalPrompt, task.prompt),
    ),
    negativePrompt,
    userNegativePrompt,
    aspectRatio: stringValue(existing.aspectRatio, stringValue(task.metadata.aspectRatio, 'auto')),
    quality: image2Quality(existing.quality) ?? image2Quality(task.metadata.quality) ?? 'low',
    imageCount: positiveInteger(existing.imageCount) ?? positiveInteger(task.metadata.batchSize) ?? 1,
    references,
    assist: {
      promptOptimization: existingAssist.promptOptimization === true || promptOptimization.requested === true,
      referenceVision: existingAssist.referenceVision === true || referenceVision.requested === true,
    },
    assistResults: {
      promptOptimization:
        Object.keys(existingAssistResults.promptOptimization ?? {}).length > 0
          ? existingAssistResults.promptOptimization
          : promptOptimization,
      referenceVision:
        Object.keys(existingAssistResults.referenceVision ?? {}).length > 0
          ? existingAssistResults.referenceVision
          : referenceVision,
    },
  }
}

function imageAssetKind(
  task: GenerationTask,
): 'character' | 'scene' | 'prop' | 'costume' | 'brand' | 'storyboard' {
  const assetKind = task.metadata.assetKind
  if (
    assetKind === 'character' ||
    assetKind === 'scene' ||
    assetKind === 'prop' ||
    assetKind === 'costume' ||
    assetKind === 'brand'
  ) {
    return assetKind
  }
  return 'storyboard'
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function videoProcessingStalled(
  task: GenerationTask,
  status: VideoGenerationStatus,
  stallTimeoutMs: number,
): boolean {
  if (status.progress > task.progress) return false
  const progressChangedAt = Date.parse(
    stringValue(task.metadata.providerProgressChangedAt, stringValue(task.metadata.providerSubmittedAt, '')),
  )
  return Number.isFinite(progressChangedAt) && Date.now() - progressChangedAt >= stallTimeoutMs
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = numberValue(value, fallback)
  return Math.min(max, Math.max(min, Math.round(number)))
}

function optionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function videoResolution(value: unknown): string {
  return value === '480p' || value === '720p' || value === '1080p' || value === '4k' ? value : '720p'
}

function recordGenerationTaskQueueWait(task: GenerationTask, now = Date.now()): void {
  observabilityMetrics.recordTaskQueueWait({
    kind: taskMetricKind(task),
    tenantId: task.tenantId,
    taskId: task.id,
    waitMs: durationSince(task.createdAt, now),
  })
}

function recordGenerationTaskTerminal(task: GenerationTask, error?: unknown): void {
  observabilityMetrics.recordTaskTerminal({
    kind: taskMetricKind(task),
    tenantId: task.tenantId,
    taskId: task.id,
    status: task.status,
  })
  observabilityMetrics.recordTaskExecution({
    kind: taskMetricKind(task),
    tenantId: task.tenantId,
    taskId: task.id,
    durationMs: durationSince(task.createdAt),
    ok: task.status === 'completed',
    error,
  })
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    usageCollector.recordJobTerminal({
      jobId: task.id,
      source: 'generation_task',
      kind: task.kind,
      status: task.status,
      creditsUsed: task.status === 'completed' ? task.estimatedCredits : 0,
      tenantId: task.tenantId,
      organizationId: task.tenantId,
      userId: task.userId,
      traceId: traceIdFromGenerationTask(task),
    })
  }
}

function taskMetricKind(task: GenerationTask): string {
  return `${task.kind}:${task.provider}`
}

function progressiveTextValidation(preview: string): Record<string, number> {
  const scenes = preview
    .split(/(?=场次\s*[:：])/u)
    .map((scene) => scene.trim())
    .filter((scene) => /^场次\s*[:：]/u.test(scene))
  const closedScenes = scenes.slice(0, -1)
  const structurallyCompleteScenes = closedScenes.filter((scene) =>
    ['剧情', '场景', '角色', '动作'].every((field) => new RegExp(`${field}\\s*[:：]`, 'u').test(scene)),
  )
  const dialogueScenes = closedScenes.filter((scene) => /(?:对白|画外音|内心独白)\s*[:：]/u.test(scene))
  return {
    recognizedScenes: scenes.length,
    checkedScenes: closedScenes.length,
    structurallyCompleteScenes: structurallyCompleteScenes.length,
    dialogueScenes: dialogueScenes.length,
  }
}

function summarizeTextTiming(
  task: GenerationTask,
  diagnostics: LocalTaskDiagnostics,
  completedAtMs: number,
): Record<string, unknown> {
  const calls = diagnostics.textTimings.map((timing, index) => ({
    label: timing.label || `call-${index + 1}`,
    outcome: timing.outcome || 'completed',
    responseHeadersMs: timing.responseHeadersMs,
    firstTokenMs: timing.firstTokenMs,
    firstTokenWaitMs:
      timing.firstTokenMs === null || timing.responseHeadersMs === null
        ? null
        : Math.max(0, timing.firstTokenMs - timing.responseHeadersMs),
    generationMs: timing.generationMs,
    totalMs: timing.totalMs,
    attempt: timing.attempt,
  }))
  const providerMs = calls.reduce((total, call) => total + call.totalMs, 0)
  const executionMs = Math.max(0, completedAtMs - diagnostics.executionStartedAtMs)
  const createdAtMs = Date.parse(task.createdAt)
  const queueWaitMs = Number.isFinite(createdAtMs)
    ? Math.max(0, diagnostics.executionStartedAtMs - createdAtMs)
    : 0
  const primary = calls[0] ?? null
  return {
    queueWaitMs,
    responseHeadersMs: primary?.responseHeadersMs ?? null,
    firstTokenWaitMs: primary?.firstTokenWaitMs ?? null,
    firstTokenMs: primary?.firstTokenMs ?? null,
    generationMs: primary?.generationMs ?? null,
    providerMs,
    appProcessingMs: Math.max(0, executionMs - providerMs),
    executionMs,
    totalMs: Number.isFinite(createdAtMs) ? Math.max(0, completedAtMs - createdAtMs) : executionMs,
    firstVisibleMs:
      diagnostics.firstPreviewAtMs === null
        ? null
        : Math.max(0, diagnostics.firstPreviewAtMs - diagnostics.executionStartedAtMs),
    extraModelCalls: Math.max(0, calls.length - 1),
    calls,
  }
}

function durationSince(startIso: string, now = Date.now()): number {
  const startedAt = Date.parse(startIso)
  return Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0
}

async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(message)
          error.name = 'TimeoutError'
          reject(error)
        }, timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function messageFor(error: unknown): string {
  if (error instanceof Error && isTimeoutError(error)) {
    return '第三方生成请求超时：上游没有在限定时间内返回结果，本次任务没有生成成功；请稍后重试，或降低质量/减少参考图后再试'
  }
  return error instanceof Error ? error.message : '第三方生成请求失败'
}

function isTimeoutError(error: Error): boolean {
  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    /aborted due to timeout|timed out|timeout/i.test(error.message)
  )
}

function canPotentiallyRefundTask(task: GenerationTask): boolean {
  if (task.estimatedCredits <= 0) return false
  if (typeof task.metadata.creditsRefundedAt === 'string') return false
  if (task.status === 'failed') return true
  if (task.status === 'paused') return typeof task.metadata.queueHiddenAt === 'string'
  if (task.status !== 'cancelled') return false

  const providerTaskId = stringValue(task.metadata.providerTaskId, '')
  if (!providerTaskId || typeof task.metadata.providerCancelRequestedAt !== 'string') return true
  return (
    typeof task.metadata.providerCancelCompletedAt === 'string' ||
    typeof task.metadata.providerCancelSkippedAt === 'string'
  )
}

function isScriptTask(task: GenerationTask): boolean {
  return (
    task.kind === 'text' &&
    task.provider === 'text' &&
    String(task.metadata.generationStage || '').startsWith('script-') &&
    (task.metadata.scriptOperation === 'generate' || task.metadata.scriptOperation === 'enrich')
  )
}

function isActiveScriptTask(task: GenerationTask): boolean {
  return isScriptTask(task) && ['queued', 'paused', 'running'].includes(task.status)
}

function isNextEpisodeScriptTask(task: GenerationTask): boolean {
  return isScriptTask(task) && task.metadata.mode === 'segment'
}

function taskCreatedAt(task: GenerationTask): number {
  const value = Date.parse(task.createdAt)
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

function recoverScriptTaskFromDraft(task: GenerationTask, state: AppState, nowIso: string): boolean {
  if (
    !isScriptTask(task) ||
    typeof task.metadata.textPreview !== 'string' ||
    !task.metadata.textPreview.trim()
  ) {
    return false
  }
  const startedAt = Date.parse(stringValue(task.metadata.localTaskStartedAt, ''))
  const requestedEpisodeId = stringValue(task.metadata.episodeId, '')
  const draft = state.scriptEpisodes
    .filter(
      (episode) =>
        episode.projectId === task.projectId &&
        episode.tenantId === task.tenantId &&
        episode.status === 'draft' &&
        episode.draftContent.trim().length > 0 &&
        (!requestedEpisodeId || episode.id === requestedEpisodeId) &&
        (!Number.isFinite(startedAt) || Date.parse(episode.updatedAt) >= startedAt),
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  const episode = draft[0]
  if (!episode) return false

  const {
    textPreview: _textPreview,
    textPreviewUpdatedAt: _textPreviewUpdatedAt,
    textFirstPreviewAt: _textFirstPreviewAt,
    textPreviewValidation: _textPreviewValidation,
    textPreviewStage: _textPreviewStage,
    ...metadata
  } = task.metadata
  const script = episode.draftContent.trim()
  task.status = 'completed'
  task.progress = 100
  task.error = null
  task.metadata = {
    ...metadata,
    localTaskRecoveredAt: nowIso,
    textResult: {
      script,
      episode,
      ...(task.metadata.mode === 'segment' ? { segment: script } : {}),
      mode: task.metadata.mode === 'segment' ? 'segment' : 'quick',
    },
  }
  task.updatedAt = nowIso
  releaseGenerationTaskLease(task)
  recordGenerationTaskTerminal(task)
  return true
}

function canRefundTask(task: GenerationTask, ledgerIds: string[]): boolean {
  if (!canPotentiallyRefundTask(task)) return false
  if (!ledgerIds.includes(`generation-${task.clientRequestId}`)) return false
  return !ledgerIds.includes(`refund-${task.id}`)
}

function refundDescription(task: GenerationTask): string {
  if (task.status === 'failed') return `${task.label} · 失败退款`
  if (task.status === 'cancelled') return `${task.label} · 取消退款`
  return `${task.label} · 已删除退款`
}

function isRemoteProviderName(value: unknown): boolean {
  return isVideoProviderName(value) || value === 'tokenadvent-img2'
}

function isVideoProviderName(value: unknown): boolean {
  return value === 'stringx-seedance' || value === 'volc-ark-seedance'
}

function outputsFor(task: GenerationTask): GenerationTask['outputs'] {
  if (task.kind === 'image' || task.kind === 'video') {
    const images = ['/demo/station.jpg', '/demo/rain.jpg', '/demo/room.jpg']
    const start = Math.abs(hash(task.id)) % images.length
    const mediaType: 'image' | 'video' = task.kind
    const views =
      task.metadata.turnaround === true ? (['front', 'side', 'back'] as const) : (['single'] as const)
    return views.map((view, index) => ({
      id: `${task.id}-${view}`,
      url: images[(start + index) % images.length] ?? images[0]!,
      mediaType,
      view,
    }))
  }
  return []
}

function hash(value: string): number {
  return [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) | 0, 0)
}
