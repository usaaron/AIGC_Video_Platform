import type { GenerationTask } from '@seqora/contracts'
import type { AudioGenerationProvider } from '../generation/audioProvider.js'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import type { StateStore } from '../../infra/store.js'
import { GeneratedAssetWriter, type MaterializedGenerationOutputs } from './generatedAssetWriter.js'
import { MediaReferenceResolver } from './mediaReferenceResolver.js'
import {
  AUDIO_PROVIDER_NAME,
  IMG2_PROVIDER_NAME,
  numberValue,
  SEEDANCE_PROVIDER_NAME,
} from './providerMetadata.js'
import { addGeneratedMedia, completeTaskWithOutputs } from './taskCompletionWriter.js'
import { audioRequestFor, imageRequestFor, messageFor, videoRequestFor } from './taskRequestFactory.js'

export class RemoteTaskRunner {
  constructor(
    private readonly store: StateStore,
    private readonly videoProvider: VideoGenerationProvider | null,
    private readonly imageProvider: ImageGenerationProvider | null,
    private readonly providerPollIntervalMs: number,
    private readonly generatedAssetWriter: GeneratedAssetWriter | null,
    private readonly mediaReferenceResolver: MediaReferenceResolver | null,
    private readonly audioProvider: AudioGenerationProvider | null,
  ) {}

  usesRemoteProvider(task: GenerationTask): boolean {
    return (
      this.usesRemoteVideoProvider(task) ||
      this.usesRemoteImageProvider(task) ||
      this.usesRemoteAudioProvider(task)
    )
  }

  usesRemoteVideoProvider(task: GenerationTask): boolean {
    return Boolean(this.videoProvider) && task.kind === 'video' && task.provider === 'seedance'
  }

  usesRemoteImageProvider(task: GenerationTask): boolean {
    return Boolean(this.imageProvider) && task.kind === 'image' && task.provider === 'img2'
  }

  usesRemoteAudioProvider(task: GenerationTask): boolean {
    return Boolean(this.audioProvider) && task.kind === 'audio' && task.provider === 'audio'
  }

  async submitVideo(task: GenerationTask): Promise<void> {
    try {
      const submission = await this.videoProvider!.submit(await this.videoRequestForProvider(task))
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (!stored || stored.status !== 'running') return
        stored.progress = Math.max(1, submission.progress)
        stored.metadata = {
          ...stored.metadata,
          providerState: submission.status,
          providerTaskId: submission.providerTaskId,
          providerPolledAt: Date.now(),
          providerPollErrors: 0,
        }
        stored.updatedAt = new Date().toISOString()
      })
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  async submitImage(task: GenerationTask): Promise<void> {
    try {
      const submission = await this.imageProvider!.submit(await this.imageRequestForProvider(task))
      const materialized =
        submission.status === 'completed'
          ? await this.materializeRemoteOutputs(task, submission.outputs)
          : null
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (!stored || stored.status !== 'running') return
        stored.progress = Math.max(1, submission.progress)
        stored.metadata = {
          ...stored.metadata,
          providerState: submission.status,
          providerTaskId: submission.providerTaskId,
          providerPolledAt: Date.now(),
          providerPollErrors: 0,
        }
        stored.updatedAt = new Date().toISOString()
        if (submission.status === 'completed' && materialized) {
          addGeneratedMedia(state, materialized.media)
          completeTaskWithOutputs(state, stored, materialized.outputs, stored.updatedAt)
        }
      })
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  async submitAudio(task: GenerationTask): Promise<void> {
    try {
      const submission = await this.audioProvider!.submit(this.audioRequestForProvider(task))
      const materialized =
        submission.status === 'completed'
          ? await this.materializeRemoteOutputs(task, submission.outputs)
          : null
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (!stored || stored.status !== 'running') return
        stored.progress = Math.max(1, submission.progress)
        stored.metadata = {
          ...stored.metadata,
          providerState: submission.status,
          providerTaskId: submission.providerTaskId,
          providerPolledAt: Date.now(),
          providerPollErrors: 0,
        }
        stored.updatedAt = new Date().toISOString()
        if (submission.status === 'completed' && materialized) {
          addGeneratedMedia(state, materialized.media)
          completeTaskWithOutputs(state, stored, materialized.outputs, stored.updatedAt)
        }
      })
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  async pollVideos(): Promise<void> {
    if (!this.videoProvider) return
    const now = Date.now()
    const tasks = await this.providerTasksDueForPoll(SEEDANCE_PROVIDER_NAME, now)

    for (const task of tasks) {
      const providerTaskId = String(task.metadata.providerTaskId)
      await this.markPolled(task.id, now)
      try {
        const status = await this.videoProvider.getStatus(providerTaskId)
        const materialized =
          status.status === 'completed' ? await this.materializeRemoteVideo(task, providerTaskId) : null
        await this.store.mutate((state) => {
          const stored = state.tasks.find((item) => item.id === task.id)
          if (!stored || stored.status !== 'running') return
          stored.status = status.status
          stored.progress = status.progress
          stored.error = status.error
          stored.metadata = { ...stored.metadata, providerState: status.status, providerPollErrors: 0 }
          stored.updatedAt = new Date().toISOString()
          if (status.status === 'completed' && materialized) {
            addGeneratedMedia(state, materialized.media)
            completeTaskWithOutputs(state, stored, materialized.outputs, stored.updatedAt)
          }
        })
      } catch (error) {
        await this.recordPollFailure(task, error)
      }
    }
  }

  async pollImages(): Promise<void> {
    if (!this.imageProvider) return
    const now = Date.now()
    const tasks = await this.providerTasksDueForPoll(IMG2_PROVIDER_NAME, now)

    for (const task of tasks) {
      const providerTaskId = String(task.metadata.providerTaskId)
      await this.markPolled(task.id, now)
      try {
        const status = await this.imageProvider.getStatus(providerTaskId)
        const materialized =
          status.status === 'completed' ? await this.materializeRemoteOutputs(task, status.outputs) : null
        await this.completePolledTask(task, status, materialized)
      } catch (error) {
        await this.recordPollFailure(task, error)
      }
    }
  }

  async pollAudios(): Promise<void> {
    if (!this.audioProvider) return
    const now = Date.now()
    const tasks = await this.providerTasksDueForPoll(AUDIO_PROVIDER_NAME, now)

    for (const task of tasks) {
      const providerTaskId = String(task.metadata.providerTaskId)
      await this.markPolled(task.id, now)
      try {
        const status = await this.audioProvider.getStatus(providerTaskId)
        const materialized =
          status.status === 'completed' ? await this.materializeRemoteOutputs(task, status.outputs) : null
        await this.completePolledTask(task, status, materialized)
      } catch (error) {
        await this.recordPollFailure(task, error)
      }
    }
  }

  private providerTasksDueForPoll(providerName: string, now: number): Promise<GenerationTask[]> {
    return this.store.read((state) =>
      state.tasks.filter(
        (task) =>
          task.status === 'running' &&
          task.metadata.providerName === providerName &&
          typeof task.metadata.providerTaskId === 'string' &&
          now - numberValue(task.metadata.providerPolledAt, 0) >= this.providerPollIntervalMs,
      ),
    )
  }

  private async markPolled(taskId: string, now: number): Promise<void> {
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === taskId)
      if (stored) stored.metadata = { ...stored.metadata, providerPolledAt: now }
    })
  }

  private async completePolledTask(
    task: GenerationTask,
    status: { status: GenerationTask['status']; progress: number; error: string | null },
    materialized: MaterializedGenerationOutputs | null,
  ): Promise<void> {
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (!stored || stored.status !== 'running') return
      stored.status = status.status
      stored.progress = status.progress
      stored.error = status.error
      stored.metadata = { ...stored.metadata, providerState: status.status, providerPollErrors: 0 }
      stored.updatedAt = new Date().toISOString()
      if (status.status === 'completed' && materialized) {
        addGeneratedMedia(state, materialized.media)
        completeTaskWithOutputs(state, stored, materialized.outputs, stored.updatedAt)
      }
    })
  }

  private async recordPollFailure(task: GenerationTask, error: unknown): Promise<void> {
    const attempts = numberValue(task.metadata.providerPollErrors, 0) + 1
    if (attempts >= 3) {
      await this.failTask(task.id, messageFor(error))
      return
    }
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (stored) stored.metadata = { ...stored.metadata, providerPollErrors: attempts }
    })
  }

  private async failTask(taskId: string, error: string): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return
      task.status = 'failed'
      task.progress = 100
      task.error = error.slice(0, 1_000)
      task.updatedAt = new Date().toISOString()
    })
  }

  private async materializeRemoteOutputs(
    task: GenerationTask,
    outputs: GenerationTask['outputs'],
  ): Promise<MaterializedGenerationOutputs> {
    if (!this.generatedAssetWriter) return { outputs, media: [] }
    return this.generatedAssetWriter.writeRemoteOutputs(task, outputs)
  }

  private async materializeRemoteVideo(
    task: GenerationTask,
    providerTaskId: string,
  ): Promise<MaterializedGenerationOutputs> {
    if (!this.generatedAssetWriter) {
      const url = `/api/v1/generation/tasks/${task.id}/content`
      return {
        outputs: [{ id: `${task.id}-video`, url, mediaType: 'video', view: 'single' }],
        media: [],
      }
    }
    return this.generatedAssetWriter.writeVideoContent(
      task,
      await this.videoProvider!.getContent(providerTaskId),
    )
  }

  private async imageRequestForProvider(task: GenerationTask) {
    const request = imageRequestFor(task)
    return this.mediaReferenceResolver
      ? this.mediaReferenceResolver.resolveImageRequest(task, request)
      : request
  }

  private async videoRequestForProvider(task: GenerationTask) {
    const request = videoRequestFor(task)
    return this.mediaReferenceResolver
      ? this.mediaReferenceResolver.resolveVideoRequest(task, request)
      : request
  }

  private audioRequestForProvider(task: GenerationTask) {
    return audioRequestFor(task)
  }
}
