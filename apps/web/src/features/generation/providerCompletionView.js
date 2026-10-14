import {
  DELIVERY_REQUIREMENT_IDS,
  deliveryContractSchema,
  deliveryEvidenceSchema,
  deliveryMediaStorageProofSchema,
  providerCompletionReceiptSchema,
} from '@seqora/contracts'

const providerLabels = {
  'dora-router-seedance': 'DoraRouter / Seedance',
  'stringx-seedance': 'StringX / Seedance',
  'volc-ark-seedance': 'Volc Ark / Seedance',
}

export const PROVIDER_COMPLETION_EXPLANATION =
  '完成回执表示服务端观察到 Provider 完成，并在同次轮询中完整保存主视频。此回执不代表上游签名或内容质量验收。'
export const PROVIDER_COMPLETION_LEGACY_NOTICE =
  '历史任务缺少可信完成回执时会保持待补；不会自动补签，也不会自动付费重新生成。'

/** Expose only display-safe fields from the server snapshot, never task metadata. */
export function providerCompletionReceiptView(snapshot, enabled = false) {
  const contract = deliveryContractSchema.safeParse(snapshot?.contract)
  const required = contract.success
    ? contract.data.must.some((item) =>
        [DELIVERY_REQUIREMENT_IDS.providerCompleted, DELIVERY_REQUIREMENT_IDS.providerAccepted].includes(
          item.id,
        ),
      )
    : false
  const candidates = Array.isArray(snapshot?.evidence)
    ? snapshot.evidence.filter((item) => item?.kind === 'provider')
    : []
  if (!enabled && !required && !candidates.some((item) => item.details?.provider === 'seedance')) return null
  const parsed = deliveryEvidenceSchema.safeParse(candidates.length === 1 ? candidates[0] : null)
  const evidence =
    parsed.success &&
    parsed.data.scope.taskId === snapshot?.taskId &&
    parsed.data.refId === snapshot?.taskId &&
    parsed.data.refType === 'provider-task' &&
    (!contract.success || parsed.data.scope.projectId === contract.data.intent.projectId) &&
    parsed.data.details.provider === 'seedance' &&
    parsed.data.requirementIds.some((id) =>
      [DELIVERY_REQUIREMENT_IDS.providerCompleted, DELIVERY_REQUIREMENT_IDS.providerAccepted].includes(id),
    )
      ? parsed.data
      : null
  const completion = evidence?.details.completion
  const parsedReceipt = providerCompletionReceiptSchema.safeParse(completion?.receipt)
  const receipt =
    parsedReceipt.success &&
    completion.reason === 'verified' &&
    parsedReceipt.data.taskId === evidence.scope.taskId &&
    parsedReceipt.data.tenantId === evidence.scope.tenantId &&
    parsedReceipt.data.projectId === evidence.scope.projectId &&
    parsedReceipt.data.mediaVersion === evidence.scope.mediaVersion
      ? parsedReceipt.data
      : null
  let status = evidence?.status ?? 'pending'
  if (status === 'passed' && !receipt) status = 'pending'
  let mediaStatus = null
  if (evidence && Object.hasOwn(evidence.details, 'currentMediaProof')) {
    const proof = deliveryMediaStorageProofSchema.safeParse(evidence.details.currentMediaProof)
    mediaStatus = proof.success ? proof.data.status : 'pending'
    if (mediaStatus === 'failed') status = 'failed'
    else if (mediaStatus === 'pending' && status === 'passed') status = 'pending'
  }
  return {
    status,
    mediaStatus,
    missingReason: !evidence
      ? 'unavailable'
      : ['invalid-receipt', 'receipt-mismatch', 'task-not-completed', 'missing-receipt'].includes(
            completion?.reason,
          )
        ? completion.reason
        : receipt
          ? null
          : 'invalid-receipt',
    contractRequirement:
      contract.success && contract.data.contractHash ? (required ? 'required' : 'legacy') : 'unfrozen',
    receipt: receipt
      ? {
          providerLabel: providerLabels[receipt.providerName],
          attempts: receipt.attempts,
          completedAt: receipt.completedAt
            .replace('T', ' ')
            .replace(/\.000Z$/, ' UTC')
            .replace(/Z$/, ' UTC'),
          size:
            receipt.media.size < 1024
              ? `${receipt.media.size} B`
              : receipt.media.size < 1024 * 1024
                ? `${(receipt.media.size / 1024).toFixed(1)} KiB`
                : `${(receipt.media.size / (1024 * 1024)).toFixed(1)} MiB`,
          hashSummary: `${receipt.media.sha256.slice(0, 12)}…${receipt.media.sha256.slice(-8)}`,
        }
      : null,
  }
}
