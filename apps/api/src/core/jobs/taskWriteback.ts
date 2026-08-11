import type { GenerationTask } from '@seqora/contracts'
import type { ImageGenerationOutput } from '../generation/imageProvider.js'
import type { VideoGenerationProvider, VideoGenerationStatus } from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { AppStore } from '../../infra/store.js'
import {
  generationTaskLeaseMatches,
  releaseGenerationTaskLease,
  renewGenerationTaskLease,
} from './taskLease.js'

export type GeneratedOutputDescriptor = {
  view: GenerationTask['outputs'][number]['view']
  storageKey: string
  contentType: string
  size: number
}

export class GenerationResultWriteback {
  constructor(
    private readonly store: AppStore,
    private readonly objectStorage: ObjectStorage | null,
  ) {}

  async persistImageOutputs(
    task: GenerationTask,
    outputs: ImageGenerationOutput[],
  ): Promise<GeneratedOutputDescriptor[]> {
    if (!this.objectStorage) return []
    const descriptors: GeneratedOutputDescriptor[] = []
    for (const output of outputs) {
      const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-${output.view}.png`
      await this.objectStorage.put(storageKey, output.content, output.contentType)
      descriptors.push({
        view: output.view,
        storageKey,
        contentType: output.contentType,
        size: output.content.length,
      })
    }
    return descriptors
  }

  async completeImageTask(
    taskId: string,
    leaseOwnerId: string,
    leaseToken: string,
    descriptors: GeneratedOutputDescriptor[],
  ): Promise<GenerationTask | null> {
    return this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.status !== 'running') return null
      if (!generationTaskLeaseMatches(task, leaseOwnerId, leaseToken)) return null
      task.status = 'completed'
      task.progress = 100
      task.error = null
      task.metadata = { ...task.metadata, providerState: 'completed', generatedOutputs: descriptors }
      task.outputs = descriptors.map((descriptor) => ({
        id: `${task.id}-${descriptor.view}`,
        url: `/api/v1/generation/tasks/${task.id}/outputs/${descriptor.view}`,
        mediaType: 'image',
        view: descriptor.view,
      }))
      task.resultUrl = task.outputs[0]?.url ?? null
      task.updatedAt = new Date().toISOString()
      releaseGenerationTaskLease(task)

      const assetId = typeof task.metadata.assetId === 'string' ? task.metadata.assetId : null
      const shotId = typeof task.metadata.shotId === 'string' ? task.metadata.shotId : null
      const asset = state.assets.find((item) => item.id === assetId && item.projectId === task.projectId)
      const shot = state.shots.find((item) => item.id === shotId && item.projectId === task.projectId)
      if (asset && task.resultUrl) {
        asset.imageUrl = task.resultUrl
        asset.updatedAt = task.updatedAt
      }
      if (shot && task.resultUrl) {
        shot.imageUrl = task.resultUrl
        shot.selectedImageTaskId = task.id
        shot.updatedAt = task.updatedAt
      }
      return task
    })
  }

  async persistVideoLastFrame(
    task: GenerationTask,
    providerTaskId: string,
    videoProvider: VideoGenerationProvider,
  ): Promise<GeneratedOutputDescriptor> {
    if (!this.objectStorage || !videoProvider.getLastFrameContent) {
      throw new Error('Video last frame storage is not configured')
    }
    const content = await videoProvider.getLastFrameContent(providerTaskId)
    const buffer = await readableToBuffer(content.stream)
    const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-last-frame.jpg`
    await this.objectStorage.put(storageKey, buffer, content.contentType)
    return { view: 'last-frame', storageKey, contentType: content.contentType, size: buffer.length }
  }

  async persistVideoContent(
    task: GenerationTask,
    providerTaskId: string,
    videoProvider: VideoGenerationProvider,
  ): Promise<GeneratedOutputDescriptor> {
    if (!this.objectStorage) throw new Error('Video storage is not configured')
    const content = await videoProvider.getContent(providerTaskId)
    const buffer = await readableToBuffer(content.stream)
    const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-video.mp4`
    await this.objectStorage.put(storageKey, buffer, content.contentType)
    return { view: 'single', storageKey, contentType: content.contentType, size: buffer.length }
  }

  async writeVideoPollResult(input: {
    taskId: string
    leaseOwnerId: string
    leaseToken: string
    leaseTtlMs: number
    status: VideoGenerationStatus
    videoDescriptor?: GeneratedOutputDescriptor | null
    videoCacheError?: string | null
    lastFrameDescriptor?: GeneratedOutputDescriptor | null
    lastFrameError?: string | null
  }): Promise<GenerationTask | null> {
    return this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === input.taskId)
      if (!stored || stored.status !== 'running') return null
      if (!generationTaskLeaseMatches(stored, input.leaseOwnerId, input.leaseToken)) return null
      const updatedAt = new Date()
      const progressChanged = input.status.progress !== stored.progress
      stored.status = input.status.status
      stored.progress = input.status.progress
      stored.error = input.status.error
      const descriptors = generatedDescriptors(stored).filter(
        (item) =>
          (!input.videoDescriptor || item.view !== 'single') &&
          (!input.lastFrameDescriptor || item.view !== 'last-frame'),
      )
      if (input.videoDescriptor) descriptors.push(input.videoDescriptor)
      if (input.lastFrameDescriptor) descriptors.push(input.lastFrameDescriptor)
      stored.metadata = {
        ...stored.metadata,
        providerState: input.status.status,
        providerPollErrors: 0,
        providerProgressChangedAt: progressChanged
          ? updatedAt.toISOString()
          : (stored.metadata.providerProgressChangedAt ?? stored.metadata.providerSubmittedAt),
        ...(input.videoDescriptor || input.lastFrameDescriptor
          ? {
              generatedOutputs: descriptors,
            }
          : {}),
        ...(input.videoDescriptor
          ? {
              videoStorageKey: input.videoDescriptor.storageKey,
              videoContentType: input.videoDescriptor.contentType,
              videoSize: input.videoDescriptor.size,
            }
          : {}),
        ...(input.lastFrameDescriptor
          ? {
              lastFrameStorageKey: input.lastFrameDescriptor.storageKey,
              lastFrameContentType: input.lastFrameDescriptor.contentType,
            }
          : {}),
        ...(input.videoCacheError ? { videoCacheError: input.videoCacheError } : {}),
        ...(input.lastFrameError ? { lastFrameError: input.lastFrameError } : {}),
      }
      if (input.status.status === 'running') {
        renewGenerationTaskLease(stored, input.leaseOwnerId, input.leaseToken, input.leaseTtlMs, updatedAt)
      } else {
        releaseGenerationTaskLease(stored)
      }
      stored.updatedAt = updatedAt.toISOString()
      if (input.status.status === 'completed') {
        const url = `/api/v1/generation/tasks/${stored.id}/content`
        stored.outputs = [
          { id: `${stored.id}-video`, url, mediaType: 'video', view: 'single' },
          ...(input.lastFrameDescriptor
            ? [
                {
                  id: `${stored.id}-last-frame`,
                  url: `/api/v1/generation/tasks/${stored.id}/outputs/last-frame`,
                  mediaType: 'image' as const,
                  view: 'last-frame' as const,
                },
              ]
            : []),
        ]
        stored.resultUrl = url
        const shotId = typeof stored.metadata.shotId === 'string' ? stored.metadata.shotId : null
        const shot = state.shots.find(
          (item) =>
            item.id === shotId && item.projectId === stored.projectId && item.tenantId === stored.tenantId,
        )
        if (shot) {
          shot.selectedVideoTaskId = stored.id
          shot.updatedAt = stored.updatedAt
        }
      }
      return stored
    })
  }
}

export function generatedDescriptors(task: GenerationTask | undefined): GeneratedOutputDescriptor[] {
  if (!task || !Array.isArray(task.metadata.generatedOutputs)) return []
  return task.metadata.generatedOutputs.filter((item): item is GeneratedOutputDescriptor => {
    if (!item || typeof item !== 'object') return false
    const descriptor = item as Partial<GeneratedOutputDescriptor>
    return (
      typeof descriptor.view === 'string' &&
      typeof descriptor.storageKey === 'string' &&
      typeof descriptor.contentType === 'string' &&
      typeof descriptor.size === 'number'
    )
  })
}

async function readableToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
