import {
  deliveryEvidenceSchema,
  deliveryEvidenceScopeSchema,
  deliveryVerificationSchema,
  type DeliveryContract,
  type DeliveryEvidence,
  type DeliveryEvidenceScope,
  type DeliveryVerification,
} from '@seqora/contracts'
import { verifyFrozenDeliveryContract } from './deliveryContractFreeze.js'

export type DeliveryContractEvaluationInput = {
  contract: DeliveryContract
  evidence: readonly DeliveryEvidence[]
  scope: DeliveryEvidenceScope
  verifiedAt: string
}

function sameScope(left: DeliveryEvidenceScope, right: DeliveryEvidenceScope): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.projectId === right.projectId &&
    left.taskId === right.taskId &&
    left.taskUpdatedAt === right.taskUpdatedAt &&
    left.mediaVersion === right.mediaVersion
  )
}

function pendingVerification(
  contract: DeliveryContract,
  verifiedAt: string,
  rationale: string,
): DeliveryVerification {
  return deliveryVerificationSchema.parse({
    status: 'pending',
    satisfiedRequirementIds: [],
    pendingRequirementIds: contract.must.map((requirement) => requirement.id),
    failedRequirementIds: [],
    rationale,
    verifiedAt,
  })
}

/**
 * Evaluates only frozen contracts against evidence from the exact task/media scope.
 * Observed evidence is useful context but never satisfies a requirement by itself.
 */
export function evaluateDeliveryContract(input: DeliveryContractEvaluationInput): DeliveryVerification {
  const contract = input.contract
  const scope = deliveryEvidenceScopeSchema.parse(input.scope)
  const verifiedAt = input.verifiedAt
  if (!verifyFrozenDeliveryContract(contract)) {
    return pendingVerification(contract, verifiedAt, '交付合同尚未冻结或合同哈希校验失败')
  }
  if (contract.intent.projectId !== scope.projectId) {
    return pendingVerification(contract, verifiedAt, '交付合同项目与证据范围不一致')
  }

  const scopedEvidence = input.evidence
    .map((item) => deliveryEvidenceSchema.parse(item))
    .filter((item) => sameScope(item.scope, scope))
  const satisfiedRequirementIds: string[] = []
  const pendingRequirementIds: string[] = []
  const failedRequirementIds: string[] = []

  for (const requirement of contract.must) {
    const matching = scopedEvidence.filter((item) => item.requirementIds.includes(requirement.id))
    if (matching.some((item) => item.status === 'failed')) {
      failedRequirementIds.push(requirement.id)
    } else if (matching.some((item) => item.status === 'passed')) {
      satisfiedRequirementIds.push(requirement.id)
    } else {
      pendingRequirementIds.push(requirement.id)
    }
  }

  const status =
    failedRequirementIds.length > 0
      ? 'failed'
      : pendingRequirementIds.length === 0
        ? 'satisfied'
        : satisfiedRequirementIds.length > 0
          ? 'partial'
          : 'pending'
  const rationale =
    status === 'satisfied'
      ? '所有交付要求均有同一任务媒体范围内的通过证据'
      : status === 'failed'
        ? '至少一项交付要求存在失败证据'
        : status === 'partial'
          ? '部分交付要求已通过，其余要求仍待证据'
          : '尚无足够的同一任务媒体范围通过证据'
  return deliveryVerificationSchema.parse({
    status,
    satisfiedRequirementIds,
    pendingRequirementIds,
    failedRequirementIds,
    rationale,
    verifiedAt,
  })
}
