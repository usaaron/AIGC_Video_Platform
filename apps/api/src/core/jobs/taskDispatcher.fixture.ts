import type { GenerationTask } from '@seqora/contracts'
import { Readable } from 'node:stream'
import { vi } from 'vitest'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { VideoContent } from '../generation/videoProvider.js'

export const syntheticVideo = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')

export function syntheticVideoContent(): VideoContent {
  return {
    stream: Readable.from([syntheticVideo]),
    contentType: 'video/mp4',
    contentLength: String(syntheticVideo.length),
    statusCode: 200,
    acceptRanges: null,
    contentRange: null,
  }
}

export function syntheticTailFrame(label: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(label), Buffer.from([0xff, 0xd9])])
}

export function queuedVideoTasks(count: number): GenerationTask[] {
  const now = new Date().toISOString()
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1
    return {
      id: `parallel-video-${sequence}`,
      clientRequestId: `parallel-video-client-${sequence}`,
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      kind: 'video',
      label: `并发镜头 ${sequence}`,
      prompt: `角色执行第 ${sequence} 个独立动作`,
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        shotId: `parallel-shot-${sequence}`,
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
      },
      status: 'queued',
      progress: 0,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
  })
}

export function memoryObjectStorage(): ObjectStorage {
  const files = new Map<string, Buffer>()
  return {
    put: vi.fn(async (key, content) => {
      files.set(key, content)
    }),
    get: vi.fn(async (key) => files.get(key) ?? Buffer.alloc(0)),
    delete: vi.fn(async (key) => {
      files.delete(key)
    }),
  }
}
