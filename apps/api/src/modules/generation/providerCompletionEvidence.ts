import {
  providerCompletionReceiptSchema,
  videoReviewVersion,
  type GenerationTask,
  type ProviderCompletionReceipt,
} from '@seqora/contracts'

type CompletionProof = {
  reason: 'verified' | 'task-not-completed' | 'missing-receipt' | 'invalid-receipt' | 'receipt-mismatch'
  receipt: ProviderCompletionReceipt | null
}

/** Validates recorded ingestion provenance. Current storage bytes are checked separately. */
export function providerCompletionEvidence(task: GenerationTask): CompletionProof {
  if (task.kind !== 'video' || task.provider !== 'seedance' || task.status !== 'completed') {
    return { reason: 'task-not-completed', receipt: null }
  }
  const raw = task.metadata.providerCompletionReceipt
  if (raw === undefined || raw === null) return { reason: 'missing-receipt', receipt: null }
  const parsed = providerCompletionReceiptSchema.safeParse(raw)
  if (!parsed.success) return { reason: 'invalid-receipt', receipt: null }
  const receipt = parsed.data
  const outputs = Array.isArray(task.metadata.generatedOutputs) ? task.metadata.generatedOutputs : []
  const candidates = outputs.filter((item): item is Record<string, unknown> =>
    Boolean(item && typeof item === 'object' && item.view === 'single'),
  )
  const current = candidates[0]
  const prefix = `${task.tenantId}/${task.projectId}/generated/${task.id}-`
  const matches =
    receipt.tenantId === task.tenantId &&
    receipt.projectId === task.projectId &&
    receipt.taskId === task.id &&
    receipt.provider === task.provider &&
    receipt.providerName === task.metadata.providerName &&
    receipt.providerTaskId === task.metadata.providerTaskId &&
    receipt.attempts === task.attempts &&
    task.metadata.providerState === 'completed' &&
    receipt.mediaVersion === videoReviewVersion(task) &&
    receipt.media.storageKey.startsWith(prefix) &&
    task.metadata.videoStorageKey === receipt.media.storageKey &&
    task.metadata.videoContentType === receipt.media.contentType &&
    task.metadata.videoSize === receipt.media.size &&
    candidates.length === 1 &&
    current &&
    (['view', 'storageKey', 'contentType', 'size', 'sha256'] as const).every(
      (key) => current[key] === receipt.media[key],
    )
  return matches ? { reason: 'verified', receipt } : { reason: 'receipt-mismatch', receipt: null }
}
