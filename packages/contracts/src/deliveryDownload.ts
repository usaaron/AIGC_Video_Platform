import { z } from 'zod'
import { deliveryGateResultSchema, deliveryVerificationSnapshotSchema } from './delivery.js'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const identifierSchema = z.string().trim().min(1).max(200)

/** A user requests authorization for one current, frozen task version. */
export const deliveryDownloadRequestSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime(),
    contractHash: sha256Schema,
    clientRequestId: z.string().trim().min(1).max(128),
  })
  .strict()
export type DeliveryDownloadRequest = z.infer<typeof deliveryDownloadRequestSchema>

/** An immutable authorization receipt; it does not assert that the client received the bytes. */
export const deliveryDownloadReceiptSchema = z.object({
  version: z.literal('seqora.delivery-download.v1'),
  id: z.string().uuid(),
  clientRequestId: z.string().trim().min(1).max(128),
  taskId: identifierSchema,
  tenantId: identifierSchema,
  projectId: identifierSchema,
  actorUserId: identifierSchema,
  sourceTaskUpdatedAt: z.string().datetime(),
  recordedTaskUpdatedAt: z.string().datetime(),
  contractHash: sha256Schema,
  authorizedAt: z.string().datetime(),
  contentType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4']),
  size: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  sha256: sha256Schema,
  snapshot: deliveryVerificationSnapshotSchema,
  gate: deliveryGateResultSchema,
})
export type DeliveryDownloadReceipt = z.infer<typeof deliveryDownloadReceiptSchema>
