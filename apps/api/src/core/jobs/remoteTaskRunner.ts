import type { GenerationTask } from '@seqora/contracts'
import type { AudioGenerationProvider } from '../generation/audioProvider.js'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { logError, logInfo, logWarn } from '../logging.js'
import { GeneratedAssetWriter, type MaterializedGenerationOutputs } from './generatedAssetWriter.js'
import { MediaReferenceResolver } from './mediaReferenceResolver.js'
import { AUDIO_PROVIDER_NAME, IMG2_PROVIDER_NAME, SEEDANCE_PROVIDER_NAME } from './providerMetadata.js'
import { isRetryableSubmissionError } from './taskRetryPolicy.js'
import { cancellationResourceLockForTask } from './taskResourceLock.js'
import { audioRequestFor, imageRequestFor, messageFor, videoRequestFor } from './taskRequestFactory.js'
import type { TaskRuntimeStore } from './taskRuntimeStore.js'

export class RemoteTaskRunner {
  private readonly cancellationLeaseMs = 60_000

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

  async retrySubmissionTasks(): Promise<void> {
    const tasks = await this.taskRuntimeStore.submissionTasksDueForRetry(Date.now())
    for (const task of tasks) {
      if (this.usesRemoteVideoProvider(task)) {
        await this.submitVideo(task)
        continue
      }
      if (this.usesRemoteImageProvider(task)) {
        await this.submitImage(task)
        continue
      }
      if (this.usesRemoteAudioProvider(task)) {
        await this.submitAudio(task)
        continue
      }
      await this.failTask(task.id, 'Provider is not configured for submission retry', 'submission')
    }
  }

  async retryPostProcessTasks(): Promise<void> {
    const tasks = await this.taskRuntimeStore.postProcessTasksDueForRetry(Date.now())
    for (const task of tasks) {
      if (this.usesRemoteVideoProvider(task)) {
        await this.retryVideoPostProcess(task)
        continue
      }
      if (this.usesRemoteImageProvider(task) || this.usesRemoteAudioProvider(task)) {
        const outputs = outputsFromPostProcessMetadata(task)
        if (outputs.length === 0) {
          await this.failTask(task.id, 'Missing remote outputs for post-processing retry', 'postprocess')
          continue
        }
        await this.retryMaterialization(task, outputs)
        continue
      }
      await this.failTask(task.id, 'Provider is not configured for post-processing retry', 'postprocess')
    }
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
      await this.handleSubmissionFailure(task, error)
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
      await this.taskRuntimeStore.applyProviderSubmission(task.id, submission, null)
      if (submission.status === 'completed') {
        try {
          const materialized = await this.materializeRemoteOutputs(task, submission.outputs)
          await this.taskRuntimeStore.applyProviderStatus(
            task.id,
            { status: 'completed', progress: 100, error: null },
            materialized,
          )
        } catch (error) {
          await this.handlePostProcessFailure(task, error, submission.outputs)
        }
      }
    } catch (error) {
      await this.handleSubmissionFailure(task, error)
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
      await this.taskRuntimeStore.applyProviderSubmission(task.id, submission, null)
      if (submission.status === 'completed') {
        try {
          const materialized = await this.materializeRemoteOutputs(task, submission.outputs)
          await this.taskRuntimeStore.applyProviderStatus(
            task.id,
            { status: 'completed', progress: 100, error: null },
            materialized,
          )
        } catch (error) {
          await this.handlePostProcessFailure(task, error, submission.outputs)
        }
      }
    } catch (error) {
      await this.handleSubmissionFailure(task, error)
    }
  }

  async cancelRequestedTasks(): Promise<void> {
    const tasks = await this.taskRuntimeStore.claimProviderCancellationTasks(Date.now(), this.cancellationLeaseMs)
    for (const task of tasks) {
      const providerTaskId = String(task.metadata.providerTaskId)
      const provider = this.cancellableProviderFor(task)
      const lock = cancellationResourceLockForTask(task)
      let cancelError: string | null = null

      try {
        if (provider?.cancel) {
          await provider.cancel(providerTaskId)
          logInfo('provider_task.cancelled', {
            taskId: task.id,
            provider: task.metadata.providerName,
            providerTaskId,
            lockKind: lock.kind,
            lockKey: lock.key,
          })
        }
      } catch (error) {
        cancelError = messageFor(error)
        logError('provider_task.cancel_failed', {
          taskId: task.id,
          provider: task.metadata.providerName,
          providerTaskId,
          lockKind: lock.kind,
          lockKey: lock.key,
          message: cancelError,
        })
      }

      await this.taskRuntimeStore.finalizeCancellation(task.id, cancelError)
    }
  }

  private cancellableProviderFor(task: GenerationTask) {
    if (task.kind === 'video' && task.provider === 'seedance') return this.videoProvider
    if (task.kind === 'image' && task.provider === 'img2') return this.imageProvider
    if (task.kind === 'audio' && task.provider === 'audio') return this.audioProvider
    return null
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
        if (status.status === 'completed') {
          try {
            const materialized = await this.materializeRemoteVideo(task, providerTaskId)
            await this.taskRuntimeStore.applyProviderStatus(task.id, status, materialized)
          } catch (error) {
            await this.handlePostProcessFailure(task, error)
          }
          continue
        }
        await this.taskRuntimeStore.applyProviderStatus(task.id, status, null)
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
        if (status.status === 'completed') {
          try {
            const materialized = await this.materializeRemoteOutputs(task, status.outputs)
            await this.taskRuntimeStore.applyProviderStatus(task.id, status, materialized)
          } catch (error) {
            await this.handlePostProcessFailure(task, error, status.outputs)
          }
          continue
        }
        await this.taskRuntimeStore.applyProviderStatus(task.id, status, null)
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
        if (status.status === 'completed') {
          try {
            const materialized = await this.materializeRemoteOutputs(task, status.outputs)
            await this.taskRuntimeStore.applyProviderStatus(task.id, status, materialized)
          } catch (error) {
            await this.handlePostProcessFailure(task, error, status.outputs)
          }
          continue
        }
        await this.taskRuntimeStore.applyProviderStatus(task.id, status, null)
      } catch (error) {
        await this.recordPollFailure(task, error)
      }
    }
  }

  private async retryVideoPostProcess(task: GenerationTask): Promise<void> {
    if (!(await this.isTaskStillRunning(task.id))) return
    const providerTaskId = String(task.metadata.providerTaskId)
    try {
      const materialized = await this.materializeRemoteVideo(task, providerTaskId)
      await this.taskRuntimeStore.applyProviderStatus(
        task.id,
        { status: 'completed', progress: 100, error: null },
        materialized,
      )
    } catch (error) {
      await this.handlePostProcessFailure(task, error)
    }
  }

  private async retryMaterialization(
    task: GenerationTask,
    outputs: GenerationTask['outputs'],
  ): Promise<void> {
    if (!(await this.isTaskStillRunning(task.id))) return
    try {
      const materialized = await this.materializeRemoteOutputs(task, outputs)
      await this.taskRuntimeStore.applyProviderStatus(
        task.id,
        { status: 'completed', progress: 100, error: null },
        materialized,
      )
    } catch (error) {
      await this.handlePostProcessFailure(task, error, outputs)
    }
  }

  private async handleSubmissionFailure(task: GenerationTask, error: unknown): Promise<void> {
    const message = messageFor(error)
    if (isRetryableSubmissionError(error)) {
      logWarn('provider_task.submit_retry', {
        taskId: task.id,
        provider: task.metadata.providerName,
        message,
      })
      await this.taskRuntimeStore.scheduleSubmissionRetry(task.id, message)
      return
    }
    await this.failTask(task.id, message, 'submission')
  }

  private async handlePostProcessFailure(
    task: GenerationTask,
    error: unknown,
    remoteOutputs?: GenerationTask['outputs'],
  ): Promise<void> {
    const message = messageFor(error)
    logWarn('provider_task.postprocess_retry', {
      taskId: task.id,
      provider: task.metadata.providerName,
      message,
    })
    await this.taskRuntimeStore.schedulePostProcessRetry(task.id, message, remoteOutputs)
  }

  private async recordPollFailure(task: GenerationTask, error: unknown): Promise<void> {
    await this.taskRuntimeStore.recordPollFailure(task.id, messageFor(error))
  }

  private async failTask(
    taskId: string,
    error: string,
    stage?: 'submission' | 'poll' | 'postprocess',
  ): Promise<void> {
    logError('generation_task.failed', { taskId, message: error })
    await this.taskRuntimeStore.failTask(taskId, error, stage)
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

function outputsFromPostProcessMetadata(task: GenerationTask): GenerationTask['outputs'] {
  const value = task.metadata.postProcessRemoteOutputs
  if (!Array.isArray(value)) return []

  return value.flatMap((item, index) => {
    if (typeof item !== 'object' || item === null) return []
    const output = item as Partial<GenerationTask['outputs'][number]>
    if (typeof output.url !== 'string' || typeof output.mediaType !== 'string') return []
    const mediaType = output.mediaType as GenerationTask['outputs'][number]['mediaType']
    const view =
      output.view === 'front' || output.view === 'side' || output.view === 'back' || output.view === 'detail'
        ? output.view
        : 'single'

    return [
      {
        id: typeof output.id === 'string' ? output.id : `${task.id}-${mediaType}-retry-${index + 1}`,
        url: output.url,
        mediaType,
        view,
      },
    ]
  })
}
