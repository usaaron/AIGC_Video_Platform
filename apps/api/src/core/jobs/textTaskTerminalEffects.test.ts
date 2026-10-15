import { beforeEach, describe, expect, it } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { queuedTextTask } from '../../testing/generationTaskFixtures.js'
import { usageCollector } from '../observability/usage.js'
import {
  isTextTaskTerminalPending,
  markTextTaskTerminalPending,
  settleTextTaskTerminal,
} from './textTaskTerminalEffects.js'

describe('text terminal effects after persistence', () => {
  beforeEach(() => usageCollector.resetForTests())

  async function fixture() {
    const store = new AppStore(null)
    await store.initialize()
    const task = {
      ...queuedTextTask('pending-text-terminal'),
      status: 'failed' as const,
      attempts: 1,
      error: 'synthetic failure',
    }
    await store.mutate((state) => {
      state.tasks = [task]
    })
    markTextTaskTerminalPending(store, task)
    return { store, task }
  }

  it('records the exact committed terminal snapshot once', async () => {
    const { store, task } = await fixture()
    settleTextTaskTerminal(store, task)
    settleTextTaskTerminal(store, task)
    expect(isTextTaskTerminalPending(store, task)).toBe(false)
    expect(usageCollector.snapshot().jobCount).toBe(1)
  })

  it('keeps an altered uncommitted failed cache ineligible for refunds', async () => {
    const { store, task } = await fixture()
    await store.mutate((state) => {
      state.tasks[0]!.metadata.localNote = 'concurrent metadata edit'
    })
    settleTextTaskTerminal(store, task)
    const current = store.read((state) => state.tasks[0]!)
    expect(isTextTaskTerminalPending(store, current)).toBe(true)
    expect(usageCollector.snapshot().jobCount).toBe(0)
    settleTextTaskTerminal(store, current)
    expect(isTextTaskTerminalPending(store, current)).toBe(true)
    // The changed snapshot may settle only after the database accepts it.
    settleTextTaskTerminal(store, current, true)
    expect(isTextTaskTerminalPending(store, current)).toBe(false)
    expect(usageCollector.snapshot().jobCount).toBe(1)
  })

  it('clears rejected execution effects after authoritative state becomes running', async () => {
    const { store, task } = await fixture()
    await store.mutate((state) => {
      state.tasks[0]!.status = 'running'
      state.tasks[0]!.attempts = 2
    })
    settleTextTaskTerminal(store, task)
    expect(isTextTaskTerminalPending(store, task)).toBe(false)
    expect(usageCollector.snapshot().jobCount).toBe(0)
  })
})
