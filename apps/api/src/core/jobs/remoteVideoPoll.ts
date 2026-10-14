import type { GenerationTask } from '@seqora/contracts'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type {
  VideoGenerationProvider,
  VideoGenerationStatus,
  VideoProviderName,
} from '../generation/videoProvider.js'
import { observeProviderCall } from '../observability/metrics.js'
import { traceIdFromGenerationTask } from '../observability/trace.js'
import { generatedDescriptors, type GeneratedOutputDescriptor } from './taskWriteback.js'
import { providerPollBinding, providerPollMatches, type ProviderPollBinding } from './providerCompletion.js'

export type ProviderVideoPollOutcome = { binding: ProviderPollBinding } & (
  | {
      kind: 'status'
      status: VideoGenerationStatus
      videoDescriptor: GeneratedOutputDescriptor | null
      videoCacheError: string | null
      lastFrameDescriptor: GeneratedOutputDescriptor | null
      lastFrameError: string | null
    }
  | { kind: 'error'; error: string }
)

export async function requestRemoteVideoPoll(
  source: GenerationTask,
  options: {
    videoProvider: VideoGenerationProvider | null
    videoProviderName: VideoProviderName
    providerStatusTimeoutMs: number
    objectStorage: ObjectStorage | null
    writeback: {
      persistVideoContent(
        task: GenerationTask,
        providerTaskId: string,
        provider: VideoGenerationProvider,
      ): Promise<GeneratedOutputDescriptor>
      persistVideoLastFrame(
        task: GenerationTask,
        providerTaskId: string,
        provider: VideoGenerationProvider,
      ): Promise<GeneratedOutputDescriptor>
    }
  },
): Promise<ProviderVideoPollOutcome> {
  const task = structuredClone(source)
  const binding = providerPollBinding(task, options.videoProviderName)
  const provider = options.videoProvider
  if (!provider) return { kind: 'error', binding, error: 'Video provider is not configured' }
  if (!providerPollMatches(task, binding))
    return { kind: 'error', binding, error: 'Video provider poll scope is invalid' }
  const observe = <T>(operation: string, call: () => Promise<T>) =>
    observeProviderCall(
      {
        provider: options.videoProviderName,
        operation,
        tenantId: task.tenantId,
        organizationId: task.tenantId,
        userId: task.userId,
        taskId: task.id,
        traceId: traceIdFromGenerationTask(task),
      },
      call,
    )
  try {
    const status = await observe('video.getStatus', () =>
      withTimeout(() => provider.getStatus(binding.providerTaskId), options.providerStatusTimeoutMs),
    )
    let videoDescriptor: GeneratedOutputDescriptor | null = null
    let videoCacheError: string | null = null
    const hasCachedVideo = generatedDescriptors(task).some(
      (item) => item.view === 'single' && item.contentType.startsWith('video/'),
    )
    if (status.status === 'completed' && !hasCachedVideo && options.objectStorage) {
      try {
        videoDescriptor = await observe('video.getContent', () =>
          withTimeout(
            () => options.writeback.persistVideoContent(task, binding.providerTaskId, provider),
            30_000,
            'Video content persistence timed out',
          ),
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
      provider.getLastFrameContent &&
      options.objectStorage
    ) {
      try {
        lastFrameDescriptor = await observe('video.getLastFrameContent', () =>
          withTimeout(
            () => options.writeback.persistVideoLastFrame(task, binding.providerTaskId, provider),
            30_000,
            'Video last-frame persistence timed out',
          ),
        )
      } catch (error) {
        lastFrameError = messageFor(error)
      }
    }
    return {
      kind: 'status',
      binding,
      status,
      videoDescriptor,
      videoCacheError,
      lastFrameDescriptor,
      lastFrameError,
    }
  } catch (error) {
    return { kind: 'error', binding, error: messageFor(error) }
  }
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message = 'Video provider status request timed out',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function messageFor(error: unknown): string {
  if (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      /aborted due to timeout|timed out|timeout/i.test(error.message))
  )
    return '第三方生成请求超时：上游没有在限定时间内返回结果，本次任务没有生成成功；请稍后重试，或降低质量/减少参考图后再试'
  return error instanceof Error ? error.message : '第三方生成请求失败'
}
