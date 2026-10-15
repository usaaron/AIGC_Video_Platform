import { describe, expect, it } from 'vitest'
import { claimGenerationTaskLease, releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { captureTextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import { recordTextTaskCancellation } from '../../core/jobs/textTaskCancellation.js'
import { AppStore } from '../../infra/store.js'
import { buildQueuedGenerationTask } from '../generation/taskCreation.js'
import { UserRepository } from '../users/repository.js'
import { StoreCreditLedger } from './creditLedger.js'
import { runBillableScriptOperation } from './scriptBilling.js'
import { assertTextTaskRefundGuard } from './textTaskRefundGuard.js'

const principal = { tenantId: 'tenant-seqora-demo', userId: 'user-member', roles: ['member'] } as const
function fixture() {
  const task = buildQueuedGenerationTask(
    {
      projectId: 'project-1',
      clientRequestId: 'request-1',
      kind: 'text',
      provider: 'text',
      model: 'seqora-5.6',
      label: '分集生成',
      estimatedCredits: 0,
      metadata: {
        scriptOperation: 'generate',
        episodePlan: { episodes: [{ title: '第一集', source: '故事' }] },
      },
    },
    { ...principal, roles: ['member'] },
    new Date().toISOString(),
  )
  claimGenerationTaskLease(task, 'worker-a', 60_000)
  const guard = captureTextTaskWriteGuard(task)
  const reference = `script-generate-${task.id}-episode-0`
  const input = {
    tenantId: principal.tenantId,
    userId: principal.userId,
    originalEntryId: `generation-${reference}`,
    refundEntryId: `refund-${reference}`,
    taskWriteGuard: guard,
  }
  const cancel = () => {
    recordTextTaskCancellation(task)
    task.status = 'cancelled'
    releaseGenerationTaskLease(task)
  }
  return { task, guard, reference, input, cancel }
}

describe('text task refund authority', () => {
  it('allows only the current live execution or its own refundable cancellation', () => {
    const f = fixture()
    expect(() => assertTextTaskRefundGuard(f.task, f.input)).not.toThrow()
    f.cancel()
    expect(() => assertTextTaskRefundGuard(f.task, f.input)).not.toThrow()
  })

  it.each([
    'same-attempt-takeover',
    'cancelled-successor',
    'new-attempt',
    'expired',
    'disabled',
    'failed',
    'completed',
    'missing-cancel-marker',
  ] as const)('denies %s refunds', (mode) => {
    const f = fixture()
    if (mode === 'same-attempt-takeover' || mode === 'cancelled-successor')
      claimGenerationTaskLease(f.task, 'worker-b', 60_000, new Date(), { countAttempt: false })
    if (mode === 'cancelled-successor') f.cancel()
    if (mode === 'new-attempt') {
      f.cancel()
      f.task.attempts! += 1
    }
    if (mode === 'expired') f.task.leaseExpiresAt = new Date(Date.now() - 1000).toISOString()
    if (mode === 'disabled') {
      f.cancel()
      f.task.metadata.creditsRefundDisabledAt = new Date().toISOString()
    }
    if (mode === 'failed' || mode === 'completed') {
      f.task.status = mode
      releaseGenerationTaskLease(f.task)
    }
    if (mode === 'missing-cancel-marker') {
      f.task.status = 'cancelled'
      releaseGenerationTaskLease(f.task)
    }
    expect(() => assertTextTaskRefundGuard(f.task, f.input)).toThrowError(
      expect.objectContaining({ code: 'TASK_LEASE_LOST' }),
    )
  })

  it.each(['id', 'tenantId', 'projectId', 'userId', 'clientRequestId', 'model'] as const)(
    'binds the refund to %s',
    (field) => {
      const f = fixture()
      f.task[field] = 'changed'
      expect(() => assertTextTaskRefundGuard(f.task, f.input)).toThrow()
    },
  )

  it.each([
    'wrong-task',
    'outside-plan',
    'another-request',
    'wrong-operation',
    'retry-zero',
    'retry-too-large',
  ] as const)('rejects a %s reservation reference', (mode) => {
    const f = fixture()
    const references = {
      'wrong-task': 'script-generate-other-task-episode-0',
      'outside-plan': `script-generate-${f.task.id}-episode-1`,
      'another-request': 'script-generate-other-request',
      'wrong-operation': `script-enrich-${f.task.clientRequestId}`,
      'retry-zero': `${f.reference}:retry:0`,
      'retry-too-large': `${f.reference}:retry:100`,
    }
    f.input.originalEntryId = `generation-${references[mode]}`
    f.input.refundEntryId = `refund-${references[mode]}`
    expect(() => assertTextTaskRefundGuard(f.task, f.input)).toThrow()
  })

  it('allows bounded recoverable references and direct script references', () => {
    const f = fixture()
    for (const reference of [
      `${f.reference}:retry:1`,
      `${f.reference}:retry:99`,
      'script-generate-request-1',
    ]) {
      expect(() =>
        assertTextTaskRefundGuard(f.task, {
          ...f.input,
          originalEntryId: `generation-${reference}`,
          refundEntryId: `refund-${reference}`,
        }),
      ).not.toThrow()
    }
  })
})

describe('atomic JSON reservation refunds', () => {
  it.each(['cancelled', 'takeover', 'cancelled-successor', 'disabled'] as const)(
    'settles a late episode failure after %s without changing successor credit',
    async (mode) => {
      const f = fixture()
      const store = new AppStore(null)
      await store.initialize()
      const ledger = new StoreCreditLedger(store, new UserRepository(store))
      const caller = { ...principal, roles: ['member'] as ['member'] }
      const before = (await ledger.summary(caller)).credits
      await store.mutate((state) => {
        state.tasks = [structuredClone(f.task)]
      })
      const providerError = new Error('provider result arrived after cancellation')
      await expect(
        runBillableScriptOperation(
          ledger,
          caller,
          f.reference,
          3,
          '分集生成',
          async () => {
            if (mode === 'takeover' || mode === 'cancelled-successor')
              claimGenerationTaskLease(f.task, 'worker-b', 60_000, new Date(), { countAttempt: false })
            if (mode !== 'takeover') f.cancel()
            if (mode === 'disabled') f.task.metadata.creditsRefundDisabledAt = new Date().toISOString()
            await store.mutate((state) => {
              state.tasks = [structuredClone(f.task)]
            })
            throw providerError
          },
          'direct',
          true,
          undefined,
          f.guard,
        ),
      ).rejects.toBe(providerError)
      expect((await ledger.summary(caller)).credits).toBe(before - (mode === 'cancelled' ? 0 : 3))
      const refunds = store.read((state) =>
        state.ledger.filter((entry) => entry.id === `refund-${f.reference}`),
      )
      expect(refunds).toHaveLength(mode === 'cancelled' ? 1 : 0)
    },
  )
})
