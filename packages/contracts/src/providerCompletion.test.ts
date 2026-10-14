import { describe, expect, it } from 'vitest'
import { providerCompletionReceiptSchema } from './providerCompletion.js'

const receipt = {
  version: 'seqora.provider-completion.v1',
  attestation: 'server-observed-completion',
  tenantId: 'tenant-1',
  projectId: 'project-1',
  taskId: 'task-1',
  provider: 'seedance',
  providerName: 'dora-router-seedance',
  providerTaskId: 'upstream-1',
  attempts: 1,
  completedAt: '2026-10-14T00:00:00.000Z',
  mediaVersion: 'current-version',
  media: {
    view: 'single',
    storageKey: 'tenant-1/project-1/generated/task-1-hash-video.mp4',
    contentType: 'video/mp4',
    size: 24,
    sha256: 'a'.repeat(64),
  },
}

describe('server-observed provider completion receipt', () => {
  it('accepts a bounded, explicit server attestation', () => {
    expect(providerCompletionReceiptSchema.parse(receipt)).toEqual(receipt)
  })

  it.each([
    { attestation: 'provider-signed' },
    { provider: 'img2' },
    { providerName: 'unknown-provider' },
    { providerTaskId: '' },
    { attempts: 0 },
    { attempts: 1.5 },
    { completedAt: 'not-a-date' },
    { mediaVersion: '' },
    { extraSecret: 'not-allowed' },
    { media: { ...receipt.media, size: 0 } },
    { media: { ...receipt.media, size: 100 * 1024 * 1024 + 1 } },
    { media: { ...receipt.media, contentType: 'text/html' } },
    { media: { ...receipt.media, sha256: 'wrong-hash' } },
    { media: { ...receipt.media, view: 'last-frame' } },
    { media: { ...receipt.media, providerUrl: 'not-allowed' } },
  ])('rejects invalid or overclaiming receipt %#', (change) => {
    expect(providerCompletionReceiptSchema.safeParse({ ...receipt, ...change }).success).toBe(false)
  })
})
