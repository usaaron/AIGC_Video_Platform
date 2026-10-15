import { z } from 'zod'
import { generationTaskStatusSchema } from './generation.js'
import { textCompletionReceiptSchema } from './textCompletion.js'

const identifier = z.string().min(1).max(200).regex(/\S/)

export const textCompletionReasonSchema = z.enum([
  'verified',
  'task-not-completed',
  'missing-receipt',
  'invalid-receipt',
  'receipt-mismatch',
])

/** A read-only historical result snapshot, not quality approval or delivery authorization. */
export const textCompletionSnapshotSchema = z
  .object({
    version: z.literal('seqora.text-completion-query.v1'),
    taskId: identifier,
    projectId: identifier,
    tenantId: identifier,
    taskUpdatedAt: z.string().datetime(),
    checkedAt: z.string().datetime(),
    taskStatus: generationTaskStatusSchema,
    reason: textCompletionReasonSchema,
    receipt: textCompletionReceiptSchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if ((snapshot.reason === 'task-not-completed') !== (snapshot.taskStatus !== 'completed')) {
      context.addIssue({
        code: 'custom',
        path: ['taskStatus'],
        message: '来源回执查询原因必须与任务完成状态一致',
      })
    }
    if (snapshot.reason !== 'verified') {
      if (snapshot.receipt !== null)
        context.addIssue({ code: 'custom', path: ['receipt'], message: '未通过核验不能返回可信来源回执' })
      return
    }
    if (!snapshot.receipt) {
      context.addIssue({ code: 'custom', path: ['receipt'], message: '通过核验必须返回来源回执' })
      return
    }
    for (const field of ['taskId', 'projectId', 'tenantId'] as const) {
      if (snapshot.receipt[field] !== snapshot[field])
        context.addIssue({
          code: 'custom',
          path: ['receipt', field],
          message: '来源回执必须属于当前查询的组织、项目和任务',
        })
    }
  })

export type TextCompletionReason = z.infer<typeof textCompletionReasonSchema>
export type TextCompletionSnapshot = z.infer<typeof textCompletionSnapshotSchema>
