import type { GenerationTask } from '@seqora/contracts'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { ImageGenerationOutput } from '../generation/imageProvider.js'
import type { VideoContent, VideoGenerationProvider } from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore } from '../../infra/store.js'
import { claimGenerationTaskLease } from './taskLease.js'
import { generatedDescriptors, GenerationResultWriteback } from './taskWriteback.js'

describe('GenerationResultWriteback content hashes', () => {
  it('retains a separate exact-byte hash for each stored image through completion', async () => {
    const { store, storage, stored, task, leaseToken, writeback } = await fixture('image')
    const outputs: ImageGenerationOutput[] = [
      { view: 'front', contentType: 'image/png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff]) },
      { view: 'side', contentType: 'image/png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xfe]) },
    ]

    const descriptors = await writeback.persistImageOutputs(task, outputs)
    await writeback.completeImageTask(task.id, 'test-worker', leaseToken, descriptors)

    expect(storage.put).toHaveBeenCalledTimes(outputs.length)
    expect(descriptors).toEqual(
      outputs.map((output) => ({
        view: output.view,
        storageKey: `${task.tenantId}/${task.projectId}/generated/${task.id}-${output.view}.png`,
        contentType: output.contentType,
        size: output.content.length,
        sha256: sha256(output.content),
      })),
    )
    for (const [index, descriptor] of descriptors.entries()) {
      expect(stored.get(descriptor.storageKey)).toEqual(outputs[index]!.content)
      expect(storage.put).toHaveBeenCalledWith(
        descriptor.storageKey,
        outputs[index]!.content,
        outputs[index]!.contentType,
      )
    }
    expect(descriptors[0]!.sha256).not.toBe(descriptors[1]!.sha256)
    const completed = store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(completed).toMatchObject({ status: 'completed', leaseToken: null })
    expect(generatedDescriptors(completed)).toEqual(descriptors)
  })

  it('hashes complete binary video and last-frame streams and persists both descriptors', async () => {
    const { store, storage, stored, task, leaseToken, writeback } = await fixture('video')
    const video = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0xff, 0, 0x80])
    const lastFrame = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x80, 0xfe, 0xff, 0xd9])
    const provider = videoProvider(video, lastFrame)

    const videoDescriptor = await writeback.persistVideoContent(task, 'provider-task', provider)
    const lastFrameDescriptor = await writeback.persistVideoLastFrame(task, 'provider-task', provider)
    await writeback.writeVideoPollResult({
      taskId: task.id,
      leaseOwnerId: 'test-worker',
      leaseToken,
      leaseTtlMs: 60_000,
      status: { status: 'completed', progress: 100, error: null },
      videoDescriptor,
      lastFrameDescriptor,
    })

    expect(videoDescriptor).toEqual({
      view: 'single',
      storageKey: `${task.tenantId}/${task.projectId}/generated/${task.id}-video.mp4`,
      contentType: 'video/mp4',
      size: video.length,
      sha256: sha256(video),
    })
    expect(lastFrameDescriptor).toEqual({
      view: 'last-frame',
      storageKey: `${task.tenantId}/${task.projectId}/generated/${task.id}-last-frame.jpg`,
      contentType: 'image/jpeg',
      size: lastFrame.length,
      sha256: sha256(lastFrame),
    })
    expect(provider.getContent).toHaveBeenCalledWith('provider-task')
    expect(provider.getLastFrameContent).toHaveBeenCalledWith('provider-task')
    expect(storage.put).toHaveBeenCalledTimes(2)
    expect(stored.get(videoDescriptor.storageKey)).toEqual(video)
    expect(stored.get(lastFrameDescriptor.storageKey)).toEqual(lastFrame)
    const completed = store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(completed).toMatchObject({ status: 'completed', leaseToken: null })
    expect(generatedDescriptors(completed)).toEqual([videoDescriptor, lastFrameDescriptor])
  })

  it.each(['image', 'video', 'last-frame'] as const)(
    'does not return a successful %s descriptor when storing its bytes fails',
    async (kind) => {
      const { store, storage, task, writeback } = await fixture(kind === 'image' ? 'image' : 'video')
      vi.mocked(storage.put).mockRejectedValueOnce(new Error('storage unavailable'))
      const content = Buffer.from([0, 0x80, 0xff])
      const provider = videoProvider(content, content)
      const pending =
        kind === 'image'
          ? writeback.persistImageOutputs(task, [{ view: 'single', contentType: 'image/png', content }])
          : kind === 'video'
            ? writeback.persistVideoContent(task, 'provider-task', provider)
            : writeback.persistVideoLastFrame(task, 'provider-task', provider)

      await expect(pending).rejects.toThrow('storage unavailable')

      const unchanged = store.read((state) => state.tasks.find((item) => item.id === task.id))
      expect(unchanged?.status).toBe('running')
      expect(generatedDescriptors(unchanged)).toEqual([])
    },
  )
})

async function fixture(kind: 'image' | 'video') {
  const store = new AppStore(null)
  await store.initialize()
  const now = new Date().toISOString()
  const task: GenerationTask = {
    id: `hash-${kind}-task`,
    clientRequestId: `hash-${kind}-request`,
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind,
    label: 'Content hash test',
    prompt: '',
    negativePrompt: '',
    provider: kind === 'video' ? 'seedance' : 'img2',
    model: null,
    metadata: {},
    status: 'running',
    progress: 0,
    estimatedCredits: 1,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
  const leaseToken = claimGenerationTaskLease(task, 'test-worker', 60_000)
  await store.mutate((state) => {
    state.tasks.unshift(task)
  })
  const stored = new Map<string, Buffer>()
  const storage: ObjectStorage = {
    put: vi.fn(async (key, content) => {
      stored.set(key, Buffer.from(content))
    }),
    get: vi.fn(async (key) => stored.get(key) ?? Buffer.alloc(0)),
    delete: vi.fn(async (key) => {
      stored.delete(key)
    }),
  }
  return {
    store,
    storage,
    stored,
    task,
    leaseToken,
    writeback: new GenerationResultWriteback(store, storage),
  }
}

function videoProvider(video: Buffer, lastFrame: Buffer): VideoGenerationProvider {
  return {
    submit: vi.fn(async () => {
      throw new Error('not used')
    }),
    getStatus: vi.fn(async () => {
      throw new Error('not used')
    }),
    getContent: vi.fn(async () => streamContent(video, 'video/mp4')),
    getLastFrameContent: vi.fn(async () => streamContent(lastFrame, 'image/jpeg')),
  }
}

function streamContent(content: Buffer, contentType: string): VideoContent {
  return {
    stream: Readable.from([content.subarray(0, 3), new Uint8Array(content.subarray(3))]),
    contentType,
    // Provider headers cannot substitute for the bytes actually received and stored.
    contentLength: '999',
    statusCode: 200,
    acceptRanges: null,
    contentRange: null,
  }
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}
