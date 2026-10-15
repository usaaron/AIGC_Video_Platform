import { describe, expect, it } from 'vitest'
import type { GenerationTask } from '@seqora/contracts'
import { queuedTextTask } from '../../testing/generationTaskFixtures.js'
import { claimGenerationTaskLease } from './taskLease.js'
import { assertTextTaskWriteGuard, captureTextTaskWriteGuard } from './textTaskExecutionGuard.js'

function fixture() {
  const task = queuedTextTask('guarded-script')
  claimGenerationTaskLease(task, 'worker-a', 60_000)
  return { task, guard: captureTextTaskWriteGuard(task) }
}

describe('text execution write guard', () => {
  it.each([undefined, null, 42, { invalid: true }])(
    'preserves failure authority for invalid operation %j',
    (operation) => {
      const task = queuedTextTask('invalid-operation')
      if (operation === undefined) delete task.metadata.scriptOperation
      else task.metadata.scriptOperation = operation
      claimGenerationTaskLease(task, 'worker-a', 60_000)
      const guard = captureTextTaskWriteGuard(task)
      expect(guard.operation).toBeNull()
      expect(() => assertTextTaskWriteGuard(task, guard)).not.toThrow()
      task.metadata.scriptOperation = 'generate'
      expect(() => assertTextTaskWriteGuard(task, guard)).toThrow('未写入本次结果')
    },
  )

  it('captures an immutable execution identity while allowing heartbeat renewal', () => {
    const { task, guard } = fixture()
    expect(Object.isFrozen(guard)).toBe(true)
    task.leaseExpiresAt = new Date(Date.now() + 120_000).toISOString()
    expect(() => assertTextTaskWriteGuard(task, guard)).not.toThrow()
  })

  it.each<[string, (task: GenerationTask) => void]>([
    [
      'cancelled',
      (t) => {
        t.status = 'cancelled'
      },
    ],
    [
      'completed',
      (t) => {
        t.status = 'completed'
      },
    ],
    [
      'queued retry',
      (t) => {
        t.status = 'queued'
      },
    ],
    [
      'another attempt',
      (t) => {
        t.attempts = 2
      },
    ],
    [
      'new owner',
      (t) => {
        t.leaseOwnerId = 'worker-b'
      },
    ],
    [
      'new lease',
      (t) => {
        t.leaseToken = 'new-lease'
      },
    ],
    [
      'expired lease',
      (t) => {
        t.leaseExpiresAt = new Date(0).toISOString()
      },
    ],
    [
      'missing lease expiry',
      (t) => {
        t.leaseExpiresAt = null
      },
    ],
    [
      'another organization',
      (t) => {
        t.tenantId = 'another-tenant'
      },
    ],
    [
      'another project',
      (t) => {
        t.projectId = 'another-project'
      },
    ],
    [
      'another user',
      (t) => {
        t.userId = 'another-user'
      },
    ],
    [
      'another task',
      (t) => {
        t.id = 'another-task'
      },
    ],
    [
      'another request',
      (t) => {
        t.clientRequestId = 'another-request'
      },
    ],
    [
      'another operation',
      (t) => {
        t.metadata.scriptOperation = 'enrich'
      },
    ],
    [
      'another model',
      (t) => {
        t.model = 'glm-5.2'
      },
    ],
    [
      'another provider',
      (t) => {
        t.provider = 'img2'
      },
    ],
    [
      'another kind',
      (t) => {
        t.kind = 'image'
      },
    ],
  ])('rejects %s even when other identity fields match', (_label, change) => {
    const { task, guard } = fixture()
    change(task)
    expect(() => assertTextTaskWriteGuard(task, guard)).toThrow('未写入本次结果')
  })

  it('rejects missing or independently scoped tasks', () => {
    const { task, guard } = fixture()
    expect(() => assertTextTaskWriteGuard(undefined, guard)).toThrow()
    task.projectId = 'sm-standalone-private'
    expect(() => captureTextTaskWriteGuard(task)).toThrow()
  })
})
