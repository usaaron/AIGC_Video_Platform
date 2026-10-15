import { describe, expect, it } from 'vitest'
import { queuedTextTask } from '../../testing/generationTaskFixtures.js'
import { claimGenerationTaskLease, releaseGenerationTaskLease } from './taskLease.js'
import { captureTextTaskWriteGuard } from './textTaskExecutionGuard.js'
import { recordTextTaskCancellation, textTaskCancellationMatches } from './textTaskCancellation.js'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from '../../modules/generation/repository.js'

describe('text cancellation execution identity', () => {
  it('keeps a non-secret digest that matches only the cancelled execution', () => {
    const task = queuedTextTask('text-cancellation')
    claimGenerationTaskLease(task, 'worker-a', 60_000)
    const first = captureTextTaskWriteGuard(task)
    claimGenerationTaskLease(task, 'worker-b', 60_000, new Date(), { countAttempt: false })
    const second = captureTextTaskWriteGuard(task)
    recordTextTaskCancellation(task)
    task.status = 'cancelled'
    releaseGenerationTaskLease(task)
    expect(textTaskCancellationMatches(task, first)).toBe(false)
    expect(textTaskCancellationMatches(task, second)).toBe(true)
    const serialized = JSON.stringify(task.metadata.textCancellationExecution)
    expect(serialized).not.toContain(second.leaseToken)
    expect(serialized).not.toContain(second.leaseOwnerId)
    task.attempts = 2
    expect(textTaskCancellationMatches(task, second)).toBe(false)
  })

  it('does not authorize a historical cancellation without an execution binding', () => {
    const task = queuedTextTask('old-cancellation')
    claimGenerationTaskLease(task, 'worker-a', 60_000)
    const guard = captureTextTaskWriteGuard(task)
    task.status = 'cancelled'
    recordTextTaskCancellation(task)
    expect(textTaskCancellationMatches(task, guard)).toBe(false)
  })

  it('records the original execution before ordinary queue cancellation releases the lease', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = queuedTextTask('cancel-through-repository')
    claimGenerationTaskLease(task, 'worker-a', 60_000)
    const guard = captureTextTaskWriteGuard(task)
    await store.mutate((state) => {
      state.tasks = [task]
    })
    const repository = new GenerationTaskRepository(store)
    const result = await repository.deleteFromQueue(task.id, {
      tenantId: task.tenantId,
      userId: task.userId,
      roles: ['member'],
    })
    expect(result.task?.status).toBe('cancelled')
    expect(result.task?.leaseToken).toBeNull()
    expect(textTaskCancellationMatches(result.task!, guard)).toBe(true)
  })
})
