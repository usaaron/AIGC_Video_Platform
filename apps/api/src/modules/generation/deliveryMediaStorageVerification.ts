import {
  deliveryEvidenceSchema,
  deliveryMediaStorageProofSchema,
  type DeliveryEvidence,
  type DeliveryMediaStorageProof,
  type GenerationTask,
} from '@seqora/contracts'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { buildGenerationTaskDeliveryEvidence } from './deliveryEvidence.js'
import { DeliveryStorageReadError, readDeliveryStorageObject } from './deliveryStorageRead.js'

type Descriptor = { storageKey: string; contentType: string; size: number; sha256: string | null }

// The main-media read is limited to 100 MiB / 15 seconds, retaining only a hash and 32 header bytes.
const MAX_MEDIA_BYTES = 100 * 1024 * 1024

const IMAGE_VIEWS = ['single', 'front', 'side', 'back', 'detail']
const CONTENT_TYPES = ['video/mp4', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']

export function currentDescriptor(task: GenerationTask): Descriptor | null {
  const contentUrl = `/api/v1/generation/tasks/${task.id}/content`
  let candidate: unknown
  if (task.kind === 'video') {
    if (task.resultUrl !== contentUrl) return null
    if (task.provider === 'local-compose') {
      candidate = {
        storageKey: task.metadata.previewStorageKey,
        contentType: task.metadata.previewContentType,
        size: task.metadata.previewSize,
        sha256: task.metadata.previewSha256,
      }
    } else if (task.provider === 'seedance' && Array.isArray(task.metadata.generatedOutputs)) {
      const matches = task.metadata.generatedOutputs.filter((item) => item?.view === 'single')
      if (matches.length !== 1) return null
      candidate = matches[0]
      if (!task.metadata.videoStorageKey || matches[0]?.storageKey !== task.metadata.videoStorageKey)
        return null
    }
  } else if (task.kind === 'image' && Array.isArray(task.metadata.generatedOutputs)) {
    const output = task.outputs.find((item) => item.url === task.resultUrl && item.mediaType === 'image')
    if (!output || !IMAGE_VIEWS.includes(output.view)) return null
    if (output.url !== `/api/v1/generation/tasks/${task.id}/outputs/${output.view}`) return null
    const matches = task.metadata.generatedOutputs.filter((item) => item?.view === output.view)
    if (matches.length !== 1) return null
    candidate = matches[0]
  }
  if (!candidate || typeof candidate !== 'object') return null
  const value = candidate as { storageKey?: unknown; contentType?: unknown; size?: unknown; sha256?: unknown }
  const prefix = `${task.tenantId}/${task.projectId}/generated/${task.id}-`
  // Exact flat object namespace: reject traversal, separators and URL-encoded keys before I/O.
  if (typeof value.storageKey !== 'string' || !value.storageKey.startsWith(prefix)) return null
  if (![task.tenantId, task.projectId, task.id].every((id) => /^[a-zA-Z0-9_-]+$/.test(id))) return null
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(value.storageKey.slice(prefix.length))) return null
  if (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0) return null
  if (typeof value.contentType !== 'string' || !value.contentType.startsWith(`${task.kind}/`)) return null
  return {
    storageKey: value.storageKey,
    contentType: value.contentType,
    size: value.size,
    sha256: typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) ? value.sha256 : null,
  }
}

export function matchesSignature(header: Buffer, contentType: string, size: number): boolean {
  if (contentType === 'video/mp4') {
    return (
      header.length >= 16 &&
      header.toString('ascii', 4, 8) === 'ftyp' &&
      header.readUInt32BE(0) >= 16 &&
      header.readUInt32BE(0) <= size
    )
  }
  if (contentType === 'image/png')
    return header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (contentType === 'image/jpeg') return header.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  if (contentType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6))
  if (contentType === 'image/webp')
    return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
  return false
}

/** Never fetches a result URL or falls back to a Provider. Historical files without a baseline stay pending. */
export async function verifyCurrentMediaStorage(
  task: GenerationTask,
  storage: ObjectStorage | null,
  signal?: AbortSignal,
): Promise<DeliveryMediaStorageProof> {
  const descriptor = currentDescriptor(task)
  const proof: DeliveryMediaStorageProof = {
    status: 'pending',
    reason: 'task-not-ready',
    contentType: descriptor?.contentType ?? null,
    expectedSize: descriptor?.size ?? null,
    actualSize: null,
    expectedSha256: descriptor?.sha256 ?? null,
    actualSha256: null,
  }
  const result = (status: DeliveryMediaStorageProof['status'], reason: DeliveryMediaStorageProof['reason']) =>
    deliveryMediaStorageProofSchema.parse({ ...proof, status, reason })
  if (task.status !== 'completed' || !['image', 'video'].includes(task.kind))
    return result('pending', 'task-not-ready')
  if (!descriptor) return result('pending', 'missing-current-media')
  if (!storage) return result('pending', 'storage-unavailable')
  if (!storage.getStream) return result('pending', 'stream-unavailable')
  if (!CONTENT_TYPES.includes(descriptor.contentType)) return result('pending', 'unsupported-content-type')
  if (descriptor.size > MAX_MEDIA_BYTES) return result('pending', 'read-limit-exceeded')

  try {
    const read = await readDeliveryStorageObject(
      storage,
      descriptor.storageKey,
      descriptor.size,
      MAX_MEDIA_BYTES,
      signal,
    )
    proof.actualSize = read.size
    proof.actualSha256 = read.sha256
    if (!matchesSignature(read.header, descriptor.contentType, read.size))
      return result('failed', 'content-type-mismatch')
    if (!descriptor.sha256) return result('pending', 'missing-checksum')
    if (read.sha256 !== descriptor.sha256) return result('failed', 'checksum-mismatch')
    return result('passed', 'verified')
  } catch (error) {
    if (!(error instanceof DeliveryStorageReadError)) throw error
    proof.actualSize = error.actualSize
    const failed = ['not-found', 'empty-object', 'size-mismatch'].includes(error.reason)
    return result(failed ? 'failed' : 'pending', error.reason)
  }
}
export async function buildMediaStorageEvidence(
  task: GenerationTask,
  storage: ObjectStorage | null,
  checkedAt = new Date().toISOString(),
  signal?: AbortSignal,
): Promise<DeliveryEvidence | null> {
  if (!['image', 'video'].includes(task.kind)) return null
  const base = buildGenerationTaskDeliveryEvidence(task).find((item) => item.kind === 'asset')!
  const proof = await verifyCurrentMediaStorage(task, storage, signal)
  return deliveryEvidenceSchema.parse({
    ...base,
    status: base.status === 'failed' ? 'failed' : proof.status,
    observedAt: checkedAt,
    details: { ...base.details, storageProof: proof },
  })
}
