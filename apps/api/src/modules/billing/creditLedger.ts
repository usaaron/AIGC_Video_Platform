import type { BillingSummary, Plan, Principal, SubscriptionSummary, UsageSummary } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../core/errors.js'
import type { AppState, StateStore } from '../../infra/store.js'
import {
  BILLING_PACKAGES,
  concurrencyForPlan,
  creditsForPlan,
  defaultSubscriptionForTenant,
  packageForPlan,
} from './catalog.js'

export interface CreditLedger {
  reserve(principal: Principal, credits: number, referenceId: string, description?: string): Promise<void>
  summary(principal: Principal): Promise<BillingSummary>
  updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary>
}

export class StoreCreditLedger implements CreditLedger {
  constructor(private readonly store: StateStore) {}

  async reserve(
    principal: Principal,
    credits: number,
    referenceId: string,
    description = 'Generation task',
  ): Promise<void> {
    await this.store.mutate((state) => {
      const existing = state.ledger.some((entry) => entry.id === `generation-${referenceId}`)
      if (existing) return
      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account not found')
      if (user.credits < credits) throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
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

  async summary(principal: Principal): Promise<BillingSummary> {
    return this.store.read((state) => {
      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account not found')

      const subscription = subscriptionForTenant(state, principal.tenantId, user.plan)
      const entries = state.ledger.filter((entry) => entry.userId === user.id).slice(0, 30)
      return {
        plan: user.plan,
        credits: user.credits,
        concurrency: concurrencyForPlan(user.plan),
        entries,
        subscription,
        packages: BILLING_PACKAGES,
        checkoutSessions: state.checkoutSessions
          .filter((session) => session.tenantId === principal.tenantId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
        usage: usageSummaryForState(state, principal.tenantId),
      }
    })
  }

  async updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary> {
    await this.store.mutate((state) => {
      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account not found')

      const now = new Date().toISOString()
      const packageInfo = packageForPlan(plan)
      const planChanged = user.plan !== plan
      user.plan = plan

      if (planChanged) {
        const grant = creditsForPlan(plan)
        if (grant > 0) {
          user.credits += grant
          state.ledger.unshift({
            id: randomUUID(),
            userId: user.id,
            tenantId: user.tenantId,
            amount: grant,
            balance: user.credits,
            type: 'grant',
            description: 'Subscription credits',
            createdAt: now,
          })
        }
      }

      const subscription = state.subscriptions.find((item) => item.tenantId === principal.tenantId)
      const nextSubscription: SubscriptionSummary = {
        ...(subscription ?? defaultSubscriptionForTenant(principal.tenantId, now)),
        tenantId: principal.tenantId,
        provider: subscription?.provider ?? 'mock',
        packageId: plan,
        status: subscription?.status ?? 'active',
        billingCycle: subscription?.billingCycle ?? 'monthly',
        seatLimit: packageInfo.seats,
        activeSeats: Math.max(1, state.users.filter((item) => item.tenantId === principal.tenantId).length),
        watermarkRequired: packageInfo.watermarkRequired,
        commercialLicenseEnabled: packageInfo.commercialLicenseIncluded,
        startsAt: subscription?.startsAt ?? now,
        renewsAt: subscription?.renewsAt ?? null,
        updatedAt: now,
      }

      if (subscription) {
        Object.assign(subscription, nextSubscription)
      } else {
        state.subscriptions.push(nextSubscription)
      }
    })
    return this.summary(principal)
  }
}

function subscriptionForTenant(state: Readonly<AppState>, tenantId: string, plan: Plan): SubscriptionSummary {
  const stored = state.subscriptions.find((item) => item.tenantId === tenantId)
  if (!stored) return defaultSubscriptionForTenant(tenantId)
  const packageInfo = packageForPlan(stored.packageId || plan)
  return {
    ...stored,
    seatLimit: packageInfo.seats,
    watermarkRequired: packageInfo.watermarkRequired,
    commercialLicenseEnabled: packageInfo.commercialLicenseIncluded,
  }
}

function usageSummaryForState(state: Readonly<AppState>, tenantId: string): UsageSummary {
  const tenantTasks = state.tasks.filter((task) => task.tenantId === tenantId)
  const tenantLedger = state.ledger.filter((entry) => entry.tenantId === tenantId)
  const tenantShares = state.projectShares.filter(
    (share) => share.tenantId === tenantId && share.status === 'active',
  )
  const pendingComments = state.projectComments.filter(
    (comment) => comment.tenantId === tenantId && comment.status === 'pending',
  )

  return {
    generatedAt: new Date().toISOString(),
    periodDays: 30,
    creditsSpent: Math.abs(
      tenantLedger.filter((entry) => entry.amount < 0).reduce((total, entry) => total + entry.amount, 0),
    ),
    tasksCreated: tenantTasks.length,
    imageTasks: tenantTasks.filter((task) => task.kind === 'image').length,
    videoTasks: tenantTasks.filter((task) => task.kind === 'video').length,
    audioTasks: tenantTasks.filter((task) => task.kind === 'audio').length,
    activeShares: tenantShares.length,
    pendingComments: pendingComments.length,
    activeMembers: state.users.filter((user) => user.tenantId === tenantId).length,
    watermarkTasks: tenantTasks.filter((task) => Boolean(task.metadata?.watermark)).length,
  }
}
