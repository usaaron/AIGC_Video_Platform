import type {
  BillingSummary,
  BillingScope,
  BillingWebhookEvent,
  GenerationTask,
  LedgerEntry,
  OrganizationBillingSummary,
  OrganizationBillingPool,
  Plan,
  Principal,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { isPlatformAdmin, isTenantManager } from '../../core/auth/roles.js'
import { AppError } from '../../core/errors.js'
import { observabilityMetrics } from '../../core/observability/metrics.js'
import { traceMetadata } from '../../core/observability/trace.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppState, AppStore } from '../../infra/store.js'
import type { SessionMetadata } from '../auth/accounts.js'
import type { UserRepository } from '../users/repository.js'
import { BillingLedgerRepository, type BillingWebhookProcessResult } from './repository.js'

const monthlyGrantCredits = 500

export interface CreditLedger {
  reserveCredits(
    principal: Principal,
    credits: number,
    referenceId: string,
    description?: string,
    metadata?: SessionMetadata,
  ): Promise<boolean>
  reserve(
    principal: Principal,
    credits: number,
    referenceId: string,
    description?: string,
    metadata?: SessionMetadata,
  ): Promise<boolean>
  reserveCreditsInState(
    state: AppState,
    principal: Principal,
    credits: number,
    referenceId: string,
    description?: string,
  ): Promise<boolean>
  reserveInState(
    state: AppState,
    principal: Principal,
    credits: number,
    referenceId: string,
    description?: string,
  ): Promise<boolean>
  refundCredits(
    principal: Principal,
    referenceId: string,
    description: string,
    metadata?: SessionMetadata,
  ): Promise<void>
  refundReservation(
    principal: Principal,
    referenceId: string,
    description: string,
    metadata?: SessionMetadata,
  ): Promise<void>
  refundCreditsInState(
    state: AppState,
    principal: Principal,
    referenceId: string,
    description: string,
  ): Promise<void>
  refundReservationInState(
    state: AppState,
    principal: Principal,
    referenceId: string,
    description: string,
  ): Promise<void>
  refundGeneration(task: GenerationTask, description?: string): Promise<void>
  refundGenerationInState(state: AppState, task: GenerationTask, description?: string): Promise<void>
  grantCredits(
    principal: Principal,
    amount: number,
    reason: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary>
  grantCreditsInState(
    state: AppState,
    principal: Principal,
    amount: number,
    reason: string,
  ): Promise<BillingSummary>
  adjustCredits(
    principal: Principal,
    targetMembershipId: string,
    amount: number,
    reason: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary>
  adjustCreditsInState(
    state: AppState,
    principal: Principal,
    targetMembershipId: string,
    amount: number,
    reason: string,
  ): Promise<BillingSummary>
  adjustOrganizationCredits(
    principal: Principal,
    tenantId: string,
    amount: number,
    reason: string,
    metadata?: SessionMetadata,
  ): Promise<OrganizationBillingSummary>
  adjustBalance(
    principal: Principal,
    amount: number,
    referenceId: string,
    description: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary>
  adjustBalanceInState(
    state: AppState,
    principal: Principal,
    amount: number,
    referenceId: string,
    description: string,
  ): Promise<BillingSummary>
  billingSummary(principal: Principal): Promise<BillingSummary>
  summary(principal: Principal): Promise<BillingSummary>
  organizationBillingSummary(principal: Principal, tenantId: string): Promise<OrganizationBillingSummary>
  consumedCreditsSince(startIso: string, tenantId?: string): Promise<number>
  updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary>
  updatePlanInState(state: AppState, principal: Principal, plan: Plan): Promise<BillingSummary>
  updateMembershipPlan(
    principal: Principal,
    targetMembershipId: string,
    plan: Plan,
    grantMonthlyCredits?: boolean,
    reason?: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary>
  processBillingWebhook(provider: string, payload: BillingWebhookEvent): Promise<BillingWebhookProcessResult>
}

export class StoreCreditLedger implements CreditLedger {
  private readonly ledgerRepository: BillingLedgerRepository | null

  constructor(
    private readonly store: AppStore | null,
    private readonly users: UserRepository,
    private readonly planSelfServiceEnabled = false,
    database: AccountDatabase | null = null,
  ) {
    this.ledgerRepository = database ? new BillingLedgerRepository(database) : null
  }

  async bootstrapFromStore(): Promise<void> {
    if (!this.ledgerRepository) return
    if (!this.store) return
    if (await this.ledgerRepository.hasImportedJsonEntries()) return
    await this.ledgerRepository.bootstrapFromStore(this.store.read((state) => state.ledger))
  }

  async reserveCredits(
    principal: Principal,
    credits: number,
    referenceId: string,
    description = 'Generation task',
    metadata?: SessionMetadata,
  ): Promise<boolean> {
    return this.reserve(principal, credits, referenceId, description, metadata)
  }

  async reserve(
    principal: Principal,
    credits: number,
    referenceId: string,
    description = 'Generation task',
    metadata?: SessionMetadata,
  ): Promise<boolean> {
    if (this.ledgerRepository) {
      return this.reserveInState(unusedJsonState(), principal, credits, referenceId, description, metadata)
    }
    return this.requireStore().transaction((state) =>
      this.reserveInState(state, principal, credits, referenceId, description, metadata),
    )
  }

  async reserveCreditsInState(
    state: AppState,
    principal: Principal,
    credits: number,
    referenceId: string,
    description = 'Generation task',
  ): Promise<boolean> {
    return this.reserveInState(state, principal, credits, referenceId, description)
  }

  async reserveInState(
    state: AppState,
    principal: Principal,
    credits: number,
    referenceId: string,
    description = 'Generation task',
    metadata?: SessionMetadata,
  ): Promise<boolean> {
    const entryId = `generation-${referenceId}`
    if (!this.ledgerRepository && state.ledger.some((entry) => entry.id === entryId)) return false

    if (this.ledgerRepository) {
      const recorded = await this.ledgerRepository.recordEntry({
        tenantId: principal.tenantId,
        userId: principal.userId,
        entryId,
        referenceId,
        entryType: 'generation',
        amount: -credits,
        description,
        createdByUserId: principal.userId,
        audit: billingAudit('billing.credits.reserved', principal.userId, metadata, {
          referenceId,
          description,
          credits,
        }),
      })
      if (!recorded) return false
      return true
    }

    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
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

  async refundReservation(
    principal: Principal,
    referenceId: string,
    description: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    if (this.ledgerRepository) {
      await this.refundReservationInState(unusedJsonState(), principal, referenceId, description, metadata)
      return
    }
    await this.requireStore().transaction((state) =>
      this.refundReservationInState(state, principal, referenceId, description, metadata),
    )
  }

  async refundCredits(
    principal: Principal,
    referenceId: string,
    description: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    await this.refundReservation(principal, referenceId, description, metadata)
  }

  async refundCreditsInState(
    state: AppState,
    principal: Principal,
    referenceId: string,
    description: string,
  ): Promise<void> {
    await this.refundReservationInState(state, principal, referenceId, description)
  }

  async refundReservationInState(
    state: AppState,
    principal: Principal,
    referenceId: string,
    description: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
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
        createdByUserId: principal.userId,
        audit: billingAudit('billing.credits.refunded', principal.userId, metadata, {
          referenceId,
          originalEntryId: debit.id,
          refundEntryId: refundId,
          description,
        }),
      })
      if (!recorded) return
      observabilityMetrics.recordRefund({ tenantId: principal.tenantId, amount: Math.abs(debit.amount) })
      return
    }

    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
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
    observabilityMetrics.recordRefund({ tenantId: principal.tenantId, amount })
  }

  async refundGeneration(task: GenerationTask, description = `${task.label} deleted refund`): Promise<void> {
    if (this.ledgerRepository) {
      await this.refundGenerationInState(unusedJsonState(), task, description)
      return
    }
    await this.requireStore().transaction((state) => this.refundGenerationInState(state, task, description))
  }

  async refundGenerationInState(
    state: AppState,
    task: GenerationTask,
    description = `${task.label} deleted refund`,
  ): Promise<void> {
    const refundId = `refund-${task.id}`
    const debitId = `generation-${task.clientRequestId}`
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
        createdByUserId: task.userId,
        createdAt: now,
        audit: {
          action: 'billing.credits.refunded',
          actorUserId: task.userId,
          ipAddress: null,
          userAgent: null,
          metadata: {
            taskId: task.id,
            taskLabel: task.label,
            referenceId: task.clientRequestId,
            originalEntryId: debit.id,
            refundEntryId: refundId,
            description,
            ...(typeof task.metadata?.traceId === 'string' ? { traceId: task.metadata.traceId } : {}),
          },
        },
      })
      if (!recorded) return
      markTaskRefunded(state, task.id, now)
      observabilityMetrics.recordRefund({ tenantId: task.tenantId, amount })
      return
    }

    const user = findUserById(state, task.userId, task.tenantId)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
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
    observabilityMetrics.recordRefund({ tenantId: task.tenantId, amount })
  }

  async grantCredits(
    principal: Principal,
    amount: number,
    reason: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary> {
    if (this.ledgerRepository) {
      return this.grantCreditsInState(unusedJsonState(), principal, amount, reason, metadata)
    }
    return this.requireStore().transaction((state) =>
      this.grantCreditsInState(state, principal, amount, reason, metadata),
    )
  }

  async grantCreditsInState(
    state: AppState,
    principal: Principal,
    amount: number,
    reason: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary> {
    if (amount <= 0) throw new AppError(400, 'INVALID_CREDIT_AMOUNT', 'Credit amount must be positive')
    const entryId = `grant-${cryptoRandomId()}`

    if (this.ledgerRepository) {
      await this.ledgerRepository.recordGrant({
        tenantId: principal.tenantId,
        userId: principal.userId,
        grantEntryId: entryId,
        amount,
        description: reason,
        createdByUserId: principal.userId,
        audit: billingAudit('billing.credits.granted', principal.userId, metadata, {
          referenceId: entryId,
          amount,
          reason,
        }),
      })
      return this.billingSummary(principal)
    }

    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
    user.credits += amount
    mirrorLedgerEntry(state, {
      id: entryId,
      userId: user.id,
      tenantId: user.tenantId,
      amount,
      balance: user.credits,
      type: 'grant',
      description: reason,
      createdAt: new Date().toISOString(),
    })
    return buildSummaryFromEntries(
      ledgerEntriesForPrincipal(state, principal),
      user.plan,
      user.credits,
      this.planSelfServiceEnabled,
    )
  }

  async adjustCredits(
    principal: Principal,
    targetMembershipId: string,
    amount: number,
    reason: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary> {
    if (this.ledgerRepository) {
      return this.adjustCreditsInState(
        unusedJsonState(),
        principal,
        targetMembershipId,
        amount,
        reason,
        metadata,
      )
    }
    return this.requireStore().transaction((state) =>
      this.adjustCreditsInState(state, principal, targetMembershipId, amount, reason, metadata),
    )
  }

  async adjustCreditsInState(
    state: AppState,
    principal: Principal,
    targetMembershipId: string,
    amount: number,
    reason: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary> {
    if (!isBillingAdmin(principal)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only administrators can adjust credits')
    }
    const entryId = `adjustment-${cryptoRandomId()}`

    if (this.ledgerRepository) {
      const recorded = await this.ledgerRepository.recordAdjustmentForMembership({
        membershipId: targetMembershipId,
        principal,
        ...(principal.roles.includes('organization_admin') ? { scopeTenantId: principal.tenantId } : {}),
        entryId,
        referenceId: entryId,
        entryType: 'adjustment',
        amount,
        description: reason,
        createdByUserId: principal.userId,
        audit: billingAudit('billing.credits.adjusted', principal.userId, metadata, {
          targetMembershipId,
          referenceId: entryId,
          amount,
          reason,
        }),
      })
      if (!recorded) {
        throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      }
      return this.billingSummary({
        userId: recorded.userId,
        tenantId: recorded.tenantId,
        roles: principal.roles,
      })
    }

    const targetUser = state.users.find(
      (item) => `membership-${item.tenantId}-${item.id}` === targetMembershipId,
    )
    if (!targetUser) {
      throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
    }
    if (!isPlatformAdmin(principal) && targetUser.tenantId !== principal.tenantId) {
      throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot adjust billing for another workspace')
    }
    const nextCredits = targetUser.credits + amount
    if (nextCredits < 0) throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
    targetUser.credits = nextCredits
    mirrorLedgerEntry(state, {
      id: entryId,
      userId: targetUser.id,
      tenantId: targetUser.tenantId,
      amount,
      balance: targetUser.credits,
      type: 'adjustment',
      description: reason,
      createdAt: new Date().toISOString(),
    })
    return buildSummaryFromEntries(
      ledgerEntriesForPrincipal(state, {
        userId: targetUser.id,
        tenantId: targetUser.tenantId,
        roles: principal.roles,
      }),
      targetUser.plan,
      targetUser.credits,
      this.planSelfServiceEnabled,
    )
  }

  async adjustOrganizationCredits(
    principal: Principal,
    tenantId: string,
    amount: number,
    reason: string,
    metadata?: SessionMetadata,
  ): Promise<OrganizationBillingSummary> {
    if (!isBillingAdmin(principal)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only administrators can adjust credits')
    }
    if (!this.ledgerRepository) {
      throw new AppError(503, 'ACCOUNT_DATABASE_REQUIRED', 'Postgres account database is required')
    }
    const entryId = `organization-adjustment-${cryptoRandomId()}`
    await this.ledgerRepository.recordAdjustmentForOrganization({
      tenantId,
      principal,
      entryId,
      referenceId: entryId,
      amount,
      description: reason,
      audit: billingAudit('billing.organization_credits.adjusted', principal.userId, metadata, {
        tenantId,
        referenceId: entryId,
        amount,
        reason,
      }),
    })
    return this.ledgerRepository.organizationBillingSummary(principal, tenantId)
  }

  async adjustBalance(
    principal: Principal,
    amount: number,
    referenceId: string,
    description: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary> {
    if (this.ledgerRepository) {
      return this.adjustBalanceInState(
        unusedJsonState(),
        principal,
        amount,
        referenceId,
        description,
        metadata,
      )
    }
    return this.requireStore().transaction((state) =>
      this.adjustBalanceInState(state, principal, amount, referenceId, description, metadata),
    )
  }

  async adjustBalanceInState(
    state: AppState,
    principal: Principal,
    amount: number,
    referenceId: string,
    description: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary> {
    const entryId = `adjustment-${referenceId}`

    if (this.ledgerRepository) {
      await this.ledgerRepository.recordAdjustment({
        tenantId: principal.tenantId,
        userId: principal.userId,
        adjustmentEntryId: entryId,
        referenceId,
        amount,
        description,
        createdByUserId: principal.userId,
        audit: billingAudit('billing.credits.adjusted', principal.userId, metadata, {
          referenceId,
          amount,
          description,
        }),
      })
      return this.billingSummary(principal)
    }

    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
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

  async billingSummary(principal: Principal): Promise<BillingSummary> {
    if (this.ledgerRepository) {
      const summary = await this.ledgerRepository.billingSummaryForPrincipal(principal)
      const summaryOptions: {
        billingScope?: BillingScope
        organizationPool?: OrganizationBillingPool
      } = { billingScope: summary.billingScope }
      if (summary.organizationPool) summaryOptions.organizationPool = summary.organizationPool
      return buildSummaryFromEntries(
        summary.entries,
        summary.plan,
        summary.credits,
        this.planSelfServiceEnabled,
        summaryOptions,
      )
    }

    const account = await this.users.findBillingAccount(principal.userId, principal.tenantId)
    if (!account) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')

    return this.requireStore().read((state) =>
      buildSummaryFromEntries(
        ledgerEntriesForPrincipal(state, principal),
        account.plan,
        account.credits,
        this.planSelfServiceEnabled,
      ),
    )
  }

  async summary(principal: Principal): Promise<BillingSummary> {
    return this.billingSummary(principal)
  }

  async organizationBillingSummary(
    principal: Principal,
    tenantId: string,
  ): Promise<OrganizationBillingSummary> {
    if (!this.ledgerRepository) {
      throw new AppError(503, 'ACCOUNT_DATABASE_REQUIRED', 'Postgres account database is required')
    }
    return this.ledgerRepository.organizationBillingSummary(principal, tenantId)
  }

  async consumedCreditsSince(startIso: string, tenantId?: string): Promise<number> {
    if (this.ledgerRepository) {
      return this.ledgerRepository.countConsumedCreditsSince(startIso, tenantId)
    }
    const startTime = new Date(startIso).getTime()
    return this.requireStore().read((state) =>
      state.ledger
        .filter(
          (entry) =>
            entry.type === 'generation' &&
            entry.amount < 0 &&
            (!tenantId || entry.tenantId === tenantId) &&
            new Date(entry.createdAt).getTime() >= startTime,
        )
        .reduce((total, entry) => total + Math.abs(entry.amount), 0),
    )
  }

  async updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary> {
    if (!this.planSelfServiceEnabled) {
      throw new AppError(403, 'PLAN_CHANGE_REQUIRES_ADMIN', 'Plan changes require an administrator')
    }
    if (this.ledgerRepository) {
      return this.updatePlanInState(unusedJsonState(), principal, plan)
    }
    return this.requireStore().transaction((state) => this.updatePlanInState(state, principal, plan))
  }

  async updatePlanInState(state: AppState, principal: Principal, plan: Plan): Promise<BillingSummary> {
    if (this.ledgerRepository) {
      const updated = await this.ledgerRepository.updatePlan({
        tenantId: principal.tenantId,
        userId: principal.userId,
        plan,
        description: 'Member monthly grant',
        createdByUserId: principal.userId,
      })
      if (!updated) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      return this.billingSummary(principal)
    }

    const user = findUser(state, principal)
    if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
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

  async updateMembershipPlan(
    principal: Principal,
    targetMembershipId: string,
    plan: Plan,
    grantMonthlyCredits = true,
    reason?: string,
    metadata?: SessionMetadata,
  ): Promise<BillingSummary> {
    if (!isBillingAdmin(principal)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only administrators can update billing plans')
    }
    if (this.ledgerRepository) {
      const updated = await this.ledgerRepository.updatePlanForMembership({
        membershipId: targetMembershipId,
        principal,
        plan,
        grantMonthlyCredits,
        description: reason ?? 'Member monthly grant',
        createdByUserId: principal.userId,
        audit: billingAudit('billing.plan.updated', principal.userId, metadata, {
          targetMembershipId,
          plan,
          grantMonthlyCredits,
          reason: reason ?? null,
        }),
      })
      return this.billingSummary({
        userId: updated.userId,
        tenantId: updated.tenantId,
        roles: [],
      })
    }

    return this.requireStore().transaction((state) => {
      const targetUser = state.users.find(
        (item) => `membership-${item.tenantId}-${item.id}` === targetMembershipId,
      )
      if (!targetUser) {
        throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      }
      if (!isPlatformAdmin(principal) && targetUser.tenantId !== principal.tenantId) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot update billing for another workspace')
      }
      targetUser.plan = plan
      const grantId = monthlyGrantId(targetUser.id)
      if (plan === 'member' && grantMonthlyCredits && !state.ledger.some((entry) => entry.id === grantId)) {
        targetUser.credits += monthlyGrantCredits
        mirrorLedgerEntry(state, {
          id: grantId,
          userId: targetUser.id,
          tenantId: targetUser.tenantId,
          amount: monthlyGrantCredits,
          balance: targetUser.credits,
          type: 'grant',
          description: reason ?? 'Member monthly grant',
          createdAt: new Date().toISOString(),
        })
      }
      return buildSummaryFromEntries(
        ledgerEntriesForPrincipal(state, {
          userId: targetUser.id,
          tenantId: targetUser.tenantId,
          roles: [],
        }),
        targetUser.plan,
        targetUser.credits,
        this.planSelfServiceEnabled,
      )
    })
  }

  async processBillingWebhook(
    provider: string,
    payload: BillingWebhookEvent,
  ): Promise<BillingWebhookProcessResult> {
    if (!this.ledgerRepository) {
      throw new AppError(503, 'ACCOUNT_DATABASE_REQUIRED', 'Postgres account database is required')
    }
    const result = await this.ledgerRepository.processWebhookEvent({ provider, payload })
    return result
  }

  private requireStore(): AppStore {
    if (!this.store) {
      throw new Error('JSON AppStore is unavailable; StoreCreditLedger must use Postgres in runtime')
    }
    return this.store
  }
}

function unusedJsonState(): AppState {
  return {
    users: [],
    projects: [],
    assets: [],
    shots: [],
    tasks: [],
    aiJobs: [],
    ledger: [],
    media: [],
    novelDocuments: [],
    novelChapters: [],
    novelChapterSummaries: [],
    novelSummaryQueues: [],
    novelSummaryQueueItems: [],
    novelBoundaries: [],
    novelStoryBibles: [],
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

function isBillingAdmin(principal: Principal): boolean {
  return isTenantManager(principal)
}

function billingAudit(
  action: string,
  actorUserId: string | null,
  metadata: SessionMetadata | undefined,
  value: Record<string, unknown>,
) {
  return {
    action,
    actorUserId,
    ipAddress: metadata?.ipAddress ?? null,
    userAgent: metadata?.userAgent ?? null,
    metadata: traceMetadata(value, metadata?.traceId ?? null),
  }
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
  options: {
    billingScope?: BillingScope
    organizationPool?: OrganizationBillingPool
  } = {},
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
    billingScope: options.billingScope ?? 'membership',
    ...(options.organizationPool ? { organizationPool: options.organizationPool } : {}),
    concurrency: plan === 'member' ? 3 : 1,
    unlimitedConcurrency: false,
    planSelfServiceEnabled,
    monthlyUsage: {
      periodStart,
      consumedCredits,
      refundedCredits,
      netCredits: Math.max(0, consumedCredits - refundedCredits),
      generationCount: generationEntries.length,
      includedCredits:
        options.billingScope === 'organization' ? 0 : plan === 'member' ? monthlyGrantCredits : 0,
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

function cryptoRandomId(): string {
  return randomUUID()
}

function startOfChinaMonth(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs,
  ).toISOString()
}
