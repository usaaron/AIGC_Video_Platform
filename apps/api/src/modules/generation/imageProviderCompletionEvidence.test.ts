import { Readable } from 'node:stream'
import { imageCompletionMediaVersion } from '@seqora/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { completedImage } from './imageProviderCompletion.fixture.js'
import { providerCompletionEvidence } from './providerCompletionEvidence.js'
import { buildGenerationTaskDeliveryEvidence } from './deliveryEvidence.js'
import { buildDeliveryVerificationSnapshot } from './deliveryVerification.js'
import { verifyImageProviderMedia } from './imageProviderStorageVerification.js'

afterEach(() => vi.useRealTimers())

describe('image provider completion evidence', () => {
  it.each([false, true])(
    'verifies all requested views and reads each once (turnaround=%s)',
    async (turnaround) => {
      const { task, receipt, storage } = completedImage(turnaround)
      const before = structuredClone(task)
      expect(providerCompletionEvidence(task)).toEqual({ reason: 'verified', receipt })
      const snapshot = await buildDeliveryVerificationSnapshot(task, storage, task.updatedAt)
      expect(snapshot.verification?.status).toBe('satisfied')
      expect(snapshot.evidence.find((item) => item.kind === 'provider')).toMatchObject({
        status: 'passed',
        details: {
          currentMediaProof: {
            status: 'passed',
            reason: 'verified',
            expectedOutputCount: receipt.outputs.length,
            verifiedOutputCount: receipt.outputs.length,
          },
        },
      })
      expect(storage.getStream).toHaveBeenCalledTimes(receipt.outputs.length)
      expect(storage.get).not.toHaveBeenCalled()
      expect(task).toEqual(before)
    },
  )

  it.each([
    ['tenantId', 'another-tenant'],
    ['projectId', 'another-project'],
    ['taskId', 'another-task'],
    ['requestId', 'another-request'],
    ['attempts', 2],
    ['mediaVersion', 'old-version'],
  ])('rejects another receipt %s', (key, value) => {
    const { task, receipt } = completedImage()
    task.metadata.providerCompletionReceipt = { ...receipt, [key as string]: value }
    expect(providerCompletionEvidence(task).reason).toBe('receipt-mismatch')
  })

  it.each([
    'missing',
    'duplicate',
    'extra',
    'changed-hash',
    'foreign-url',
    'foreign-storage',
    'changed-request-set',
  ])('rejects incomplete or changed all-view bindings: %s', (change) => {
    const { task, receipt } = completedImage(true)
    if (change === 'missing') task.outputs.pop()
    if (change === 'duplicate') task.outputs[2] = { ...task.outputs[1]! }
    if (change === 'extra')
      task.metadata.generatedOutputs = [...receipt.outputs, { ...receipt.outputs[0], view: 'detail' }]
    if (change === 'changed-hash')
      (task.metadata.generatedOutputs as Array<{ sha256: string }>)[1]!.sha256 = 'f'.repeat(64)
    if (change === 'foreign-url') task.outputs[1]!.url = '/api/v1/generation/tasks/other/outputs/side'
    if (change === 'foreign-storage') {
      receipt.outputs[1]!.storageKey = 'other-tenant/project/generated/file.png'
      task.metadata.generatedOutputs = structuredClone(receipt.outputs)
    }
    if (change === 'changed-request-set') task.metadata.turnaround = false
    receipt.mediaVersion = imageCompletionMediaVersion(task)
    expect(providerCompletionEvidence(task).reason).toBe('receipt-mismatch')
  })

  it.each(['duplicate-view', 'duplicate-key', 'budget', 'bad-hash', 'claimed-provider-signature'])(
    'rejects invalid receipt schema: %s without I/O',
    async (change) => {
      const { task, receipt, storage } = completedImage(true)
      if (change === 'duplicate-view') receipt.outputs[1]!.view = 'front'
      if (change === 'duplicate-key') receipt.outputs[1]!.storageKey = receipt.outputs[0]!.storageKey
      if (change === 'budget') for (const output of receipt.outputs) output.size = 40 * 1024 * 1024
      if (change === 'bad-hash') receipt.outputs[1]!.sha256 = 'unknown'
      if (change === 'claimed-provider-signature')
        task.metadata.providerCompletionReceipt = { ...receipt, attestation: 'provider-signed' }
      expect(providerCompletionEvidence(task).reason).toBe('invalid-receipt')
      expect(await verifyImageProviderMedia(task, storage)).toBeNull()
      expect(storage.getStream).not.toHaveBeenCalled()
    },
  )

  it.each(['replaced', 'missing', 'wrong-signature'])(
    'blocks Provider completion when a secondary output is %s',
    async (change) => {
      const { task, receipt, storage, objects } = completedImage(true)
      const key = receipt.outputs[1]!.storageKey
      if (change === 'missing') objects.delete(key)
      else {
        const bytes = Buffer.from(objects.get(key)!)
        bytes[change === 'wrong-signature' ? 0 : bytes.length - 1] = 255
        objects.set(key, bytes)
      }
      const snapshot = await buildDeliveryVerificationSnapshot(task, storage, task.updatedAt)
      expect(snapshot.evidence.find((item) => item.kind === 'asset')?.status).toBe('passed')
      expect(snapshot.evidence.find((item) => item.kind === 'provider')).toMatchObject({
        status: 'failed',
        details: { currentMediaProof: { reason: 'output-failed', verifiedOutputCount: 2 } },
      })
      expect(snapshot.verification?.status).toBe('failed')
    },
  )

  it('keeps unavailable storage pending and legacy records without a synthetic receipt', async () => {
    const { task, storage } = completedImage(true)
    expect((await verifyImageProviderMedia(task, null))?.status).toBe('pending')
    delete task.metadata.providerCompletionReceipt
    expect(providerCompletionEvidence(task).reason).toBe('missing-receipt')
    expect(buildGenerationTaskDeliveryEvidence(task).find((item) => item.kind === 'provider')?.status).toBe(
      'pending',
    )
    expect(
      (await buildDeliveryVerificationSnapshot(task, storage, task.updatedAt)).verification?.status,
    ).toBe('partial')
    expect(task.metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('stops all output reads at one overall deadline and destroys the active stream', async () => {
    vi.useFakeTimers()
    const { task, receipt, storage } = completedImage(true)
    const stream = new Readable({ read() {} })
    storage.getStream.mockImplementation(async () => ({ stream, size: receipt.outputs[0]!.size }))
    const pending = verifyImageProviderMedia(task, storage)
    await vi.advanceTimersByTimeAsync(15_001)
    const proof = await pending
    expect(proof).toMatchObject({ status: 'pending', expectedOutputCount: 3, verifiedOutputCount: 0 })
    expect(proof?.outputs.every((output) => output.storageProof.reason === 'read-timeout')).toBe(true)
    expect(storage.getStream).toHaveBeenCalledOnce()
    expect(stream.destroyed).toBe(true)
  })

  it('honors caller cancellation before opening any image output', async () => {
    const { task, storage } = completedImage(true)
    const controller = new AbortController()
    controller.abort()
    expect((await verifyImageProviderMedia(task, storage, controller.signal))?.status).toBe('pending')
    expect(storage.getStream).not.toHaveBeenCalled()
  })
})
