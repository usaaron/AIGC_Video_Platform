import { createHash } from 'node:crypto'
import {
  deliveryEvidenceSchema,
  rigidPhysicsAuditResultSchema,
  videoReviewState,
  needsVideoReview,
  videoReviewVersion,
  DELIVERY_REQUIREMENT_IDS,
  type DeliveryEvidence,
  type DeliveryEvidenceKind,
  type DeliveryEvidenceStatus,
  type GenerationTask,
} from '@seqora/contracts'
import { providerCompletionEvidence } from './providerCompletionEvidence.js'

export type VideoTailDescriptor = {
  storageKey: string
  contentType: string
  size: number
}

function metadataString(task: GenerationTask, key: string): string | null {
  const value = task.metadata[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function providerState(task: GenerationTask): string | null {
  return metadataString(task, 'providerState')
}

function currentMediaVersion(task: GenerationTask): string | null {
  if (task.kind === 'video') return videoReviewVersion(task)
  const outputs = task.outputs.map((output) => [output.id, output.mediaType, output.view, output.url.trim()])
  return JSON.stringify([task.id, task.resultUrl?.trim() || null, outputs])
}

function scopeFor(task: GenerationTask) {
  return {
    tenantId: task.tenantId,
    projectId: task.projectId,
    taskId: task.id,
    taskUpdatedAt: task.updatedAt,
    mediaVersion: currentMediaVersion(task),
  }
}

function stableEvidenceId(task: GenerationTask, kind: DeliveryEvidenceKind): string {
  const input = JSON.stringify({ scope: scopeFor(task), kind })
  return createHash('sha256').update(input).digest('hex')
}

function evidenceStatusForTask(task: GenerationTask): DeliveryEvidenceStatus {
  if (task.status === 'completed') return 'passed'
  if (task.status === 'failed' || task.status === 'cancelled') return 'failed'
  return 'pending'
}

function evidenceStatusForProvider(task: GenerationTask): DeliveryEvidenceStatus {
  const state = providerState(task)
  if (state === 'failed' || state === 'cancelled') return 'failed'
  if (providerCompletionEvidence(task).receipt) return 'passed'
  if (metadataString(task, 'providerTaskId') && ['queued', 'running', 'completed'].includes(state ?? '')) {
    return 'observed'
  }
  return task.status === 'failed' ? 'failed' : 'pending'
}

function hasMediaCandidate(task: GenerationTask): boolean {
  const expectedType =
    task.kind === 'video' || task.kind === 'image' || task.kind === 'audio' ? task.kind : null
  if (expectedType === null) return false
  if (task.resultUrl && task.resultUrl.trim().length > 0) return true
  return task.outputs.some((output) => output.mediaType === expectedType && output.url.trim().length > 0)
}

function mediaEvidenceStatus(task: GenerationTask): DeliveryEvidenceStatus {
  if (hasMediaCandidate(task)) return 'observed'
  if (task.status === 'failed' || task.status === 'cancelled') return 'failed'
  return 'pending'
}

function reviewEvidenceStatus(task: GenerationTask): DeliveryEvidenceStatus {
  const reviewState = videoReviewState(task)
  if (reviewState === 'approved') return 'passed'
  if (reviewState === 'rejected') return 'failed'
  return 'pending'
}

function rawPhysicsEvidence(task: GenerationTask): unknown {
  return task.metadata.rigidPhysicsAudit
}

function currentMediaVersionMatches(task: GenerationTask, mediaVersion: string): boolean {
  return mediaVersion === currentMediaVersion(task)
}

function validPhysicsAudit(task: GenerationTask) {
  if (task.kind !== 'video' || task.status !== 'completed') return null
  const parsed = rigidPhysicsAuditResultSchema.safeParse(rawPhysicsEvidence(task))
  if (!parsed.success || !currentMediaVersionMatches(task, parsed.data.mediaVersion)) return null
  return parsed.data
}

function hasPhysicsFact(task: GenerationTask): boolean {
  return task.metadata.rigidPhysicsContract !== undefined || rawPhysicsEvidence(task) !== undefined
}

function physicalEvidenceStatus(task: GenerationTask): DeliveryEvidenceStatus {
  if (!hasPhysicsFact(task)) return 'pending'
  const audit = validPhysicsAudit(task)
  if (!audit) return 'pending'
  if (audit.status === 'passed') return 'passed'
  if (audit.status === 'failed') return 'failed'
  return 'pending'
}

export function currentVideoTailDescriptor(task: GenerationTask): VideoTailDescriptor | null {
  const generatedOutputs = task.metadata.generatedOutputs
  if (!Array.isArray(generatedOutputs)) return null
  const currentStorageKey = metadataString(task, 'lastFrameStorageKey')
  if (!currentStorageKey) return null
  const expectedPrefix = `${task.tenantId}/${task.projectId}/generated/${task.id}-`
  if (!currentStorageKey.startsWith(expectedPrefix)) return null
  const candidate = generatedOutputs.find((item) => {
    if (!item || typeof item !== 'object') return false
    return (item as { view?: unknown }).view === 'last-frame'
  })
  if (!candidate || typeof candidate !== 'object') return null
  const value = candidate as { storageKey?: unknown; contentType?: unknown; size?: unknown }
  if (typeof value.storageKey !== 'string' || value.storageKey.trim() !== currentStorageKey) return null
  if (typeof value.contentType !== 'string' || !value.contentType.trim().toLowerCase().startsWith('image/'))
    return null
  if (typeof value.size !== 'number' || !Number.isInteger(value.size) || value.size <= 0) return null
  return {
    storageKey: currentStorageKey,
    contentType: value.contentType.trim().toLowerCase(),
    size: value.size,
  }
}

function continuityEvidenceStatus(task: GenerationTask): DeliveryEvidenceStatus {
  if (task.status === 'failed' || task.status === 'cancelled') return 'failed'
  if (task.status !== 'completed' || !hasMediaCandidate(task)) return 'pending'
  if (needsVideoReview(task) && videoReviewState(task) === 'rejected') return 'failed'
  if (needsVideoReview(task) && videoReviewState(task) !== 'approved') return 'pending'
  if (hasPhysicsFact(task) && physicalEvidenceStatus(task) !== 'passed') return 'pending'
  return currentVideoTailDescriptor(task) ? 'observed' : 'pending'
}

function evidence(input: {
  task: GenerationTask
  kind: DeliveryEvidenceKind
  status: DeliveryEvidenceStatus
  requirementIds: readonly string[]
  refType: string
  details?: Record<string, unknown>
}): DeliveryEvidence {
  const taskScope = scopeFor(input.task)
  return deliveryEvidenceSchema.parse({
    evidenceId: stableEvidenceId(input.task, input.kind),
    kind: input.kind,
    status: input.status,
    requirementIds: [...input.requirementIds],
    refType: input.refType,
    refId: input.task.id,
    observedAt: input.task.updatedAt,
    scope: taskScope,
    details: { taskStatus: input.task.status, ...input.details },
  })
}

/**
 * Projects server-owned task facts into a scoped, read-only evidence snapshot.
 * It does not perform storage I/O, semantic quality review, or delivery gating.
 */
export function buildGenerationTaskDeliveryEvidence(task: GenerationTask): DeliveryEvidence[] {
  const result: DeliveryEvidence[] = [
    evidence({
      task,
      kind: 'task',
      status: evidenceStatusForTask(task),
      requirementIds: [DELIVERY_REQUIREMENT_IDS.taskCompleted],
      refType: 'generation-task',
      details: { taskStatus: task.status },
    }),
    evidence({
      task,
      kind: 'provider',
      status: evidenceStatusForProvider(task),
      requirementIds: [DELIVERY_REQUIREMENT_IDS.providerAccepted, DELIVERY_REQUIREMENT_IDS.providerCompleted],
      refType: 'provider-task',
      details: {
        provider: task.provider,
        providerState: providerState(task),
        completion: providerCompletionEvidence(task),
      },
    }),
    evidence({
      task,
      kind: 'asset',
      status: mediaEvidenceStatus(task),
      requirementIds: [DELIVERY_REQUIREMENT_IDS.mediaUrl],
      refType: 'generation-output',
      details: {
        candidate: hasMediaCandidate(task),
        outputCount: task.outputs.length,
        mediaVersion: currentMediaVersion(task),
      },
    }),
  ]

  if (task.kind === 'video' && needsVideoReview(task)) {
    result.push(
      evidence({
        task,
        kind: 'content-review',
        status: reviewEvidenceStatus(task),
        requirementIds: [DELIVERY_REQUIREMENT_IDS.contentReview],
        refType: 'video-review',
        details: { reviewState: videoReviewState(task) },
      }),
    )
  }

  if (task.kind === 'video' && hasPhysicsFact(task)) {
    const audit = validPhysicsAudit(task)
    result.push(
      evidence({
        task,
        kind: 'physics',
        status: physicalEvidenceStatus(task),
        requirementIds: [DELIVERY_REQUIREMENT_IDS.physicalReview],
        refType: 'rigid-physics-audit',
        details: {
          auditState: audit?.status ?? 'pending',
          mediaVersionMatched: audit !== null,
        },
      }),
    )
  }

  if (task.kind === 'video') {
    const tail = currentVideoTailDescriptor(task)
    result.push(
      evidence({
        task,
        kind: 'continuity',
        status: continuityEvidenceStatus(task),
        requirementIds: [DELIVERY_REQUIREMENT_IDS.continuityReady],
        refType: 'video-continuity',
        details: {
          tailCandidate: tail !== null,
          tailSize: tail?.size ?? null,
          tailContentType: tail?.contentType ?? null,
          reviewState: videoReviewState(task),
          physicalState: physicalEvidenceStatus(task),
        },
      }),
    )
  }

  return result
}
