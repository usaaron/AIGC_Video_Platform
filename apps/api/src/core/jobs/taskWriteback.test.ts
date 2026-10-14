import { videoReviewVersion, type GenerationTask } from '@seqora/contracts'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { ImageGenerationOutput } from '../generation/imageProvider.js'
import type { VideoContent, VideoGenerationProvider } from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore } from '../../infra/store.js'
import { claimGenerationTaskLease } from './taskLease.js'
import { generatedDescriptors, GenerationResultWriteback } from './taskWriteback.js'
import { providerPollBinding } from './providerCompletion.js'
import { prepareImageCompletion } from './imageProviderCompletion.js'
import { imageRequestFor } from './imageTaskRequest.js'

const validVideo = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
const validImage = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

describe('GenerationResultWriteback content hashes', () => {
  it('retains a separate exact-byte hash for each stored image through completion', async () => {
    const { store, storage, stored, task, leaseToken, writeback } = await fixture('image')
    const outputs: ImageGenerationOutput[] = [
      { view: 'front', contentType: 'image/png', content: Buffer.concat([validImage, Buffer.from('front')]) },
      { view: 'side', contentType: 'image/png', content: Buffer.concat([validImage, Buffer.from('side')]) },
      { view: 'back', contentType: 'image/png', content: Buffer.concat([validImage, Buffer.from('back')]) },
    ]
    task.metadata.turnaround = true
    await store.mutate((state) => {
      state.tasks.find((item) => item.id === task.id)!.metadata.turnaround = true
    })
    const binding = prepareImageCompletion(task, imageRequestFor(task, []))
    const descriptors = await writeback.persistImageOutputs(task, outputs, binding)
    await writeback.completeImageTask(task.id, 'test-worker', leaseToken, descriptors)

    expect(storage.put).toHaveBeenCalledTimes(outputs.length)
    expect(descriptors).toEqual(
      outputs.map((output) => ({
        view: output.view,
        storageKey: `${task.tenantId}/${task.projectId}/generated/${task.id}-attempt-1-${sha256(output.content)}-${output.view}.png`,
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
    expect(completed?.metadata.providerCompletionReceipt).toMatchObject({
      version: 'seqora.provider-image-completion.v1',
      requestId: task.metadata.providerIdempotencyKey,
      outputs: descriptors,
    })
  })

  it('hashes complete binary video and last-frame streams and persists both descriptors', async () => {
    const { store, storage, stored, task, leaseToken, writeback } = await fixture('video')
    const video = validVideo
    const lastFrame = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x80, 0xfe, 0xff, 0xd9])
    const provider = videoProvider(video, lastFrame)

    const videoDescriptor = await writeback.persistVideoContent(task, 'provider-task', provider)
    const lastFrameDescriptor = await writeback.persistVideoLastFrame(task, 'provider-task', provider)
    await writeback.writeVideoPollResult({
      taskId: task.id,
      binding: providerPollBinding(task, 'stringx-seedance'),
      leaseOwnerId: 'test-worker',
      leaseToken,
      leaseTtlMs: 60_000,
      status: { status: 'completed', progress: 100, error: null },
      videoDescriptor,
      lastFrameDescriptor,
    })

    expect(videoDescriptor).toEqual({
      view: 'single',
      storageKey: `${task.tenantId}/${task.projectId}/generated/${task.id}-attempt-1-${sha256(video)}-video.mp4`,
      contentType: 'video/mp4',
      size: video.length,
      sha256: sha256(video),
    })
    expect(lastFrameDescriptor).toEqual({
      view: 'last-frame',
      storageKey: `${task.tenantId}/${task.projectId}/generated/${task.id}-attempt-1-${sha256(lastFrame)}-last-frame.jpg`,
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
    expect(completed?.metadata.providerCompletionReceipt).toEqual({
      version: 'seqora.provider-completion.v1',
      attestation: 'server-observed-completion',
      tenantId: task.tenantId,
      projectId: task.projectId,
      taskId: task.id,
      provider: 'seedance',
      providerName: 'stringx-seedance',
      providerTaskId: 'provider-task',
      attempts: 1,
      completedAt: completed!.updatedAt,
      mediaVersion: videoReviewVersion(completed!),
      media: videoDescriptor,
    })
  })

  it.each(['image', 'video', 'last-frame'] as const)(
    'does not return a successful %s descriptor when storing its bytes fails',
    async (kind) => {
      const { store, storage, task, writeback } = await fixture(kind === 'image' ? 'image' : 'video')
      vi.mocked(storage.put).mockRejectedValueOnce(new Error('storage unavailable'))
      const content = validVideo
      const provider = videoProvider(content, content)
      const pending =
        kind === 'image'
          ? writeback.persistImageOutputs(
              task,
              [{ view: 'single', contentType: 'image/png', content: validImage }],
              prepareImageCompletion(task, imageRequestFor(task, [])),
            )
          : kind === 'video'
            ? writeback.persistVideoContent(task, 'provider-task', provider)
            : writeback.persistVideoLastFrame(task, 'provider-task', provider)

      await expect(pending).rejects.toThrow('storage unavailable')

      const unchanged = store.read((state) => state.tasks.find((item) => item.id === task.id))
      expect(unchanged?.status).toBe('running')
      expect(generatedDescriptors(unchanged)).toEqual([])
    },
  )

  it.each(['providerTaskId', 'providerName', 'attempts', 'lease', 'tenantId', 'projectId'] as const)(
    'rejects a completed poll after the stored %s changes',
    async (field) => {
      const { store, task, leaseToken, writeback } = await fixture('video')
      const binding = providerPollBinding(task, 'stringx-seedance')
      const videoDescriptor = await writeback.persistVideoContent(
        task,
        'provider-task',
        videoProvider(validVideo, Buffer.alloc(0)),
      )
      await store.mutate((state) => {
        const current = state.tasks.find((item) => item.id === task.id)!
        if (field === 'providerTaskId') current.metadata.providerTaskId = 'other-provider-task'
        else if (field === 'providerName') current.metadata.providerName = 'volc-ark-seedance'
        else if (field === 'attempts') current.attempts = 2
        else if (field === 'lease') claimGenerationTaskLease(current, 'other-worker', 60_000)
        else current[field] = `other-${field}`
      })
      const result = await writeback.writeVideoPollResult({
        taskId: task.id,
        binding,
        leaseOwnerId: 'test-worker',
        leaseToken,
        leaseTtlMs: 60_000,
        status: { status: 'completed', progress: 100, error: null },
        videoDescriptor,
      })
      expect(result).toBeNull()
      expect(store.read((state) => state.tasks.find((item) => item.id === task.id)!.status)).toBe('running')
      expect(
        store.read(
          (state) => state.tasks.find((item) => item.id === task.id)!.metadata.providerCompletionReceipt,
        ),
      ).toBeUndefined()
    },
  )

  it('does not upgrade cached or copied descriptors into fresh provider completion proof', async () => {
    const { store, task, leaseToken, writeback } = await fixture('video')
    const descriptor = await writeback.persistVideoContent(
      task,
      'provider-task',
      videoProvider(validVideo, Buffer.alloc(0)),
    )
    await store.mutate((state) => {
      state.tasks.find((item) => item.id === task.id)!.metadata.providerCompletionReceipt = { stale: true }
    })
    const completed = await writeback.writeVideoPollResult({
      taskId: task.id,
      binding: providerPollBinding(task, 'stringx-seedance'),
      leaseOwnerId: 'test-worker',
      leaseToken,
      leaseTtlMs: 60_000,
      status: { status: 'completed', progress: 100, error: null },
      videoDescriptor: { ...descriptor },
    })
    expect(completed?.status).toBe('completed')
    expect(completed?.metadata.providerCompletionReceipt).toBeUndefined()
  })

  it.each(['running', 'failed', 'completed'] as const)(
    'clears old receipt on %s without fresh media ingestion',
    async (status) => {
      const { store, task, leaseToken, writeback } = await fixture('video')
      await store.mutate((state) => {
        state.tasks.find((item) => item.id === task.id)!.metadata.providerCompletionReceipt = { stale: true }
      })
      const result = await writeback.writeVideoPollResult({
        taskId: task.id,
        binding: providerPollBinding(task, 'stringx-seedance'),
        leaseOwnerId: 'test-worker',
        leaseToken,
        leaseTtlMs: 60_000,
        status: {
          status,
          progress: status === 'running' ? 50 : 100,
          error: status === 'failed' ? 'Provider failed' : null,
        },
      })
      expect(result?.metadata.providerCompletionReceipt).toBeUndefined()
    },
  )

  it('uses different immutable media keys for different attempts and bytes', async () => {
    const { task, writeback, stored } = await fixture('video')
    const first = await writeback.persistVideoContent(
      task,
      'provider-task',
      videoProvider(validVideo, Buffer.alloc(0)),
    )
    const retry = { ...task, attempts: 2 }
    const second = await writeback.persistVideoContent(
      retry,
      'provider-task',
      videoProvider(validVideo, Buffer.alloc(0)),
    )
    const changedVideo = Buffer.concat([validVideo, Buffer.from('different')])
    const third = await writeback.persistVideoContent(
      task,
      'provider-task',
      videoProvider(changedVideo, Buffer.alloc(0)),
    )
    expect(new Set([first.storageKey, second.storageKey, third.storageKey]).size).toBe(3)
    expect(stored.get(first.storageKey)).toEqual(validVideo)
    expect(stored.get(third.storageKey)).toEqual(changedVideo)
  })
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
    metadata:
      kind === 'video'
        ? { providerName: 'stringx-seedance', providerTaskId: 'provider-task' }
        : {
            providerName: 'tokenadvent-img2',
            providerIdempotencyKey: 'image-request-key',
          },
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
    contentLength: String(content.length),
    statusCode: 200,
    acceptRanges: null,
    contentRange: null,
  }
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}
