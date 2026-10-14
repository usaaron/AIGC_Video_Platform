import {
  imageCompletionMediaVersion,
  imageProviderCompletionReceiptSchema,
  type GenerationTask,
  type ImageProviderCompletionReceipt,
} from '@seqora/contracts'

export type ImageCompletionProof = {
  reason: 'verified' | 'task-not-completed' | 'missing-receipt' | 'invalid-receipt' | 'receipt-mismatch'
  receipt: ImageProviderCompletionReceipt | null
}

/** Binds every requested view to the same completed adapter attempt and exact ingestion descriptors. */
export function imageProviderCompletionEvidence(task: GenerationTask): ImageCompletionProof {
  if (task.kind !== 'image' || task.provider !== 'img2' || task.status !== 'completed')
    return { reason: 'task-not-completed', receipt: null }
  const raw = task.metadata.providerCompletionReceipt
  if (raw === undefined || raw === null) return { reason: 'missing-receipt', receipt: null }
  const parsed = imageProviderCompletionReceiptSchema.safeParse(raw)
  if (!parsed.success) return { reason: 'invalid-receipt', receipt: null }
  const receipt = parsed.data
  const expectedViews = task.metadata.turnaround === true ? ['front', 'side', 'back'] : ['single']
  const generated = Array.isArray(task.metadata.generatedOutputs) ? task.metadata.generatedOutputs : []
  const prefix = `${task.tenantId}/${task.projectId}/generated/${task.id}-`
  const matches =
    receipt.tenantId === task.tenantId &&
    receipt.projectId === task.projectId &&
    receipt.taskId === task.id &&
    receipt.providerName === task.metadata.providerName &&
    receipt.requestId === task.metadata.providerIdempotencyKey &&
    receipt.attempts === task.attempts &&
    task.metadata.providerState === 'completed' &&
    receipt.mediaVersion === imageCompletionMediaVersion(task) &&
    [task.tenantId, task.projectId, task.id].every((id) => /^[a-zA-Z0-9_-]+$/.test(id)) &&
    receipt.outputs.length === expectedViews.length &&
    generated.length === expectedViews.length &&
    task.outputs.length === expectedViews.length &&
    task.outputs.some((output) => output.url === task.resultUrl) &&
    expectedViews.every((view) => {
      const media = receipt.outputs.find((output) => output.view === view)
      const outputs = task.outputs.filter((output) => output.view === view)
      const descriptors = generated.filter((item) => item && typeof item === 'object' && item.view === view)
      return Boolean(
        media &&
        media.storageKey.startsWith(prefix) &&
        /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(media.storageKey.slice(prefix.length)) &&
        outputs.length === 1 &&
        outputs[0]?.mediaType === 'image' &&
        outputs[0]?.url === `/api/v1/generation/tasks/${task.id}/outputs/${view}` &&
        descriptors.length === 1 &&
        (['view', 'storageKey', 'contentType', 'size', 'sha256'] as const).every(
          (key) => descriptors[0]?.[key] === media[key],
        ),
      )
    })
  return matches ? { reason: 'verified', receipt } : { reason: 'receipt-mismatch', receipt: null }
}
