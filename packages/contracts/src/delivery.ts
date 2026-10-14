import { z } from 'zod'

/** The product-level artifact a user asked the system to deliver. */
export const deliveryArtifactTypeSchema = z.enum(['text', 'image', 'video', 'episode'])
export type DeliveryArtifactType = z.infer<typeof deliveryArtifactTypeSchema>

export const deliveryModeSchema = z.enum(['response', 'asset', 'shot', 'episode'])
export type DeliveryMode = z.infer<typeof deliveryModeSchema>

export const deliveryRequirementSourceSchema = z.enum([
  'user',
  'script',
  'storyboard',
  'system',
  'provider',
  'review',
])

export const deliveryRequirementSchema = z.object({
  id: z.string().trim().min(1).max(160),
  statement: z.string().trim().min(1).max(2_000),
  source: deliveryRequirementSourceSchema,
})
export type DeliveryRequirement = z.infer<typeof deliveryRequirementSchema>

export const deliveryIntentSchema = z.object({
  mode: deliveryModeSchema,
  projectId: z.string().trim().min(1),
  episodeId: z.string().trim().min(1).nullable().default(null),
  shotIds: z.array(z.string().trim().min(1)).max(500).default([]),
})
export type DeliveryIntent = z.infer<typeof deliveryIntentSchema>

/**
 * This contract freezes what the current run is expected to deliver.
 * `contractHash` is assigned by the owning service when the contract is frozen;
 * a draft is allowed to carry null before that boundary.
 */
export const deliveryContractSchema = z
  .object({
    version: z.literal('seqora.delivery.v1'),
    contractHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    intent: deliveryIntentSchema,
    expectedArtifact: z.object({
      type: deliveryArtifactTypeSchema,
      count: z.number().int().positive().max(500),
    }),
    must: z.array(deliveryRequirementSchema).min(1).max(200),
    frozenAt: z.string().datetime().nullable().default(null),
  })
  .superRefine((contract, context) => {
    if (contract.contractHash !== null && contract.frozenAt === null) {
      context.addIssue({ code: 'custom', path: ['frozenAt'], message: '带哈希的合同必须有冻结时间' })
    }
    if (contract.contractHash === null && contract.frozenAt !== null) {
      context.addIssue({ code: 'custom', path: ['contractHash'], message: '冻结合同必须有哈希' })
    }
    const ids = contract.must.map((requirement) => requirement.id)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['must'], message: '交付要求 ID 必须唯一' })
    }
  })
export type DeliveryContract = z.infer<typeof deliveryContractSchema>

export const deliveryContractFreezeRequestSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  contract: deliveryContractSchema,
})
export type DeliveryContractFreezeRequest = z.infer<typeof deliveryContractFreezeRequestSchema>

export const deliveryEvidenceKindSchema = z.enum([
  'source',
  'task',
  'provider',
  'asset',
  'continuity',
  'physics',
  'content-review',
  'billing',
])
export type DeliveryEvidenceKind = z.infer<typeof deliveryEvidenceKindSchema>

export const deliveryEvidenceStatusSchema = z.enum(['observed', 'passed', 'failed', 'pending'])
export type DeliveryEvidenceStatus = z.infer<typeof deliveryEvidenceStatusSchema>

/** Every projected fact is scoped to one immutable task/media snapshot. */
export const deliveryEvidenceScopeSchema = z.object({
  tenantId: z.string().trim().min(1).max(200),
  projectId: z.string().trim().min(1).max(200),
  taskId: z.string().trim().min(1).max(200),
  taskUpdatedAt: z.string().datetime(),
  mediaVersion: z.string().trim().min(1).max(2_000).nullable(),
})
export type DeliveryEvidenceScope = z.infer<typeof deliveryEvidenceScopeSchema>

/** Read-only proof from a complete object read, compared with its ingestion checksum. */
export const deliveryMediaStorageProofSchema = z.object({
  status: z.enum(['passed', 'failed', 'pending']),
  reason: z.enum([
    'task-not-ready',
    'missing-current-media',
    'storage-unavailable',
    'stream-unavailable',
    'read-limit-exceeded',
    'read-timeout',
    'not-found',
    'read-error',
    'empty-object',
    'size-mismatch',
    'unsupported-content-type',
    'content-type-mismatch',
    'missing-checksum',
    'checksum-mismatch',
    'verified',
  ]),
  contentType: z.string().nullable(),
  expectedSize: z.number().int().nonnegative().nullable(),
  actualSize: z.number().int().nonnegative().nullable(),
  expectedSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  actualSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
})
export type DeliveryMediaStorageProof = z.infer<typeof deliveryMediaStorageProofSchema>

export const deliveryEvidenceSchema = z.object({
  evidenceId: z.string().trim().min(1).max(200),
  kind: deliveryEvidenceKindSchema,
  status: deliveryEvidenceStatusSchema,
  requirementIds: z.array(z.string().trim().min(1)).max(200).default([]),
  refType: z.string().trim().min(1).max(120),
  refId: z.string().trim().min(1).max(500),
  observedAt: z.string().datetime(),
  scope: deliveryEvidenceScopeSchema,
  details: z.record(z.string(), z.unknown()).default({}),
})
export type DeliveryEvidence = z.infer<typeof deliveryEvidenceSchema>

export const deliveryVerificationStatusSchema = z.enum(['satisfied', 'partial', 'failed', 'pending'])
export type DeliveryVerificationStatus = z.infer<typeof deliveryVerificationStatusSchema>

export const deliveryVerificationSchema = z.object({
  status: deliveryVerificationStatusSchema,
  satisfiedRequirementIds: z.array(z.string().trim().min(1)).max(200),
  pendingRequirementIds: z.array(z.string().trim().min(1)).max(200),
  failedRequirementIds: z.array(z.string().trim().min(1)).max(200),
  rationale: z.string().trim().min(1).max(4_000),
  verifiedAt: z.string().datetime(),
})
export type DeliveryVerification = z.infer<typeof deliveryVerificationSchema>

export const deliveryVerificationSnapshotSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  contract: deliveryContractSchema.nullable(),
  evidence: z.array(deliveryEvidenceSchema).max(500),
  verification: deliveryVerificationSchema.nullable(),
})
export type DeliveryVerificationSnapshot = z.infer<typeof deliveryVerificationSnapshotSchema>

/** Reasons returned by the server-side formal delivery gate. */
export const deliveryGateReasonCodeSchema = z.enum([
  'CONTRACT_NOT_FROZEN',
  'CONTRACT_HASH_INVALID',
  'TASK_NOT_COMPLETED',
  'MEDIA_NOT_READABLE',
  'CONTENT_REVIEW_PENDING',
  'CONTENT_REVIEW_FAILED',
  'PHYSICAL_REVIEW_PENDING',
  'PHYSICAL_REVIEW_FAILED',
  'CONTINUITY_PENDING',
  'CONTINUITY_FAILED',
  'DELIVERY_REQUIREMENTS_INCOMPLETE',
])
export type DeliveryGateReasonCode = z.infer<typeof deliveryGateReasonCodeSchema>

export const deliveryGateResultSchema = z.object({
  allowed: z.boolean(),
  status: z.enum(['allowed', 'blocked', 'pending']),
  reasonCodes: z.array(deliveryGateReasonCodeSchema).max(32),
  rationale: z.string().trim().min(1).max(4_000),
  verifiedAt: z.string().datetime(),
  verification: deliveryVerificationSchema.nullable(),
})
export type DeliveryGateResult = z.infer<typeof deliveryGateResultSchema>

/** Stable requirement IDs used when generation tasks are projected to evidence. */
export const DELIVERY_REQUIREMENT_IDS = {
  taskCompleted: 'task-completed',
  providerAccepted: 'provider-accepted',
  mediaUrl: 'media-url',
  contentReview: 'content-review',
  physicalReview: 'physical-review',
  continuityReady: 'continuity-ready',
} as const

/**
 * A task may be technically complete while its user-facing delivery is still
 * awaiting review. This lifecycle is intentionally separate from generation
 * task status and is only a structural state machine in this package.
 */
export const deliveryLifecycleStatusSchema = z.enum([
  'intent_frozen',
  'submitted',
  'provider_accepted',
  'media_ready',
  'technical_review_pending',
  'content_review_pending',
  'accepted',
  'rejected',
  'waiting_external',
  'cancelled',
])
export type DeliveryLifecycleStatus = z.infer<typeof deliveryLifecycleStatusSchema>
