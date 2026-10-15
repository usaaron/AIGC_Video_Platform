import { storyboardReferences } from './storyboardReferences.js'
import type {
  CreateGenerationTask,
  DeliveryGateResult,
  DeliveryDownloadRequest,
  DeliveryVerificationSnapshot,
  GenerationTask,
  GenerationTaskPolling,
  Principal,
  RigidPhysicsAuditRequest,
  DeliveryContractFreezeRequest,
} from '@seqora/contracts'
import { createHash, randomUUID } from 'node:crypto'
import {
  generateScriptRequestSchema,
  rigidPhysicsAuditResultSchema,
  type ReviewVideo,
  videoReviewVersion,
} from '@seqora/contracts'
import { Readable } from 'node:stream'
import {
  compileStoryboardVideoPrompt,
  deriveRigidPhysicsContract,
  inspectVideoPreflight,
  VIDEO_PROMPT_VERSION,
} from '@seqora/prompting'
import type { FilmPreviewDispatcher } from '../../core/film/filmPreviewComposer.js'
import { traceContext, traceIdFromGenerationTask } from '../../core/observability/trace.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { VideoGenerationProvider } from '../../core/generation/videoProvider.js'
import type { VideoProviderName } from '../../core/generation/videoProvider.js'
import { trustedPortraitAliases } from '../../core/generation/trustedPortraitReferences.js'
import type { ObjectStorage, ObjectStorageStream } from '../../infra/objectStorage.js'
import { AppError } from '../../core/errors.js'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { GenerationTaskRepository } from './repository.js'
import { auditRigidVideoBuffer, type RawVideoFrameAudit } from '../../core/generation/rigidFrameAudit.js'
import { evaluateDeliveryGate } from './deliveryGate.js'
import { readDeliveryQuery } from './deliveryQuery.js'
import { prepareDeliveryDownload } from './deliveryDownload.js'
import { readTextCompletionQuery } from './textCompletionQuery.js'

export type FilmPreviewMode = 'full' | 'partial'

export type AssetLibraryTaskPreflight = (
  projectId: string,
  assetId: string,
  principal: Principal,
  expectedFaceReferenceId?: string,
) => Promise<void>

export type RigidAuditRunner = (input: {
  prompt: string
  video: Buffer
  observations: RigidPhysicsAuditRequest['observations']
}) => Promise<RawVideoFrameAudit>

export class GenerationService {
  constructor(
    private readonly repository: GenerationTaskRepository,
    private readonly dispatcher: TaskDispatcher,
    private readonly videoProvider: VideoGenerationProvider | null = null,
    private readonly videoProviderName: VideoProviderName = 'stringx-seedance',
    private readonly objectStorage: ObjectStorage | null = null,
    private readonly filmPreviewComposer: FilmPreviewDispatcher | null = null,
    private readonly textProvider: TextGenerationProvider | null = null,
    private readonly assetLibraryTaskPreflight: AssetLibraryTaskPreflight | null = null,
    private readonly rigidAuditRunner: RigidAuditRunner = auditRigidVideoBuffer,
  ) {}

  async createTask(
    input: CreateGenerationTask,
    principal: Principal,
    traceId?: string | null,
  ): Promise<GenerationTask> {
    if (!(await this.repository.canCreate(input.projectId, principal))) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权生成')
    }
    if (input.kind === 'video' && input.provider === 'seedance' && !this.videoProvider) {
      throw new AppError(503, 'SEEDANCE_NOT_CONFIGURED', '视频生成服务尚未配置，请配置后重试；本次未扣费')
    }
    if (input.kind === 'text' && input.provider === 'text' && !this.textProvider) {
      throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    }
    if (input.kind === 'text' && input.provider === 'text' && input.metadata?.episodePlan) {
      const parsed = generateScriptRequestSchema.safeParse({
        ...input.metadata,
        model: input.model ?? input.metadata.model,
      })
      if (!parsed.success || input.metadata.scriptOperation !== 'generate') {
        throw new AppError(400, 'INVALID_EPISODE_PLAN', '分集计划无效，请重新确认')
      }
      const key = createHash('sha256')
        .update(
          JSON.stringify([
            input.projectId,
            parsed.data.episodePlan,
            parsed.data.model,
            parsed.data.direction,
            parsed.data.episodeDurationSeconds,
          ]),
        )
        .digest('hex')
      const history = (await this.repository.listByProject(input.projectId, principal, true)).filter(
        (task) => task.userId === principal.userId && task.metadata.episodePlanKey === key,
      )
      const previous = history.sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )[0]
      if (previous && ['queued', 'paused', 'running', 'completed'].includes(previous.status)) return previous
      // Stable per-attempt request IDs also deduplicate simultaneous submissions under the repository lock.
      input = {
        ...input,
        clientRequestId: `episode-batch-${key}-${previous?.id || 'first'}`,
        estimatedCredits: 0,
        metadata: { ...input.metadata, episodePlanKey: key, billingMode: 'direct' },
      }
    }
    await this.preflightAssetLibraryTask(input, principal)
    const existingAssetSuggestionTask = await this.findExistingAssetSuggestionTask(input, principal)
    if (existingAssetSuggestionTask) return existingAssetSuggestionTask

    const taskInput = await this.snapshotStoryboardVideoTask(input, principal)
    const blockedPortraitNames = await this.repository.blockedPortraitNames(taskInput, principal)
    if (blockedPortraitNames.length) {
      throw new AppError(
        409,
        'TRUSTED_PORTRAIT_REQUIRED',
        `以下仿真人物需要先完成方舟资源入库或真人授权：${blockedPortraitNames.join('、')}`,
      )
    }
    const stringXPortraitNames = await this.repository.stringXPortraitNames(taskInput, principal)
    if (
      !['stringx-seedance', 'dora-router-seedance'].includes(this.videoProviderName) &&
      stringXPortraitNames.length
    ) {
      throw new AppError(
        409,
        'VIDEO_ASSET_PROVIDER_MISMATCH',
        `以下人物使用弦序 MaaS 素材，不能提交到当前视频 Provider：${stringXPortraitNames.join('、')}。请切换弦序视频 API 后再生成`,
      )
    }
    const task = await this.repository.createWithCharge(taskInput, principal, traceContext(traceId))
    if (task.status !== 'queued' || task.clientRequestId !== input.clientRequestId) return task
    await this.dispatcher.dispatch(task, { traceId: traceId ?? traceIdFromGenerationTask(task) })
    return task
  }

  private async preflightAssetLibraryTask(input: CreateGenerationTask, principal: Principal): Promise<void> {
    if (input.provider !== 'asset-library' || input.metadata?.trustedAssetOperation !== 'register-virtual') {
      return
    }
    const assetId = input.metadata.assetId
    if (typeof assetId !== 'string' || !assetId) {
      throw new AppError(400, 'CHARACTER_ASSET_REQUIRED', '人物资产 ID 缺失')
    }
    if (!this.assetLibraryTaskPreflight) {
      throw new AppError(503, 'ASSET_LIBRARY_NOT_READY', '人物素材资源预检服务尚未就绪')
    }
    const expectedFaceReferenceId = input.metadata.faceReferenceId
    if (typeof expectedFaceReferenceId === 'string') {
      await this.assetLibraryTaskPreflight(input.projectId, assetId, principal, expectedFaceReferenceId)
    } else {
      await this.assetLibraryTaskPreflight(input.projectId, assetId, principal)
    }
  }

  private async findExistingAssetSuggestionTask(
    input: CreateGenerationTask,
    principal: Principal,
  ): Promise<GenerationTask | null> {
    const cacheKey = assetSuggestionCacheKey(input)
    if (!cacheKey) return null
    const tasks = await this.repository.listByProject(input.projectId, principal)
    return (
      tasks.find((task) => {
        if (
          task.kind !== 'text' ||
          task.provider !== 'text' ||
          task.metadata?.scriptOperation !== 'suggest-assets' ||
          assetSuggestionCacheKey(task) !== cacheKey
        ) {
          return false
        }
        if (task.status === 'queued' || task.status === 'paused' || task.status === 'running') return true
        if (task.status !== 'completed') return false
        const result = task.metadata?.textResult
        return Boolean(
          result && typeof result === 'object' && Array.isArray((result as { assets?: unknown }).assets),
        )
      }) ?? null
    )
  }

  private async snapshotStoryboardVideoTask(
    input: CreateGenerationTask,
    principal: Principal,
  ): Promise<CreateGenerationTask> {
    if (
      input.kind !== 'video' ||
      input.provider !== 'seedance' ||
      typeof input.metadata?.shotId !== 'string'
    ) {
      return input
    }
    const context = await this.repository.storyboardVideoContext(input, principal)
    if (!context) throw new AppError(404, 'SHOT_NOT_FOUND', '分镜不存在或无权生成')
    const videoPreflight = inspectVideoPreflight(
      context.shot.prompt,
      context.assets.filter(
        (asset) =>
          Array.isArray(input.metadata?.referenceAssetIds) &&
          input.metadata.referenceAssetIds.includes(asset.id),
      ),
    )
    const conflicts = videoPreflight.issues.filter((issue) => issue.severity === 'error')
    if (conflicts.length)
      throw new AppError(
        409,
        'VIDEO_PROMPT_CONFLICT',
        `${conflicts.map((issue) => issue.message).join(' ')} 本次未扣费。`,
      )
    const referenceAssetIds = Array.isArray(input.metadata.referenceAssetIds)
      ? input.metadata.referenceAssetIds.filter((value): value is string => typeof value === 'string')
      : []
    trustedPortraitAliases(
      context.assets.filter((asset) => referenceAssetIds.includes(asset.id)),
      this.videoProviderName,
    )
    const continuityMode = input.metadata.continuityMode === 'continue' ? 'continue' : 'independent'
    const { images, manualReferenceImages, references } = storyboardReferences(
      context.shot,
      context.assets,
      referenceAssetIds,
      continuityMode === 'continue',
    )
    const hasContinuitySource =
      typeof input.metadata.continuitySourceTaskId === 'string' &&
      Boolean(input.metadata.continuitySourceTaskId)
    if ((continuityMode === 'continue') !== hasContinuitySource)
      throw new AppError(
        400,
        'INVALID_SHOT_CONTINUITY',
        '镜头衔接方式与尾帧来源不一致，请刷新分镜后重新提交。',
      )
    const compiledPrompt = compileStoryboardVideoPrompt({
      project: { ...context.project, visualStyle: context.project.visualStyle ?? 'cinematic-cg' },
      shot: context.shot,
      shots: context.shots,
      assets: context.assets,
      references,
      manualReferenceCount: manualReferenceImages.length,
      continuityMode,
    })
    const rigidPhysicsContract = deriveRigidPhysicsContract({
      shotId: context.shot.id,
      prompt: context.shot.prompt,
    })
    const sourceShotSnapshot = {
      id: context.shot.id,
      order: context.shot.order,
      title: context.shot.title,
      framing: context.shot.framing,
      duration: context.shot.duration,
      prompt: context.shot.prompt,
      negativePrompt: context.shot.negativePrompt,
      referenceImages: manualReferenceImages,
      continuityMode: context.shot.continuityMode,
      continuityNote: context.shot.continuityNote,
      episodeNumber: context.shot.episodeNumber,
      episodeBreakBefore: context.shot.episodeBreakBefore,
      updatedAt: context.shot.updatedAt,
    }
    return {
      ...input,
      prompt: compiledPrompt,
      negativePrompt: input.negativePrompt ?? context.shot.negativePrompt,
      metadata: {
        ...input.metadata,
        videoPreflight,
        sourceShotSnapshot,
        images,
        referenceBindingVersion: 'shot-asset-v1',
        assetReferenceBindings: references,
        manualReferenceImages,
        manualReferenceUrl: manualReferenceImages[0]?.url ?? null,
        sourcePromptSnapshot: context.shot.prompt,
        sourcePromptHash: promptHash(context.shot.prompt),
        sourceShotUpdatedAt: context.shot.updatedAt,
        compiledPrompt,
        compiledPromptHash: promptHash(compiledPrompt),
        videoPromptVersion: VIDEO_PROMPT_VERSION,
        sourceProjectVersion: context.project.version,
        ...(rigidPhysicsContract
          ? {
              rigidPhysicsContract,
              rigidPhysicsAudit: {
                status: 'pending-evidence',
                version: rigidPhysicsContract.version,
                checkedFrames: 0,
                violations: [],
              },
            }
          : {}),
      },
    }
  }

  listProjectTasks(projectId: string, principal: Principal): Promise<GenerationTask[]> {
    return this.repository.listByProject(projectId, principal)
  }

  async reviewVideo(taskId: string, input: ReviewVideo, principal: Principal): Promise<GenerationTask> {
    return this.repository.reviewVideo(taskId, input, principal)
  }

  async freezeDeliveryContract(
    taskId: string,
    input: DeliveryContractFreezeRequest,
    principal: Principal,
  ): Promise<GenerationTask> {
    return this.repository.freezeDeliveryContract(taskId, input.contract, input.expectedUpdatedAt, principal)
  }

  textCompletion(taskId: string, principal: Principal) {
    return readTextCompletionQuery(this.repository, taskId, principal)
  }

  async deliveryVerification(
    taskId: string,
    principal: Principal,
    signal?: AbortSignal,
  ): Promise<DeliveryVerificationSnapshot> {
    return (await readDeliveryQuery(this.repository, this.objectStorage, taskId, principal, signal)).snapshot
  }

  async deliveryGate(
    taskId: string,
    principal: Principal,
    signal?: AbortSignal,
  ): Promise<DeliveryGateResult> {
    const { task, snapshot, checkedAt } = await readDeliveryQuery(
      this.repository,
      this.objectStorage,
      taskId,
      principal,
      signal,
    )
    return evaluateDeliveryGate({ task, ...snapshot, verifiedAt: checkedAt })
  }
  prepareDeliveryDownload(
    taskId: string,
    input: DeliveryDownloadRequest,
    principal: Principal,
    signal?: AbortSignal,
  ) {
    return prepareDeliveryDownload(this.repository, this.objectStorage, taskId, input, principal, signal)
  }
  /** Audit one already completed video. This only reads existing media and updates audit metadata. */
  async auditRigidPhysics(
    taskId: string,
    input: RigidPhysicsAuditRequest,
    principal: Principal,
  ): Promise<GenerationTask> {
    const task = await this.repository.findById(taskId, principal)
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权验收')
    if (
      task.kind !== 'video' ||
      task.provider !== 'seedance' ||
      task.status !== 'completed' ||
      !task.resultUrl
    ) {
      throw new AppError(409, 'RIGID_AUDIT_NOT_REVIEWABLE', '只能验收已完成的 Seedance 视频版本')
    }
    const prompt =
      typeof task.metadata.sourcePromptSnapshot === 'string' && task.metadata.sourcePromptSnapshot.trim()
        ? task.metadata.sourcePromptSnapshot
        : task.prompt
    const contract =
      task.metadata.rigidPhysicsContract && typeof task.metadata.rigidPhysicsContract === 'object'
        ? task.metadata.rigidPhysicsContract
        : deriveRigidPhysicsContract({ prompt })
    if (!contract) throw new AppError(409, 'RIGID_AUDIT_UNAVAILABLE', '该视频没有刚性物体物理合同')
    const video = await this.readVideoBytesForRigidAudit(task)
    if (video.length > 100_000_000) {
      throw new AppError(413, 'RIGID_AUDIT_TOO_LARGE', '视频过大，暂不执行逐帧物理验收')
    }
    const raw = await this.rigidAuditRunner({ prompt, video, observations: input.observations })
    if (!raw.physics) throw new AppError(409, 'RIGID_AUDIT_UNAVAILABLE', '无法从该视频生成刚性物体合同')
    const auditedAt = new Date().toISOString()
    const result = rigidPhysicsAuditResultSchema.parse({
      status: raw.physics.status,
      checkedFrames: raw.physics.checkedFrames,
      cameraCuts: raw.physics.cameraCuts,
      violations: raw.physics.violations,
      metrics: raw.physics.metrics,
      version:
        typeof (contract as { version?: unknown }).version === 'string'
          ? (contract as { version: string }).version
          : 'rigid-physics-v1',
      mediaVersion: videoReviewVersion(task),
      auditedAt,
      auditedBy: principal.userId,
      evidence: {
        source: input.observations.length ? 'submitted-observations' : 'video-frames',
        observationCount: raw.observationCount,
        completeFrameCoverage: raw.completeFrameCoverage,
        objects: raw.physics.evidence,
      },
    })
    return this.repository.persistRigidPhysicsAudit(
      taskId,
      result,
      input.expectedUpdatedAt,
      principal,
      contract,
    )
  }

  private async readVideoBytesForRigidAudit(task: GenerationTask): Promise<Buffer> {
    const descriptor = Array.isArray(task.metadata.generatedOutputs)
      ? task.metadata.generatedOutputs.find(
          (item) =>
            item &&
            typeof item === 'object' &&
            (item as { view?: unknown }).view === 'single' &&
            typeof (item as { storageKey?: unknown }).storageKey === 'string' &&
            typeof (item as { contentType?: unknown }).contentType === 'string' &&
            String((item as { contentType: string }).contentType).startsWith('video/'),
        )
      : null
    if (descriptor && this.objectStorage) {
      return this.objectStorage.get((descriptor as { storageKey: string }).storageKey)
    }
    const providerTaskId = task.metadata.providerTaskId
    if (!this.videoProvider || typeof providerTaskId !== 'string' || !providerTaskId) {
      throw new AppError(503, 'VIDEO_STORAGE_UNAVAILABLE', '视频内容不可读取，无法执行物理验收')
    }
    try {
      const content = await this.videoProvider.getContent(providerTaskId)
      const chunks: Buffer[] = []
      for await (const chunk of content.stream as AsyncIterable<Uint8Array | string>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      return Buffer.concat(chunks)
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频读取失败'
      throw new AppError(502, 'RIGID_AUDIT_VIDEO_READ_FAILED', message)
    }
  }

  listProjectTaskPolling(projectId: string, principal: Principal): Promise<GenerationTaskPolling[]> {
    return this.repository.listPollingByProject(projectId, principal)
  }

  pollingVersion(projectId: string, principal: Principal): Promise<string> {
    return this.repository.pollingVersion(projectId, principal)
  }

  listRecentTasks(principal: Principal): Promise<GenerationTask[]> {
    return this.repository.listRecent(principal)
  }

  clearCompleted(projectId: string, principal: Principal): Promise<number> {
    return this.repository.clearCompleted(projectId, principal)
  }

  async createFilmPreview(
    projectId: string,
    principal: Principal,
    mode: FilmPreviewMode = 'full',
    force = false,
    episodeNumber: number | null = null,
    traceId?: string | null,
  ): Promise<GenerationTask> {
    if (!(await this.repository.canCreate(projectId, principal))) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权生成')
    }
    if (!this.filmPreviewComposer) {
      throw new AppError(503, 'FILM_PREVIEW_UNAVAILABLE', '完整预览合成服务尚未配置')
    }
    const plan = await this.repository.filmPreviewPlan(projectId, principal, episodeNumber)
    if (!plan || !plan.shots.length) throw new AppError(400, 'SHOTS_REQUIRED', '项目还没有可合成的分镜')
    const missing = plan.sources.filter((source) => !source.task).map((source) => source.shot.title)
    if (mode === 'full' && missing.length) {
      throw new AppError(409, 'SHOT_VIDEOS_INCOMPLETE', `以下镜头尚未完成视频：${missing.join('、')}`)
    }
    const firstMissingIndex = plan.sources.findIndex((source) => !source.task)
    const selectedSources =
      mode === 'partial'
        ? plan.sources.slice(0, firstMissingIndex < 0 ? plan.sources.length : firstMissingIndex)
        : plan.sources
    if (!selectedSources.length) {
      throw new AppError(409, 'SHOT_VIDEOS_INCOMPLETE', '至少需要第一个镜头视频完成后才能合成片段预览')
    }
    const selectedShots = selectedSources.map((source) => source.shot)
    const sourceTasks = selectedSources.map((source) => source.task!)
    const sourceVideoTaskIds = sourceTasks.map((task) => task.id)
    const projectTasks = await this.repository.listByProject(projectId, principal)
    const active = projectTasks.find(
      (task) =>
        task.provider === 'local-compose' &&
        task.metadata.generationStage === 'film-preview' &&
        sameEpisodeScope(task.metadata.episodeNumber, episodeNumber) &&
        (task.status === 'queued' || task.status === 'running' || task.status === 'paused'),
    )
    // A compose can be expensive and streams every source clip. Never start another compose for
    // the same project scope while one is active, even if a shot version changed in the meantime.
    if (active) return active

    const existing = projectTasks.find(
      (task) =>
        task.provider === 'local-compose' &&
        task.metadata.generationStage === 'film-preview' &&
        (mode === 'partial'
          ? task.metadata.previewMode === 'partial'
          : task.metadata.previewMode !== 'partial') &&
        sameStringArray(task.metadata.sourceVideoTaskIds, sourceVideoTaskIds) &&
        task.status !== 'cancelled',
    )
    // Automatic completion callbacks are idempotent even after a failed compose. An explicit
    // user retry may replace a terminal result, but never duplicates an active composition.
    if (existing && (!force || existing.status === 'queued' || existing.status === 'running')) return existing

    const task = await this.repository.create(
      {
        clientRequestId: `film-preview-${randomUUID()}`,
        projectId,
        kind: 'video',
        label:
          mode === 'partial'
            ? `${plan.project.name} · ${episodeNumber ? `第 ${episodeNumber} 集 · ` : ''}前 ${selectedShots.length} 镜片段预览`
            : `${plan.project.name} · ${episodeNumber ? `第 ${episodeNumber} 集` : '全部剧集'}成片预览`,
        prompt: '',
        provider: 'local-compose',
        estimatedCredits: 0,
        metadata: {
          generationStage: 'film-preview',
          previewMode: mode,
          renderQuality: '1080p',
          aspectRatio: plan.project.aspectRatio,
          sourceVideoTaskIds,
          sourceShotIds: selectedShots.map((shot) => shot.id),
          sourceShotCount: selectedShots.length,
          totalShotCount: plan.shots.length,
          duration: selectedShots.reduce((total, shot) => total + shot.duration, 0),
          providerState: 'queued',
          episodeNumber,
          episodeNumbers: [...new Set(selectedShots.map((shot) => shot.episodeNumber))],
          projectVersion: plan.project.version,
        },
      },
      principal,
      traceContext(traceId),
    )
    return this.filmPreviewComposer.start(task)
  }

  async pauseTask(taskId: string, principal: Principal): Promise<GenerationTask> {
    const result = await this.repository.pause(taskId, principal)
    if (!result.task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权操作')
    if (result.outcome === 'not_pausable') {
      throw new AppError(409, 'TASK_NOT_PAUSABLE', '只有等待中的任务可以暂停，第三方生成中不能暂停')
    }
    return result.task
  }

  async stopRunningTask(taskId: string, principal: Principal): Promise<GenerationTask> {
    const result = await this.repository.stopRunningWithoutRefund(taskId, principal)
    if (!result.task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权操作')
    if (result.outcome === 'not_running') {
      throw new AppError(409, 'TASK_NOT_RUNNING', '只有生成中的任务可以执行停止操作')
    }
    return result.task
  }

  async resumeTask(taskId: string, principal: Principal, traceId?: string | null): Promise<GenerationTask> {
    const result = await this.repository.resume(taskId, principal)
    if (!result.task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权操作')
    if (result.outcome === 'not_resumable') {
      throw new AppError(409, 'TASK_NOT_RESUMABLE', '只有已暂停且仍在队列中的任务可以继续')
    }
    await this.dispatcher.dispatch(result.task, {
      traceId: traceId ?? traceIdFromGenerationTask(result.task),
    })
    return result.task
  }

  async deleteTask(taskId: string, principal: Principal): Promise<void> {
    const result = await this.repository.deleteFromQueue(taskId, principal)
    if (!result.task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权操作')
    if (result.outcome === 'not_deletable') {
      throw new AppError(409, 'TASK_NOT_DELETABLE', '第三方生成中的任务不能暂停或删除，请等待任务结束')
    }
  }

  async getVideoContent(taskId: string, principal: Principal, range?: string, downloadFileName?: string) {
    const task = await this.repository.findById(taskId, principal)
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权访问')
    if (task.kind !== 'video') {
      throw new AppError(400, 'VIDEO_CONTENT_UNAVAILABLE', '该任务没有视频内容')
    }
    if (task.provider === 'local-compose') {
      if (task.status !== 'completed' || !this.objectStorage) {
        throw new AppError(409, 'VIDEO_NOT_READY', '完整预览尚未合成完成')
      }
      const storageKey = task.metadata.previewStorageKey
      if (typeof storageKey !== 'string') {
        throw new AppError(404, 'VIDEO_CONTENT_UNAVAILABLE', '完整预览文件不存在')
      }
      return await this.videoStorageContent(storageKey, range, downloadFileName)
    }
    if (task.provider !== 'seedance') {
      throw new AppError(400, 'VIDEO_CONTENT_UNAVAILABLE', '该任务没有可播放的视频内容')
    }
    const cachedVideo = Array.isArray(task.metadata.generatedOutputs)
      ? task.metadata.generatedOutputs.find(
          (item) =>
            item &&
            typeof item === 'object' &&
            (item as { view?: unknown }).view === 'single' &&
            typeof (item as { storageKey?: unknown }).storageKey === 'string' &&
            typeof (item as { contentType?: unknown }).contentType === 'string' &&
            String((item as { contentType: string }).contentType).startsWith('video/'),
        )
      : null
    if (cachedVideo && this.objectStorage) {
      return await this.videoStorageContent(
        (cachedVideo as { storageKey: string }).storageKey,
        range,
        downloadFileName,
      )
    }
    if (!this.videoProvider) {
      throw new AppError(503, 'SEEDANCE_NOT_CONFIGURED', 'Seedance 服务尚未配置')
    }
    const providerTaskId = task.metadata.providerTaskId
    if (task.status !== 'completed' || typeof providerTaskId !== 'string') {
      throw new AppError(409, 'VIDEO_NOT_READY', '视频尚未生成完成')
    }
    if (
      typeof task.metadata.providerName === 'string' &&
      task.metadata.providerName !== this.videoProviderName
    ) {
      throw new AppError(
        409,
        'VIDEO_PROVIDER_MISMATCH',
        '该视频由其他 Provider 生成，请切回对应视频 Provider 后读取',
      )
    }
    try {
      return await this.videoProvider.getContent(providerTaskId, range)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Seedance 视频读取失败'
      throw new AppError(502, 'SEEDANCE_CONTENT_ERROR', message)
    }
  }

  async getImageOutput(taskId: string, view: string, principal: Principal) {
    const task = await this.repository.findById(taskId, principal)
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权访问')
    if (
      (task.kind !== 'image' && !(task.kind === 'video' && view === 'last-frame')) ||
      task.status !== 'completed' ||
      !this.objectStorage
    ) {
      throw new AppError(409, 'IMAGE_NOT_READY', '图片尚未生成完成')
    }
    const descriptors = Array.isArray(task.metadata.generatedOutputs) ? task.metadata.generatedOutputs : []
    const descriptor = descriptors.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        (item as { view?: unknown }).view === view &&
        typeof (item as { storageKey?: unknown }).storageKey === 'string' &&
        typeof (item as { contentType?: unknown }).contentType === 'string',
    ) as { storageKey: string; contentType: string } | undefined
    if (!descriptor) throw new AppError(404, 'IMAGE_OUTPUT_NOT_FOUND', '图片输出不存在')
    return {
      content: await this.objectStorage.get(descriptor.storageKey),
      contentType: descriptor.contentType,
    }
  }

  private async videoStorageContent(storageKey: string, range?: string, downloadFileName?: string) {
    const storage = this.objectStorage
    if (!storage) throw new AppError(503, 'VIDEO_STORAGE_UNAVAILABLE', '视频存储尚未配置')
    const signedUrl = await signedStorageUrl(storage, storageKey, downloadFileName)
    if (signedUrl) return { redirectUrl: signedUrl, contentType: 'video/mp4' as const }

    if (storage.getStream) {
      const full = await storage.getStream(storageKey)
      const parsed = parseByteRange(range, full.size)
      if (!parsed) {
        return streamVideoContent(full, null)
      }
      full.stream.destroy()
      const partial = await storage.getStream(storageKey, parsed)
      return streamVideoContent(partial, parsed)
    }

    return bufferVideoContent(await storage.get(storageKey), range)
  }
}

function assetSuggestionCacheKey(input: CreateGenerationTask | GenerationTask): string | null {
  const metadata = input.metadata ?? {}
  const fingerprint = metadata.sourceScriptFingerprint
  const assetRevision = metadata.assetRevision
  if (
    typeof fingerprint !== 'string' ||
    !fingerprint ||
    typeof assetRevision !== 'string' ||
    !assetRevision
  ) {
    return null
  }
  const direction = metadata.direction
  const directionKey =
    direction && typeof direction === 'object'
      ? JSON.stringify({
          style: (direction as Record<string, unknown>).style ?? 'auto',
          composition: (direction as Record<string, unknown>).composition ?? 'auto',
          lighting: (direction as Record<string, unknown>).lighting ?? 'auto',
          camera: (direction as Record<string, unknown>).camera ?? 'auto',
          focus: (direction as Record<string, unknown>).focus ?? 'balanced',
        })
      : '{}'
  return JSON.stringify([fingerprint, assetRevision, input.model ?? metadata.model ?? '', directionKey])
}

function promptHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function sameStringArray(value: unknown, expected: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  )
}

function sameEpisodeScope(value: unknown, expected: number | null): boolean {
  if (expected === null) return value === null || value === undefined
  return Number(value) === expected
}

function bufferVideoContent(content: Buffer, range?: string) {
  const parsed = parseByteRange(range, content.length)
  if (!parsed) {
    return {
      stream: Readable.from(content),
      contentType: 'video/mp4',
      contentLength: String(content.length),
      statusCode: 200,
      acceptRanges: 'bytes',
      contentRange: null,
    }
  }
  const selected = content.subarray(parsed.start, parsed.end + 1)
  return {
    stream: Readable.from(selected),
    contentType: 'video/mp4',
    contentLength: String(selected.length),
    statusCode: 206,
    acceptRanges: 'bytes',
    contentRange: `bytes ${parsed.start}-${parsed.end}/${content.length}`,
  }
}

function streamVideoContent(content: ObjectStorageStream, range: { start: number; end: number } | null) {
  const selectedLength = range ? range.end - range.start + 1 : content.size
  return {
    stream: content.stream,
    contentType: 'video/mp4',
    contentLength: String(selectedLength),
    statusCode: range ? 206 : 200,
    acceptRanges: 'bytes',
    contentRange: range ? `bytes ${range.start}-${range.end}/${content.size}` : null,
  }
}

async function signedStorageUrl(
  storage: ObjectStorage | null,
  storageKey: string,
  downloadFileName?: string,
): Promise<string | null> {
  if (!storage?.getSignedUrl) return null
  try {
    return await storage.getSignedUrl(storageKey, undefined, downloadFileName ? { downloadFileName } : {})
  } catch {
    return null
  }
}

function parseByteRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    const suffix = Math.min(size, Number(match[2]))
    return Number.isFinite(suffix) && suffix > 0 ? { start: size - suffix, end: size - 1 } : null
  }
  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size) return null
  return { start, end: Math.min(size - 1, Math.max(start, requestedEnd)) }
}
