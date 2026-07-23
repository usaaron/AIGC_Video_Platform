import type { BillingSummary, GenerationTask, Plan, Principal } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { AppStore } from '../../infra/store.js'

export interface CreditLedger {
  reserve(principal: Principal, credits: number, referenceId: string, description?: string): Promise<boolean>
  refundReservation(principal: Principal, referenceId: string, description: string): Promise<void>
  refundGeneration(task: GenerationTask, description?: string): Promise<void>
  summary(principal: Principal): BillingSummary
  updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary>
}

export class StoreCreditLedger implements CreditLedger {
  constructor(
    private readonly store: AppStore,
    private readonly planSelfServiceEnabled = false,
  ) {}

  async reserve(
    principal: Principal,
    credits: number,
    referenceId: string,
    description = '生成任务',
  ): Promise<boolean> {
    return this.store.mutate((state) => {
      const existing = state.ledger.some((entry) => entry.id === `generation-${referenceId}`)
      if (existing) return false
      const user = state.users.find((item) => item.id === principal.userId)
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')
      if (user.credits < credits) throw new AppError(402, 'INSUFFICIENT_CREDITS', '积分不足')
      user.credits -= credits
      state.ledger.unshift({
        id: `generation-${referenceId}`,
        userId: user.id,
        tenantId: user.tenantId,
        amount: -credits,
        balance: user.credits,
        type: 'generation',
        description,
        createdAt: new Date().toISOString(),
      })
      return true
    })
  }

  async refundReservation(principal: Principal, referenceId: string, description: string): Promise<void> {
    await this.store.mutate((state) => {
      const debit = state.ledger.find(
        (entry) =>
          entry.id === `generation-${referenceId}` &&
          entry.userId === principal.userId &&
          entry.tenantId === principal.tenantId,
      )
      const refundId = `refund-${referenceId}`
      if (!debit || state.ledger.some((entry) => entry.id === refundId)) return
      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')
      const amount = Math.abs(debit.amount)
      user.credits += amount
      state.ledger.unshift({
        id: refundId,
        userId: user.id,
        tenantId: user.tenantId,
        amount,
        balance: user.credits,
        type: 'adjustment',
        description,
        createdAt: new Date().toISOString(),
      })
    })
  }

  async refundGeneration(task: GenerationTask, description = `${task.label} · 已删除退款`): Promise<void> {
    await this.store.mutate((state) => {
      const refundId = `refund-${task.id}`
      const hasDebit = state.ledger.some((entry) => entry.id === `generation-${task.clientRequestId}`)
      if (!hasDebit || state.ledger.some((entry) => entry.id === refundId) || task.estimatedCredits <= 0)
        return
      const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')
      const now = new Date().toISOString()
      user.credits += task.estimatedCredits
      state.ledger.unshift({
        id: refundId,
        userId: user.id,
        tenantId: user.tenantId,
        amount: task.estimatedCredits,
        balance: user.credits,
        type: 'adjustment',
        description,
        createdAt: now,
      })
      const storedTask = state.tasks.find((item) => item.id === task.id)
      if (storedTask) storedTask.metadata = { ...storedTask.metadata, creditsRefundedAt: now }
    })
  }

  summary(principal: Principal): BillingSummary {
    return this.store.read((state) => {
      const user = state.users.find((item) => item.id === principal.userId)
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')
      const periodStart = startOfChinaMonth()
      const monthlyEntries = state.ledger.filter(
        (entry) => entry.userId === user.id && entry.createdAt >= periodStart,
      )
      const generationEntries = monthlyEntries.filter(
        (entry) => entry.type === 'generation' && entry.amount < 0,
      )
      const consumedCredits = generationEntries.reduce((total, entry) => total - entry.amount, 0)
      const refundedCredits = monthlyEntries
        .filter((entry) => entry.type === 'adjustment' && entry.amount > 0 && entry.id.startsWith('refund-'))
        .reduce((total, entry) => total + entry.amount, 0)
      return {
        plan: user.plan,
        credits: user.credits,
        concurrency: user.plan === 'member' ? 3 : 1,
        planSelfServiceEnabled: this.planSelfServiceEnabled,
        monthlyUsage: {
          periodStart,
          consumedCredits,
          refundedCredits,
          netCredits: Math.max(0, consumedCredits - refundedCredits),
          generationCount: generationEntries.length,
          includedCredits: user.plan === 'member' ? 500 : 0,
        },
        entries: state.ledger.filter((entry) => entry.userId === user.id).slice(0, 30),
      }
    })
  }

  async updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary> {
    if (!this.planSelfServiceEnabled) {
      throw new AppError(403, 'PLAN_CHANGE_REQUIRES_ADMIN', '套餐变更需要由管理员处理')
    }
    await this.store.mutate((state) => {
      const user = state.users.find((item) => item.id === principal.userId)
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')
      if (user.plan === plan) return
      user.plan = plan
      const monthlyGrantId = `membership-${user.id}-${startOfChinaMonth().slice(0, 10)}`
      if (plan === 'member' && !state.ledger.some((entry) => entry.id === monthlyGrantId)) {
        user.credits += 500
        state.ledger.unshift({
          id: monthlyGrantId,
          userId: user.id,
          tenantId: user.tenantId,
          amount: 500,
          balance: user.credits,
          type: 'grant',
          description: '会员月度积分',
          createdAt: new Date().toISOString(),
        })
      }
    })
    return this.summary(principal)
  }
}

function startOfChinaMonth(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs,
  ).toISOString()
}
