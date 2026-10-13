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
export const deliveryContractSchema = z.object({
  version: z.literal('seqora.delivery.v1'),
  contractHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  intent: deliveryIntentSchema,
  expectedArtifact: z.object({
    type: deliveryArtifactTypeSchema,
    count: z.number().int().positive().max(500),
  }),
  must: z.array(deliveryRequirementSchema).min(1).max(200),
  frozenAt: z.string().datetime().nullable().default(null),
})
export type DeliveryContract = z.infer<typeof deliveryContractSchema>

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

export const deliveryEvidenceSchema = z.object({
  evidenceId: z.string().trim().min(1).max(200),
  kind: deliveryEvidenceKindSchema,
  status: deliveryEvidenceStatusSchema,
  requirementIds: z.array(z.string().trim().min(1)).max(200).default([]),
  refType: z.string().trim().min(1).max(120),
  refId: z.string().trim().min(1).max(500),
  observedAt: z.string().datetime(),
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

export function evaluateDeliveryVerification(
  contract: DeliveryContract,
  evidence: readonly DeliveryEvidence[],
  verifiedAt = new Date().toISOString(),
): DeliveryVerification {
  const satisfiedRequirementIds: string[] = []
  const pendingRequirementIds: string[] = []
  const failedRequirementIds: string[] = []

  for (const requirement of contract.must) {
    const related = evidence.filter(item => item.requirementIds.includes(requirement.id))
    if (related.some(item => item.status === 'failed')) {
      failedRequirementIds.push(requirement.id)
    } else if (related.some(item => item.status === 'passed')) {
      satisfiedRequirementIds.push(requirement.id)
    } else {
      pendingRequirementIds.push(requirement.id)
    }
  }

  const status: DeliveryVerificationStatus = failedRequirementIds.length > 0
    ? 'failed'
    : pendingRequirementIds.length > 0
      ? satisfiedRequirementIds.length > 0 ? 'partial' : 'pending'
      : 'satisfied'

  return deliveryVerificationSchema.parse({
    status,
    satisfiedRequirementIds,
    pendingRequirementIds,
    failedRequirementIds,
    rationale: status === 'satisfied'
      ? '每项交付要求都已绑定通过的事实证据。'
      : status === 'failed'
        ? '至少一项交付要求绑定了失败证据。'
        : '仍有交付要求缺少通过证据。',
    verifiedAt,
  })
}
