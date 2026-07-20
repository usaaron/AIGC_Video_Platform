import type { GenerationTask } from '@seqora/contracts'
import type { AudioGenerationProvider } from '../generation/audioProvider.js'
import type { FilmExporter } from '../generation/filmExporter.js'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { logError, logInfo } from '../logging.js'
import type { StateStore } from '../../infra/store.js'
import { GeneratedAssetWriter } from './generatedAssetWriter.js'
import { MediaReferenceResolver } from './mediaReferenceResolver.js'
import {
  AUDIO_PROVIDER_NAME,
  IMG2_PROVIDER_NAME,
  REMOTE_PROVIDER_NAMES,
  SEEDANCE_PROVIDER_NAME,
} from './providerMetadata.js'
import { RemoteTaskRunner } from './remoteTaskRunner.js'
import { addGeneratedMedia, completeTaskWithOutputs } from './taskCompletionWriter.js'
import { localOutputsFor, messageFor } from './taskRequestFactory.js'

export interface TaskDispatcher {
  dispatch(task: GenerationTask): Promise<void>
}

export class NoopTaskDispatcher implements TaskDispatcher {
  async dispatch(_task: GenerationTask): Promise<void> {
    // Local API processes can create tasks without executing them.
  }
}

const FILM_EXPORT_PROVIDER_NAME = 'film-export'
const MANAGED_PROVIDER_NAMES = new Set([...REMOTE_PROVIDER_NAMES, FILM_EXPORT_PROVIDER_NAME])

export class GenerationTaskRunner implements TaskDispatcher {
  private timer: NodeJS.Timeout | null = null
  private tickPromise: Promise<void> | null = null
  private readonly remoteTasks: RemoteTaskRunner

  constructor(
    private readonly store: StateStore,
    videoProvider: VideoGenerationProvider | null = null,
    imageProvider: ImageGenerationProvider | null = null,
    providerPollIntervalMs = 5_000,
    generatedAssetWriter: GeneratedAssetWriter | null = null,
    mediaReferenceResolver: MediaReferenceResolver | null = null,
    audioProvider: AudioGenerationProvider | null = null,
    private readonly filmExporter: FilmExporter | null = null,
  ) {
    this.remoteTasks = new RemoteTaskRunner(
      store,
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
    const hasActiveTasks = await this.store.read((state) =>
      state.tasks.some((task) => task.status === 'queued' || task.status === 'running'),
    )
    if (!hasActiveTasks) return

    const remoteTasks = await this.store.mutate((state) => {
      const now = new Date().toISOString()
      const selectedVideoTasks: GenerationTask[] = []
      const selectedImageTasks: GenerationTask[] = []
      const selectedAudioTasks: GenerationTask[] = []
      const selectedFilmExportTasks: GenerationTask[] = []

      state.tasks
        .filter(
          (task) =>
            task.status === 'running' &&
            REMOTE_PROVIDER_NAMES.has(stringValue(task.metadata.providerName, '')) &&
            task.metadata.providerState === 'submitting' &&
            !task.metadata.providerTaskId,
        )
        .forEach((task) => {
          task.status = 'failed'
          task.progress = 100
          task.error = '杩滅▼鐢熸垚鎻愪氦杩囩▼琚腑鏂紝璇烽噸璇曟浠诲姟'
          task.updatedAt = now
        })

      for (const user of state.users) {
        const userTasks = state.tasks.filter((task) => task.userId === user.id)
        const running = userTasks.filter((task) => task.status === 'running')
        const available = Math.max(0, (user.plan === 'member' ? 3 : 1) - running.length)
        userTasks
          .filter((task) => task.status === 'queued')
          .slice(0, available)
          .forEach((task) => {
            task.status = 'running'
            task.progress = this.remoteTasks.usesRemoteProvider(task) ? 1 : 8
            task.updatedAt = now
            if (this.remoteTasks.usesRemoteVideoProvider(task)) {
              task.metadata = {
                ...task.metadata,
                providerName: SEEDANCE_PROVIDER_NAME,
                providerState: 'submitting',
              }
              selectedVideoTasks.push(task)
            }
            if (this.remoteTasks.usesRemoteImageProvider(task)) {
              task.metadata = {
                ...task.metadata,
                providerName: IMG2_PROVIDER_NAME,
                providerState: 'submitting',
              }
              selectedImageTasks.push(task)
            }
            if (this.remoteTasks.usesRemoteAudioProvider(task)) {
              task.metadata = {
                ...task.metadata,
                providerName: AUDIO_PROVIDER_NAME,
                providerState: 'submitting',
              }
              selectedAudioTasks.push(task)
            }
            if (this.usesFilmExportProvider(task)) {
              task.progress = 1
              task.metadata = {
                ...task.metadata,
                providerName: FILM_EXPORT_PROVIDER_NAME,
                providerState: 'exporting',
              }
              selectedFilmExportTasks.push(task)
            }
          })
      }

      return {
        video: selectedVideoTasks,
        image: selectedImageTasks,
        audio: selectedAudioTasks,
        film: selectedFilmExportTasks,
      }
    })

    for (const task of remoteTasks.video) await this.remoteTasks.submitVideo(task)
    for (const task of remoteTasks.image) await this.remoteTasks.submitImage(task)
    for (const task of remoteTasks.audio) await this.remoteTasks.submitAudio(task)
    for (const task of remoteTasks.film) await this.exportFilm(task)

    await this.store.mutate((state) => {
      const now = new Date().toISOString()
      state.tasks
        .filter(
          (task) =>
            task.status === 'running' &&
            !MANAGED_PROVIDER_NAMES.has(stringValue(task.metadata.providerName, '')),
        )
        .forEach((task) => {
          task.progress = Math.min(100, task.progress + 12)
          task.updatedAt = now
          if (task.progress >= 100) {
            completeTaskWithOutputs(state, task, localOutputsFor(task), now)
          }
        })
    })

    await this.remoteTasks.pollVideos()
    await this.remoteTasks.pollImages()
    await this.remoteTasks.pollAudios()
  }

  private usesFilmExportProvider(task: GenerationTask): boolean {
    return Boolean(this.filmExporter) && task.kind === 'video' && task.provider === FILM_EXPORT_PROVIDER_NAME
  }

  private async exportFilm(task: GenerationTask): Promise<void> {
    try {
      if (!(await this.isTaskStillRunning(task.id))) return
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (!stored || stored.status !== 'running') return
        stored.progress = Math.max(5, stored.progress)
        stored.updatedAt = new Date().toISOString()
      })
      const materialized = await this.filmExporter!.export(task)
      logInfo('film_export.completed', { taskId: task.id, outputs: materialized.outputs.length })
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (!stored || stored.status !== 'running') return
        addGeneratedMedia(state, materialized.media)
        stored.metadata = { ...stored.metadata, providerState: 'completed' }
        completeTaskWithOutputs(state, stored, materialized.outputs, new Date().toISOString())
      })
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  private async failTask(taskId: string, error: string): Promise<void> {
    logError('generation_task.failed', { taskId, message: error })
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return
      task.status = 'failed'
      task.progress = 100
      task.error = error.slice(0, 1_000)
      task.updatedAt = new Date().toISOString()
    })
  }

  private async isTaskStillRunning(taskId: string): Promise<boolean> {
    return this.store.read((state) =>
      state.tasks.some((task) => task.id === taskId && task.status === 'running'),
    )
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}
