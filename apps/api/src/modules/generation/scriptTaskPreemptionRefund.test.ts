import { createGenerationTaskSchema } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { captureTextTaskWriteGuard, type TextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import { claimGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { textTaskCancellationMatches } from '../../core/jobs/textTaskCancellation.js'
import { AppStore } from '../../infra/store.js'
import { StoreCreditLedger } from '../billing/creditLedger.js'
import { UserRepository } from '../users/repository.js'
import { GenerationTaskRepository } from './repository.js'

const principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] as ['member'] }

describe('automatic script preemption refunds', () => {
  it.each(['original', 'takeover', 'disabled'] as const)(
    'binds the cancelled %s execution before releasing its lease',
    async (mode) => {
      const store = new AppStore(null)
      await store.initialize()
      const tasks = new GenerationTaskRepository(store)
      const ledger = new StoreCreditLedger(store, new UserRepository(store))
      const input = createGenerationTaskSchema.parse({
        projectId: 'project-midnight-film',
        clientRequestId: 'preempt-original',
        kind: 'text',
        provider: 'text',
        model: 'seqora-5.6',
        label: '分集生成',
        estimatedCredits: 1,
        metadata: {
          generationStage: 'script-generate',
          scriptOperation: 'generate',
          billingMode: 'direct',
          episodePlan: { episodes: [{ title: '第一集', source: '故事' }] },
        },
      })
      input.estimatedCredits = 0
      const first = await tasks.createWithCharge(input, principal)
      let originalGuard!: TextTaskWriteGuard
      let latestGuard!: TextTaskWriteGuard
      await store.mutate((state) => {
        const task = state.tasks.find((item) => item.id === first.id)!
        claimGenerationTaskLease(task, 'worker-a', 60_000)
        originalGuard = captureTextTaskWriteGuard(task)
        if (mode === 'takeover')
          claimGenerationTaskLease(task, 'worker-b', 60_000, new Date(), { countAttempt: false })
        if (mode === 'disabled') task.metadata.creditsRefundDisabledAt = new Date().toISOString()
        latestGuard = captureTextTaskWriteGuard(task)
      })
      const reference = `script-generate-${first.id}-episode-0`
      const before = (await ledger.summary(principal)).credits
      await ledger.reserve(principal, 3, reference, '本集预约')
      await tasks.createWithCharge({ ...input, clientRequestId: 'preempt-replacement' }, principal)
      const cancelled = store.read((state) => state.tasks.find((item) => item.id === first.id)!)
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        leaseToken: null,
        metadata: { cancelReason: 'new_script_task' },
      })
      expect(textTaskCancellationMatches(cancelled, latestGuard)).toBe(true)
      expect(JSON.stringify(cancelled.metadata)).not.toContain(originalGuard.leaseToken)
      if (mode === 'original')
        await ledger.refundReservation(principal, reference, '取消退款', undefined, originalGuard)
      else
        await expect(
          ledger.refundReservation(principal, reference, '取消退款', undefined, originalGuard),
        ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
      expect((await ledger.summary(principal)).credits).toBe(before - (mode === 'original' ? 0 : 3))
    },
  )
})
