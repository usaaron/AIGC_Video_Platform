import type { GenerationTask } from '@seqora/contracts'
import type { AudioGenerationProvider } from '../generation/audioProvider.js'
import type { FilmExporter } from '../generation/filmExporter.js'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { logError, logInfo } from '../logging.js'
import type { StateStore } from '../../infra/store.js'
import { GeneratedAssetWriter } from './generatedAssetWriter.js'
import { MediaReferenceResolver } from './mediaReferenceResolver.js'
import { RemoteTaskRunner } from './remoteTaskRunner.js'
import { messageFor } from './taskRequestFactory.js'
import { StoreTaskRuntimeStore, type TaskRuntimeStore } from './taskRuntimeStore.js'

export interface TaskDispatcher {
  dispatch(task: GenerationTask): Promise<void>
  ping?(): Promise<void>
}

export class NoopTaskDispatcher implements TaskDispatcher {
  async dispatch(_task: GenerationTask): Promise<void> {
    // Local API processes can create tasks without executing them.
  }

  async ping(): Promise<void> {
    // Inline/local mode has no external queue dependency.
  }
}

export class GenerationTaskRunner implements TaskDispatcher {
  private timer: NodeJS.Timeout | null = null
  private tickPromise: Promise<void> | null = null
  private readonly remoteTasks: RemoteTaskRunner
  private readonly taskRuntimeStore: TaskRuntimeStore

  constructor(
    store: StateStore,
    videoProvider: VideoGenerationProvider | null = null,
    imageProvider: ImageGenerationProvider | null = null,
    providerPollIntervalMs = 5_000,
    generatedAssetWriter: GeneratedAssetWriter | null = null,
    mediaReferenceResolver: MediaReferenceResolver | null = null,
    audioProvider: AudioGenerationProvider | null = null,
    private readonly filmExporter: FilmExporter | null = null,
    taskRuntimeStore: TaskRuntimeStore | null = null,
  ) {
    this.taskRuntimeStore = taskRuntimeStore ?? new StoreTaskRuntimeStore(store)
    this.remoteTasks = new RemoteTaskRunner(
      this.taskRuntimeStore,
      videoProvider,
      imageProvider,
      providerPollIntervalMs,
      generatedAssetWriter,
      mediaReferenceResolver,
      audioProvider,
    )
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
    await this.tick()
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
    const hasActiveTasks = await this.taskRuntimeStore.hasActiveTasks()
    if (!hasActiveTasks) return

    const remoteTasks = await this.taskRuntimeStore.claimQueuedTasks(
      this.remoteTasks,
      Boolean(this.filmExporter),
    )

    for (const task of remoteTasks.video) await this.remoteTasks.submitVideo(task)
    for (const task of remoteTasks.image) await this.remoteTasks.submitImage(task)
    for (const task of remoteTasks.audio) await this.remoteTasks.submitAudio(task)
    for (const task of remoteTasks.film) await this.exportFilm(task)

    await this.taskRuntimeStore.advanceLocalTasks()

    await this.remoteTasks.pollVideos()
    await this.remoteTasks.pollImages()
    await this.remoteTasks.pollAudios()
  }

  private async exportFilm(task: GenerationTask): Promise<void> {
    try {
      if (!(await this.isTaskStillRunning(task.id))) return
      await this.taskRuntimeStore.markFilmExportStarted(task.id)
      const materialized = await this.filmExporter!.export(task)
      logInfo('film_export.completed', { taskId: task.id, outputs: materialized.outputs.length })
      await this.taskRuntimeStore.completeFilmExport(task.id, materialized)
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  private async failTask(taskId: string, error: string): Promise<void> {
    logError('generation_task.failed', { taskId, message: error })
    await this.taskRuntimeStore.failTask(taskId, error)
  }

  private async isTaskStillRunning(taskId: string): Promise<boolean> {
    return this.taskRuntimeStore.isTaskRunning(taskId)
  }
}
