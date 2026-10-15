import type { GenerationTask } from '@seqora/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { queuedTextTask } from '../../testing/generationTaskFixtures.js'
import type { CreditLedger } from '../../modules/billing/creditLedger.js'
import { usageCollector } from '../observability/usage.js'
import { GenerationTaskRunner } from './taskDispatcher.js'
import { TaskRefundService } from './taskRunnerComponents.js'
import type { LocalTaskExecutionContext } from './localTaskHandler.js'
import { createScriptTaskHandler } from './scriptTaskHandler.js'
import type { ProjectService } from '../../modules/projects/service.js'
import { imageTask, memoryObjectStorage } from './taskDispatcher.fixture.js'

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

async function fixture() {
  const store = new AppStore(null)
  await store.initialize()
  const task = queuedTextTask('guarded-runner-text')
  await store.mutate((state) => {
    state.tasks = [task]
  })
  const current = () => store.read((state) => state.tasks[0]!)
  const refundGeneration = vi.fn(async () => {})
  const creditLedger = { refundGeneration } as unknown as CreditLedger
  return { store, task, current, refundGeneration, creditLedger }
}

describe('text runner execution guards', () => {
  beforeEach(() => usageCollector.resetForTests())

  it('persists text refund bookkeeping discovered during a media failure without another tick', async () => {
    const f = await fixture()
    const hold = deferred()
    let entered = false
    await f.store.mutate((state) => {
      state.tasks[0]!.status = 'completed'
      state.tasks.push(imageTask('mixed-refund-image', 'asset-midnight-lantern'))
    })
    const persistedText: GenerationTask[] = []
    const runner = new GenerationTaskRunner(f.store, {
      creditLedger: f.creditLedger,
      objectStorage: memoryObjectStorage(),
      persistTask: async () => {},
      persistTickTasks: async (ids) => {
        if (ids.includes(f.task.id)) persistedText.push(structuredClone(f.current()))
      },
      imageProvider: {
        generate: async () => {
          entered = true
          await hold.promise
          throw new Error('Synthetic media failure')
        },
      },
    })
    try {
      await runner.tick()
      await vi.waitFor(() => expect(entered).toBe(true))
      // A historical text failure arrives after the tick's periodic refund pass.
      await f.store.mutate((state) => {
        state.tasks[0]!.status = 'failed'
        state.tasks[0]!.error = 'Synthetic historical failure'
      })
      hold.release()
      await vi.waitFor(() => expect(usageCollector.snapshot().jobConcurrency).toBe(0))
      expect(persistedText).toHaveLength(1)
      expect(persistedText[0]!.metadata.creditsRefundedAt).toEqual(expect.any(String))
      expect(f.refundGeneration.mock.calls.length).toBe(2)
    } finally {
      hold.release()
      runner.stop()
    }
  })

  it.each([undefined, null, 42])(
    'fails and refunds unsupported operation %j instead of leaving it running',
    async (operation) => {
      const f = await fixture()
      await f.store.mutate((state) => {
        if (operation === undefined) delete state.tasks[0]!.metadata.scriptOperation
        else state.tasks[0]!.metadata.scriptOperation = operation
      })
      const runner = new GenerationTaskRunner(f.store, {
        creditLedger: f.creditLedger,
        localTaskHandler: {
          canHandle: () => true,
          execute: createScriptTaskHandler(f.store, {} as ProjectService),
        },
      })
      await runner.tick()
      await vi.waitFor(() => expect(usageCollector.snapshot().jobConcurrency).toBe(0))
      expect(f.current().status).toBe('failed')
      expect(f.current().error).toBe('Unsupported text task operation')
      expect(f.current().leaseToken).toBeNull()
      expect(f.refundGeneration).toHaveBeenCalledTimes(1)
      expect(usageCollector.snapshot().jobCount).toBe(1)
    },
  )

  it.each(['cancelled', 'new lease', 'new attempt', 'expired'] as const)(
    'drops late success and failure after %s',
    async (change) => {
      const f = await fixture()
      const hold = deferred()
      let context: LocalTaskExecutionContext | undefined
      const runner = new GenerationTaskRunner(f.store, {
        creditLedger: f.creditLedger,
        localTaskHandler: {
          canHandle: () => true,
          execute: async (_task, execution) => {
            context = execution
            await hold.promise
            await execution?.assertActive?.()
            return { script: 'obsolete result' }
          },
        },
      })
      await runner.tick()
      await vi.waitFor(() => expect(context?.taskWriteGuard).toBeDefined())
      expect(Object.isFrozen(context!.taskWriteGuard)).toBe(true)
      await f.store.mutate((state) => {
        const t = state.tasks[0]!
        if (change === 'cancelled') t.status = 'cancelled'
        if (change === 'new lease') t.leaseToken = 'replacement-lease'
        if (change === 'new attempt') t.attempts = (t.attempts ?? 0) + 1
        if (change === 'expired') t.leaseExpiresAt = new Date(0).toISOString()
      })
      const before = structuredClone(f.current())
      hold.release()
      await vi.waitFor(() => expect(usageCollector.snapshot().jobConcurrency).toBe(0))
      expect(f.current()).toEqual(before)
      expect(f.current().metadata.textResult).toBeUndefined()
      expect(f.refundGeneration).not.toHaveBeenCalled()
      expect(usageCollector.snapshot().jobCount).toBe(0)
    },
  )

  it.each(['completed', 'failed'] as const)('records %s only after persistence returns', async (outcome) => {
    const f = await fixture()
    const persisted = deferred()
    const runner = new GenerationTaskRunner(f.store, {
      creditLedger: f.creditLedger,
      persistTask: async () => {
        if (f.current().status === outcome) await persisted.promise
      },
      localTaskHandler: {
        canHandle: () => true,
        execute: async () => {
          if (outcome === 'failed') throw new Error('provider unavailable')
          return { script: 'new result' }
        },
      },
    })
    await runner.tick()
    await vi.waitFor(() => expect(f.current().status).toBe(outcome))
    expect(usageCollector.snapshot().jobCount).toBe(0)
    await new TaskRefundService(f.store, f.creditLedger).refundTerminalTasks()
    expect(f.refundGeneration).not.toHaveBeenCalled()
    persisted.release()
    await vi.waitFor(() => expect(usageCollector.snapshot().jobConcurrency).toBe(0))
    expect(usageCollector.snapshot().jobCount).toBe(1)
    expect(f.refundGeneration).toHaveBeenCalledTimes(outcome === 'failed' ? 1 : 0)
  })

  it.each(['completed', 'failed'] as const)(
    'does not observe or refund rejected %s snapshots',
    async (outcome) => {
      const f = await fixture()
      let authoritative: GenerationTask | undefined
      const runner = new GenerationTaskRunner(f.store, {
        creditLedger: f.creditLedger,
        persistTask: async () => {
          if (f.current().status !== outcome) return
          await f.store.mutate((state) => {
            state.tasks[0] = { ...authoritative!, leaseToken: 'new-owner-lease', attempts: 2 }
          })
        },
        localTaskHandler: {
          canHandle: () => true,
          execute: async (task) => {
            authoritative = structuredClone(task)
            if (outcome === 'failed') throw new Error('late provider error')
            return { script: 'late result' }
          },
        },
      })
      await runner.tick()
      await vi.waitFor(() => expect(usageCollector.snapshot().jobConcurrency).toBe(0))
      expect(f.current().status).toBe('running')
      expect(f.current().leaseToken).toBe('new-owner-lease')
      expect(f.current().metadata.textResult).toBeUndefined()
      expect(f.refundGeneration).not.toHaveBeenCalled()
      expect(usageCollector.snapshot().jobCount).toBe(0)
    },
  )

  it('keeps failed cache writes ineligible for refunds when persistence throws', async () => {
    const f = await fixture()
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    try {
      const runner = new GenerationTaskRunner(f.store, {
        creditLedger: f.creditLedger,
        persistTask: async () => {
          throw new Error('database unreachable')
        },
        localTaskHandler: {
          canHandle: () => true,
          execute: async () => {
            throw new Error('failed provider')
          },
        },
      })
      await runner.tick()
      await vi.waitFor(() => expect(usageCollector.snapshot().jobConcurrency).toBe(0))
      await new TaskRefundService(f.store, f.creditLedger).refundTerminalTasks()
      expect(f.current().status).toBe('failed')
      expect(f.refundGeneration).not.toHaveBeenCalled()
      expect(usageCollector.snapshot().jobCount).toBe(0)
    } finally {
      warn.mockRestore()
    }
  })
})
