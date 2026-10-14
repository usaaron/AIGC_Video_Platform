import { describe, expect, it } from 'vitest'
import {
  imageCompletionMediaVersion,
  imageProviderCompletionReceiptSchema,
  imageProviderMediaProofSchema,
  IMAGE_COMPLETION_MAX_BYTES,
} from './imageProviderCompletion.js'

const output = {
  view: 'single',
  storageKey: 'tenant/project/generated/task-attempt-hash-single.png',
  contentType: 'image/png',
  size: 24,
  sha256: 'a'.repeat(64),
}
const receipt = {
  version: 'seqora.provider-image-completion.v1',
  attestation: 'server-observed-completion',
  tenantId: 'tenant',
  projectId: 'project',
  taskId: 'task',
  provider: 'img2',
  providerName: 'tokenadvent-img2',
  requestId: 'server-request-key',
  attempts: 1,
  completedAt: '2026-10-14T00:00:00.000Z',
  mediaVersion: 'version',
  outputs: [output],
}
const storageProof = {
  status: 'passed',
  reason: 'verified',
  contentType: 'image/png',
  expectedSize: 24,
  actualSize: 24,
  expectedSha256: 'a'.repeat(64),
  actualSha256: 'a'.repeat(64),
}
const proof = {
  status: 'passed',
  reason: 'verified',
  expectedOutputCount: 1,
  verifiedOutputCount: 1,
  outputs: [{ view: 'single', storageProof }],
}

describe('Image2 server completion receipt', () => {
  it('accepts a complete bounded receipt without claiming an upstream signature', () => {
    expect(imageProviderCompletionReceiptSchema.parse(receipt)).toEqual(receipt)
    expect(imageProviderMediaProofSchema.parse(proof)).toEqual(proof)
  })
  it.each([
    { version: 'seqora.provider-completion.v1' },
    { attestation: 'provider-signed' },
    { provider: 'seedance' },
    { providerName: 'unknown' },
    { requestId: '' },
    { attempts: 0 },
    { attempts: 1.5 },
    { completedAt: 'today' },
    { mediaVersion: '' },
    { providerTaskId: 'unproven-upstream-id' },
    { outputs: [] },
    { outputs: [{ ...output, contentType: 'text/html' }] },
    { outputs: [{ ...output, sha256: 'invalid' }] },
    { outputs: [{ ...output, size: IMAGE_COMPLETION_MAX_BYTES + 1 }] },
    { outputs: [output, { ...output, storageKey: 'other' }] },
    { outputs: [output, { ...output, view: 'front' }] },
    {
      outputs: [
        { ...output, size: IMAGE_COMPLETION_MAX_BYTES },
        { ...output, view: 'front', storageKey: 'other' },
      ],
    },
    { outputs: [{ ...output, providerUrl: 'untrusted' }] },
  ])('rejects malformed or inconsistent receipt %#', (change) => {
    expect(imageProviderCompletionReceiptSchema.safeParse({ ...receipt, ...change }).success).toBe(false)
  })
  it('keeps existing image media-version semantics, including view order', () => {
    const task = {
      id: 'task',
      resultUrl: ' /image/front ',
      outputs: [{ id: 'output', mediaType: 'image' as const, view: 'front' as const, url: ' /image/front ' }],
    }
    expect(imageCompletionMediaVersion(task)).toBe(
      JSON.stringify(['task', '/image/front', [['output', 'image', 'front', '/image/front']]]),
    )
    expect(imageCompletionMediaVersion({ ...task, resultUrl: null, outputs: [] })).toBe('["task",null,[]]')
  })
  it.each([
    { expectedOutputCount: 2 },
    { verifiedOutputCount: 0 },
    { status: 'failed' },
    { reason: 'output-pending' },
    { outputs: [] },
    { storageKey: 'hidden' },
    { outputs: [...proof.outputs, ...proof.outputs], expectedOutputCount: 2, verifiedOutputCount: 2 },
    { outputs: [{ ...proof.outputs[0], storageProof: { ...storageProof, storageKey: 'hidden' } }] },
  ])('rejects inconsistent or secret-bearing aggregate proof %#', (change) => {
    expect(imageProviderMediaProofSchema.safeParse({ ...proof, ...change }).success).toBe(false)
  })
  it('prioritizes a failed view over a pending view', () => {
    const failed = {
      ...proof,
      status: 'failed',
      reason: 'output-failed',
      expectedOutputCount: 2,
      verifiedOutputCount: 0,
      outputs: [
        {
          view: 'front',
          storageProof: { ...storageProof, status: 'pending', reason: 'storage-unavailable' },
        },
        { view: 'back', storageProof: { ...storageProof, status: 'failed', reason: 'checksum-mismatch' } },
      ],
    }
    expect(imageProviderMediaProofSchema.parse(failed)).toEqual(failed)
    expect(
      imageProviderMediaProofSchema.safeParse({ ...failed, status: 'pending', reason: 'output-pending' })
        .success,
    ).toBe(false)
  })
})
