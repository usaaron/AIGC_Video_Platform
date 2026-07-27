import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { FilmPreviewDispatcher } from '../../core/film/filmPreviewComposer.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { VideoGenerationProvider } from '../../core/generation/videoProvider.js'
import type { VideoProviderName } from '../../core/generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppError } from '../../core/errors.js'
import type { GenerationTaskRepository } from './repository.js'

export type FilmPreviewMode = 'full' | 'partial'

export class GenerationService {
  constructor(
    private readonly repository: GenerationTaskRepository,
    private readonly dispatcher: TaskDispatcher,
    private readonly videoProvider: VideoGenerationProvider | null = null,
    private readonly videoProviderName: VideoProviderName = 'stringx-seedance',
    private readonly objectStorage: ObjectStorage | null = null,
    private readonly filmPreviewComposer: FilmPreviewDispatcher | null = null,
  ) {}

  async createTask(input: CreateGenerationTask, principal: Principal): Promise<GenerationTask> {
    if (!this.repository.canCreate(input.projectId, principal)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权生成')
    }
    const blockedPortraitNames = this.repository.blockedPortraitNames(input, principal)
    if (blockedPortraitNames.length) {
      throw new AppError(
        409,
        'TRUSTED_PORTRAIT_REQUIRED',
        `以下仿真人物需要先完成方舟资源入库或真人授权：${blockedPortraitNames.join('、')}`,
      )
    }
    const stringXPortraitNames = this.repository.stringXPortraitNames(input, principal)
    if (this.videoProviderName !== 'stringx-seedance' && stringXPortraitNames.length) {
      throw new AppError(
        409,
        'VIDEO_ASSET_PROVIDER_MISMATCH',
        `以下人物使用弦序 MaaS 素材，不能提交到当前视频 Provider：${stringXPortraitNames.join('、')}。请切换弦序视频 API 后再生成`,
      )
    }
    const task = await this.repository.createWithCharge(input, principal)
    await this.dispatcher.dispatch(task)
    return task
  }

  listProjectTasks(projectId: string, principal: Principal): Promise<GenerationTask[]> {
    return Promise.resolve(this.repository.listByProject(projectId, principal))
  }

  listRecentTasks(principal: Principal): Promise<GenerationTask[]> {
    return Promise.resolve(this.repository.listRecent(principal))
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
  ): Promise<GenerationTask> {
    if (!this.repository.canCreate(projectId, principal)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权生成')
    }
    if (!this.filmPreviewComposer) {
      throw new AppError(503, 'FILM_PREVIEW_UNAVAILABLE', '完整预览合成服务尚未配置')
    }
    const plan = this.repository.filmPreviewPlan(projectId, principal, episodeNumber)
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
    const existing = this.repository
      .listByProject(projectId, principal)
      .find(
        (task) =>
          task.provider === 'local-compose' &&
          task.metadata.generationStage === 'film-preview' &&
          (mode === 'partial'
            ? task.metadata.previewMode === 'partial'
            : task.metadata.previewMode !== 'partial') &&
          sameStringArray(task.metadata.sourceVideoTaskIds, sourceVideoTaskIds) &&
          (task.status === 'queued' || task.status === 'running' || task.status === 'completed'),
      )
    if (existing && !force) return existing

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

  async resumeTask(taskId: string, principal: Principal): Promise<GenerationTask> {
    const result = await this.repository.resume(taskId, principal)
    if (!result.task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权操作')
    if (result.outcome === 'not_resumable') {
      throw new AppError(409, 'TASK_NOT_RESUMABLE', '只有已暂停且仍在队列中的任务可以继续')
    }
    await this.dispatcher.dispatch(result.task)
    return result.task
  }

  async deleteTask(taskId: string, principal: Principal): Promise<void> {
    const result = await this.repository.deleteFromQueue(taskId, principal)
    if (!result.task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权操作')
    if (result.outcome === 'not_deletable') {
      throw new AppError(409, 'TASK_NOT_DELETABLE', '第三方生成中的任务不能暂停或删除，请等待任务结束')
    }
  }

  async getVideoContent(taskId: string, principal: Principal, range?: string) {
    const task = this.repository.findById(taskId, principal)
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
      return bufferVideoContent(await this.objectStorage.get(storageKey), range)
    }
    if (task.provider !== 'seedance') {
      throw new AppError(400, 'VIDEO_CONTENT_UNAVAILABLE', '该任务没有可播放的视频内容')
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
    const task = this.repository.findById(taskId, principal)
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
}

function sameStringArray(value: unknown, expected: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  )
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
