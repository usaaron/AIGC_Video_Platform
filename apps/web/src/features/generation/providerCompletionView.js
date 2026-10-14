import {
  DELIVERY_REQUIREMENT_IDS,
  deliveryContractSchema,
  deliveryEvidenceSchema,
  deliveryMediaStorageProofSchema,
  imageProviderCompletionReceiptSchema,
  imageProviderMediaProofSchema,
  providerCompletionReceiptSchema,
} from '@seqora/contracts'

const providerLabels = {
  'dora-router-seedance': 'DoraRouter / Seedance',
  'stringx-seedance': 'StringX / Seedance',
  'volc-ark-seedance': 'Volc Ark / Seedance',
  'tokenadvent-img2': 'TokenAdvent / Image2',
}
const imageViewLabels = { single: '单图', front: '正面', side: '侧面', back: '背面', detail: '细节' }

export const PROVIDER_COMPLETION_EXPLANATION =
  '完成回执表示服务端观察到 Provider 完成，并在同次轮询中完整保存主视频。此回执不代表上游签名或内容质量验收。'
export const PROVIDER_COMPLETION_LEGACY_NOTICE =
  '历史任务缺少可信完成回执时会保持待补；不会自动补签，也不会自动付费重新生成。'
export const IMAGE_PROVIDER_COMPLETION_EXPLANATION =
  '图片完成回执记录服务端观察到 Provider 完成，并完整保存本次所有图片视图；显示已核验还要求当前全部图片字节通过核验。此回执不代表上游签名或内容质量验收。'
export const IMAGE_PROVIDER_DOWNLOAD_NOTICE =
  '正式下载仍仅包含当前主图（1 个图片文件），不会打包下载全部视图。'

function displaySize(size) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KiB`
      : `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

function hashSummary(sha256) {
  return `${sha256.slice(0, 12)}…${sha256.slice(-8)}`
}

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
  if (
    !enabled &&
    !required &&
    !candidates.some((item) => ['seedance', 'img2'].includes(item.details?.provider))
  )
    return null
  const parsed = deliveryEvidenceSchema.safeParse(candidates.length === 1 ? candidates[0] : null)
  const evidence =
    parsed.success &&
    parsed.data.scope.taskId === snapshot?.taskId &&
    parsed.data.refId === snapshot?.taskId &&
    parsed.data.refType === 'provider-task' &&
    (!contract.success || parsed.data.scope.projectId === contract.data.intent.projectId) &&
    (!contract.success ||
      contract.data.expectedArtifact.type ===
        (parsed.data.details.provider === 'img2' ? 'image' : 'video')) &&
    ['seedance', 'img2'].includes(parsed.data.details.provider) &&
    parsed.data.requirementIds.some((id) =>
      [DELIVERY_REQUIREMENT_IDS.providerCompleted, DELIVERY_REQUIREMENT_IDS.providerAccepted].includes(id),
    )
      ? parsed.data
      : null
  const completion = evidence?.details.completion
  const isImage = evidence?.details.provider === 'img2' || contract.data?.expectedArtifact.type === 'image'
  const parsedReceipt = (
    isImage ? imageProviderCompletionReceiptSchema : providerCompletionReceiptSchema
  ).safeParse(completion?.receipt)
  const receipt =
    parsedReceipt.success &&
    completion.reason === 'verified' &&
    parsedReceipt.data.taskId === evidence.scope.taskId &&
    parsedReceipt.data.tenantId === evidence.scope.tenantId &&
    parsedReceipt.data.projectId === evidence.scope.projectId &&
    parsedReceipt.data.mediaVersion === evidence.scope.mediaVersion &&
    parsedReceipt.data.provider === evidence.details.provider
      ? parsedReceipt.data
      : null
  let status = evidence?.status ?? 'pending'
  if (status === 'passed' && !receipt) status = 'pending'
  let mediaStatus = null
  if (evidence && Object.hasOwn(evidence.details, 'currentMediaProof')) {
    const proof = (isImage ? imageProviderMediaProofSchema : deliveryMediaStorageProofSchema).safeParse(
      evidence.details.currentMediaProof,
    )
    const matchingViews =
      !isImage ||
      (proof.success &&
        receipt &&
        proof.data.expectedOutputCount === receipt.outputs.length &&
        proof.data.outputs.length === receipt.outputs.length &&
        proof.data.outputs.every((output) => {
          const recorded = receipt.outputs.find((item) => item.view === output.view)
          const current = output.storageProof
          return (
            recorded &&
            current.contentType === recorded.contentType &&
            current.expectedSize === recorded.size &&
            current.expectedSha256 === recorded.sha256 &&
            (current.status !== 'passed' ||
              (current.reason === 'verified' &&
                current.actualSize === recorded.size &&
                current.actualSha256 === recorded.sha256))
          )
        }))
    mediaStatus = proof.success && matchingViews ? proof.data.status : 'pending'
    if (mediaStatus === 'failed') status = 'failed'
    else if (mediaStatus === 'pending' && status === 'passed') status = 'pending'
  } else if (isImage && status === 'passed') {
    mediaStatus = 'pending'
    status = 'pending'
  }
  return {
    status,
    mediaStatus,
    mediaKind: isImage ? 'image' : 'video',
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
          ...(isImage
            ? {
                viewCount: receipt.outputs.length,
                size: displaySize(receipt.outputs.reduce((total, output) => total + output.size, 0)),
                outputs: receipt.outputs.map((output) => ({
                  viewLabel: imageViewLabels[output.view],
                  size: displaySize(output.size),
                  hashSummary: hashSummary(output.sha256),
                })),
              }
            : { size: displaySize(receipt.media.size), hashSummary: hashSummary(receipt.media.sha256) }),
        }
      : null,
  }
}
