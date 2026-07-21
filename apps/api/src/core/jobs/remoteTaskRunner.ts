import type { GenerationTask } from '@seqora/contracts'
import type { AudioGenerationProvider } from '../generation/audioProvider.js'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { logError, logInfo } from '../logging.js'
import { GeneratedAssetWriter, type MaterializedGenerationOutputs } from './generatedAssetWriter.js'
import { MediaReferenceResolver } from './mediaReferenceResolver.js'
import { AUDIO_PROVIDER_NAME, IMG2_PROVIDER_NAME, SEEDANCE_PROVIDER_NAME } from './providerMetadata.js'
import { audioRequestFor, imageRequestFor, messageFor, videoRequestFor } from './taskRequestFactory.js'
import type { TaskRuntimeStore } from './taskRuntimeStore.js'

export class RemoteTaskRunner {
  constructor(
    private readonly taskRuntimeStore: TaskRuntimeStore,
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
      if (!(await this.isTaskStillRunning(task.id))) return
      const submission = await this.videoProvider!.submit(await this.videoRequestForProvider(task))
      logInfo('provider_task.submitted', {
        taskId: task.id,
        provider: SEEDANCE_PROVIDER_NAME,
        providerTaskId: submission.providerTaskId,
      })
      await this.taskRuntimeStore.applyProviderSubmission(task.id, submission, null)
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  async submitImage(task: GenerationTask): Promise<void> {
    try {
      if (!(await this.isTaskStillRunning(task.id))) return
      const submission = await this.imageProvider!.submit(await this.imageRequestForProvider(task))
      logInfo('provider_task.submitted', {
        taskId: task.id,
        provider: IMG2_PROVIDER_NAME,
        providerTaskId: submission.providerTaskId,
      })
      const materialized =
        submission.status === 'completed'
          ? await this.materializeRemoteOutputs(task, submission.outputs)
          : null
      await this.taskRuntimeStore.applyProviderSubmission(task.id, submission, materialized)
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  async submitAudio(task: GenerationTask): Promise<void> {
    try {
      if (!(await this.isTaskStillRunning(task.id))) return
      const submission = await this.audioProvider!.submit(this.audioRequestForProvider(task))
      logInfo('provider_task.submitted', {
        taskId: task.id,
        provider: AUDIO_PROVIDER_NAME,
        providerTaskId: submission.providerTaskId,
      })
      const materialized =
        submission.status === 'completed'
          ? await this.materializeRemoteOutputs(task, submission.outputs)
          : null
      await this.taskRuntimeStore.applyProviderSubmission(task.id, submission, materialized)
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  async pollVideos(): Promise<void> {
    if (!this.videoProvider) return
    const now = Date.now()
    const tasks = await this.taskRuntimeStore.providerTasksDueForPoll(
      SEEDANCE_PROVIDER_NAME,
      now,
      this.providerPollIntervalMs,
    )

    for (const task of tasks) {
      const providerTaskId = String(task.metadata.providerTaskId)
      await this.taskRuntimeStore.markPolled(task.id, now)
      try {
        const status = await this.videoProvider.getStatus(providerTaskId)
        const materialized =
          status.status === 'completed' ? await this.materializeRemoteVideo(task, providerTaskId) : null
        await this.taskRuntimeStore.applyProviderStatus(task.id, status, materialized)
      } catch (error) {
        await this.recordPollFailure(task, error)
      }
    }
  }

  async pollImages(): Promise<void> {
    if (!this.imageProvider) return
    const now = Date.now()
    const tasks = await this.taskRuntimeStore.providerTasksDueForPoll(
      IMG2_PROVIDER_NAME,
      now,
      this.providerPollIntervalMs,
    )

    for (const task of tasks) {
      const providerTaskId = String(task.metadata.providerTaskId)
      await this.taskRuntimeStore.markPolled(task.id, now)
      try {
        const status = await this.imageProvider.getStatus(providerTaskId)
        const materialized =
          status.status === 'completed' ? await this.materializeRemoteOutputs(task, status.outputs) : null
        await this.taskRuntimeStore.applyProviderStatus(task.id, status, materialized)
      } catch (error) {
        await this.recordPollFailure(task, error)
      }
    }
  }

  async pollAudios(): Promise<void> {
    if (!this.audioProvider) return
    const now = Date.now()
    const tasks = await this.taskRuntimeStore.providerTasksDueForPoll(
      AUDIO_PROVIDER_NAME,
      now,
      this.providerPollIntervalMs,
    )

    for (const task of tasks) {
      const providerTaskId = String(task.metadata.providerTaskId)
      await this.taskRuntimeStore.markPolled(task.id, now)
      try {
        const status = await this.audioProvider.getStatus(providerTaskId)
        const materialized =
          status.status === 'completed' ? await this.materializeRemoteOutputs(task, status.outputs) : null
        await this.taskRuntimeStore.applyProviderStatus(task.id, status, materialized)
      } catch (error) {
        await this.recordPollFailure(task, error)
      }
    }
  }

  private async recordPollFailure(task: GenerationTask, error: unknown): Promise<void> {
    await this.taskRuntimeStore.recordPollFailure(task.id, messageFor(error))
  }

  private async failTask(taskId: string, error: string): Promise<void> {
    logError('generation_task.failed', { taskId, message: error })
    await this.taskRuntimeStore.failTask(taskId, error)
  }

  private async isTaskStillRunning(taskId: string): Promise<boolean> {
    return this.taskRuntimeStore.isTaskRunning(taskId)
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
