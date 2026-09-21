import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../../modules/billing/creditLedger.js'
import { GenerationTaskRunner } from './taskDispatcher.js'
import { TaskRefundService } from './taskRefundService.js'

describe('refund writeback durability', () => {
  it('explicitly flushes periodic refund metadata for otherwise unchanged failed tasks', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = failedTask('periodic-refund')
    const originalUpdatedAt = task.updatedAt
    await store.mutate((state) => {
      state.tasks = [task]
    })
    let persisted = structuredClone(task)
    const persistTickTasks = vi.fn(async (ids: readonly string[]) => {
      if (ids.includes(task.id)) persisted = store.read((state) => state.tasks[0]!)
    })
    const refundGeneration = vi.fn(async () => {})
    await new GenerationTaskRunner(store, {
      persistTickTasks,
      creditLedger: { refundGeneration } as unknown as CreditLedger,
    }).tick()

    expect(persistTickTasks).toHaveBeenCalledWith([task.id])
    expect(persisted.metadata.creditsRefundedAt).toEqual(expect.any(String))
    expect(Date.parse(persisted.updatedAt)).toBeGreaterThan(Date.parse(originalUpdatedAt))
    const restartedStore = new AppStore(null)
    await restartedStore.initialize()
    await restartedStore.mutate((state) => {
      state.tasks = [persisted]
    })
    await new GenerationTaskRunner(restartedStore, {
      creditLedger: { refundGeneration } as unknown as CreditLedger,
    }).tick()
    expect(refundGeneration).toHaveBeenCalledOnce()
  })

  it('retries failed persistence without refunding the same task a second time', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = failedTask('refund-persistence-retry')
    await store.mutate((state) => {
      state.tasks = [task]
    })
    let persisted: GenerationTask | undefined
    let failedOnce = false
    const persistTickTasks = vi.fn(async (ids: readonly string[]) => {
      if (!ids.includes(task.id)) return
      if (!failedOnce) {
        failedOnce = true
        throw new Error('database temporarily unavailable')
      }
      persisted = store.read((state) => state.tasks[0]!)
    })
    const refundGeneration = vi.fn(async () => {})
    const runner = new GenerationTaskRunner(store, {
      persistTickTasks,
      creditLedger: { refundGeneration } as unknown as CreditLedger,
    })
    await expect(runner.tick()).rejects.toThrow('database temporarily unavailable')
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11_000)
    try {
      await runner.tick()
    } finally {
      clock.mockRestore()
    }
    expect(persisted?.metadata.creditsRefundedAt).toEqual(expect.any(String))
    expect(refundGeneration).toHaveBeenCalledOnce()
  })

  it('isolates a ledger error and leaves only that task pending for a later retry', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const first = failedTask('refund-blocked'),
      second = failedTask('refund-ready')
    await store.mutate((state) => {
      state.tasks = [first, second]
    })
    const refundGeneration = vi.fn(async (task: GenerationTask) => {
      if (task.id === first.id) throw new Error('private database error')
    })
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    const service = new TaskRefundService(store, { refundGeneration } as unknown as CreditLedger)
    try {
      expect(await service.refundTerminalTasks()).toEqual([second.id])
      expect(store.read((state) => state.tasks[0]?.metadata.creditsRefundedAt)).toBeUndefined()
      expect(store.read((state) => state.tasks[1]?.metadata.creditsRefundedAt)).toEqual(expect.any(String))
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private database error')
    } finally {
      warning.mockRestore()
    }
  })
})

function failedTask(id: string): GenerationTask {
  return {
    id,
    clientRequestId: id,
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind: 'video',
    label: '退款回归',
    prompt: '',
    negativePrompt: '',
    provider: 'seedance',
    model: null,
    metadata: {},
    status: 'failed',
    progress: 100,
    estimatedCredits: 18,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    resultUrl: null,
    outputs: [],
    error: '上游失败',
  }
}
