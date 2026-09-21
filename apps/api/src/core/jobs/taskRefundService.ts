import type { GenerationTask } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../../modules/billing/creditLedger.js'
import { observabilityMetrics } from '../observability/metrics.js'

export class TaskRefundService {
  constructor(
    private readonly store: AppStore,
    private readonly creditLedger: CreditLedger | null = null,
  ) {}

  async refundTerminalTasks(taskIds?: readonly string[]): Promise<string[]> {
    const selected = taskIds ? new Set(taskIds) : null
    const candidates = this.store.read((state) =>
      state.tasks.filter((task) => (!selected || selected.has(task.id)) && canPotentiallyRefundTask(task)),
    )
    if (!candidates.length) return []
    if (this.creditLedger) {
      const handledTaskIds: string[] = []
      for (const task of candidates) {
        try {
          // The ledger transaction owns debit lookup and idempotent refunds. A failed
          // account must not block unrelated users' refunds or provider polling.
          await this.creditLedger.refundGeneration(task, refundDescription(task))
          handledTaskIds.push(task.id)
        } catch {
          process.emitWarning(`Generation refund will be retried for task ${task.id}`, {
            code: 'SEQORA_GENERATION_REFUND_RETRY',
          })
        }
      }
      if (!handledTaskIds.length) return []
      await this.store.mutateGenerationTaskRuntimeCacheAsync((state) => {
        const handled = new Set(handledTaskIds)
        for (const task of state.tasks) {
          if (handled.has(task.id)) markRefundHandled(task)
        }
      })
      return handledTaskIds
    }

    return this.store.mutate((state) => {
      const handled: string[] = []
      for (const task of state.tasks) {
        if (selected && !selected.has(task.id)) continue
        if (!canPotentiallyRefundTask(task)) continue
        const debit = state.ledger.find(
          (entry) =>
            entry.id === `generation-${task.clientRequestId}` &&
            entry.userId === task.userId &&
            entry.tenantId === task.tenantId,
        )
        if (!debit) continue
        const refundId = `refund-${task.id}`
        if (!state.ledger.some((entry) => entry.id === refundId)) {
          const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
          if (!user) continue
          const amount = Math.abs(debit.amount)
          user.credits += amount
          state.ledger.unshift({
            id: refundId,
            userId: user.id,
            tenantId: user.tenantId,
            amount,
            balance: user.credits,
            type: 'adjustment',
            description: refundDescription(task),
            createdAt: new Date().toISOString(),
          })
          observabilityMetrics.recordRefund({ tenantId: task.tenantId, amount })
        }
        markRefundHandled(task)
        handled.push(task.id)
      }
      return handled
    })
  }
}

function markRefundHandled(task: GenerationTask): void {
  const now = new Date(Math.max(Date.now(), (Date.parse(task.updatedAt) || 0) + 1)).toISOString()
  task.metadata = {
    ...task.metadata,
    creditsRefundedAt:
      typeof task.metadata.creditsRefundedAt === 'string' ? task.metadata.creditsRefundedAt : now,
  }
  task.updatedAt = now
}

function canPotentiallyRefundTask(task: GenerationTask): boolean {
  if (task.estimatedCredits <= 0 || typeof task.metadata.creditsRefundedAt === 'string') return false
  if (task.status === 'failed') return true
  if (task.status === 'paused') return typeof task.metadata.queueHiddenAt === 'string'
  if (task.status !== 'cancelled') return false
  if (!task.metadata.providerTaskId || typeof task.metadata.providerCancelRequestedAt !== 'string')
    return true
  return (
    typeof task.metadata.providerCancelCompletedAt === 'string' ||
    typeof task.metadata.providerCancelSkippedAt === 'string'
  )
}

function refundDescription(task: GenerationTask): string {
  if (task.status === 'failed') return `${task.label} · 失败退款`
  if (task.status === 'cancelled') return `${task.label} · 取消退款`
  return `${task.label} · 已删除退款`
}
