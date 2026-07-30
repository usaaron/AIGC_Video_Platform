import type { BillingSummary, GenerationTask, Plan, Principal } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { AppState, AppStore } from '../../infra/store.js'
import type { UserRepository } from '../users/repository.js'

export interface CreditLedger {
  reserve(principal: Principal, credits: number, referenceId: string, description?: string): Promise<boolean>
  reserveInState(
    state: AppState,
    principal: Principal,
    credits: number,
    referenceId: string,
    description?: string,
  ): Promise<boolean>
  refundReservation(principal: Principal, referenceId: string, description: string): Promise<void>
  refundReservationInState(
    state: AppState,
    principal: Principal,
    referenceId: string,
    description: string,
  ): Promise<void>
  refundGeneration(task: GenerationTask, description?: string): Promise<void>
  refundGenerationInState(state: AppState, task: GenerationTask, description?: string): Promise<void>
  summary(principal: Principal): Promise<BillingSummary>
  updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary>
  updatePlanInState(state: AppState, principal: Principal, plan: Plan): Promise<BillingSummary>
}

export class StoreCreditLedger implements CreditLedger {
  constructor(
    private readonly store: AppStore,
    private readonly users: UserRepository,
    private readonly planSelfServiceEnabled = false,
  ) {}

  async reserve(
    principal: Principal,
    credits: number,
    referenceId: string,
    description = '生成任务',
  ): Promise<boolean> {
    return this.store.transaction((state) => this.reserveInState(state, principal, credits, referenceId, description))
  }

  async reserveInState(
    state: AppState,
    principal: Principal,
    credits: number,
    referenceId: string,
    description = '生成任务',
  ): Promise<boolean> {
    const entryId = `generation-${referenceId}`
    if (state.ledger.some((entry) => entry.id === entryId)) return false
    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账户不存在')
    if (user.credits < credits) throw new AppError(402, 'INSUFFICIENT_CREDITS', '积分不足')

    if (this.users.hasDatabase) {
      const updated = await this.users.adjustBillingCredits(principal.userId, principal.tenantId, -credits)
      if (!updated) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账户不存在')
      user.credits = updated.credits
    } else {
      user.credits -= credits
    }

    state.ledger.unshift({
      id: entryId,
      userId: user.id,
      tenantId: user.tenantId,
      amount: -credits,
      balance: user.credits,
      type: 'generation',
      description,
      createdAt: new Date().toISOString(),
    })
    return true
  }

  async refundReservation(principal: Principal, referenceId: string, description: string): Promise<void> {
    await this.store.transaction((state) =>
      this.refundReservationInState(state, principal, referenceId, description),
    )
  }

  async refundReservationInState(
    state: AppState,
    principal: Principal,
    referenceId: string,
    description: string,
  ): Promise<void> {
    const debit = state.ledger.find(
      (entry) =>
        entry.id === `generation-${referenceId}` &&
        entry.userId === principal.userId &&
        entry.tenantId === principal.tenantId,
    )
    const refundId = `refund-${referenceId}`
    if (!debit || state.ledger.some((entry) => entry.id === refundId)) return
    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账户不存在')
    const amount = Math.abs(debit.amount)

    if (this.users.hasDatabase) {
      const updated = await this.users.adjustBillingCredits(principal.userId, principal.tenantId, amount)
      if (!updated) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账户不存在')
      user.credits = updated.credits
    } else {
      user.credits += amount
    }

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
  }

  async refundGeneration(task: GenerationTask, description = `${task.label} · 已删除退款`): Promise<void> {
    await this.store.transaction((state) => this.refundGenerationInState(state, task, description))
  }

  async refundGenerationInState(
    state: AppState,
    task: GenerationTask,
    description = `${task.label} · 已删除退款`,
  ): Promise<void> {
    const refundId = `refund-${task.id}`
    const hasDebit = state.ledger.some((entry) => entry.id === `generation-${task.clientRequestId}`)
    if (!hasDebit || state.ledger.some((entry) => entry.id === refundId) || task.estimatedCredits <= 0) return
    const user = findUserById(state, task.userId, task.tenantId)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账户不存在')
    const now = new Date().toISOString()

    if (this.users.hasDatabase) {
      const updated = await this.users.adjustBillingCredits(task.userId, task.tenantId, task.estimatedCredits)
      if (!updated) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账户不存在')
      user.credits = updated.credits
    } else {
      user.credits += task.estimatedCredits
    }

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
  }

  async summary(principal: Principal): Promise<BillingSummary> {
    const account = await this.users.findBillingAccount(principal.userId, principal.tenantId)
    if (!account) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账户不存在')
    return this.store.read((state) =>
      buildSummary(state, principal, account.plan, account.credits, this.planSelfServiceEnabled),
    )
  }

  async updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary> {
    if (!this.planSelfServiceEnabled) {
      throw new AppError(403, 'PLAN_CHANGE_REQUIRES_ADMIN', '套餐变更需要管理员处理')
    }
    return this.store.transaction((state) => this.updatePlanInState(state, principal, plan))
  }

  async updatePlanInState(
    state: AppState,
    principal: Principal,
    plan: Plan,
  ): Promise<BillingSummary> {
    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账户不存在')
    if (user.plan === plan) {
      return buildSummary(state, principal, user.plan, user.credits, this.planSelfServiceEnabled)
    }

    if (this.users.hasDatabase) {
      const updated = await this.users.setBillingPlan(principal.userId, principal.tenantId, plan)
      if (!updated) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账户不存在')
      user.plan = updated.plan
      user.credits = updated.credits
    } else {
      user.plan = plan
    }

    const monthlyGrantId = `membership-${user.id}-${startOfChinaMonth().slice(0, 10)}`
    if (plan === 'member' && !state.ledger.some((entry) => entry.id === monthlyGrantId)) {
      if (this.users.hasDatabase) {
        const updated = await this.users.adjustBillingCredits(principal.userId, principal.tenantId, 500)
        if (!updated) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账户不存在')
        user.credits = updated.credits
      } else {
        user.credits += 500
      }
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

    return buildSummary(state, principal, user.plan, user.credits, this.planSelfServiceEnabled)
  }
}

function findUser(state: AppState, principal: Principal): AppState['users'][number] | null {
  return state.users.find((item) => item.id === principal.userId && item.tenantId === principal.tenantId) ?? null
}

function findUserById(
  state: AppState,
  userId: string,
  tenantId: string,
): AppState['users'][number] | null {
  return state.users.find((item) => item.id === userId && item.tenantId === tenantId) ?? null
}

function buildSummary(
  state: AppState,
  principal: Principal,
  plan: Plan,
  credits: number,
  planSelfServiceEnabled: boolean,
): BillingSummary {
  const periodStart = startOfChinaMonth()
  const entries = state.ledger.filter(
    (entry) => entry.userId === principal.userId && entry.tenantId === principal.tenantId,
  )
  const monthlyEntries = entries.filter((entry) => entry.createdAt >= periodStart)
  const generationEntries = monthlyEntries.filter((entry) => entry.type === 'generation' && entry.amount < 0)
  const consumedCredits = generationEntries.reduce((total, entry) => total - entry.amount, 0)
  const refundedCredits = monthlyEntries
    .filter((entry) => entry.type === 'adjustment' && entry.amount > 0 && entry.id.startsWith('refund-'))
    .reduce((total, entry) => total + entry.amount, 0)
  return {
    plan,
    credits,
    concurrency: plan === 'member' ? 3 : 1,
    planSelfServiceEnabled,
    monthlyUsage: {
      periodStart,
      consumedCredits,
      refundedCredits,
      netCredits: Math.max(0, consumedCredits - refundedCredits),
      generationCount: generationEntries.length,
      includedCredits: plan === 'member' ? 500 : 0,
    },
    entries: entries.slice(0, 30),
  }
}

function startOfChinaMonth(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs).toISOString()
}
