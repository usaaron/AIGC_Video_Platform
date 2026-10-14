import { z } from 'zod'
import type { GenerationTask } from './generation.js'
import { deliveryMediaStorageProofSchema } from './delivery.js'

export const IMAGE_COMPLETION_MAX_BYTES = 100 * 1024 * 1024

export const imageCompletionOutputSchema = z
  .object({
    view: z.enum(['single', 'front', 'side', 'back', 'detail']),
    storageKey: z.string().min(1).max(1_000),
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    size: z.number().int().positive().max(IMAGE_COMPLETION_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

/** Observed successful adapter response and complete ingestion; requestId is a server request key, not an upstream receipt. */
export const imageProviderCompletionReceiptSchema = z
  .object({
    version: z.literal('seqora.provider-image-completion.v1'),
    attestation: z.literal('server-observed-completion'),
    tenantId: z.string().min(1).max(200),
    projectId: z.string().min(1).max(200),
    taskId: z.string().min(1).max(200),
    provider: z.literal('img2'),
    providerName: z.literal('tokenadvent-img2'),
    requestId: z.string().min(1).max(500),
    attempts: z.number().int().positive(),
    completedAt: z.string().datetime(),
    mediaVersion: z.string().min(1).max(2_000),
    outputs: z.array(imageCompletionOutputSchema).min(1).max(5),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (new Set(receipt.outputs.map((output) => output.view)).size !== receipt.outputs.length) {
      context.addIssue({ code: 'custom', path: ['outputs'], message: '完成回执的图片视图必须唯一' })
    }
    if (new Set(receipt.outputs.map((output) => output.storageKey)).size !== receipt.outputs.length) {
      context.addIssue({ code: 'custom', path: ['outputs'], message: '完成回执的图片存储键必须唯一' })
    }
    if (receipt.outputs.reduce((sum, output) => sum + output.size, 0) > IMAGE_COMPLETION_MAX_BYTES) {
      context.addIssue({ code: 'custom', path: ['outputs'], message: '完成回执图片总大小超出预算' })
    }
  })

export type ImageProviderCompletionReceipt = z.infer<typeof imageProviderCompletionReceiptSchema>

/** All receipt images must still match their stored bytes, including non-primary views. */
export const imageProviderMediaProofSchema = z
  .object({
    status: z.enum(['passed', 'pending', 'failed']),
    reason: z.enum(['verified', 'output-failed', 'output-pending']),
    expectedOutputCount: z.number().int().min(1).max(5),
    verifiedOutputCount: z.number().int().min(0).max(5),
    outputs: z
      .array(
        z
          .object({
            view: imageCompletionOutputSchema.shape.view,
            storageProof: deliveryMediaStorageProofSchema.strict(),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict()
  .superRefine((proof, context) => {
    const passedCount = proof.outputs.filter((output) => output.storageProof.status === 'passed').length
    const status = proof.outputs.some((output) => output.storageProof.status === 'failed')
      ? 'failed'
      : proof.outputs.some((output) => output.storageProof.status === 'pending')
        ? 'pending'
        : 'passed'
    const reason =
      status === 'failed' ? 'output-failed' : status === 'pending' ? 'output-pending' : 'verified'
    if (
      new Set(proof.outputs.map((output) => output.view)).size !== proof.outputs.length ||
      proof.outputs.length !== proof.expectedOutputCount ||
      passedCount !== proof.verifiedOutputCount ||
      status !== proof.status ||
      reason !== proof.reason
    ) {
      context.addIssue({ code: 'custom', message: '图片存储证明的计数或汇总状态不一致' })
    }
  })

export type ImageProviderMediaProof = z.infer<typeof imageProviderMediaProofSchema>

/** Matches the existing image delivery evidence scope; checksum bindings live in receipt.outputs. */
export function imageCompletionMediaVersion(
  task: Pick<GenerationTask, 'id' | 'resultUrl' | 'outputs'>,
): string {
  return JSON.stringify([
    task.id,
    task.resultUrl?.trim() || null,
    task.outputs.map((output) => [output.id, output.mediaType, output.view, output.url.trim()]),
  ])
}
