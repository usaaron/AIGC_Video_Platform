import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { videoReviewVersion, type GenerationTask } from '@seqora/contracts'
import type { ObjectStorage, ObjectStorageStream } from '../../infra/objectStorage.js'
import {
  buildVideoTailStorageEvidence,
  verifyCurrentVideoTailStorage,
} from './deliveryStorageVerification.js'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])

function task(overrides: Partial<GenerationTask> = {}): GenerationTask {
  return {
    id: 'task-1',
    clientRequestId: 'request-1',
    projectId: 'project-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    kind: 'video',
    label: '镜头 1',
    prompt: 'prompt',
    negativePrompt: '',
    provider: 'seedance',
    model: null,
    tier: null,
    metadata: {
      providerState: 'completed',
      providerTaskId: 'provider-1',
      lastFrameStorageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
      generatedOutputs: [
        {
          view: 'last-frame',
          storageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
          contentType: 'image/png',
          size: png.length,
        },
      ],
    },
    status: 'completed',
    progress: 100,
    estimatedCredits: 18,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:01:00.000Z',
    resultUrl: '/video/task-1',
    outputs: [],
    error: null,
    ...overrides,
  }
}

function approvedTask(overrides: Partial<GenerationTask> = {}): GenerationTask {
  const initial = task(overrides)
  return task({
    ...overrides,
    metadata: {
      ...initial.metadata,
      contentReview: {
        decision: 'approved',
        mediaVersion: videoReviewVersion(initial),
      },
    },
  })
}

function storageFor(content: Buffer, failure?: unknown): ObjectStorage {
  return {
    put: async () => undefined,
    get: async () => {
      if (failure) throw failure
      return content
    },
    getStream: async () => {
      if (failure) throw failure
      return { stream: Readable.from([content]), size: content.length }
    },
    delete: async () => undefined,
  }
}

afterEach(() => vi.useRealTimers())

describe('video tail object storage verification', () => {
  it('does not fall back to an unbounded get when streaming is unavailable', async () => {
    const storage = storageFor(png)
    delete storage.getStream
    storage.get = vi.fn(storage.get)
    expect(await verifyCurrentVideoTailStorage(task(), storage)).toMatchObject({
      status: 'pending',
      reason: 'stream-unavailable',
    })
    expect(storage.get).not.toHaveBeenCalled()
  })

  it('rejects a declared tail above 10 MiB before opening storage', async () => {
    const current = task()
    ;(current.metadata.generatedOutputs as Array<{ size: number }>)[0]!.size = 10 * 1024 * 1024 + 1
    const storage = storageFor(png)
    storage.getStream = vi.fn(storage.getStream!)
    expect(await verifyCurrentVideoTailStorage(current, storage)).toMatchObject({
      status: 'pending',
      reason: 'read-limit-exceeded',
    })
    expect(storage.getStream).not.toHaveBeenCalled()
  })

  it('stops an oversized object and a stream exceeding its trusted descriptor', async () => {
    const storage = storageFor(png)
    const stream = Readable.from([png, Buffer.from([1])])
    storage.getStream = vi.fn(async () => ({ stream, size: png.length }))
    expect(await verifyCurrentVideoTailStorage(task(), storage)).toMatchObject({
      status: 'failed',
      reason: 'size-mismatch',
    })
    expect(stream.destroyed).toBe(true)
    const huge = new Readable({
      read() {
        throw new Error('Should not consume oversized object')
      },
    })
    storage.getStream = vi.fn(async () => ({ stream: huge, size: 10 * 1024 * 1024 + 1 }))
    expect(await verifyCurrentVideoTailStorage(task(), storage)).toMatchObject({
      status: 'pending',
      reason: 'read-limit-exceeded',
    })
    expect(huge.destroyed).toBe(true)
  })

  it('times out stalled tails and destroys streams that arrive after the deadline', async () => {
    vi.useFakeTimers()
    const storage = storageFor(png)
    const stream = new Readable({ read() {} })
    storage.getStream = vi.fn(async () => ({ stream, size: png.length }))
    const pending = verifyCurrentVideoTailStorage(task(), storage)
    await vi.advanceTimersByTimeAsync(15_001)
    expect(await pending).toMatchObject({ status: 'pending', reason: 'read-timeout' })
    expect(stream.destroyed).toBe(true)
    const lateStream = new Readable({
      read() {
        throw new Error('Late stream must not be read')
      },
    })
    let resolveOpen!: (object: ObjectStorageStream) => void
    storage.getStream = vi.fn(
      () =>
        new Promise<ObjectStorageStream>((resolve) => {
          resolveOpen = resolve
        }),
    )
    const late = verifyCurrentVideoTailStorage(task(), storage)
    await vi.advanceTimersByTimeAsync(15_001)
    expect(await late).toMatchObject({ status: 'pending', reason: 'read-timeout' })
    resolveOpen({ stream: lateStream, size: png.length })
    await Promise.resolve()
    expect(lateStream.destroyed).toBe(true)
  })

  it('honors cancellation without passing partial bytes and closes the stream', async () => {
    const storage = storageFor(png)
    const stream = new Readable({ read() {} })
    storage.getStream = vi.fn(async () => ({ stream, size: png.length }))
    const controller = new AbortController()
    const pending = verifyCurrentVideoTailStorage(task(), storage, controller.signal)
    await Promise.resolve()
    controller.abort()
    expect(await pending).toMatchObject({ status: 'pending', reason: 'read-error' })
    expect(stream.destroyed).toBe(true)
  })

  it.each(['../outside.png', 'last-frame/png', 'last-frame\\png', 'last-framepng'])(
    'rejects the malformed tail suffix %s before storage access',
    async (suffix) => {
      const current = task()
      const storageKey = `tenant-1/project-1/generated/task-1-${suffix}`
      current.metadata.lastFrameStorageKey = storageKey
      ;(current.metadata.generatedOutputs as Array<{ storageKey: string }>)[0]!.storageKey = storageKey
      const storage = storageFor(png)
      storage.getStream = vi.fn(storage.getStream!)
      expect(await verifyCurrentVideoTailStorage(current, storage)).toMatchObject({
        status: 'pending',
        reason: 'missing-current-tail',
      })
      expect(storage.getStream).not.toHaveBeenCalled()
    },
  )

  it('keeps missing storage, missing tails and non-completed tasks pending', async () => {
    expect((await verifyCurrentVideoTailStorage(task(), null)).reason).toBe('storage-unavailable')
    expect((await verifyCurrentVideoTailStorage(task({ metadata: {} }), storageFor(png))).reason).toBe(
      'missing-current-tail',
    )
    expect((await verifyCurrentVideoTailStorage(task({ status: 'queued' }), storageFor(png))).reason).toBe(
      'task-not-ready',
    )
  })

  it('passes a current readable PNG with the recorded size', async () => {
    const result = await verifyCurrentVideoTailStorage(task(), storageFor(png))
    expect(result).toEqual({
      status: 'passed',
      reason: 'readable',
      storageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
      expectedSize: png.length,
      actualSize: png.length,
    })
  })

  it('fails absent, empty, wrong-size and wrong-signature objects', async () => {
    const notFound = Object.assign(new Error('missing'), { code: 'ENOENT' })
    expect((await verifyCurrentVideoTailStorage(task(), storageFor(png, notFound))).reason).toBe('not-found')
    const gcsNotFound = Object.assign(new Error('missing'), { statusCode: 404 })
    expect((await verifyCurrentVideoTailStorage(task(), storageFor(png, gcsNotFound))).reason).toBe(
      'not-found',
    )
    expect((await verifyCurrentVideoTailStorage(task(), storageFor(Buffer.alloc(0)))).reason).toBe(
      'empty-object',
    )
    expect(
      (await verifyCurrentVideoTailStorage(task(), storageFor(Buffer.concat([png, Buffer.from([1])]))))
        .reason,
    ).toBe('size-mismatch')
    const invalid = Buffer.from(png)
    invalid[0] = 0
    expect((await verifyCurrentVideoTailStorage(task(), storageFor(invalid))).reason).toBe(
      'content-type-mismatch',
    )
    const unsupportedType = task({
      metadata: {
        lastFrameStorageKey: 'tenant-1/project-1/generated/task-1-last-frame.svg',
        generatedOutputs: [
          {
            view: 'last-frame',
            storageKey: 'tenant-1/project-1/generated/task-1-last-frame.svg',
            contentType: 'image/svg+xml',
            size: png.length,
          },
        ],
      },
    })
    expect((await verifyCurrentVideoTailStorage(unsupportedType, storageFor(png))).reason).toBe(
      'content-type-mismatch',
    )
  })

  it('keeps transient storage errors pending and rejects a stale descriptor', async () => {
    expect(
      (await verifyCurrentVideoTailStorage(task(), storageFor(png, new Error('temporary')))).status,
    ).toBe('pending')
    const stale = task({
      metadata: {
        lastFrameStorageKey: 'current-key',
        generatedOutputs: [
          { view: 'last-frame', storageKey: 'old-key', contentType: 'image/png', size: png.length },
        ],
      },
    })
    expect((await verifyCurrentVideoTailStorage(stale, storageFor(png))).reason).toBe('missing-current-tail')
    const crossScope = task({
      metadata: {
        lastFrameStorageKey: 'tenant-other/project-1/generated/task-1-last-frame.png',
        generatedOutputs: [
          {
            view: 'last-frame',
            storageKey: 'tenant-other/project-1/generated/task-1-last-frame.png',
            contentType: 'image/png',
            size: png.length,
          },
        ],
      },
    })
    expect((await verifyCurrentVideoTailStorage(crossScope, storageFor(png))).reason).toBe(
      'missing-current-tail',
    )
  })

  it('only upgrades continuity to passed after review gates and storage reading pass', async () => {
    const approved = approvedTask()
    const evidence = await buildVideoTailStorageEvidence(
      approved,
      storageFor(png),
      '2026-10-13T00:03:00.000Z',
    )
    expect(evidence?.status).toBe('passed')
    expect(evidence?.observedAt).toBe('2026-10-13T00:03:00.000Z')
    expect((await buildVideoTailStorageEvidence(approved, null))?.status).toBe('pending')

    const rejected = task({
      metadata: {
        lastFrameStorageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
        generatedOutputs: [
          {
            view: 'last-frame',
            storageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
            contentType: 'image/png',
            size: png.length,
          },
        ],
        contentReview: {
          decision: 'rejected',
          mediaVersion: videoReviewVersion(task()),
        },
      },
    })
    expect((await buildVideoTailStorageEvidence(rejected, storageFor(png)))?.status).toBe('failed')
  })
})
