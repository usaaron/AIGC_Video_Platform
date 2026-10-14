import { describe, expect, it } from 'vitest'
import { deliveryDownloadReceiptSchema, deliveryDownloadRequestSchema } from './deliveryDownload.js'

const timestamp = '2026-10-14T00:00:00.000Z'
const request = { expectedUpdatedAt: timestamp, contractHash: 'a'.repeat(64), clientRequestId: 'download-1' }

describe('formal delivery download contracts', () => {
  it('requires an explicit current version, hash and bounded idempotency key', () => {
    expect(deliveryDownloadRequestSchema.parse(request)).toEqual(request)
    for (const field of ['expectedUpdatedAt', 'contractHash', 'clientRequestId']) {
      expect(deliveryDownloadRequestSchema.safeParse({ ...request, [field]: undefined }).success).toBe(false)
    }
    expect(
      deliveryDownloadRequestSchema.safeParse({ ...request, clientRequestId: 'x'.repeat(129) }).success,
    ).toBe(false)
    expect(deliveryDownloadRequestSchema.safeParse({ ...request, gate: { allowed: true } }).success).toBe(
      false,
    )
    expect(deliveryDownloadRequestSchema.safeParse({ ...request, snapshot: {} }).success).toBe(false)
  })

  it('models immutable authorization separately from client receipt of bytes', () => {
    const receipt = {
      version: 'seqora.delivery-download.v1',
      id: '35f27178-11fe-424d-971a-a94933b1d5ab',
      clientRequestId: request.clientRequestId,
      taskId: 'task',
      tenantId: 'tenant',
      projectId: 'project',
      actorUserId: 'actor',
      sourceTaskUpdatedAt: timestamp,
      recordedTaskUpdatedAt: timestamp,
      authorizedAt: timestamp,
      contractHash: request.contractHash,
      contentType: 'image/png',
      size: 24,
      sha256: 'b'.repeat(64),
      snapshot: { taskId: 'task', contract: null, evidence: [], verification: null },
      gate: {
        allowed: true,
        status: 'allowed',
        reasonCodes: [],
        rationale: 'Verified',
        verifiedAt: timestamp,
        verification: null,
      },
    }
    expect(deliveryDownloadReceiptSchema.parse(receipt)).toEqual(receipt)
    expect(deliveryDownloadReceiptSchema.safeParse({ ...receipt, size: 100 * 1024 * 1024 + 1 }).success).toBe(
      false,
    )
    expect(deliveryDownloadReceiptSchema.safeParse({ ...receipt, size: 0 }).success).toBe(false)
    expect(deliveryDownloadReceiptSchema.safeParse({ ...receipt, contentType: 'text/html' }).success).toBe(
      false,
    )
    expect(deliveryDownloadReceiptSchema.safeParse({ ...receipt, sha256: 'unknown' }).success).toBe(false)
  })
})
