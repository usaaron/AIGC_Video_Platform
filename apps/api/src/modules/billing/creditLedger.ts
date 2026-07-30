import type { BillingSummary, GenerationTask, LedgerEntry, Plan, Principal } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppState, AppStore } from '../../infra/store.js'
import type { UserRepository } from '../users/repository.js'
import { BillingLedgerRepository } from './repository.js'

const monthlyGrantCredits = 500

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
  adjustBalance(
    principal: Principal,
    amount: number,
    referenceId: string,
    description: string,
  ): Promise<BillingSummary>
  adjustBalanceInState(
    state: AppState,
    principal: Principal,
    amount: number,
    referenceId: string,
    description: string,
  ): Promise<BillingSummary>
  summary(principal: Principal): Promise<BillingSummary>
  updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary>
  updatePlanInState(state: AppState, principal: Principal, plan: Plan): Promise<BillingSummary>
}

export class StoreCreditLedger implements CreditLedger {
  private readonly ledgerRepository: BillingLedgerRepository | null

  constructor(
    private readonly store: AppStore,
    private readonly users: UserRepository,
    private readonly planSelfServiceEnabled = false,
    database: AccountDatabase | null = null,
  ) {
    this.ledgerRepository = database ? new BillingLedgerRepository(database) : null
  }

  async bootstrapFromStore(): Promise<void> {
    if (!this.ledgerRepository) return
    await this.ledgerRepository.bootstrapFromStore(this.store.read((state) => state.ledger))
  }

  async reserve(
    principal: Principal,
    credits: number,
    referenceId: string,
    description = 'Generation task',
  ): Promise<boolean> {
    return this.store.transaction((state) =>
      this.reserveInState(state, principal, credits, referenceId, description),
    )
  }

  async reserveInState(
    state: AppState,
    principal: Principal,
    credits: number,
    referenceId: string,
    description = 'Generation task',
  ): Promise<boolean> {
    const entryId = `generation-${referenceId}`
    if (state.ledger.some((entry) => entry.id === entryId)) return false
    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')

    if (this.ledgerRepository) {
      const recorded = await this.ledgerRepository.recordEntry({
        tenantId: principal.tenantId,
        userId: principal.userId,
        entryId,
        referenceId,
        entryType: 'generation',
        amount: -credits,
        description,
      })
      if (!recorded) return false
      user.credits = recorded.balance
      mirrorLedgerEntry(state, recorded.entry)
      return true
    }

    if (user.credits < credits) throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
    user.credits -= credits
    mirrorLedgerEntry(state, {
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
    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
    const debitId = `generation-${referenceId}`
    const refundId = `refund-${referenceId}`

    if (this.ledgerRepository) {
      const debit = await this.ledgerRepository.findEntryById(debitId, principal.userId, principal.tenantId)
      if (!debit) return
      if (await this.ledgerRepository.hasEntryId(refundId, principal.userId, principal.tenantId)) return

      const recorded = await this.ledgerRepository.recordRefund({
        tenantId: principal.tenantId,
        userId: principal.userId,
        originalEntryId: debit.id,
        refundEntryId: refundId,
        amount: Math.abs(debit.amount),
        description,
      })
      if (!recorded) return
      user.credits = recorded.balance
      mirrorLedgerEntry(state, recorded.entry)
      return
    }

    const debit = state.ledger.find(
      (entry) =>
        entry.id === debitId && entry.userId === principal.userId && entry.tenantId === principal.tenantId,
    )
    if (!debit || state.ledger.some((entry) => entry.id === refundId)) return

    const amount = Math.abs(debit.amount)
    user.credits += amount
    mirrorLedgerEntry(state, {
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

  async refundGeneration(task: GenerationTask, description = `${task.label} deleted refund`): Promise<void> {
    await this.store.transaction((state) => this.refundGenerationInState(state, task, description))
  }

  async refundGenerationInState(
    state: AppState,
    task: GenerationTask,
    description = `${task.label} deleted refund`,
  ): Promise<void> {
    const refundId = `refund-${task.id}`
    const debitId = `generation-${task.clientRequestId}`
    const user = findUserById(state, task.userId, task.tenantId)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
    const now = new Date().toISOString()

    if (this.ledgerRepository) {
      const debit = await this.ledgerRepository.findEntryById(debitId, task.userId, task.tenantId)
      if (!debit) return
      if (await this.ledgerRepository.hasEntryId(refundId, task.userId, task.tenantId)) return

      const amount = Math.abs(debit.amount)
      if (amount <= 0) return
      const recorded = await this.ledgerRepository.recordRefund({
        tenantId: task.tenantId,
        userId: task.userId,
        originalEntryId: debit.id,
        refundEntryId: refundId,
        amount,
        description,
        createdAt: now,
      })
      if (!recorded) return
      user.credits = recorded.balance
      mirrorLedgerEntry(state, recorded.entry)
      markTaskRefunded(state, task.id, now)
      return
    }

    const debit = state.ledger.find(
      (entry) => entry.id === debitId && entry.userId === task.userId && entry.tenantId === task.tenantId,
    )
    if (!debit || state.ledger.some((entry) => entry.id === refundId)) return

    const amount = Math.abs(debit.amount)
    if (amount <= 0) return
    user.credits += amount
    mirrorLedgerEntry(state, {
      id: refundId,
      userId: user.id,
      tenantId: user.tenantId,
      amount,
      balance: user.credits,
      type: 'adjustment',
      description,
      createdAt: now,
    })
    markTaskRefunded(state, task.id, now)
  }

  async adjustBalance(
    principal: Principal,
    amount: number,
    referenceId: string,
    description: string,
  ): Promise<BillingSummary> {
    return this.store.transaction((state) =>
      this.adjustBalanceInState(state, principal, amount, referenceId, description),
    )
  }

  async adjustBalanceInState(
    state: AppState,
    principal: Principal,
    amount: number,
    referenceId: string,
    description: string,
  ): Promise<BillingSummary> {
    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
    const entryId = `adjustment-${referenceId}`

    if (this.ledgerRepository) {
      const recorded = await this.ledgerRepository.recordAdjustment({
        tenantId: principal.tenantId,
        userId: principal.userId,
        adjustmentEntryId: entryId,
        referenceId,
        amount,
        description,
        createdByUserId: principal.userId,
      })
      if (recorded) {
        user.credits = recorded.balance
        mirrorLedgerEntry(state, recorded.entry)
      }
      const entries = await this.ledgerRepository.listEntries(principal.userId, principal.tenantId)
      return buildSummaryFromEntries(entries, user.plan, user.credits, this.planSelfServiceEnabled)
    }

    if (state.ledger.some((entry) => entry.id === entryId)) {
      return buildSummaryFromEntries(
        ledgerEntriesForPrincipal(state, principal),
        user.plan,
        user.credits,
        this.planSelfServiceEnabled,
      )
    }

    const nextCredits = user.credits + amount
    if (nextCredits < 0) throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
    user.credits = nextCredits
    mirrorLedgerEntry(state, {
      id: entryId,
      userId: user.id,
      tenantId: user.tenantId,
      amount,
      balance: user.credits,
      type: 'adjustment',
      description,
      createdAt: new Date().toISOString(),
    })
    return buildSummaryFromEntries(
      ledgerEntriesForPrincipal(state, principal),
      user.plan,
      user.credits,
      this.planSelfServiceEnabled,
    )
  }

  async summary(principal: Principal): Promise<BillingSummary> {
    const account = await this.users.findBillingAccount(principal.userId, principal.tenantId)
    if (!account) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')

    if (this.ledgerRepository) {
      const entries = await this.ledgerRepository.listEntries(principal.userId, principal.tenantId)
      return buildSummaryFromEntries(entries, account.plan, account.credits, this.planSelfServiceEnabled)
    }

    return this.store.read((state) =>
      buildSummaryFromEntries(
        ledgerEntriesForPrincipal(state, principal),
        account.plan,
        account.credits,
        this.planSelfServiceEnabled,
      ),
    )
  }

  async updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary> {
    if (!this.planSelfServiceEnabled) {
      throw new AppError(403, 'PLAN_CHANGE_REQUIRES_ADMIN', 'Plan changes require an administrator')
    }
    return this.store.transaction((state) => this.updatePlanInState(state, principal, plan))
  }

  async updatePlanInState(state: AppState, principal: Principal, plan: Plan): Promise<BillingSummary> {
    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')

    if (this.ledgerRepository) {
      const updated = await this.ledgerRepository.updatePlan({
        tenantId: principal.tenantId,
        userId: principal.userId,
        plan,
        description: 'Member monthly grant',
        createdByUserId: principal.userId,
      })
      if (!updated) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      user.plan = updated.plan
      user.credits = updated.credits
      if (updated.grantEntry) mirrorLedgerEntry(state, updated.grantEntry)
      const entries = await this.ledgerRepository.listEntries(principal.userId, principal.tenantId)
      return buildSummaryFromEntries(entries, user.plan, user.credits, this.planSelfServiceEnabled)
    }

    if (user.plan === plan) {
      return buildSummaryFromEntries(
        ledgerEntriesForPrincipal(state, principal),
        user.plan,
        user.credits,
        this.planSelfServiceEnabled,
      )
    }

    user.plan = plan
    const grantId = monthlyGrantId(user.id)
    if (plan === 'member' && !state.ledger.some((entry) => entry.id === grantId)) {
      user.credits += monthlyGrantCredits
      mirrorLedgerEntry(state, {
        id: grantId,
        userId: user.id,
        tenantId: user.tenantId,
        amount: monthlyGrantCredits,
        balance: user.credits,
        type: 'grant',
        description: 'Member monthly grant',
        createdAt: new Date().toISOString(),
      })
    }

    return buildSummaryFromEntries(
      ledgerEntriesForPrincipal(state, principal),
      user.plan,
      user.credits,
      this.planSelfServiceEnabled,
    )
  }
}

function findUser(state: AppState, principal: Principal): AppState['users'][number] | null {
  return (
    state.users.find((item) => item.id === principal.userId && item.tenantId === principal.tenantId) ?? null
  )
}

function findUserById(state: AppState, userId: string, tenantId: string): AppState['users'][number] | null {
  return state.users.find((item) => item.id === userId && item.tenantId === tenantId) ?? null
}

function ledgerEntriesForPrincipal(state: AppState, principal: Principal): LedgerEntry[] {
  return state.ledger.filter(
    (entry) => entry.userId === principal.userId && entry.tenantId === principal.tenantId,
  )
}

function mirrorLedgerEntry(state: AppState, entry: LedgerEntry): void {
  const existingIndex = state.ledger.findIndex((item) => item.id === entry.id)
  if (existingIndex >= 0) state.ledger.splice(existingIndex, 1)
  state.ledger.unshift(entry)
}

function markTaskRefunded(state: AppState, taskId: string, refundedAt: string): void {
  const storedTask = state.tasks.find((item) => item.id === taskId)
  if (storedTask) storedTask.metadata = { ...storedTask.metadata, creditsRefundedAt: refundedAt }
}

function buildSummaryFromEntries(
  entries: readonly LedgerEntry[],
  plan: Plan,
  credits: number,
  planSelfServiceEnabled: boolean,
): BillingSummary {
  const periodStart = startOfChinaMonth()
  const orderedEntries = orderLedgerEntries(entries)
  const monthlyEntries = orderedEntries.filter((entry) => entry.createdAt >= periodStart)
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
      includedCredits: plan === 'member' ? monthlyGrantCredits : 0,
    },
    entries: orderedEntries.slice(0, 30),
  }
}

function orderLedgerEntries(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((left, right) => {
    const createdAtOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    if (createdAtOrder !== 0) return createdAtOrder
    return right.id.localeCompare(left.id)
  })
}

function monthlyGrantId(userId: string): string {
  return `membership-${userId}-${startOfChinaMonth().slice(0, 10)}`
}

function startOfChinaMonth(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs,
  ).toISOString()
}
