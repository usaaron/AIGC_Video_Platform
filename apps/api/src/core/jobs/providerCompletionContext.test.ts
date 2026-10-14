import type { GenerationTask } from '@seqora/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearProviderCompletionContext,
  findProviderCompletionContext,
  registerProviderCompletionContext,
} from './providerCompletionContext.js'

function task(id: string): GenerationTask {
  return { metadata: { providerCompletionReceipt: { taskId: id } } } as unknown as GenerationTask
}

afterEach(() => vi.useRealTimers())

describe('private provider completion context', () => {
  it('survives task cloning without putting lease credentials into metadata', () => {
    const source = task('context-clone')
    registerProviderCompletionContext(source, 'owner', 'token')
    expect(findProviderCompletionContext(structuredClone(source))).toMatchObject({
      leaseOwnerId: 'owner',
      leaseToken: 'token',
    })
    expect(JSON.stringify(source)).not.toContain('token')
    clearProviderCompletionContext(source)
    expect(findProviderCompletionContext(source)).toBeNull()
  })

  it('expires source lease authority after five minutes', () => {
    vi.useFakeTimers()
    const source = task('context-expiry')
    registerProviderCompletionContext(source, 'owner', 'token')
    vi.advanceTimersByTime(5 * 60_000)
    expect(findProviderCompletionContext(source)).toBeNull()
  })

  it('bounds retained contexts and fails closed on evicted or changed receipts', () => {
    const oldest = task('context-bound-first')
    registerProviderCompletionContext(oldest, 'owner', 'token')
    const tasks = Array.from({ length: 1_024 }, (_, index) => task(`context-bound-${index}`))
    for (const current of tasks) registerProviderCompletionContext(current, 'owner', 'token')
    expect(findProviderCompletionContext(oldest)).toBeNull()
    expect(findProviderCompletionContext(tasks.at(-1)!)).not.toBeNull()
    const altered = structuredClone(tasks.at(-1)!)
    altered.metadata.providerCompletionReceipt = { taskId: 'changed' }
    expect(findProviderCompletionContext(altered)).toBeNull()
    for (const current of tasks) clearProviderCompletionContext(current)
  })
})
