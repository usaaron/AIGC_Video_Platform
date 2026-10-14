import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerationTask } from '@seqora/contracts'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import { buildMediaStorageEvidence, verifyCurrentMediaStorage } from './deliveryMediaStorageVerification.js'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const checkedAt = '2026-10-14T00:00:00.000Z'

function task(kind: 'image' | 'video' = 'image', provider = 'seedance'): GenerationTask {
  const current = buildQueuedGenerationTask(
    {
      clientRequestId: 'request-1',
      projectId: 'project-1',
      kind,
      provider,
      label: '存储证明',
      prompt: '',
      negativePrompt: '',
      estimatedCredits: 0,
      metadata: {},
    },
    { tenantId: 'tenant-1', userId: 'user-1', roles: ['member'] },
    checkedAt,
  )
  current.id = 'task-1'
  current.status = 'completed'
  const bytes = kind === 'image' ? png : mp4
  const contentType = kind === 'image' ? 'image/png' : 'video/mp4'
  const storageKey = `tenant-1/project-1/generated/task-1-single.${kind === 'image' ? 'png' : 'mp4'}`
  current.metadata.generatedOutputs = [
    { view: 'single', storageKey, contentType, size: bytes.length, sha256: sha(bytes) },
  ]
  if (kind === 'image') {
    current.resultUrl = '/api/v1/generation/tasks/task-1/outputs/single'
    current.outputs = [{ id: 'output-1', view: 'single', mediaType: 'image', url: current.resultUrl }]
  } else {
    current.resultUrl = '/api/v1/generation/tasks/task-1/content'
    current.metadata.videoStorageKey = storageKey
    if (provider === 'local-compose')
      Object.assign(current.metadata, {
        previewStorageKey: storageKey,
        previewContentType: contentType,
        previewSize: bytes.length,
        previewSha256: sha(bytes),
      })
  }
  return current
}

function descriptor(current: GenerationTask) {
  return (current.metadata.generatedOutputs as Array<Record<string, unknown>>)[0]!
}

function storage(bytes: Buffer, declaredSize = bytes.length) {
  const stream = Readable.from([bytes.subarray(0, 5), bytes.subarray(5)])
  return {
    stream,
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    getStream: vi.fn(async () => ({ stream, size: declaredSize })),
  }
}

afterEach(() => vi.useRealTimers())

describe('main media storage proof', () => {
  it.each([
    ['image', 'tokenadvent', png],
    ['video', 'seedance', mp4],
    ['video', 'local-compose', mp4],
  ] as const)('fully reads and verifies %s / %s against ingestion bytes', async (kind, provider, bytes) => {
    const current = task(kind, provider)
    const before = structuredClone(current)
    const objects = storage(bytes)
    const result = await buildMediaStorageEvidence(current, objects, checkedAt)
    expect(result).toMatchObject({
      kind: 'asset',
      status: 'passed',
      observedAt: checkedAt,
      details: {
        storageProof: {
          status: 'passed',
          reason: 'verified',
          expectedSize: bytes.length,
          actualSize: bytes.length,
          expectedSha256: sha(bytes),
          actualSha256: sha(bytes),
        },
      },
    })
    expect(JSON.stringify(result?.details.storageProof)).not.toContain('storageKey')
    expect(JSON.stringify(result?.details.storageProof)).not.toContain(descriptor(current).storageKey)
    expect(objects.getStream).toHaveBeenCalledExactlyOnceWith(descriptor(current).storageKey)
    expect(objects.get).not.toHaveBeenCalled()
    expect(objects.put).not.toHaveBeenCalled()
    expect(objects.delete).not.toHaveBeenCalled()
    expect(objects.stream.destroyed).toBe(true)
    expect(current).toEqual(before)
  })

  it('detects same-length replacement even when its image signature is unchanged', async () => {
    const replaced = Buffer.from(png)
    replaced[replaced.length - 1] = replaced[replaced.length - 1]! ^ 255
    expect(await verifyCurrentMediaStorage(task(), storage(replaced))).toMatchObject({
      status: 'failed',
      reason: 'checksum-mismatch',
      expectedSha256: sha(png),
      actualSha256: sha(replaced),
    })
  })

  it.each([undefined, 'invalid', 'A'.repeat(64)])(
    'does not manufacture a baseline for legacy checksum %s',
    async (checksum) => {
      const current = task()
      descriptor(current).sha256 = checksum
      expect(await verifyCurrentMediaStorage(current, storage(png))).toMatchObject({
        status: 'pending',
        reason: 'missing-checksum',
        expectedSha256: null,
        actualSha256: sha(png),
      })
      expect(descriptor(current).sha256).toBe(checksum)
    },
  )

  it.each([
    'tenant-other/project-1/generated/task-1-single.png',
    'tenant-1/project-other/generated/task-1-single.png',
    'tenant-1/project-1/generated/task-other-single.png',
    'tenant-1/project-1/generated/task-1-../../secret.png',
    'tenant-1/project-1/generated/task-1-..\\secret.png',
    'tenant-1/project-1/generated/task-1-%2e%2e%2fsecret.png',
    'https://example.invalid/media.png',
  ])('rejects an out-of-scope or unsafe key without I/O: %s', async (storageKey) => {
    const current = task()
    descriptor(current).storageKey = storageKey
    const objects = storage(png)
    expect(await verifyCurrentMediaStorage(current, objects)).toMatchObject({
      status: 'pending',
      reason: 'missing-current-media',
    })
    expect(objects.getStream).not.toHaveBeenCalled()
  })

  it('requires the current local URL, output view and unambiguous descriptor', async () => {
    const objects = storage(png)
    const remote = task()
    remote.resultUrl = 'https://example.invalid/media.png'
    const staleVideo = task('video')
    staleVideo.metadata.videoStorageKey = 'tenant-1/project-1/generated/task-1-old.mp4'
    const duplicate = task()
    ;(duplicate.metadata.generatedOutputs as unknown[]).push({ ...descriptor(duplicate) })
    for (const current of [remote, staleVideo, duplicate]) {
      expect((await verifyCurrentMediaStorage(current, objects)).reason).toBe('missing-current-media')
    }
    expect(objects.getStream).not.toHaveBeenCalled()
  })

  it('keeps unavailable storage, unavailable streaming and unfinished tasks pending', async () => {
    expect((await verifyCurrentMediaStorage(task(), null)).reason).toBe('storage-unavailable')
    const objects = storage(png)
    const { getStream: _getStream, ...withoutStreaming } = objects
    expect((await verifyCurrentMediaStorage(task(), withoutStreaming)).reason).toBe('stream-unavailable')
    expect((await verifyCurrentMediaStorage({ ...task(), status: 'running' }, objects)).reason).toBe(
      'task-not-ready',
    )
    expect(objects.getStream).not.toHaveBeenCalled()
    expect(await buildMediaStorageEvidence({ ...task(), kind: 'text' }, objects)).toBeNull()
  })

  it.each([
    ['ENOENT', 'failed', 'not-found'],
    [404, 'failed', 'not-found'],
    ['ETIMEDOUT', 'pending', 'read-error'],
  ])('classifies storage error %s without exposing its message', async (code, status, reason) => {
    const objects: ObjectStorage = {
      ...storage(png),
      getStream: async () => {
        throw Object.assign(new Error('private-path'), { code })
      },
    }
    const proof = await verifyCurrentMediaStorage(task(), objects)
    expect(proof).toMatchObject({ status, reason })
    expect(JSON.stringify(proof)).not.toContain('private-path')
  })

  it.each([
    [Buffer.alloc(0), 0, 'empty-object'],
    [png.subarray(0, 9), png.length, 'size-mismatch'],
    [Buffer.concat([png, Buffer.from([0])]), png.length, 'size-mismatch'],
    [png, png.length + 1, 'size-mismatch'],
    [Buffer.alloc(png.length), png.length, 'content-type-mismatch'],
  ] as const)(
    'rejects empty, truncated, oversized or wrong-signature bytes %#',
    async (bytes, size, reason) => {
      const objects = storage(bytes, size)
      expect(await verifyCurrentMediaStorage(task(), objects)).toMatchObject({ status: 'failed', reason })
      expect(objects.stream.destroyed).toBe(true)
    },
  )

  it('refuses unsupported types and over-budget descriptors before reading', async () => {
    const objects = storage(png)
    const unsupported = task()
    descriptor(unsupported).contentType = 'image/svg+xml'
    expect((await verifyCurrentMediaStorage(unsupported, objects)).reason).toBe('unsupported-content-type')
    const large = task()
    descriptor(large).size = 100 * 1024 * 1024 + 1
    expect((await verifyCurrentMediaStorage(large, objects)).reason).toBe('read-limit-exceeded')
    expect(objects.getStream).not.toHaveBeenCalled()
    const largeObject = storage(png, 100 * 1024 * 1024 + 1)
    expect((await verifyCurrentMediaStorage(task(), largeObject)).reason).toBe('read-limit-exceeded')
    expect(largeObject.stream.destroyed).toBe(true)
  })

  it('times out a stalled stream and destroys it', async () => {
    vi.useFakeTimers()
    const stream = new Readable({ read() {} })
    const objects = { ...storage(png), getStream: async () => ({ stream, size: png.length }) }
    const pending = verifyCurrentMediaStorage(task(), objects)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await pending).toMatchObject({ status: 'pending', reason: 'read-timeout' })
    expect(stream.destroyed).toBe(true)
  })

  it('destroys a stream that arrives after the metadata request timed out', async () => {
    vi.useFakeTimers()
    const objects = storage(png)
    let resolveRead!: (value: { stream: Readable; size: number }) => void
    objects.getStream = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )
    const pending = verifyCurrentMediaStorage(task(), objects)
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await pending).reason).toBe('read-timeout')
    resolveRead({ stream: objects.stream, size: png.length })
    await vi.advanceTimersByTimeAsync(0)
    expect(objects.stream.destroyed).toBe(true)
  })

  it('keeps a mid-read failure pending and closes the stream', async () => {
    const stream = Readable.from(
      (async function* () {
        yield png.subarray(0, 8)
        throw new Error('read failed')
      })(),
    )
    expect(
      await verifyCurrentMediaStorage(task(), {
        ...storage(png),
        getStream: async () => ({ stream, size: png.length }),
      }),
    ).toMatchObject({ status: 'pending', reason: 'read-error' })
    expect(stream.destroyed).toBe(true)
  })
})
