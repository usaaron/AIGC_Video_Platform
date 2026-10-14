import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { ObjectStorage } from '../../infra/objectStorage.js'

type ReadFailureReason =
  | 'stream-unavailable'
  | 'read-limit-exceeded'
  | 'read-timeout'
  | 'not-found'
  | 'read-error'
  | 'empty-object'
  | 'size-mismatch'

export class DeliveryStorageReadError extends Error {
  constructor(
    readonly reason: ReadFailureReason,
    readonly actualSize: number | null = null,
  ) {
    super(reason)
  }
}

/** Reads only a bounded stream; retains an incremental hash and 32 signature bytes. */
export async function readDeliveryStorageObject(
  storage: ObjectStorage,
  storageKey: string,
  expectedSize: number,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ size: number; header: Buffer; sha256: string }> {
  if (signal?.aborted) throw new DeliveryStorageReadError('read-error')
  if (!storage.getStream) throw new DeliveryStorageReadError('stream-unavailable')
  if (expectedSize > maxBytes) throw new DeliveryStorageReadError('read-limit-exceeded')
  let stream: Readable | undefined
  let stopped = false
  let actualSize: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel: (() => void) | undefined
  const read = async () => {
    const object = await storage.getStream!(storageKey)
    stream = object.stream
    if (stopped || signal?.aborted) {
      stream.destroy()
      throw new DeliveryStorageReadError('read-error')
    }
    if (object.size > maxBytes) throw new DeliveryStorageReadError('read-limit-exceeded')
    if (object.size !== expectedSize) {
      actualSize = Number.isSafeInteger(object.size) && object.size >= 0 ? object.size : null
      throw new DeliveryStorageReadError(object.size === 0 ? 'empty-object' : 'size-mismatch', actualSize)
    }
    const hash = createHash('sha256')
    let size = 0
    let header = Buffer.alloc(0)
    for await (const chunk of stream) {
      if (stopped || signal?.aborted) throw new DeliveryStorageReadError('read-error', actualSize)
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      actualSize = size
      if (size > maxBytes) throw new DeliveryStorageReadError('read-limit-exceeded', size)
      if (size > expectedSize) throw new DeliveryStorageReadError('size-mismatch', size)
      hash.update(bytes)
      if (header.length < 32) header = Buffer.concat([header, bytes.subarray(0, 32 - header.length)])
    }
    actualSize = size
    if (!size) throw new DeliveryStorageReadError('empty-object', 0)
    if (size !== expectedSize) throw new DeliveryStorageReadError('size-mismatch', size)
    return { size, header, sha256: hash.digest('hex') }
  }
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        const stop = (reason: ReadFailureReason) => {
          stopped = true
          stream?.destroy()
          reject(new DeliveryStorageReadError(reason, actualSize))
        }
        cancel = () => stop('read-error')
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) cancel()
        timer = setTimeout(() => stop('read-timeout'), 15_000)
      }),
    ])
  } catch (error) {
    if (error instanceof DeliveryStorageReadError) throw error
    const value = error as { code?: unknown; statusCode?: unknown } | null
    const missing = value?.code === 'ENOENT' || value?.code === 404 || value?.statusCode === 404
    throw new DeliveryStorageReadError(missing ? 'not-found' : 'read-error', actualSize)
  } finally {
    stopped = true
    clearTimeout(timer)
    if (cancel) signal?.removeEventListener('abort', cancel)
    stream?.destroy()
  }
}
