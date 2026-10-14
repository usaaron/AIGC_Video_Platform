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
import { matchesSignature } from './deliveryMediaStorageVerification.js'
import { DeliveryStorageReadError, readDeliveryStorageObject } from './deliveryStorageRead.js'

export type VideoTailStorageVerification = {
  status: 'passed' | 'failed' | 'pending'
  reason:
    | 'task-not-ready'
    | 'missing-current-tail'
    | 'storage-unavailable'
    | 'stream-unavailable'
    | 'read-limit-exceeded'
    | 'read-timeout'
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

/** Verifies the current tail object without writing task state or calling a provider. */
export async function verifyCurrentVideoTailStorage(
  task: GenerationTask,
  storage: ObjectStorage | null,
  signal?: AbortSignal,
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

  const result = (
    status: VideoTailStorageVerification['status'],
    reason: VideoTailStorageVerification['reason'],
    actualSize: number | null,
  ): VideoTailStorageVerification => ({
    status,
    reason,
    storageKey: descriptor.storageKey,
    expectedSize: descriptor.size,
    actualSize,
  })
  const prefix = `${task.tenantId}/${task.projectId}/generated/${task.id}-`
  if (
    ![task.tenantId, task.projectId, task.id].every((id) => /^[a-zA-Z0-9_-]+$/.test(id)) ||
    !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(descriptor.storageKey.slice(prefix.length))
  )
    return result('pending', 'missing-current-tail', null)
  try {
    const read = await readDeliveryStorageObject(
      storage,
      descriptor.storageKey,
      descriptor.size,
      10 * 1024 * 1024,
      signal,
    )
    if (!matchesSignature(read.header, descriptor.contentType, read.size))
      return result('failed', 'content-type-mismatch', read.size)
    return result('passed', 'readable', read.size)
  } catch (error) {
    if (!(error instanceof DeliveryStorageReadError)) throw error
    const failed = ['not-found', 'empty-object', 'size-mismatch'].includes(error.reason)
    return result(failed ? 'failed' : 'pending', error.reason, error.actualSize)
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
  signal?: AbortSignal,
): Promise<DeliveryEvidence | null> {
  if (task.kind !== 'video') return null
  const verification = await verifyCurrentVideoTailStorage(task, storage, signal)
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
