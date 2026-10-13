import {
  deliveryGateResultSchema,
  needsVideoReview,
  physicalAuditState,
  videoReviewState,
  type DeliveryContract,
  type DeliveryEvidence,
  type DeliveryGateResult,
  type DeliveryVerification,
  type GenerationTask,
} from '@seqora/contracts'
import { verifyFrozenDeliveryContract } from './deliveryContractFreeze.js'

export type DeliveryGateInput = {
  task: GenerationTask
  contract: DeliveryContract | null
  evidence: readonly DeliveryEvidence[]
  verification: DeliveryVerification | null
  verifiedAt: string
}

function hasRequirementEvidence(
  evidence: readonly DeliveryEvidence[],
  requirementId: string,
  status: DeliveryEvidence['status'],
): boolean {
  return evidence.some((item) => item.requirementIds.includes(requirementId) && item.status === status)
}

/**
 * Applies server-owned invariants that must hold before any future formal
 * delivery/publish action. This is intentionally read-only: callers must run
 * it again at the eventual write boundary.
 */
export function evaluateDeliveryGate(input: DeliveryGateInput): DeliveryGateResult {
  const { task, contract, evidence, verification, verifiedAt } = input
  const reasonCodes: DeliveryGateResult['reasonCodes'] = []

  if (!contract) reasonCodes.push('CONTRACT_NOT_FROZEN')
  else if (!verifyFrozenDeliveryContract(contract)) reasonCodes.push('CONTRACT_HASH_INVALID')

  if (task.status !== 'completed') reasonCodes.push('TASK_NOT_COMPLETED')

  const expectedMedia = contract?.expectedArtifact.type
  if (expectedMedia === 'video' || expectedMedia === 'image' || expectedMedia === 'episode') {
    if (!hasRequirementEvidence(evidence, 'media-url', 'passed')) reasonCodes.push('MEDIA_NOT_READABLE')
  }

  if (needsVideoReview(task)) {
    const state = videoReviewState(task)
    if (state === 'rejected') reasonCodes.push('CONTENT_REVIEW_FAILED')
    else if (state !== 'approved') reasonCodes.push('CONTENT_REVIEW_PENDING')
  }

  const physical = physicalAuditState(task)
  if (physical === 'failed') reasonCodes.push('PHYSICAL_REVIEW_FAILED')
  else if (!['none', 'passed'].includes(physical)) reasonCodes.push('PHYSICAL_REVIEW_PENDING')

  if (task.kind === 'video') {
    if (hasRequirementEvidence(evidence, 'continuity-ready', 'failed')) reasonCodes.push('CONTINUITY_FAILED')
    else if (!hasRequirementEvidence(evidence, 'continuity-ready', 'passed')) reasonCodes.push('CONTINUITY_PENDING')
  }

  if (verification && verification.status !== 'satisfied') {
    reasonCodes.push('DELIVERY_REQUIREMENTS_INCOMPLETE')
  }

  const uniqueReasonCodes = [...new Set(reasonCodes)]
  const allowed = uniqueReasonCodes.length === 0
  const hasHardFailure = uniqueReasonCodes.some((code) =>
    [
      'CONTRACT_HASH_INVALID',
      'TASK_NOT_COMPLETED',
      'CONTENT_REVIEW_FAILED',
      'PHYSICAL_REVIEW_FAILED',
      'CONTINUITY_FAILED',
    ].includes(code),
  )
  const status = allowed ? 'allowed' : hasHardFailure ? 'blocked' : 'pending'
  const rationale = allowed
    ? '当前冻结合同及其同范围证据满足正式交付门禁'
    : hasHardFailure
      ? '正式交付被服务器门禁阻止，请先修复失败证据'
      : '正式交付尚未放行，仍需补齐可验证证据'

  return deliveryGateResultSchema.parse({
    allowed,
    status,
    reasonCodes: uniqueReasonCodes,
    rationale,
    verifiedAt,
    verification,
  })
}
