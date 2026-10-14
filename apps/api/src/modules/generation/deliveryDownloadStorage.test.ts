import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { downloadTask } from './deliveryDownload.fixture.js'
import { captureDeliveryMedia } from './deliveryDownloadStorage.js'

const png = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex')
function fixture() {
  const task = downloadTask()
  const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-single.png`
  task.outputs = [{ id: 'output-1', mediaType: 'image', view: 'single', url: task.resultUrl! }]
  task.metadata.generatedOutputs = [
    {
      view: 'single',
      storageKey,
      size: png.length,
      contentType: 'image/png',
      sha256: createHash('sha256').update(png).digest('hex'),
    },
  ]
  const storage: ObjectStorage = {
    put: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    getStream: vi.fn(async () => ({ stream: Readable.from([png]), size: png.length })),
  }
  return { task, storage, storageKey }
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('formal download capture budget', () => {
  it('captures verified bytes once and never reopens storage for proof', async () => {
    const { task, storage, storageKey } = fixture()
    const captured = await captureDeliveryMedia(task, storage)
    expect(captured.content).toEqual(png)
    expect(await captured.snapshotStorage.get(storageKey)).toEqual(png)
    expect(storage.getStream).toHaveBeenCalledTimes(1)
    await expect(captured.snapshotStorage.get('another/key')).rejects.toThrow()
    await expect(captured.snapshotStorage.put(storageKey, png, 'image/png')).rejects.toThrow('read-only')
  })

  it('rejects an oversized declared file before opening a stream', async () => {
    const { task, storage } = fixture()
    ;(task.metadata.generatedOutputs as Array<{ size: number }>)[0]!.size = 101 * 1024 * 1024
    await expect(captureDeliveryMedia(task, storage)).rejects.toMatchObject({ statusCode: 413 })
    expect(storage.getStream).not.toHaveBeenCalled()
  })

  it('destroys a stream that exceeds its declared length', async () => {
    const { task, storage } = fixture()
    const stream = Readable.from([png, Buffer.from('extra')])
    vi.mocked(storage.getStream!).mockResolvedValue({ stream, size: png.length })
    await expect(captureDeliveryMedia(task, storage)).rejects.toMatchObject({
      code: 'DELIVERY_MEDIA_CHANGED',
    })
    expect(stream.destroyed).toBe(true)
  })

  it('ends a stalled stream within the time budget', async () => {
    vi.useFakeTimers()
    const { task, storage } = fixture()
    const stream = new Readable({ read() {} })
    vi.mocked(storage.getStream!).mockResolvedValue({ stream, size: png.length })
    const expectation = expect(captureDeliveryMedia(task, storage)).rejects.toMatchObject({
      code: 'DELIVERY_READ_TIMEOUT',
    })
    await vi.advanceTimersByTimeAsync(15_001)
    await expectation
    expect(stream.destroyed).toBe(true)
  })

  it('destroys a late-opening stream after a timeout without reading any bytes', async () => {
    vi.useFakeTimers()
    const { task, storage } = fixture()
    const stream = new Readable({
      read() {
        throw new Error('Should not read')
      },
    })
    let resolveOpen!: (value: { stream: Readable; size: number }) => void
    vi.mocked(storage.getStream!).mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = resolve
      }),
    )
    const expectation = expect(captureDeliveryMedia(task, storage)).rejects.toMatchObject({
      code: 'DELIVERY_READ_TIMEOUT',
    })
    await vi.advanceTimersByTimeAsync(15_001)
    await expectation
    resolveOpen({ stream, size: png.length })
    await Promise.resolve()
    expect(stream.destroyed).toBe(true)
  })

  it('closes active and late streams on client cancellation', async () => {
    const { task, storage } = fixture()
    const stream = new Readable({ read() {} })
    vi.mocked(storage.getStream!).mockResolvedValue({ stream, size: png.length })
    const controller = new AbortController()
    const expectation = expect(captureDeliveryMedia(task, storage, controller.signal)).rejects.toMatchObject({
      statusCode: 499,
    })
    await Promise.resolve()
    controller.abort()
    await expectation
    expect(stream.destroyed).toBe(true)
    await expect(captureDeliveryMedia(task, storage, controller.signal)).rejects.toMatchObject({
      statusCode: 499,
    })
    expect(storage.getStream).toHaveBeenCalledTimes(1)
  })
})
