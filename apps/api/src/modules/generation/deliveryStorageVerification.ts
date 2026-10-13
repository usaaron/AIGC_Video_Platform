import {
  deliveryEvidenceSchema,
  DELIVERY_REQUIREMENT_IDS,
  needsVideoReview,
  videoReviewState,
  type DeliveryEvidence,
  type GenerationTask,
} from '@seqora/contracts'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { buildGenerationTaskDeliveryEvidence, currentVideoTailDescriptor } from './deliveryEvidence.js'

export type VideoTailStorageVerification = {
  status: 'passed' | 'failed' | 'pending'
  reason:
    | 'task-not-ready'
    | 'missing-current-tail'
    | 'storage-unavailable'
    | 'not-found'
    | 'read-error'
    | 'empty-object'
    | 'size-mismatch'
    | 'content-type-mismatch'
    | 'readable'
  storageKey: string | null
  expectedSize: number | null
  actualSize: number | null
}

function hasSignature(content: Buffer, contentType: string): boolean {
  if (contentType === 'image/png') {
    return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  }
  if (contentType === 'image/jpeg') return content.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  if (contentType === 'image/gif') {
    const header = content.subarray(0, 6).toString('ascii')
    return header === 'GIF87a' || header === 'GIF89a'
  }
  if (contentType === 'image/webp') {
    return (
      content.subarray(0, 4).toString('ascii') === 'RIFF' &&
      content.subarray(8, 12).toString('ascii') === 'WEBP'
    )
  }
  return false
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; statusCode?: unknown }
  return value.code === 'ENOENT' || value.code === 404 || value.statusCode === 404
}

/** Verifies the current tail object without writing task state or calling a provider. */
export async function verifyCurrentVideoTailStorage(
  task: GenerationTask,
  storage: ObjectStorage | null,
): Promise<VideoTailStorageVerification> {
  if (task.kind !== 'video' || task.status !== 'completed') {
    return {
      status: 'pending',
      reason: 'task-not-ready',
      storageKey: null,
      expectedSize: null,
      actualSize: null,
    }
  }
  const descriptor = currentVideoTailDescriptor(task)
  if (!descriptor) {
    return {
      status: 'pending',
      reason: 'missing-current-tail',
      storageKey: null,
      expectedSize: null,
      actualSize: null,
    }
  }
  if (!storage) {
    return {
      status: 'pending',
      reason: 'storage-unavailable',
      storageKey: descriptor.storageKey,
      expectedSize: descriptor.size,
      actualSize: null,
    }
  }

  let content: Buffer
  try {
    content = await storage.get(descriptor.storageKey)
  } catch (error) {
    return {
      status: isNotFound(error) ? 'failed' : 'pending',
      reason: isNotFound(error) ? 'not-found' : 'read-error',
      storageKey: descriptor.storageKey,
      expectedSize: descriptor.size,
      actualSize: null,
    }
  }
  if (content.length === 0) {
    return {
      status: 'failed',
      reason: 'empty-object',
      storageKey: descriptor.storageKey,
      expectedSize: descriptor.size,
      actualSize: 0,
    }
  }
  if (content.length !== descriptor.size) {
    return {
      status: 'failed',
      reason: 'size-mismatch',
      storageKey: descriptor.storageKey,
      expectedSize: descriptor.size,
      actualSize: content.length,
    }
  }
  if (!hasSignature(content, descriptor.contentType)) {
    return {
      status: 'failed',
      reason: 'content-type-mismatch',
      storageKey: descriptor.storageKey,
      expectedSize: descriptor.size,
      actualSize: content.length,
    }
  }
  return {
    status: 'passed',
    reason: 'readable',
    storageKey: descriptor.storageKey,
    expectedSize: descriptor.size,
    actualSize: content.length,
  }
}

/**
 * Converts storage validation into a delivery fact. It only passes continuity
 * when the read succeeds and the ordinary review/physics gates are already observed.
 */
export async function buildVideoTailStorageEvidence(
  task: GenerationTask,
  storage: ObjectStorage | null,
  checkedAt = new Date().toISOString(),
): Promise<DeliveryEvidence | null> {
  if (task.kind !== 'video') return null
  const verification = await verifyCurrentVideoTailStorage(task, storage)
  const base = buildGenerationTaskDeliveryEvidence(task).find((item) => item.kind === 'continuity')
  if (!base) return null
  const status =
    base.status === 'failed'
      ? 'failed'
      : base.status === 'observed' && verification.status === 'passed'
        ? 'passed'
        : verification.status === 'failed'
          ? 'failed'
          : 'pending'
  return deliveryEvidenceSchema.parse({
    ...base,
    status,
    observedAt: checkedAt,
    requirementIds: [DELIVERY_REQUIREMENT_IDS.continuityReady],
    details: {
      ...base.details,
      storageStatus: verification.status,
      storageReason: verification.reason,
      storageSize: verification.actualSize,
      reviewState: videoReviewState(task),
      reviewRequired: needsVideoReview(task),
    },
  })
}
