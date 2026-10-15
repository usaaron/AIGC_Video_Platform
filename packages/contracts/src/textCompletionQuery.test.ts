import { describe, expect, it } from 'vitest'
import { generationTaskStatusSchema } from './generation.js'
import { type TextCompletionReceipt } from './textCompletion.js'
import {
  textCompletionReasonSchema,
  textCompletionSnapshotSchema,
  type TextCompletionSnapshot,
} from './textCompletionQuery.js'

const receipt: TextCompletionReceipt = {
  version: 'seqora.text-completion.v1',
  attestation: 'server-observed-text-result',
  tenantId: 'tenant',
  projectId: 'project',
  taskId: 'task',
  userId: 'user',
  clientRequestId: 'request',
  attempts: 1,
  model: 'logical-model',
  operation: 'generate',
  completedAt: '2026-10-15T03:00:00.000Z',
  resultSha256: 'a'.repeat(64),
  resultBytes: 80,
  units: [
    {
      unitId: 'result',
      source: 'provider-derived',
      resultSha256: 'b'.repeat(64),
      resultBytes: 40,
      providerCalls: [
        {
          sequence: 1,
          model: 'logical-model',
          stage: 'first-draft',
          responseSha256: 'c'.repeat(64),
          responseBytes: 20,
          observation: 'adapter-returned',
        },
      ],
    },
  ],
}
const snapshot: TextCompletionSnapshot = {
  version: 'seqora.text-completion-query.v1',
  taskId: receipt.taskId,
  projectId: receipt.projectId,
  tenantId: receipt.tenantId,
  taskUpdatedAt: '2026-10-15T04:00:00.000Z',
  checkedAt: '2026-10-15T05:00:00.000Z',
  taskStatus: 'completed',
  reason: 'verified',
  receipt,
}

describe('read-only text completion query snapshot', () => {
  it('accepts a scoped historical receipt without confusing completion and query timestamps', () => {
    expect(textCompletionSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot.taskUpdatedAt).not.toBe(receipt.completedAt)
    expect(snapshot.checkedAt).not.toBe(snapshot.taskUpdatedAt)
  })

  it.each(
    generationTaskStatusSchema.options.flatMap((taskStatus) =>
      textCompletionReasonSchema.options.map((reason) => ({ taskStatus, reason })),
    ),
  )('enforces the $taskStatus / $reason state combination', ({ taskStatus, reason }) => {
    const value = { ...snapshot, taskStatus, reason, receipt: reason === 'verified' ? receipt : null }
    const valid =
      taskStatus === 'completed' ? reason !== 'task-not-completed' : reason === 'task-not-completed'
    expect(textCompletionSnapshotSchema.safeParse(value).success).toBe(valid)
  })

  it.each([null, undefined])('requires a receipt for verified results: %s', (value) => {
    expect(textCompletionSnapshotSchema.safeParse({ ...snapshot, receipt: value }).success).toBe(false)
  })

  it.each(['task-not-completed', 'missing-receipt', 'invalid-receipt', 'receipt-mismatch'] as const)(
    'never presents a trusted receipt when reason is %s',
    (reason) => {
      const taskStatus = reason === 'task-not-completed' ? 'running' : 'completed'
      expect(textCompletionSnapshotSchema.safeParse({ ...snapshot, reason, taskStatus }).success).toBe(false)
      expect(
        textCompletionSnapshotSchema.safeParse({ ...snapshot, reason, taskStatus, receipt: undefined })
          .success,
      ).toBe(false)
    },
  )

  it.each(['taskId', 'projectId', 'tenantId'] as const)(
    'binds the receipt %s to the query scope',
    (field) => {
      expect(
        textCompletionSnapshotSchema.safeParse({ ...snapshot, receipt: { ...receipt, [field]: 'another' } })
          .success,
      ).toBe(false)
      expect(textCompletionSnapshotSchema.safeParse({ ...snapshot, [field]: 'another' }).success).toBe(false)
    },
  )

  it.each(
    (['taskId', 'projectId', 'tenantId'] as const).flatMap((field) =>
      ['', ' ', '\t\n', 'x'.repeat(201), null].map((value) => ({ field, value })),
    ),
  )('rejects invalid query identifier $field: $value', ({ field, value }) => {
    expect(
      textCompletionSnapshotSchema.safeParse({
        ...snapshot,
        reason: 'missing-receipt',
        receipt: null,
        [field]: value,
      }).success,
    ).toBe(false)
  })

  it('accepts bounded identifiers without rewriting their exact receipt binding', () => {
    const identifiers = { taskId: 'x'.repeat(200), projectId: ' project ', tenantId: 'tenant-汉字' }
    const value = { ...snapshot, ...identifiers, receipt: { ...receipt, ...identifiers } }
    expect(textCompletionSnapshotSchema.parse(value)).toEqual(value)
  })

  it.each(
    (['taskUpdatedAt', 'checkedAt'] as const).flatMap((field) =>
      ['', 'today', '2026-10-15', '2026-10-15T05:00:00', '2026-02-30T05:00:00.000Z', null].map((value) => ({
        field,
        value,
      })),
    ),
  )('rejects invalid ISO timestamp $field: $value', ({ field, value }) => {
    expect(textCompletionSnapshotSchema.safeParse({ ...snapshot, [field]: value }).success).toBe(false)
  })

  it.each(Object.keys(snapshot))('requires the snapshot field %s', (field) => {
    const value: Record<string, unknown> = { ...snapshot }
    delete value[field]
    expect(textCompletionSnapshotSchema.safeParse(value).success).toBe(false)
  })

  it.each([
    { version: 'seqora.delivery.v1' },
    { taskStatus: 'succeeded' },
    { reason: 'provider-completed' },
    { reason: 'quality-approved' },
    { reason: 'delivery-authorized' },
    { allowed: true },
    { textResult: { script: 'raw body' } },
    { prompt: 'raw prompt' },
    { leaseToken: 'private' },
    { providerTaskId: 'unverified' },
  ])('rejects invalid or additional public claims %#', (change) => {
    expect(textCompletionSnapshotSchema.safeParse({ ...snapshot, ...change }).success).toBe(false)
  })

  it.each([
    { attestation: 'provider-completed' },
    { resultBytes: 0 },
    { resultSha256: 'wrong' },
    { units: [] },
    { script: 'raw body' },
    { leaseToken: 'private' },
  ])('preserves strict validation of the nested receipt %#', (change) => {
    expect(
      textCompletionSnapshotSchema.safeParse({ ...snapshot, receipt: { ...receipt, ...change } }).success,
    ).toBe(false)
  })

  it('allows zero-byte returned text only with the empty text digest', () => {
    const value = structuredClone(snapshot)
    const call = value.receipt!.units[0]!.providerCalls[0]!
    call.responseBytes = 0
    call.responseSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    expect(textCompletionSnapshotSchema.parse(value)).toEqual(value)
    call.responseSha256 = 'c'.repeat(64)
    expect(textCompletionSnapshotSchema.safeParse(value).success).toBe(false)
  })

  it('returns detached public data without modifying the original receipt', () => {
    const original = structuredClone(snapshot)
    const parsed = textCompletionSnapshotSchema.parse(original)
    parsed.receipt!.units[0]!.providerCalls[0]!.stage = 'changed'
    expect(original).toEqual(snapshot)
  })
})
