import {
  textCompletionReceiptSchema,
  type GenerationTask,
  type TextCompletionReceipt,
} from '@seqora/contracts'
import { textCompletionResultUnits, textResultDigest } from '../../core/jobs/textCompletion.js'

type TextCompletionProof = {
  reason: 'verified' | 'task-not-completed' | 'missing-receipt' | 'invalid-receipt' | 'receipt-mismatch'
  receipt: TextCompletionReceipt | null
}

/** Binds historical completion to the task result snapshot, not the editable project or delivery gate. */
export function textCompletionEvidence(task: GenerationTask): TextCompletionProof {
  if (
    task.kind !== 'text' ||
    task.provider !== 'text' ||
    task.status !== 'completed' ||
    task.projectId.startsWith('sm-standalone-')
  )
    return { reason: 'task-not-completed', receipt: null }
  const raw = task.metadata.textCompletionReceipt
  if (raw === undefined || raw === null) return { reason: 'missing-receipt', receipt: null }
  const parsed = textCompletionReceiptSchema.safeParse(raw)
  if (!parsed.success) return { reason: 'invalid-receipt', receipt: null }
  const receipt = parsed.data
  const digest = textResultDigest(task.metadata.textResult)
  const units = textCompletionResultUnits(task.metadata.textResult, task)
  const valid =
    receipt.tenantId === task.tenantId &&
    receipt.projectId === task.projectId &&
    receipt.taskId === task.id &&
    receipt.userId === task.userId &&
    receipt.clientRequestId === task.clientRequestId &&
    receipt.attempts === task.attempts &&
    receipt.model === (task.model ?? null) &&
    receipt.operation === task.metadata.scriptOperation &&
    receipt.completedAt === task.metadata.localTaskCompletedAt &&
    receipt.resultSha256 === digest?.sha256 &&
    receipt.resultBytes === digest.bytes &&
    units?.length === receipt.units.length &&
    units.every((unit, index) => {
      const actual = receipt.units[index]!
      return (
        unit.unitId === actual.unitId &&
        unit.resultSha256 === actual.resultSha256 &&
        unit.resultBytes === actual.resultBytes
      )
    })
  return valid ? { reason: 'verified', receipt } : { reason: 'receipt-mismatch', receipt: null }
}
