import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { GenerationTask } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { currentVideoTailDescriptor } from './deliveryEvidence.js'
import { currentDescriptor, matchesSignature } from './deliveryMediaStorageVerification.js'

const MAX_MEDIA_BYTES = 100 * 1024 * 1024
const MAX_TAIL_BYTES = 10 * 1024 * 1024
const READ_TIMEOUT_MS = 15_000

export function assertDownloadActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppError(499, 'DELIVERY_DOWNLOAD_ABORTED', '下载请求已取消')
}

/** Captures the exact verified bytes; neither URLs nor reopened objects are delivery outputs. */
export async function captureDeliveryMedia(
  task: GenerationTask,
  storage: ObjectStorage | null,
  signal?: AbortSignal,
) {
  const descriptor = currentDescriptor(task)
  if (!descriptor?.sha256)
    throw new AppError(409, 'DELIVERY_MEDIA_UNVERIFIED', '当前媒体缺少可信入库哈希或有效存储描述')
  if (!storage?.getStream) throw new AppError(503, 'DELIVERY_STORAGE_UNAVAILABLE', '媒体存储暂不可用')
  const content = await captureObject(
    storage,
    { ...descriptor, sha256: descriptor.sha256 },
    MAX_MEDIA_BYTES,
    signal,
  )
  const objects = new Map([[descriptor.storageKey, content]])
  if (task.kind === 'video') {
    const tail = currentVideoTailDescriptor(task)
    const outputs = Array.isArray(task.metadata.generatedOutputs) ? task.metadata.generatedOutputs : []
    const tails = outputs.filter((item) => item?.view === 'last-frame')
    const hash: unknown = tails[0]?.sha256
    const prefix = `${task.tenantId}/${task.projectId}/generated/${task.id}-`
    if (
      !tail ||
      tails.length !== 1 ||
      !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(tail.storageKey.slice(prefix.length)) ||
      typeof hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      throw new AppError(409, 'DELIVERY_TAIL_UNVERIFIED', '当前视频尾帧缺少可信入库哈希或有效范围')
    objects.set(
      tail.storageKey,
      await captureObject(storage, { ...tail, sha256: hash }, MAX_TAIL_BYTES, signal),
    )
  }
  // Verification uses only these captured bytes. All writes and external fallbacks are impossible.
  const snapshotStorage: ObjectStorage = {
    get: async (key) => {
      const object = objects.get(key)
      if (!object) throw new Error('Object outside delivery snapshot')
      return object
    },
    getStream: async (key) => {
      const object = objects.get(key)
      if (!object) throw new Error('Object outside delivery snapshot')
      return { size: object.length, stream: Readable.from([object]) }
    },
    put: async () => {
      throw new Error('Delivery snapshot is read-only')
    },
    delete: async () => {
      throw new Error('Delivery snapshot is read-only')
    },
  }
  return { content, descriptor: { ...descriptor, sha256: descriptor.sha256 }, snapshotStorage }
}

async function captureObject(
  storage: ObjectStorage,
  descriptor: { storageKey: string; contentType: string; size: number; sha256: string },
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  assertDownloadActive(signal)
  if (descriptor.size > maxBytes)
    throw new AppError(413, 'DELIVERY_READ_LIMIT', '媒体超过正式下载核验大小上限')
  let stream: Readable | undefined
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel: (() => void) | undefined
  const read = async () => {
    const stored = await storage.getStream!(descriptor.storageKey)
    stream = stored.stream
    if (stopped) {
      stream.destroy()
      throw new Error('Capture stopped')
    }
    if (stored.size !== descriptor.size)
      throw new AppError(409, 'DELIVERY_MEDIA_CHANGED', '媒体大小与入库记录不符')
    const chunks: Buffer[] = []
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of stream) {
      assertDownloadActive(signal)
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > descriptor.size || size > maxBytes)
        throw new AppError(409, 'DELIVERY_MEDIA_CHANGED', '媒体读取大小与入库记录不符')
      hash.update(buffer)
      chunks.push(Buffer.from(buffer))
    }
    const content = Buffer.concat(chunks, size)
    if (
      size !== descriptor.size ||
      hash.digest('hex') !== descriptor.sha256 ||
      !matchesSignature(content.subarray(0, 32), descriptor.contentType, size)
    )
      throw new AppError(409, 'DELIVERY_MEDIA_CHANGED', '媒体签名、大小或哈希与入库记录不符')
    return content
  }
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        const stop = (error: AppError) => {
          stopped = true
          stream?.destroy()
          reject(error)
        }
        cancel = () => stop(new AppError(499, 'DELIVERY_DOWNLOAD_ABORTED', '下载请求已取消'))
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) cancel()
        timer = setTimeout(
          () => stop(new AppError(503, 'DELIVERY_READ_TIMEOUT', '媒体读取超时，请稍后重试')),
          READ_TIMEOUT_MS,
        )
      }),
    ])
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(409, 'DELIVERY_MEDIA_UNAVAILABLE', '当前媒体无法完整读取，正式下载未放行')
  } finally {
    stopped = true
    clearTimeout(timer)
    if (cancel) signal?.removeEventListener('abort', cancel)
    stream?.destroy()
  }
}
