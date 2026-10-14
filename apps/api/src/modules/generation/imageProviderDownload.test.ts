import { Readable } from 'node:stream'
import { deliveryContractSchema } from '@seqora/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { completedImage } from './imageProviderCompletion.fixture.js'
import { downloadPrincipal } from './deliveryDownload.fixture.js'
import { prepareDeliveryDownload } from './deliveryDownload.js'
import { GenerationTaskRepository } from './repository.js'
import { freezeDeliveryContract } from './deliveryContractFreeze.js'

afterEach(() => vi.useRealTimers())

async function fixture() {
  const source = completedImage(true)
  const store = new AppStore(null)
  await store.initialize()
  await store.mutate((state) => {
    state.tasks = [structuredClone(source.task)]
  })
  const repository = new GenerationTaskRepository(store)
  const input = {
    clientRequestId: 'image-download',
    expectedUpdatedAt: source.task.updatedAt,
    contractHash: deliveryContractSchema.parse(source.task.metadata.deliveryContract).contractHash!,
  }
  const prepare = (signal?: AbortSignal) =>
    prepareDeliveryDownload(repository, source.storage, source.task.id, input, downloadPrincipal, signal)
  return { ...source, store, repository, input, prepare }
}

describe('image receipt formal download guard', () => {
  it('captures and verifies every view while returning only the primary image', async () => {
    const { task, receipt, storage, objects, prepare } = await fixture()
    const result = await prepare()
    try {
      expect(result.content).toEqual(objects.get(receipt.outputs[0]!.storageKey))
      expect(result.receipt.snapshot.evidence.find((item) => item.kind === 'provider')).toMatchObject({
        status: 'passed',
        details: { currentMediaProof: { expectedOutputCount: 3, verifiedOutputCount: 3 } },
      })
      expect(result.fileName).toBe(`seqora-${task.id}.png`)
      expect(storage.getStream).toHaveBeenCalledTimes(3)
      expect(storage.get).not.toHaveBeenCalled()
    } finally {
      result.release()
    }
  })

  it.each(['replace', 'remove'])(
    'rejects %s of a secondary view before receipt authorization',
    async (action) => {
      const { task, receipt, objects, store, prepare } = await fixture()
      const key = receipt.outputs[1]!.storageKey
      if (action === 'remove') objects.delete(key)
      else {
        const bytes = Buffer.from(objects.get(key)!)
        bytes[bytes.length - 1] = 200
        objects.set(key, bytes)
      }
      await expect(prepare()).rejects.toMatchObject({
        code: action === 'remove' ? 'DELIVERY_MEDIA_UNAVAILABLE' : 'DELIVERY_MEDIA_CHANGED',
      })
      expect(
        store.read((state) => state.tasks.find((item) => item.id === task.id)?.metadata.deliveryDownloads),
      ).toBeUndefined()
    },
  )

  it('uses one deadline for all captured images and releases its concurrency slot', async () => {
    vi.useFakeTimers()
    const { storage, receipt, prepare, objects } = await fixture()
    const streams: Readable[] = []
    storage.getStream.mockImplementation(async (key) => {
      await new Promise((resolve) => setTimeout(resolve, 8_000))
      const bytes = objects.get(key)!
      const stream = Readable.from([bytes])
      streams.push(stream)
      return { stream, size: bytes.length }
    })
    const pending = expect(prepare()).rejects.toMatchObject({ code: 'DELIVERY_READ_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(15_001)
    await pending
    await vi.advanceTimersByTimeAsync(1_000)
    expect(storage.getStream).toHaveBeenCalledTimes(2)
    expect(streams.every((stream) => stream.destroyed)).toBe(true)
    storage.getStream.mockImplementation(async (key) => ({
      stream: Readable.from([objects.get(key)!]),
      size: receipt.outputs[0]!.size,
    }))
    const retry = await prepare()
    retry.release()
  })

  it('cancels an active secondary read and does not issue a download receipt', async () => {
    const { storage, receipt, prepare, objects, task, store } = await fixture()
    const controller = new AbortController()
    const stalled = new Readable({ read() {} })
    storage.getStream.mockImplementation(async (key) => {
      if (key === receipt.outputs[1]!.storageKey) {
        controller.abort()
        return { stream: stalled, size: receipt.outputs[1]!.size }
      }
      return { stream: Readable.from([objects.get(key)!]), size: objects.get(key)!.length }
    })
    await expect(prepare(controller.signal)).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_ABORTED' })
    expect(stalled.destroyed).toBe(true)
    expect(storage.getStream).toHaveBeenCalledTimes(2)
    expect(
      store.read((state) => state.tasks.find((item) => item.id === task.id)?.metadata.deliveryDownloads),
    ).toBeUndefined()
  })

  it('rejects same-timestamp secondary descriptor changes during capture', async () => {
    const { storage, objects, store, receipt, prepare } = await fixture()
    storage.getStream.mockImplementation(async (key) => {
      if (key === receipt.outputs[2]!.storageKey)
        await store.mutate((state) => {
          const outputs = state.tasks[0]!.metadata.generatedOutputs as Array<{ sha256: string }>
          outputs[1]!.sha256 = 'f'.repeat(64)
        })
      return { stream: Readable.from([objects.get(key)!]), size: objects.get(key)!.length }
    })
    await expect(prepare()).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_STALE' })
    expect(store.read((state) => state.tasks[0]!.metadata.deliveryDownloads)).toBeUndefined()
  })

  it('blocks legacy no-receipt images under a provider completion contract', async () => {
    const { store, prepare } = await fixture()
    await store.mutate((state) => {
      delete state.tasks[0]!.metadata.providerCompletionReceipt
    })
    await expect(prepare()).rejects.toMatchObject({ code: 'DELIVERY_GATE_BLOCKED' })
    expect(store.read((state) => state.tasks[0]!.metadata.providerCompletionReceipt)).toBeUndefined()
  })

  it('preserves historical image contracts and their original requirements without inventing receipts', async () => {
    const { store, input, prepare, task } = await fixture()
    const legacy = freezeDeliveryContract(
      {
        version: 'seqora.delivery.v1',
        intent: { mode: 'asset', projectId: task.projectId },
        expectedArtifact: { type: 'image', count: 1 },
        must: [{ id: 'media-url', statement: 'Historical media requirement', source: 'system' }],
      },
      task.updatedAt,
    )
    input.contractHash = legacy.contractHash!
    await store.mutate((state) => {
      delete state.tasks[0]!.metadata.providerCompletionReceipt
      state.tasks[0]!.metadata.deliveryContract = structuredClone(legacy)
    })
    const result = await prepare()
    try {
      expect(result.receipt.contractHash).toBe(legacy.contractHash)
      expect(result.receipt.snapshot.contract).toEqual(legacy)
      const saved = store.read((state) => state.tasks[0]!)
      expect(saved.metadata.deliveryContract).toEqual(legacy)
      expect(saved.metadata.providerCompletionReceipt).toBeUndefined()
      expect(result.receipt.snapshot.evidence.find((item) => item.kind === 'provider')?.status).toBe(
        'pending',
      )
    } finally {
      result.release()
    }
  })
})
