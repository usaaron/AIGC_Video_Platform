import { describe, expect, it, vi } from 'vitest'
import type { ImageGenerationOutput, ImageGenerationProvider } from '../generation/imageProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore } from '../../infra/store.js'
import { imageTask, memoryObjectStorage, syntheticImage } from './taskDispatcher.fixture.js'
import { ImageTaskExecutor, TaskRefundService, TaskWritebackService } from './taskRunnerComponents.js'
import { claimGenerationTaskLease } from './taskLease.js'

const outputs = (): ImageGenerationOutput[] => [
  { view: 'single', contentType: 'image/png', content: syntheticImage() },
]

async function fixture(storage: ObjectStorage | null = memoryObjectStorage()) {
  const store = new AppStore(null)
  await store.initialize()
  const task = imageTask('image-executor-proof', 'asset-station')
  claimGenerationTaskLease(task, 'image-worker', 60_000)
  task.metadata.providerName = 'tokenadvent-img2'
  await store.mutate((state) => {
    state.tasks.unshift(task)
  })
  const provider: ImageGenerationProvider = { generate: vi.fn(async () => outputs()) }
  const writeback = new TaskWritebackService(
    store,
    storage,
    'image-worker',
    60_000,
    new TaskRefundService(store),
  )
  const executor = new ImageTaskExecutor(store, {
    imageProvider: provider,
    mediaRepository: null,
    objectStorage: storage,
    leaseOwnerId: 'image-worker',
    leaseTtlMs: 60_000,
    writeback,
  })
  const current = () => store.read((state) => state.tasks.find((item) => item.id === task.id)!)
  return { store, task, storage, provider, executor, writeback, current }
}

describe('ImageTaskExecutor trusted completion', () => {
  it('captures the prepared server request and records successful stored output', async () => {
    const f = await fixture()
    expect(f.task.metadata.providerIdempotencyKey).toBeUndefined()
    await f.executor.execute(f.task)
    const request = vi.mocked(f.provider.generate).mock.calls[0]![0]
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(request.outputs)).toBe(true)
    expect(f.current()).toMatchObject({
      status: 'completed',
      metadata: {
        providerState: 'completed',
        providerCompletionReceipt: {
          version: 'seqora.provider-image-completion.v1',
          requestId: `generation:${f.task.tenantId}:${f.task.id}`,
          attempts: 1,
        },
      },
    })
  })

  it('fails without storage before calling the Provider and clears any old receipt', async () => {
    const f = await fixture(null)
    await f.store.mutate((state) => {
      state.tasks.find((item) => item.id === f.task.id)!.metadata.providerCompletionReceipt = { stale: true }
    })
    await f.executor.execute(f.task)
    expect(f.provider.generate).not.toHaveBeenCalled()
    expect(f.current()).toMatchObject({
      status: 'failed',
      error: 'Image storage is not configured',
      outputs: [],
      resultUrl: null,
    })
    expect(f.current().metadata.providerCompletionReceipt).toBeUndefined()
  })

  it.each(['resolved', 'rejected'] as const)(
    'ignores %s old request after a same-lease request change',
    async (outcome) => {
      const f = await fixture()
      let resolve!: (value: ImageGenerationOutput[]) => void
      let reject!: (error: Error) => void
      vi.mocked(f.provider.generate).mockImplementation(
        () =>
          new Promise((done, fail) => {
            resolve = done
            reject = fail
          }),
      )
      const pending = f.executor.execute(f.task)
      await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledOnce())
      await f.store.mutate((state) => {
        const current = state.tasks.find((item) => item.id === f.task.id)!
        current.metadata.providerIdempotencyKey = 'new-request'
        current.metadata.providerCompletionReceipt = { current: true }
        current.progress = 60
      })
      const before = structuredClone(f.current())
      if (outcome === 'resolved') resolve(outputs())
      else reject(new Error('late upstream failure'))
      await pending
      expect(f.current()).toEqual(before)
    },
  )

  it('does not invoke the Provider for an already replaced lease', async () => {
    const f = await fixture()
    await f.store.mutate((state) => {
      claimGenerationTaskLease(
        state.tasks.find((item) => item.id === f.task.id)!,
        'new-worker',
        60_000,
      )
    })
    await f.executor.execute(f.task)
    expect(f.provider.generate).not.toHaveBeenCalled()
    expect(f.current()).toMatchObject({ status: 'running', leaseOwnerId: 'new-worker', attempts: 2 })
  })

  it('ignores completion after cancellation while storage is pending', async () => {
    const f = await fixture()
    let release!: () => void
    vi.mocked(f.storage!.put).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const pending = f.executor.execute(f.task)
    await vi.waitFor(() => expect(f.storage!.put).toHaveBeenCalledOnce())
    await f.store.mutate((state) => {
      const current = state.tasks.find((item) => item.id === f.task.id)!
      current.status = 'cancelled'
      current.metadata.providerCompletionReceipt = { cancelled: true }
    })
    const before = structuredClone(f.current())
    release()
    await pending
    expect(f.current()).toEqual(before)
  })
})
