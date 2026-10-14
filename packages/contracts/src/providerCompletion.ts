import { z } from 'zod'

/** Server observation plus successful media ingestion, not an upstream signature or quality approval. */
export const providerCompletionReceiptSchema = z
  .object({
    version: z.literal('seqora.provider-completion.v1'),
    attestation: z.literal('server-observed-completion'),
    tenantId: z.string().min(1).max(200),
    projectId: z.string().min(1).max(200),
    taskId: z.string().min(1).max(200),
    provider: z.literal('seedance'),
    providerName: z.enum(['dora-router-seedance', 'stringx-seedance', 'volc-ark-seedance']),
    providerTaskId: z.string().min(1).max(500),
    attempts: z.number().int().positive(),
    completedAt: z.string().datetime(),
    mediaVersion: z.string().min(1).max(2_000),
    media: z
      .object({
        view: z.literal('single'),
        storageKey: z.string().min(1).max(1_000),
        contentType: z.literal('video/mp4'),
        size: z
          .number()
          .int()
          .positive()
          .max(100 * 1024 * 1024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict()

export type ProviderCompletionReceipt = z.infer<typeof providerCompletionReceiptSchema>
