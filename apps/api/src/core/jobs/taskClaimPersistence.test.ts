import type { GenerationTask } from '@seqora/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRunner } from './taskDispatcher.js'
import { imageTask, memoryObjectStorage, syntheticImage } from './taskDispatcher.fixture.js'
import { usageCollector } from '../observability/usage.js'
import { observabilityMetrics } from '../observability/metrics.js'

beforeEach(() => usageCollector.resetForTests())
afterEach(() => vi.restoreAllMocks())

async function fixture() {
  const store = new AppStore(null)
  await store.initialize()
  const task = imageTask('image-claim-persistence', 'asset-station')
  await store.mutate((state) => {
    state.tasks.unshift(task)
  })
  const provider: ImageGenerationProvider = {
    generate: vi.fn<ImageGenerationProvider['generate']>(async () => [
      { view: 'single', contentType: 'image/png', content: syntheticImage() },
    ]),
  }
  const current = () =>
    store.readGenerationTaskRuntimeCache((state) => state.tasks.find((item) => item.id === task.id)!)
  return { store, task, provider, current }
}

describe('claim persistence precedes Provider scheduling', () => {
  it.each(['persistTickTasks', 'afterTick'] as const)(
    'waits for %s before allowing a fast image completion',
    async (callback) => {
      const f = await fixture()
      const saved: GenerationTask[] = []
      let release!: () => void
      let first = true
      const persistClaim = vi.fn(async () => {
        if (!first) return
        first = false
        saved.push(structuredClone(f.current()))
        await new Promise<void>((resolve) => {
          release = resolve
        })
      })
      const runner = new GenerationTaskRunner(f.store, {
        imageProvider: f.provider,
        objectStorage: memoryObjectStorage(),
        [callback]: persistClaim,
        persistTask: async () => {
          saved.push(structuredClone(f.current()))
        },
      })
      const tick = runner.tick()
      await vi.waitFor(() => expect(persistClaim).toHaveBeenCalledOnce())
      expect(f.provider.generate).not.toHaveBeenCalled()
      expect(saved[0]).toMatchObject({ status: 'running', attempts: 1 })
      expect(saved[0]!.metadata.providerCompletionReceipt).toBeUndefined()
      release()
      await tick
      await vi.waitFor(() => expect(saved.some((task) => task.status === 'completed')).toBe(true))
      expect(
        saved.find((task) => task.status === 'completed')!.metadata.providerCompletionReceipt,
      ).toMatchObject({
        version: 'seqora.provider-image-completion.v1',
        attempts: 1,
      })
    },
  )

  it('does not call the Provider when claim persistence rejects', async () => {
    const f = await fixture()
    const runner = new GenerationTaskRunner(f.store, {
      imageProvider: f.provider,
      objectStorage: memoryObjectStorage(),
      persistTickTasks: async () => {
        throw new Error('claim persistence failed')
      },
    })
    await expect(runner.tick()).rejects.toThrow('claim persistence failed')
    expect(f.provider.generate).not.toHaveBeenCalled()
    expect(f.current().metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('does not dispatch a claim that persistence reconciles to cancellation', async () => {
    const f = await fixture()
    const runner = new GenerationTaskRunner(f.store, {
      imageProvider: f.provider,
      objectStorage: memoryObjectStorage(),
      persistTickTasks: async () => {
        await f.store.mutate((state) => {
          const task = state.tasks.find((item) => item.id === f.task.id)!
          task.status = 'cancelled'
          task.leaseOwnerId = null
          task.leaseToken = null
        })
      },
    })
    await runner.tick()
    expect(f.provider.generate).not.toHaveBeenCalled()
    expect(f.current().status).toBe('cancelled')
  })

  it.each(['accepted', 'rejected', 'changed receipt', 'storage failure'] as const)(
    'records successful image metrics only after persistence: %s',
    async (outcome) => {
      const f = await fixture()
      let release!: () => void
      const terminal = vi.spyOn(observabilityMetrics, 'recordTaskTerminal')
      vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
      const persistTask = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        if (outcome === 'storage failure') throw new Error('database unavailable')
        if (outcome !== 'accepted')
          await f.store.mutate((state) => {
            const task = state.tasks.find((item) => item.id === f.task.id)!
            if (outcome === 'rejected') task.status = 'cancelled'
            task.metadata.providerCompletionReceipt = { replaced: true }
          })
      })
      const runner = new GenerationTaskRunner(f.store, {
        imageProvider: f.provider,
        objectStorage: memoryObjectStorage(),
        persistTickTasks: async () => {},
        persistTask,
      })
      await runner.tick()
      await vi.waitFor(() => expect(persistTask).toHaveBeenCalledOnce())
      expect(usageCollector.snapshot({ userId: f.task.userId })).toMatchObject({
        jobCount: 0,
        creditsUsed: 0,
      })
      expect(terminal).not.toHaveBeenCalledWith(
        expect.objectContaining({ taskId: f.task.id, status: 'completed' }),
      )
      release()
      await vi.waitFor(() =>
        expect(usageCollector.snapshot({ userId: f.task.userId }).jobConcurrency).toBe(0),
      )
      expect(usageCollector.snapshot({ userId: f.task.userId })).toMatchObject({
        jobCount: outcome === 'accepted' ? 1 : 0,
        creditsUsed: outcome === 'accepted' ? f.task.estimatedCredits : 0,
      })
      if (outcome === 'accepted')
        expect(terminal).toHaveBeenCalledWith(
          expect.objectContaining({ taskId: f.task.id, status: 'completed' }),
        )
      else
        expect(terminal).not.toHaveBeenCalledWith(
          expect.objectContaining({ taskId: f.task.id, status: 'completed' }),
        )
    },
  )
})
