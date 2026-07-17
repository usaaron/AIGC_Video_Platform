import type { BillingSummary, Plan, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../core/errors.js'
import type { AppStore } from '../../infra/store.js'

export interface CreditLedger {
  reserve(principal: Principal, credits: number, referenceId: string, description?: string): Promise<void>
  summary(principal: Principal): BillingSummary
  updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary>
}

export class StoreCreditLedger implements CreditLedger {
  constructor(private readonly store: AppStore) {}

  async reserve(
    principal: Principal,
    credits: number,
    referenceId: string,
    description = '生成任务',
  ): Promise<void> {
    await this.store.mutate((state) => {
      const existing = state.ledger.some((entry) => entry.id === `generation-${referenceId}`)
      if (existing) return
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
    })
  }

  summary(principal: Principal): BillingSummary {
    return this.store.read((state) => {
      const user = state.users.find((item) => item.id === principal.userId)
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')
      return {
        plan: user.plan,
        credits: user.credits,
        concurrency: user.plan === 'member' ? 3 : 1,
        entries: state.ledger.filter((entry) => entry.userId === user.id).slice(0, 30),
      }
    })
  }

  async updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary> {
    await this.store.mutate((state) => {
      const user = state.users.find((item) => item.id === principal.userId)
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')
      if (user.plan === plan) return
      user.plan = plan
      if (plan === 'member') {
        user.credits += 500
        state.ledger.unshift({
          id: randomUUID(),
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
