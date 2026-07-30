import type { GenerationTask } from '@seqora/contracts'
import {
  compileQualityRules,
  compileStoryboardVideoPrompt,
  normalizedVideoDuration,
  QUALITY_RULE_VERSION,
  VIDEO_PROMPT_VERSION,
} from '@seqora/prompting'
import { randomUUID } from 'node:crypto'
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageReference,
} from '../generation/imageProvider.js'
import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoProviderName,
} from '../generation/videoProvider.js'
import type { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { CreditLedger } from '../../modules/billing/creditLedger.js'
import { cancellationResourceLockForTask, taskResourceLockId } from './taskResourceLock.js'
import {
  GenerationResultWriteback,
  generatedDescriptors,
  type GeneratedOutputDescriptor,
} from './taskWriteback.js'
import {
  DEFAULT_TASK_MAX_ATTEMPTS,
  claimGenerationTaskLease,
  generationTaskLeaseActive,
  generationTaskLeaseMatches,
  releaseGenerationTaskLease,
  renewGenerationTaskLease,
} from './taskLease.js'

export interface TaskDispatcher {
  dispatch(task: GenerationTask): Promise<void>
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
  onVideoCompleted?: (task: GenerationTask) => Promise<void>
}

export class GenerationTaskRunner implements TaskDispatcher {
  private timer: NodeJS.Timeout | null = null
  private tickPromise: Promise<void> | null = null
  private readonly videoProvider: VideoGenerationProvider | null
  private readonly videoProviderName: VideoProviderName
  private readonly imageProvider: ImageGenerationProvider | null
  private readonly objectStorage: ObjectStorage | null
  private readonly creditLedger: CreditLedger | null
  private readonly writeback: GenerationResultWriteback
  private readonly providerPollIntervalMs: number
  private readonly leaseTtlMs: number
  private readonly leaseOwnerId: string
  private readonly onVideoCompleted: ((task: GenerationTask) => Promise<void>) | null
  private readonly activeExecutions = new Set<string>()

  constructor(
    private readonly store: AppStore,
    options: GenerationTaskRunnerOptions = {},
  ) {
    this.videoProvider = options.videoProvider ?? null
    this.videoProviderName = options.videoProviderName ?? 'stringx-seedance'
    this.imageProvider = options.imageProvider ?? null
    this.objectStorage = options.objectStorage ?? null
    this.creditLedger = options.creditLedger ?? null
    this.writeback = new GenerationResultWriteback(store, this.objectStorage)
    this.providerPollIntervalMs = options.providerPollIntervalMs ?? 5_000
    this.leaseTtlMs = options.leaseTtlMs ?? 120_000
    this.leaseOwnerId = `generation-task-runner-${process.pid}-${randomUUID()}`
    this.onVideoCompleted = options.onVideoCompleted ?? null
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

  async dispatch(_task: GenerationTask): Promise<void> {
    void this.tick().catch(() => {})
  }

  async tick(): Promise<void> {
    if (this.tickPromise) return this.tickPromise

    const tickPromise = this.runTick()
    this.tickPromise = tickPromise

    try {
      await tickPromise
    } finally {
      if (this.tickPromise === tickPromise) this.tickPromise = null
    }
  }

  private async runTick(): Promise<void> {
    await this.recoverStatusParseFailures()
    await this.recoverStaleRunningTasks()
    await this.reconcileCancelledRemoteTasks()
    await this.refundTerminalTasks()
    const hasActiveTasks = this.store.read((state) =>
      state.tasks.some((task) => task.status === 'queued' || task.status === 'running'),
    )
    if (!hasActiveTasks) return

    const remoteTasks = await this.claimQueuedTasks()

    await this.refundTerminalTasks()
    this.scheduleRemoteExecutions(remoteTasks.video, (task) => this.submitRemoteVideo(task))
    this.scheduleRemoteExecutions(remoteTasks.image, (task) => this.generateRemoteImage(task))

    await this.store.mutate(async (state) => {
      const now = new Date().toISOString()
      state.tasks
        .filter(
          (task) =>
            task.status === 'running' &&
            task.provider !== 'local-compose' &&
            !isRemoteProviderName(task.metadata.providerName) &&
            task.leaseOwnerId === this.leaseOwnerId,
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
          }
        })
    })

    await this.pollRemoteVideos()
  }

  private async reconcileCancelledRemoteTasks(): Promise<void> {
    const tasks = this.store.read((state) =>
      state.tasks.filter(
        (task) =>
          task.status === 'cancelled' &&
          task.metadata.providerName === this.videoProviderName &&
          typeof task.metadata.providerTaskId === 'string' &&
          typeof task.metadata.providerCancelRequestedAt === 'string' &&
          typeof task.metadata.providerCancelCompletedAt !== 'string' &&
          typeof task.metadata.providerCancelSkippedAt !== 'string',
      ),
    )
    if (!tasks.length) return

    if (!this.videoProvider?.cancel) {
      await this.store.mutate((state) => {
        const now = new Date().toISOString()
        for (const task of tasks) {
          const stored = state.tasks.find((item) => item.id === task.id)
          if (!stored || stored.status !== 'cancelled') continue
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
      return
    }

    const claimedTasks = await this.claimCancelledRemoteTasks(tasks)

    for (const task of claimedTasks) {
      const providerTaskId = stringValue(task.metadata.providerTaskId, '')
      if (!providerTaskId) continue
      try {
        await this.videoProvider.cancel(providerTaskId)
        await this.store.mutate((state) => {
          const stored = state.tasks.find((item) => item.id === task.id)
          if (!stored || stored.status !== 'cancelled') return
          const now = new Date().toISOString()
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
          stored.updatedAt = now
        })
      } catch (error) {
        await this.store.mutate((state) => {
          const stored = state.tasks.find((item) => item.id === task.id)
          if (!stored || stored.status !== 'cancelled') return
          const now = new Date().toISOString()
          stored.metadata = {
            ...stored.metadata,
            providerCancelError: messageFor(error),
            providerCancelFailedAt: now,
          }
          stored.updatedAt = now
        })
      }
    }
  }

  private async claimCancelledRemoteTasks(tasks: GenerationTask[]): Promise<GenerationTask[]> {
    return this.store.mutate((state) => {
      const now = new Date()
      const nowIso = now.toISOString()
      const leaseExpiresAt = new Date(now.getTime() + this.leaseTtlMs).toISOString()
      const requestedTaskIds = new Set(tasks.map((task) => task.id))
      const eligible = state.tasks
        .filter(
          (task) =>
            requestedTaskIds.has(task.id) &&
            task.status === 'cancelled' &&
            task.metadata.providerName === this.videoProviderName &&
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
        const lock = cancellationResourceLockForTask(task)
        const lockId = taskResourceLockId(lock)
        if (activeLocks.has(lockId) || claimedLocks.has(lockId)) continue
        const stored = state.tasks.find((item) => item.id === task.id)
        if (!stored || stored.status !== 'cancelled') continue
        if (this.cancelClaimActive(stored, now.getTime())) {
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
        } = stored.metadata
        stored.metadata = {
          ...metadata,
          cancelResourceLockKind: lock.kind,
          cancelResourceLockKey: lock.key,
          cancelClaimedAt: nowIso,
          cancelLeaseExpiresAt: leaseExpiresAt,
        }
        stored.updatedAt = nowIso
        claimedLocks.add(lockId)
        claimedTasks.push(stored)
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

  private async recoverStaleRunningTasks(): Promise<void> {
    await this.store.mutate((state) => {
      const now = new Date()
      const nowIso = now.toISOString()
      state.tasks
        .filter((task) => task.status === 'running' && task.provider !== 'local-compose')
        .forEach((task) => {
          const providerName = this.remoteProviderName(task)
          if (!this.ownsTask(task, providerName)) return
          if (generationTaskLeaseActive(task, now.getTime())) return
          if (providerName && !task.metadata.providerTaskId) {
            task.status = 'failed'
            task.progress = 100
            task.error = 'Remote generation submission was interrupted; retry this task'
            task.updatedAt = nowIso
            releaseGenerationTaskLease(task)
            return
          }
          claimGenerationTaskLease(task, this.leaseOwnerId, this.leaseTtlMs, now, {
            countAttempt: false,
          })
          task.updatedAt = nowIso
        })
    })
  }

  private async claimQueuedTasks(): Promise<{ video: GenerationTask[]; image: GenerationTask[] }> {
    return this.store.mutate((state) => {
      const now = new Date()
      const nowIso = now.toISOString()
      const selectedVideoTasks: GenerationTask[] = []
      const selectedImageTasks: GenerationTask[] = []

      for (const user of state.users) {
        const userTasks = state.tasks.filter((task) => task.userId === user.id)
        userTasks
          .filter((task) => task.status === 'queued' && dependencyState(task, userTasks) === 'failed')
          .forEach((task) => {
            task.status = 'failed'
            task.progress = 100
            task.error = continuityDependencyMissingFrame(task, userTasks)
              ? 'Dependency source is missing a last frame; regenerate the previous shot'
              : 'Dependency task failed or is missing'
            task.updatedAt = nowIso
            releaseGenerationTaskLease(task)
          })

        const running = userTasks.filter(
          (task) => task.status === 'running' && task.provider !== 'local-compose',
        )
        const available = Math.max(0, (user.plan === 'member' ? 3 : 1) - running.length)
        let claimed = 0
        for (const task of userTasks) {
          if (claimed >= available) break
          if (task.status !== 'queued') continue
          if (task.provider === 'local-compose') continue
          if (dependencyState(task, userTasks) !== 'ready') continue
          const providerName = this.remoteProviderName(task)
          if (!this.ownsTask(task, providerName)) continue
          if ((task.attempts ?? 0) >= (task.maxAttempts ?? DEFAULT_TASK_MAX_ATTEMPTS)) {
            task.status = 'failed'
            task.progress = 100
            task.error = 'Task exceeded maximum attempts; create a new task or retry from details'
            task.updatedAt = nowIso
            releaseGenerationTaskLease(task)
            continue
          }
          claimGenerationTaskLease(task, this.leaseOwnerId, this.leaseTtlMs, now)
          task.progress = providerName ? 1 : 8
          task.updatedAt = nowIso
          if (providerName) {
            task.metadata = {
              ...task.metadata,
              providerName,
              providerState: 'submitting',
            }
            if (this.isRemoteVideoTask(task)) selectedVideoTasks.push(task)
            if (this.isRemoteImageTask(task)) selectedImageTasks.push(task)
          }
          claimed += 1
        }
      }

      return { video: selectedVideoTasks, image: selectedImageTasks }
    })
  }

  private ownsTask(task: GenerationTask, providerName: string | null): boolean {
    if (task.provider === 'local-compose') return false
    const existingProviderName = stringValue(task.metadata.providerName, '')
    if (!providerName) return existingProviderName.length === 0
    return existingProviderName.length === 0 || existingProviderName === providerName
  }

  private scheduleRemoteExecutions(
    tasks: GenerationTask[],
    execute: (task: GenerationTask) => Promise<void>,
  ): void {
    for (const task of tasks) {
      if (this.activeExecutions.has(task.id)) continue
      this.activeExecutions.add(task.id)
      void this.runRemoteExecution(task, execute).finally(() => {
        this.activeExecutions.delete(task.id)
      })
    }
  }

  private async runRemoteExecution(
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

  private isRemoteVideoTask(task: GenerationTask): boolean {
    return Boolean(this.videoProvider) && task.kind === 'video' && task.provider === 'seedance'
  }

  private isRemoteImageTask(task: GenerationTask): boolean {
    return (
      Boolean(this.imageProvider) &&
      Boolean(this.objectStorage) &&
      task.kind === 'image' &&
      task.provider === 'img2'
    )
  }

  private async recoverStatusParseFailures(): Promise<void> {
    await this.store.mutate((state) => {
      const now = new Date().toISOString()
      state.tasks
        .filter(
          (task) =>
            task.status === 'failed' &&
            task.metadata.providerName === this.videoProviderName &&
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

  private remoteProviderName(task: GenerationTask): string | null {
    if (this.videoProvider && task.kind === 'video' && task.provider === 'seedance') {
      return this.videoProviderName
    }
    if (this.imageProvider && this.objectStorage && task.kind === 'image' && task.provider === 'img2') {
      return 'tokenadvent-img2'
    }
    return null
  }

  private async submitRemoteVideo(task: GenerationTask): Promise<void> {
    const leaseToken = stringValue(task.leaseToken, '')
    if (!leaseToken) return
    try {
      const preparedTask = await this.prepareStoryboardVideoTask(task)
      const submission = await this.videoProvider!.submit(
        videoRequestFor(preparedTask, await this.resolveVideoImages(preparedTask)),
      )
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
          providerPolledAt: Date.now(),
          providerPollErrors: 0,
        }
        renewGenerationTaskLease(stored, this.leaseOwnerId, leaseToken, this.leaseTtlMs, now)
        stored.updatedAt = now.toISOString()
      })
    } catch (error) {
      await this.failTask(task.id, messageFor(error), leaseToken)
    }
  }

  private prepareStoryboardVideoTask(task: GenerationTask): Promise<GenerationTask> {
    return this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (!stored) return task
      const leaseToken = stringValue(task.leaseToken, '')
      if (leaseToken && !generationTaskLeaseMatches(stored, this.leaseOwnerId, leaseToken)) return task
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
      const compiledPrompt = compileStoryboardVideoPrompt({
        project,
        shot,
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
        sourcePrompt: shot.prompt,
        customNegativePrompt: userNegativePrompt,
      })

      stored.prompt = compiledPrompt
      stored.negativePrompt = quality.negativePrompt
      stored.metadata = {
        ...stored.metadata,
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
      if (leaseToken) renewGenerationTaskLease(stored, this.leaseOwnerId, leaseToken, this.leaseTtlMs, now)
      stored.updatedAt = now.toISOString()
      return stored
    })
  }

  private async resolveVideoImages(task: GenerationTask): Promise<VideoGenerationRequest['images']> {
    const images: VideoGenerationRequest['images'] = []
    const continuitySourceTaskId = stringValue(task.metadata.continuitySourceTaskId, '')
    const storyboardImageUrl = stringValue(task.metadata.storyboardImageUrl, '')
    if (continuitySourceTaskId) {
      if (!this.objectStorage) throw new Error('连续镜头需要对象存储读取上一镜头尾帧')
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
      const content = await this.objectStorage.get(lastFrame.storageKey)
      images.push({
        url: `data:${lastFrame.contentType};base64,${content.toString('base64')}`,
        role: 'first_frame',
      })
    }

    if (!Array.isArray(task.metadata.images)) return images
    for (const value of task.metadata.images.slice(0, Math.max(0, 9 - images.length))) {
      if (typeof value !== 'string') continue
      if (/^asset:\/\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
        images.push({ url: value, role: 'reference_image' })
        continue
      }
      if (/^https?:\/\//.test(value)) {
        images.push({ url: value, role: 'reference_image' })
        continue
      }
      if (!this.objectStorage) continue
      const stored = this.findStoredReference(task, value)
      if (!stored) continue
      const content = await this.objectStorage.get(stored.storageKey)
      images.push({
        url: `data:${stored.contentType};base64,${content.toString('base64')}`,
        role: continuitySourceTaskId && value === storyboardImageUrl ? 'last_frame' : 'reference_image',
      })
    }
    return images
  }

  private async generateRemoteImage(task: GenerationTask): Promise<void> {
    const leaseToken = stringValue(task.leaseToken, '')
    if (!leaseToken) return
    try {
      const preparedTask = await this.prepareImageTask(task)
      const references = await this.resolveImageReferences(preparedTask)
      const outputs = await this.imageProvider!.generate(imageRequestFor(preparedTask, references))
      const descriptors = await this.writeback.persistImageOutputs(task, outputs)
      await this.writeback.completeImageTask(task.id, this.leaseOwnerId, leaseToken, descriptors)
    } catch (error) {
      await this.failTask(task.id, messageFor(error), leaseToken)
    }
  }

  private prepareImageTask(task: GenerationTask): Promise<GenerationTask> {
    return this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (!stored) return task
      const leaseToken = stringValue(task.leaseToken, '')
      if (leaseToken && !generationTaskLeaseMatches(stored, this.leaseOwnerId, leaseToken)) return task
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
        qualityRuleVersion: QUALITY_RULE_VERSION,
        qualityPresetIds: quality.presetIds,
        compiledNegativePrompt: quality.negativePrompt,
        userNegativePrompt,
      }
      const now = new Date()
      if (leaseToken) renewGenerationTaskLease(stored, this.leaseOwnerId, leaseToken, this.leaseTtlMs, now)
      stored.updatedAt = now.toISOString()
      return stored
    })
  }

  private async resolveImageReferences(task: GenerationTask): Promise<ImageReference[]> {
    if (!this.objectStorage || !Array.isArray(task.metadata.references)) return []
    const references: ImageReference[] = []
    for (const raw of task.metadata.references.slice(0, 3)) {
      if (!raw || typeof raw !== 'object') continue
      const reference = raw as { url?: unknown; name?: unknown }
      if (typeof reference.url !== 'string') continue
      const stored = this.findStoredReference(task, reference.url)
      if (!stored) continue
      references.push({
        name: typeof reference.name === 'string' ? reference.name : `reference-${references.length + 1}.png`,
        contentType: stored.contentType,
        content: await this.objectStorage.get(stored.storageKey),
      })
    }
    return references
  }

  private findStoredReference(
    task: GenerationTask,
    url: string,
  ): { storageKey: string; contentType: string } | null {
    const mediaId = /^\/api\/v1\/media\/([^/]+)$/.exec(url)?.[1]
    if (mediaId) {
      return this.store.read((state) => {
        const media = state.media.find(
          (item) =>
            item.id === mediaId && item.projectId === task.projectId && item.tenantId === task.tenantId,
        )
        return media ? { storageKey: media.storageKey, contentType: media.contentType } : null
      })
    }

    const generated = /^\/api\/v1\/generation\/tasks\/([^/]+)\/outputs\/([^/]+)$/.exec(url)
    if (!generated) return null
    return this.store.read((state) => {
      const sourceTask = state.tasks.find(
        (item) =>
          item.id === generated[1] && item.projectId === task.projectId && item.tenantId === task.tenantId,
      )
      const descriptor = generatedDescriptors(sourceTask).find((item) => item.view === generated[2])
      return descriptor ? { storageKey: descriptor.storageKey, contentType: descriptor.contentType } : null
    })
  }

  private async pollRemoteVideos(): Promise<void> {
    if (!this.videoProvider) return
    const now = Date.now()
    const tasks = this.store.read((state) =>
      state.tasks.filter(
        (task) =>
          task.status === 'running' &&
          task.metadata.providerName === this.videoProviderName &&
          task.leaseOwnerId === this.leaseOwnerId &&
          generationTaskLeaseActive(task, now) &&
          typeof task.metadata.providerTaskId === 'string' &&
          now - numberValue(task.metadata.providerPolledAt, 0) >= this.providerPollIntervalMs,
      ),
    )

    for (const task of tasks) {
      const providerTaskId = String(task.metadata.providerTaskId)
      const leaseToken = stringValue(task.leaseToken, '')
      if (!leaseToken) continue
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (!stored || !generationTaskLeaseMatches(stored, this.leaseOwnerId, leaseToken)) return
        stored.metadata = { ...stored.metadata, providerPolledAt: now }
        renewGenerationTaskLease(stored, this.leaseOwnerId, leaseToken, this.leaseTtlMs)
      })
      try {
        const status = await this.videoProvider.getStatus(providerTaskId)
        let lastFrameDescriptor: GeneratedOutputDescriptor | null = null
        let lastFrameError: string | null = null
        const hasLastFrame = generatedDescriptors(task).some((item) => item.view === 'last-frame')
        if (
          status.status === 'completed' &&
          !hasLastFrame &&
          this.videoProvider.getLastFrameContent &&
          this.objectStorage
        ) {
          try {
            lastFrameDescriptor = await this.writeback.persistVideoLastFrame(
              task,
              providerTaskId,
              this.videoProvider,
            )
          } catch (error) {
            lastFrameError = messageFor(error)
          }
        }
        await this.writeback.writeVideoPollResult({
          taskId: task.id,
          leaseOwnerId: this.leaseOwnerId,
          leaseToken,
          leaseTtlMs: this.leaseTtlMs,
          status,
          lastFrameDescriptor,
          lastFrameError,
        })
        if (status.status === 'completed' && this.onVideoCompleted) {
          const completedTask = this.store.read(
            (state) => state.tasks.find((item) => item.id === task.id) ?? null,
          )
          if (completedTask?.status === 'completed')
            await this.onVideoCompleted(completedTask).catch(() => {})
        }
      } catch (error) {
        const attempts = numberValue(task.metadata.providerPollErrors, 0) + 1
        if (attempts >= 3) {
          await this.failTask(task.id, messageFor(error), leaseToken)
        } else {
          await this.store.mutate((state) => {
            const stored = state.tasks.find((item) => item.id === task.id)
            if (!stored || !generationTaskLeaseMatches(stored, this.leaseOwnerId, leaseToken)) return
            stored.metadata = { ...stored.metadata, providerPollErrors: attempts }
            renewGenerationTaskLease(stored, this.leaseOwnerId, leaseToken, this.leaseTtlMs)
          })
        }
      }
    }
  }

  private async failTask(taskId: string, error: string, leaseToken?: string): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return
      if (leaseToken && !generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return
      const now = new Date().toISOString()
      task.status = 'failed'
      task.progress = 100
      task.error = error.slice(0, 1_000)
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
    })
    await this.refundTerminalTasks()
  }

  private async refundTerminalTasks(): Promise<void> {
    const hasRefundableTask = this.store.read((state) =>
      state.tasks.some((task) =>
        canRefundTask(
          task,
          state.ledger.map((entry) => entry.id),
        ),
      ),
    )
    if (!hasRefundableTask) return
    const creditLedger = this.creditLedger
    await this.store.mutate(async (state) => {
      const ledgerIds = state.ledger.map((entry) => entry.id)
      for (const task of state.tasks) {
        if (!canRefundTask(task, ledgerIds)) continue
        if (creditLedger) {
          await creditLedger.refundGenerationInState(state, task, refundDescription(task))
          ledgerIds.unshift(`refund-${task.id}`)
          continue
        }
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
        ledgerIds.unshift(refundId)
      }
    })
  }
}

function imageRequestFor(task: GenerationTask, references: ImageReference[]): ImageGenerationRequest {
  const outputs: ImageGenerationRequest['outputs'] =
    task.metadata.turnaround === true ? ['front', 'side', 'back'] : ['single']
  return {
    taskId: task.id,
    assetId: stringValue(task.metadata.assetId, ''),
    aspectRatio: stringValue(task.metadata.aspectRatio, '1:1'),
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

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function imageAssetKind(task: GenerationTask): 'character' | 'scene' | 'prop' | 'costume' | 'storyboard' {
  const assetKind = task.metadata.assetKind
  if (assetKind === 'character' || assetKind === 'scene' || assetKind === 'prop' || assetKind === 'costume') {
    return assetKind
  }
  return 'storyboard'
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = numberValue(value, fallback)
  return Math.min(max, Math.max(min, Math.round(number)))
}

function optionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function videoResolution(value: unknown): string {
  return value === '480p' || value === '720p' || value === '1080p' || value === '4k' ? value : '720p'
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

function canRefundTask(task: GenerationTask, ledgerIds: string[]): boolean {
  if (task.estimatedCredits <= 0) return false
  if (!ledgerIds.includes(`generation-${task.clientRequestId}`)) return false
  if (ledgerIds.includes(`refund-${task.id}`)) return false
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

function dependencyState(task: GenerationTask, userTasks: GenerationTask[]): 'ready' | 'waiting' | 'failed' {
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
    if (continuityDependencyMissingFrame(task, userTasks)) return 'failed'
    if (dependency.status !== 'completed') waiting = true
  }
  return waiting ? 'waiting' : 'ready'
}

function continuityDependencyMissingFrame(task: GenerationTask, userTasks: GenerationTask[]): boolean {
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
