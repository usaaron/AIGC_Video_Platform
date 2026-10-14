import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerationTask } from '@seqora/contracts'
import { downloadTask, downloadPrincipal } from './deliveryDownload.fixture.js'
import { readDeliveryQuery } from './deliveryQuery.js'
import { buildDeliveryVerificationSnapshot } from './deliveryVerification.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'

const png = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex')
function fixture() {
  const task = downloadTask()
  const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-single.png`
  task.outputs = [{ id: 'output-1', mediaType: 'image', view: 'single', url: task.resultUrl! }]
  task.metadata.generatedOutputs = [
    {
      view: 'single',
      storageKey,
      contentType: 'image/png',
      size: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    },
  ]
  const repository = { findById: vi.fn(async (): Promise<GenerationTask | null> => structuredClone(task)) }
  const storage: ObjectStorage = {
    put: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    getStream: vi.fn(async () => ({ size: png.length, stream: Readable.from([png]) })),
  }
  const run = (signal?: AbortSignal) =>
    readDeliveryQuery(repository, storage, task.id, downloadPrincipal, signal)
  return { task, storage, repository, run }
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('GET delivery query resource budget', () => {
  it('checks task access before acquiring a slot or reading storage', async () => {
    const test = fixture()
    test.repository.findById.mockResolvedValue(null)
    await expect(test.run()).rejects.toMatchObject({ statusCode: 404 })
    expect(test.storage.getStream).not.toHaveBeenCalled()
    expect(test.storage.get).not.toHaveBeenCalled()
  })

  it('caps queries at four and releases slots on abort without limiting internal snapshot verification', async () => {
    const test = fixture()
    const streams: Readable[] = []
    vi.mocked(test.storage.getStream!).mockImplementation(async () => {
      const stream = new Readable({ read() {} })
      streams.push(stream)
      return { stream, size: png.length }
    })
    const controllers = Array.from({ length: 4 }, () => new AbortController())
    const pending = controllers.map((controller) => test.run(controller.signal).catch((error) => error))
    await Promise.resolve()
    await Promise.resolve()
    await expect(test.run()).rejects.toMatchObject({ statusCode: 429, code: 'DELIVERY_QUERY_BUSY' })
    expect(test.storage.getStream).toHaveBeenCalledTimes(4)
    test.repository.findById.mockResolvedValueOnce(null)
    await expect(test.run()).rejects.toMatchObject({ statusCode: 404 })
    const available = fixture()
    expect(
      (await buildDeliveryVerificationSnapshot(available.task, available.storage, available.task.updatedAt))
        .verification?.status,
    ).toBe('satisfied')
    for (const controller of controllers) controller.abort()
    const results = await Promise.all(pending)
    expect(results.every((error) => error.code === 'DELIVERY_QUERY_ABORTED')).toBe(true)
    expect(streams.every((stream) => stream.destroyed)).toBe(true)
    expect((await available.run()).snapshot.verification?.status).toBe('satisfied')
  })

  it('bounds the whole query including a delayed repository lookup and destroys late streams', async () => {
    vi.useFakeTimers()
    const test = fixture()
    test.repository.findById.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(structuredClone(test.task)), 10_000)
        }),
    )
    let resolveOpen!: (value: { size: number; stream: Readable }) => void
    vi.mocked(test.storage.getStream!).mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = resolve
      }),
    )
    const outcome = test.run().catch((error) => error)
    await vi.advanceTimersByTimeAsync(15_001)
    expect(await outcome).toMatchObject({ statusCode: 503, code: 'DELIVERY_QUERY_TIMEOUT' })
    const late = new Readable({
      read() {
        throw new Error('Must not read expired stream')
      },
    })
    resolveOpen({ size: png.length, stream: late })
    await Promise.resolve()
    expect(late.destroyed).toBe(true)
    expect((await fixture().run()).snapshot.verification?.status).toBe('satisfied')
  })

  it('does not acquire a slot or open media when repository lookup finishes after cancellation', async () => {
    const test = fixture()
    let resolveTask!: (task: GenerationTask) => void
    test.repository.findById.mockReturnValue(
      new Promise((resolve) => {
        resolveTask = resolve
      }),
    )
    const controller = new AbortController()
    const outcome = test.run(controller.signal).catch((error) => error)
    controller.abort()
    expect(await outcome).toMatchObject({ statusCode: 499 })
    resolveTask(test.task)
    await Promise.resolve()
    expect(test.storage.getStream).not.toHaveBeenCalled()
  })

  it('rejects an already aborted request before even reading the task', async () => {
    const test = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(test.run(controller.signal)).rejects.toMatchObject({ statusCode: 499 })
    expect(test.repository.findById).not.toHaveBeenCalled()
    expect(test.storage.getStream).not.toHaveBeenCalled()
  })

  it('closes both current video and tail streams when the overall deadline expires', async () => {
    vi.useFakeTimers()
    const test = fixture()
    const task = test.task
    task.kind = 'video'
    task.provider = 'seedance'
    task.resultUrl = `/api/v1/generation/tasks/${task.id}/content`
    const prefix = `${task.tenantId}/${task.projectId}/generated/${task.id}-`
    task.metadata.videoStorageKey = prefix + 'single.mp4'
    task.metadata.lastFrameStorageKey = prefix + 'tail.png'
    task.metadata.generatedOutputs = [
      {
        view: 'single',
        storageKey: task.metadata.videoStorageKey,
        contentType: 'video/mp4',
        size: 24,
        sha256: 'a'.repeat(64),
      },
      {
        view: 'last-frame',
        storageKey: task.metadata.lastFrameStorageKey,
        contentType: 'image/png',
        size: 12,
      },
    ]
    const streams: Readable[] = []
    vi.mocked(test.storage.getStream!).mockImplementation(async (key) => {
      const stream = new Readable({ read() {} })
      streams.push(stream)
      return { stream, size: key.endsWith('.mp4') ? 24 : 12 }
    })
    const outcome = test.run().catch((error) => error)
    await vi.advanceTimersByTimeAsync(15_001)
    expect(await outcome).toMatchObject({ code: 'DELIVERY_QUERY_TIMEOUT' })
    expect(streams).toHaveLength(2)
    expect(streams.every((stream) => stream.destroyed)).toBe(true)
  })
})
