import {
  ROLES,
  type BillingScope,
  type BillingWebhookEvent,
  type LedgerEntry,
  type OrganizationBillingSummary,
  type OrganizationLedgerEntry,
  type OrganizationType,
  type Plan,
  type Principal,
  type Role,
} from '@seqora/contracts'
import type { QueryResultRow } from 'pg'
import { insertAuditLog } from '../../core/audit/auditLog.js'
import { AppError } from '../../core/errors.js'
import type { AccountDatabase } from '../../infra/postgres.js'

const monthlyGrantCredits = 500
const emptyMetadata = '{}'

export type BillingLedgerRecordInput = {
  tenantId: string
  userId: string
  entryId: string
  referenceId: string
  entryType: LedgerEntry['type']
  amount: number
  description: string
  relatedEntryId?: string | null
  createdByUserId?: string | null
  createdAt?: string | undefined
  metadata?: BillingLedgerMetadata | undefined
  audit?: BillingLedgerAuditInput | undefined
}

export type BillingLedgerMetadata = Record<string, unknown>

export type BillingLedgerAuditInput = {
  action: string
  actorUserId: string | null
  ipAddress: string | null
  userAgent: string | null
  metadata?: Record<string, unknown>
}

export type BillingLedgerMembershipRecordInput = {
  membershipId: string
  principal: Pick<Principal, 'tenantId' | 'roles'>
  scopeTenantId?: string
  entryId: string
  referenceId: string
  entryType: LedgerEntry['type']
  amount: number
  description: string
  relatedEntryId?: string | null
  createdByUserId?: string | null
  createdAt?: string | undefined
  metadata?: BillingLedgerMetadata | undefined
  audit?: BillingLedgerAuditInput | undefined
}

export type BillingLedgerRecordResult = {
  entry: LedgerEntry
  balance: number
}

export type BillingLedgerMembershipRecordResult = BillingLedgerRecordResult & {
  membershipId: string
  userId: string
  tenantId: string
}

export type BillingPrincipalSummaryResult = {
  plan: Plan
  credits: number
  entries: LedgerEntry[]
  billingScope: BillingScope
  organizationPool?: {
    tenantId: string
    organizationId: string
    credits: number
  }
}

export type OrganizationBillingRecordResult = {
  entry: OrganizationLedgerEntry
  balance: number
  tenantId: string
}

export type BillingPlanResult = {
  plan: Plan
  credits: number
  grantEntry: LedgerEntry | null
}

export type BillingMembershipPlanResult = BillingPlanResult & {
  membershipId: string
  userId: string
  tenantId: string
}

export type BillingWebhookProcessInput = {
  provider: string
  payload: BillingWebhookEvent
}

export type BillingWebhookProcessResult = {
  provider: string
  eventId: string
  eventType: BillingWebhookEvent['type']
  duplicate: boolean
  status: 'processed'
  tenantId: string | null
  userId: string | null
  membershipId: string | null
  plan: Plan | null
  credits: number | null
  ledgerEntry: LedgerEntry | null
}

export class BillingLedgerRepository {
  constructor(private readonly database: AccountDatabase) {}

  async bootstrapFromStore(entries: LedgerEntry[]): Promise<void> {
    if (!entries.length) return
    await this.database.transaction(async (client) => {
      for (const entry of entries) {
        const membership = await resolveMembership(client, entry.userId, entry.tenantId)
        if (!membership) continue
        const referenceId = bootstrapReferenceId(entry.id)
        await client.query(
          `
          INSERT INTO billing_ledger_entries (
            id,
            tenant_id,
            user_id,
            membership_id,
            reference_id,
            related_entry_id,
            entry_type,
            amount,
            balance,
            description,
            created_by_user_id,
            created_at,
            updated_at,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $11, $12)
          ON CONFLICT (tenant_id, user_id, reference_id) DO NOTHING
          `,
          [
            entry.id,
            entry.tenantId,
            entry.userId,
            membership.id,
            referenceId,
            null,
            entry.type,
            entry.amount,
            entry.balance,
            entry.description,
            entry.createdAt,
            JSON.stringify({ importedFromJson: true }),
          ],
        )
      }
    })
  }

  async listEntries(userId: string, tenantId: string): Promise<LedgerEntry[]> {
    const result = await this.database.query<LedgerEntryRow>(
      `
      SELECT
        id,
        user_id,
        tenant_id,
        entry_type,
        amount,
        balance,
        description,
        created_at
      FROM billing_ledger_entries
      WHERE user_id = $1
        AND tenant_id = $2
      ORDER BY created_at DESC, id DESC
      `,
      [userId, tenantId],
    )
    return result.rows.map(toLedgerEntry)
  }

  async hasEntryId(entryId: string, userId: string, tenantId: string): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      `
      SELECT id FROM (
        SELECT id
        FROM billing_ledger_entries
        WHERE id = $1
          AND user_id = $2
          AND tenant_id = $3
        UNION ALL
        SELECT id
        FROM organization_billing_ledger_entries
        WHERE id = $1
          AND tenant_id = $3
          AND (user_id = $2 OR membership_id IN (
            SELECT id
            FROM tenant_memberships
            WHERE user_id = $2
              AND tenant_id = $3
          ))
      ) entries
      LIMIT 1
      `,
      [entryId, userId, tenantId],
    )
    return Boolean(result.rows[0])
  }

  async findEntryById(entryId: string, userId: string, tenantId: string): Promise<LedgerEntry | null> {
    const result = await this.database.query<LedgerEntryRow>(
      `
      SELECT id, user_id, tenant_id, entry_type, amount, balance, description, created_at
      FROM (
        SELECT
          0 AS source_order,
          id,
          user_id,
          tenant_id,
          entry_type,
          amount,
          balance,
          description,
          created_at
        FROM billing_ledger_entries
        WHERE id = $1
          AND user_id = $2
          AND tenant_id = $3
        UNION ALL
        SELECT
          1 AS source_order,
          id,
          COALESCE(user_id, $2) AS user_id,
          tenant_id,
          entry_type,
          amount,
          balance,
          description,
          created_at
        FROM organization_billing_ledger_entries
        WHERE id = $1
          AND tenant_id = $3
          AND (user_id = $2 OR membership_id IN (
            SELECT id
            FROM tenant_memberships
            WHERE user_id = $2
              AND tenant_id = $3
          ))
      ) entries
      ORDER BY source_order
      LIMIT 1
      `,
      [entryId, userId, tenantId],
    )
    return result.rows[0] ? toLedgerEntry(result.rows[0]) : null
  }

  async findEntryByReference(
    referenceId: string,
    userId: string,
    tenantId: string,
  ): Promise<LedgerEntry | null> {
    const result = await this.database.query<LedgerEntryRow>(
      `
      SELECT
        id,
        user_id,
        tenant_id,
        entry_type,
        amount,
        balance,
        description,
        created_at
      FROM billing_ledger_entries
      WHERE reference_id = $1
        AND user_id = $2
        AND tenant_id = $3
      LIMIT 1
      `,
      [referenceId, userId, tenantId],
    )
    return result.rows[0] ? toLedgerEntry(result.rows[0]) : null
  }

  async recordEntry(input: BillingLedgerRecordInput): Promise<BillingLedgerRecordResult | null> {
    return this.database.transaction(async (client) => {
      const target = await resolveBillingTargetByPrincipal(client, input.userId, input.tenantId)
      if (!target) {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
      }
      if (target.scope === 'organization') {
        const recorded = await insertOrganizationLedgerEntryIfAbsent(client, {
          organization: target.organization,
          userId: input.userId,
          membershipId: target.account.membershipId,
          entryId: input.entryId,
          referenceId: input.referenceId,
          relatedEntryId: input.relatedEntryId ?? null,
          entryType: input.entryType,
          amount: input.amount,
          description: input.description,
          createdByUserId: input.createdByUserId ?? null,
          createdAt: input.createdAt,
          metadata: input.metadata,
          audit: input.audit,
        })
        return recorded ? { entry: organizationEntryToLedgerEntry(recorded.entry), balance: recorded.balance } : null
      }

      const duplicate = await client.query<{ id: string }>(
        `
        SELECT id
        FROM billing_ledger_entries
        WHERE tenant_id = $1
          AND user_id = $2
          AND reference_id = $3
        LIMIT 1
        `,
        [input.tenantId, input.userId, input.referenceId],
      )
      if (duplicate.rows[0]) return null

      const nextCredits = target.account.credits + input.amount
      if (nextCredits < 0) {
        throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
      }

      await client.query(
        `
        UPDATE billing_accounts
        SET credits = $2,
            updated_at = now()
        WHERE membership_id = $1
        `,
        [target.account.membershipId, nextCredits],
      )

      const createdAt = input.createdAt ?? new Date().toISOString()
      const inserted = await client.query<LedgerEntryRow>(
        `
        INSERT INTO billing_ledger_entries (
          id,
          tenant_id,
          user_id,
          membership_id,
          reference_id,
          related_entry_id,
          entry_type,
          amount,
          balance,
          description,
          created_by_user_id,
          created_at,
          updated_at,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13)
        RETURNING id, user_id, tenant_id, entry_type, amount, balance, description, created_at
        `,
        [
          input.entryId,
          input.tenantId,
          input.userId,
          target.account.membershipId,
          input.referenceId,
          input.relatedEntryId ?? null,
          input.entryType,
          input.amount,
          nextCredits,
          input.description,
          input.createdByUserId ?? null,
          createdAt,
          JSON.stringify(input.metadata ?? {}),
        ],
      )
      const entry = toLedgerEntry(inserted.rows[0]!)
      if (input.audit) {
        await insertAuditLog(client, {
          tenantId: input.tenantId,
          userId: input.userId,
          actorUserId: input.audit.actorUserId,
          action: input.audit.action,
          resourceType: 'billing_account',
          resourceId: target.account.membershipId,
          ipAddress: input.audit.ipAddress,
          userAgent: input.audit.userAgent,
          metadata: {
            ...input.audit.metadata,
            membershipId: target.account.membershipId,
            ledgerEntryId: entry.id,
            entryType: entry.type,
            amount: entry.amount,
            balance: entry.balance,
          },
        })
      }
      return {
        entry,
        balance: nextCredits,
      }
    })
  }

  async recordRefund(input: {
    tenantId: string
    userId: string
    originalEntryId: string
    refundEntryId: string
    amount: number
    description: string
    createdByUserId?: string | null
    createdAt?: string
    audit?: BillingLedgerAuditInput
  }): Promise<BillingLedgerRecordResult | null> {
    const organizationRefund = await this.database.transaction(async (client) => {
      const original = await client.query<OrganizationLedgerEntryRow>(
        `
        SELECT
          id,
          user_id,
          tenant_id,
          membership_id,
          reference_id,
          related_entry_id,
          entry_type,
          amount,
          balance,
          description,
          created_by_user_id,
          created_at,
          metadata
        FROM organization_billing_ledger_entries
        WHERE id = $1
          AND tenant_id = $2
          AND (user_id = $3 OR membership_id IN (
            SELECT id
            FROM tenant_memberships
            WHERE user_id = $3
              AND tenant_id = $2
          ))
        LIMIT 1
        FOR UPDATE
        `,
        [input.originalEntryId, input.tenantId, input.userId],
      )
      if (!original.rows[0]) return null
      const organization = await ensureOrganizationBillingAccount(client, input.tenantId, true)
      if (!organization) {
        throw new AppError(404, 'ORGANIZATION_BILLING_ACCOUNT_NOT_FOUND', 'Organization billing account does not exist')
      }
      return await insertOrganizationLedgerEntryIfAbsent(client, {
        organization,
        userId: input.userId,
        membershipId: original.rows[0].membership_id,
        entryId: input.refundEntryId,
        referenceId: input.refundEntryId,
        relatedEntryId: input.originalEntryId,
        entryType: 'adjustment',
        amount: input.amount,
        description: input.description,
        createdByUserId: input.createdByUserId ?? null,
        createdAt: input.createdAt,
        audit: input.audit,
      })
    })
    if (organizationRefund) {
      return {
        entry: organizationEntryToLedgerEntry(organizationRefund.entry),
        balance: organizationRefund.balance,
      }
    }

    return this.database.transaction(async (client) => {
      const original = await client.query<{ id: string; membership_id: string }>(
        `
        SELECT id, membership_id
        FROM billing_ledger_entries
        WHERE id = $1
          AND tenant_id = $2
          AND user_id = $3
        LIMIT 1
        FOR UPDATE
        `,
        [input.originalEntryId, input.tenantId, input.userId],
      )
      const originalEntry = original.rows[0]
      if (!originalEntry) return null

      const account = await resolveAccountByMembershipId(client, originalEntry.membership_id)
      if (!account) return null

      const duplicate = await client.query<{ id: string }>(
        `
        SELECT id
        FROM billing_ledger_entries
        WHERE tenant_id = $1
          AND user_id = $2
          AND reference_id = $3
        LIMIT 1
        `,
        [input.tenantId, input.userId, input.refundEntryId],
      )
      if (duplicate.rows[0]) return null

      const nextCredits = account.credits + input.amount
      if (nextCredits < 0) {
        throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
      }

      await client.query(
        `
        UPDATE billing_accounts
        SET credits = $2,
            updated_at = now()
        WHERE membership_id = $1
        `,
        [account.membershipId, nextCredits],
      )

      const createdAt = input.createdAt ?? new Date().toISOString()
      const inserted = await client.query<LedgerEntryRow>(
        `
        INSERT INTO billing_ledger_entries (
          id,
          tenant_id,
          user_id,
          membership_id,
          reference_id,
          related_entry_id,
          entry_type,
          amount,
          balance,
          description,
          created_by_user_id,
          created_at,
          updated_at,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'adjustment', $7, $8, $9, $10, $11, $11, $12)
        RETURNING id, user_id, tenant_id, entry_type, amount, balance, description, created_at
        `,
        [
          input.refundEntryId,
          input.tenantId,
          input.userId,
          account.membershipId,
          input.refundEntryId,
          input.originalEntryId,
          input.amount,
          nextCredits,
          input.description,
          input.createdByUserId ?? null,
          createdAt,
          emptyMetadata,
        ],
      )
      const entry = toLedgerEntry(inserted.rows[0]!)
      if (input.audit) {
        await insertAuditLog(client, {
          tenantId: account.tenantId,
          userId: account.userId,
          actorUserId: input.audit.actorUserId,
          action: input.audit.action,
          resourceType: 'billing_account',
          resourceId: account.membershipId,
          ipAddress: input.audit.ipAddress,
          userAgent: input.audit.userAgent,
          metadata: {
            ...input.audit.metadata,
            membershipId: account.membershipId,
            ledgerEntryId: entry.id,
            entryType: entry.type,
            amount: entry.amount,
            balance: entry.balance,
          },
        })
      }
      return { entry, balance: nextCredits }
    })
  }

  async recordGrant(input: {
    tenantId: string
    userId: string
    grantEntryId: string
    description: string
    amount?: number
    createdByUserId?: string | null
    createdAt?: string
    metadata?: BillingLedgerMetadata
    audit?: BillingLedgerAuditInput
  }): Promise<BillingLedgerRecordResult | null> {
    return this.recordEntry({
      tenantId: input.tenantId,
      userId: input.userId,
      entryId: input.grantEntryId,
      referenceId: input.grantEntryId,
      entryType: 'grant',
      amount: input.amount ?? monthlyGrantCredits,
      description: input.description,
      createdByUserId: input.createdByUserId ?? null,
      createdAt: input.createdAt,
      metadata: input.metadata,
      audit: input.audit,
    })
  }

  async recordAdjustment(input: {
    tenantId: string
    userId: string
    adjustmentEntryId: string
    referenceId: string
    amount: number
    description: string
    relatedEntryId?: string | null
    createdByUserId?: string | null
    createdAt?: string
    metadata?: BillingLedgerMetadata
    audit?: BillingLedgerAuditInput
  }): Promise<BillingLedgerRecordResult | null> {
    return this.recordEntry({
      tenantId: input.tenantId,
      userId: input.userId,
      entryId: input.adjustmentEntryId,
      referenceId: input.referenceId,
      relatedEntryId: input.relatedEntryId ?? null,
      entryType: 'adjustment',
      amount: input.amount,
      description: input.description,
      createdByUserId: input.createdByUserId ?? null,
      createdAt: input.createdAt,
      metadata: input.metadata,
      audit: input.audit,
    })
  }

  async recordAdjustmentForMembership(
    input: BillingLedgerMembershipRecordInput,
  ): Promise<BillingLedgerMembershipRecordResult | null> {
    return this.database.transaction(async (client) => {
      const account = await resolveAccountByMembershipId(client, input.membershipId)
      if (!account) {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
      }
      if (input.scopeTenantId && account.tenantId !== input.scopeTenantId) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot adjust billing for another workspace')
      }
      if (!canManageBillingAccount(input.principal, account)) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot adjust billing for another workspace')
      }

      const duplicate = await client.query<{ id: string }>(
        `
        SELECT id
        FROM billing_ledger_entries
        WHERE tenant_id = $1
          AND user_id = $2
          AND reference_id = $3
        LIMIT 1
        `,
        [account.tenantId, account.userId, input.referenceId],
      )
      if (duplicate.rows[0]) return null

      const nextCredits = account.credits + input.amount
      if (nextCredits < 0) {
        throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
      }

      await client.query(
        `
        UPDATE billing_accounts
        SET credits = $2,
            updated_at = now()
        WHERE membership_id = $1
        `,
        [account.membershipId, nextCredits],
      )

      const createdAt = input.createdAt ?? new Date().toISOString()
      const inserted = await client.query<LedgerEntryRow>(
        `
        INSERT INTO billing_ledger_entries (
          id,
          tenant_id,
          user_id,
          membership_id,
          reference_id,
          related_entry_id,
          entry_type,
          amount,
          balance,
          description,
          created_by_user_id,
          created_at,
          updated_at,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13)
        RETURNING id, user_id, tenant_id, entry_type, amount, balance, description, created_at
        `,
        [
          input.entryId,
          account.tenantId,
          account.userId,
          account.membershipId,
          input.referenceId,
          input.relatedEntryId ?? null,
          input.entryType,
          input.amount,
          nextCredits,
          input.description,
          input.createdByUserId ?? null,
          createdAt,
          JSON.stringify(input.metadata ?? {}),
        ],
      )
      const entry = toLedgerEntry(inserted.rows[0]!)
      if (input.audit) {
        await insertAuditLog(client, {
          tenantId: account.tenantId,
          userId: account.userId,
          actorUserId: input.audit.actorUserId,
          action: input.audit.action,
          resourceType: 'billing_account',
          resourceId: account.membershipId,
          ipAddress: input.audit.ipAddress,
          userAgent: input.audit.userAgent,
          metadata: {
            ...input.audit.metadata,
            membershipId: account.membershipId,
            ledgerEntryId: entry.id,
            entryType: entry.type,
            amount: entry.amount,
            balance: entry.balance,
          },
        })
      }
      return {
        entry,
        balance: nextCredits,
        membershipId: account.membershipId,
        userId: account.userId,
        tenantId: account.tenantId,
      }
    })
  }

  async billingSummaryForPrincipal(principal: Principal): Promise<BillingPrincipalSummaryResult> {
    return this.database.transaction(async (client) => {
      const target = await resolveBillingTargetByPrincipal(client, principal.userId, principal.tenantId)
      if (!target) {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
      }
      if (target.scope === 'organization') {
        const entries = await listOrganizationLedgerEntries(client, target.organization.tenantId, null)
        return {
          plan: target.account.plan,
          credits: target.organization.credits,
          entries: entries.map(organizationEntryToLedgerEntry),
          billingScope: 'organization',
          organizationPool: {
            tenantId: target.organization.tenantId,
            organizationId: target.organization.tenantId,
            credits: target.organization.credits,
          },
        }
      }

      const entries = await listMembershipLedgerEntries(client, target.account.userId, target.account.tenantId)
      return {
        plan: target.account.plan,
        credits: target.account.credits,
        entries,
        billingScope: 'membership',
      }
    })
  }

  async organizationBillingSummary(
    principal: Principal,
    tenantId: string,
  ): Promise<OrganizationBillingSummary> {
    return this.database.transaction(async (client) => {
      const organization = await ensureOrganizationBillingAccount(client, tenantId, false)
      if (!organization) {
        throw new AppError(404, 'ORGANIZATION_BILLING_ACCOUNT_NOT_FOUND', 'Organization billing account does not exist')
      }
      if (!canReadOrganizationBilling(principal, organization)) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot read another organization billing account')
      }
      const entries = await listOrganizationLedgerEntries(client, tenantId, null)
      return {
        tenantId: organization.tenantId,
        organizationId: organization.tenantId,
        credits: organization.credits,
        monthlyUsage: monthlyUsageFromEntries(entries),
        entries: entries.slice(0, 30),
      }
    })
  }

  async recordAdjustmentForOrganization(input: {
    tenantId: string
    principal: Principal
    entryId: string
    referenceId: string
    amount: number
    description: string
    createdAt?: string
    metadata?: BillingLedgerMetadata
    audit?: BillingLedgerAuditInput
  }): Promise<OrganizationBillingRecordResult | null> {
    return this.database.transaction(async (client) => {
      const organization = await ensureOrganizationBillingAccount(client, input.tenantId, true)
      if (!organization) {
        throw new AppError(404, 'ORGANIZATION_BILLING_ACCOUNT_NOT_FOUND', 'Organization billing account does not exist')
      }
      if (!canManageOrganizationBilling(input.principal, organization)) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot adjust another organization billing account')
      }
      return await insertOrganizationLedgerEntryIfAbsent(client, {
        organization,
        userId: input.principal.userId,
        membershipId: null,
        entryId: input.entryId,
        referenceId: input.referenceId,
        relatedEntryId: null,
        entryType: 'adjustment',
        amount: input.amount,
        description: input.description,
        createdByUserId: input.principal.userId,
        createdAt: input.createdAt,
        metadata: input.metadata,
        audit: input.audit,
      })
    })
  }

  async updatePlanForMembership(input: {
    membershipId: string
    principal: Principal
    plan: Plan
    grantMonthlyCredits?: boolean
    description?: string
    createdByUserId?: string | null
    audit?: BillingLedgerAuditInput
  }): Promise<BillingMembershipPlanResult> {
    return this.database.transaction(async (client) => {
      const account = await resolveAccountByMembershipId(client, input.membershipId)
      if (!account) {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
      }
      if (!canManageBillingAccount(input.principal, account)) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot update billing for another workspace')
      }

      const previousPlan = account.plan
      if (previousPlan !== input.plan) {
        await client.query(
          `
          UPDATE billing_accounts
          SET plan = $2,
              updated_at = now()
          WHERE membership_id = $1
          `,
          [account.membershipId, input.plan],
        )
      }

      let credits = account.credits
      let grantEntry: LedgerEntry | null = null
      if (input.plan === 'member' && input.grantMonthlyCredits !== false) {
        const grantId = monthlyGrantId(account.userId)
        const grant = await insertLedgerEntryIfAbsent(client, {
          account: { ...account, plan: input.plan, credits },
          entryId: grantId,
          referenceId: grantId,
          entryType: 'grant',
          amount: monthlyGrantCredits,
          currentCredits: credits,
          description: input.description ?? 'Member monthly grant',
          createdAt: new Date().toISOString(),
          metadata: { source: 'admin_plan_update' },
        })
        if (grant) {
          credits = grant.balance
          grantEntry = grant.entry
        }
      }

      if (input.audit && previousPlan !== input.plan) {
        await insertAuditLog(client, {
          tenantId: account.tenantId,
          userId: account.userId,
          actorUserId: input.audit.actorUserId,
          action: input.audit.action,
          resourceType: 'billing_account',
          resourceId: account.membershipId,
          ipAddress: input.audit.ipAddress,
          userAgent: input.audit.userAgent,
          metadata: {
            ...input.audit.metadata,
            membershipId: account.membershipId,
            previousPlan,
            plan: input.plan,
            grantEntryId: grantEntry?.id ?? null,
          },
        })
      }

      return {
        plan: input.plan,
        credits,
        grantEntry,
        membershipId: account.membershipId,
        userId: account.userId,
        tenantId: account.tenantId,
      }
    })
  }

  async processWebhookEvent(input: BillingWebhookProcessInput): Promise<BillingWebhookProcessResult> {
    return this.database.transaction(async (client) => {
      const payload = input.payload
      const inserted = await client.query<{ id: string }>(
        `
        INSERT INTO billing_webhook_events (
          id,
          provider,
          provider_event_id,
          event_type,
          status,
          payload,
          metadata
        )
        VALUES ($1, $2, $3, $4, 'processing', $5, $6)
        ON CONFLICT (provider, provider_event_id) DO NOTHING
        RETURNING id
        `,
        [
          webhookEventId(input.provider, payload.eventId),
          input.provider,
          payload.eventId,
          payload.type,
          JSON.stringify(payload),
          JSON.stringify(payload.metadata ?? {}),
        ],
      )

      if (!inserted.rows[0]) {
        const existing = await client.query<BillingWebhookEventRow>(
          `
          SELECT
            provider,
            provider_event_id,
            event_type,
            status,
            tenant_id,
            user_id,
            membership_id,
            plan,
            amount
          FROM billing_webhook_events
          WHERE provider = $1
            AND provider_event_id = $2
          LIMIT 1
          `,
          [input.provider, payload.eventId],
        )
        return webhookResultFromRow(existing.rows[0]!, true)
      }

      const account = payload.membershipId
        ? await resolveAccountByMembershipId(client, payload.membershipId)
        : await resolveAccountByPrincipal(client, payload.userId!, payload.tenantId!)
      if (!account) {
        throw new AppError(404, 'BILLING_ACCOUNT_NOT_FOUND', 'Billing account does not exist')
      }

      const previousPlan = account.plan
      let plan = account.plan
      let credits = account.credits
      let ledgerEntry: LedgerEntry | null = null
      let amount: number | null = null
      const occurredAt = payload.occurredAt ?? new Date().toISOString()
      const metadata = webhookLedgerMetadata(input.provider, payload)

      if (payload.type === 'subscription.activated' || payload.type === 'subscription.renewed') {
        const nextPlan = payload.plan ?? 'member'
        if (plan !== nextPlan) {
          await client.query(
            `
            UPDATE billing_accounts
            SET plan = $2,
                updated_at = now()
            WHERE membership_id = $1
            `,
            [account.membershipId, nextPlan],
          )
          plan = nextPlan
        }
        if (nextPlan === 'member') {
          const grantId = monthlyGrantId(account.userId, occurredAt)
          const monthlyGrant = await insertLedgerEntryIfAbsent(client, {
            account,
            entryId: grantId,
            referenceId: grantId,
            entryType: 'grant',
            amount: monthlyGrantCredits,
            currentCredits: credits,
            description: payload.description ?? 'Member monthly grant',
            createdAt: occurredAt,
            metadata,
          })
          if (monthlyGrant) {
            credits = monthlyGrant.balance
            ledgerEntry = monthlyGrant.entry
            amount = monthlyGrantCredits
          }
        }
      }

      if (payload.type === 'subscription.cancelled' || payload.type === 'subscription.expired') {
        if (plan !== 'free') {
          await client.query(
            `
            UPDATE billing_accounts
            SET plan = 'free',
                updated_at = now()
            WHERE membership_id = $1
            `,
            [account.membershipId],
          )
          plan = 'free'
        }
      }

      if (payload.type === 'credits.purchased') {
        const referenceId = payload.referenceId ?? `payment-${input.provider}-${payload.eventId}`
        const grant = await insertLedgerEntryIfAbsent(client, {
          account,
          entryId: `payment-${input.provider}-${payload.eventId}`,
          referenceId,
          entryType: 'grant',
          amount: payload.credits!,
          currentCredits: credits,
          description: payload.description ?? 'Credit purchase',
          createdAt: occurredAt,
          metadata,
        })
        if (grant) {
          credits = grant.balance
          ledgerEntry = grant.entry
        }
        amount = payload.credits!
      }

      if (payload.type === 'payment.refunded') {
        const referenceId = payload.referenceId
          ? `refund-${payload.referenceId}`
          : `refund-${input.provider}-${payload.eventId}`
        const refund = await insertLedgerEntryIfAbsent(client, {
          account,
          entryId: `refund-${input.provider}-${payload.eventId}`,
          referenceId,
          entryType: 'adjustment',
          amount: -payload.credits!,
          currentCredits: credits,
          description: payload.description ?? 'Payment refund',
          createdAt: occurredAt,
          metadata,
        })
        if (refund) {
          credits = refund.balance
          ledgerEntry = refund.entry
        }
        amount = -payload.credits!
      }

      await client.query(
        `
        UPDATE billing_webhook_events
        SET status = 'processed',
            tenant_id = $2,
            user_id = $3,
            membership_id = $4,
            reference_id = $5,
            plan = $6,
            amount = $7,
            processed_at = now(),
            updated_at = now()
        WHERE id = $1
        `,
        [
          inserted.rows[0].id,
          account.tenantId,
          account.userId,
          account.membershipId,
          payload.referenceId ?? null,
          plan,
          amount,
        ],
      )

      if (plan !== previousPlan) {
        await insertAuditLog(client, {
          tenantId: account.tenantId,
          userId: account.userId,
          actorUserId: null,
          action: 'billing.plan.updated',
          resourceType: 'billing_account',
          resourceId: account.membershipId,
          ipAddress: null,
          userAgent: null,
          metadata: {
            ...metadata,
            provider: input.provider,
            webhookEventId: payload.eventId,
            webhookEventType: payload.type,
            previousPlan,
            plan,
          },
        })
      }

      if (ledgerEntry) {
        await insertAuditLog(client, {
          tenantId: account.tenantId,
          userId: account.userId,
          actorUserId: null,
          action: billingAuditActionForWebhook(payload, ledgerEntry),
          resourceType: 'billing_account',
          resourceId: account.membershipId,
          ipAddress: null,
          userAgent: null,
          metadata: {
            ...metadata,
            provider: input.provider,
            webhookEventId: payload.eventId,
            webhookEventType: payload.type,
            membershipId: account.membershipId,
            ledgerEntryId: ledgerEntry.id,
            entryType: ledgerEntry.type,
            amount: ledgerEntry.amount,
            balance: ledgerEntry.balance,
          },
        })
      }

      return {
        provider: input.provider,
        eventId: payload.eventId,
        eventType: payload.type,
        duplicate: false,
        status: 'processed',
        tenantId: account.tenantId,
        userId: account.userId,
        membershipId: account.membershipId,
        plan,
        credits,
        ledgerEntry,
      }
    })
  }

  async updatePlan(input: {
    tenantId: string
    userId: string
    plan: Plan
    description?: string
    createdByUserId?: string | null
  }): Promise<BillingPlanResult | null> {
    return this.database.transaction(async (client) => {
      const membership = await resolveMembership(client, input.userId, input.tenantId)
      if (!membership) {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
      }

      const account = await client.query<{ plan: Plan; credits: number }>(
        `
        SELECT plan, credits
        FROM billing_accounts
        WHERE membership_id = $1
        FOR UPDATE
        `,
        [membership.id],
      )
      const current = account.rows[0]
      if (!current) {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
      }
      if (current.plan === input.plan) {
        return { plan: current.plan, credits: current.credits, grantEntry: null }
      }

      await client.query(
        `
        UPDATE billing_accounts
        SET plan = $2,
            updated_at = now()
        WHERE membership_id = $1
        `,
        [membership.id, input.plan],
      )

      let credits = current.credits
      let grantEntry: LedgerEntry | null = null
      if (input.plan === 'member') {
        const grantId = monthlyGrantId(input.userId)
        const existingGrant = await client.query<{ id: string }>(
          `
          SELECT id
          FROM billing_ledger_entries
          WHERE tenant_id = $1
            AND user_id = $2
            AND reference_id = $3
          LIMIT 1
          `,
          [input.tenantId, input.userId, grantId],
        )
        if (!existingGrant.rows[0]) {
          credits += monthlyGrantCredits
          await client.query(
            `
            UPDATE billing_accounts
            SET credits = $2,
                updated_at = now()
            WHERE membership_id = $1
            `,
            [membership.id, credits],
          )
          const createdAt = new Date().toISOString()
          const inserted = await client.query<LedgerEntryRow>(
            `
            INSERT INTO billing_ledger_entries (
              id,
              tenant_id,
              user_id,
              membership_id,
              reference_id,
              related_entry_id,
              entry_type,
              amount,
              balance,
              description,
              created_by_user_id,
              created_at,
              updated_at,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, NULL, 'grant', $6, $7, $8, $9, $10, $10, $11)
            RETURNING id, user_id, tenant_id, entry_type, amount, balance, description, created_at
            `,
            [
              grantId,
              input.tenantId,
              input.userId,
              membership.id,
              grantId,
              monthlyGrantCredits,
              credits,
              input.description ?? 'Member monthly grant',
              input.createdByUserId ?? null,
              createdAt,
              emptyMetadata,
            ],
          )
          grantEntry = toLedgerEntry(inserted.rows[0]!)
        }
      }

      return { plan: input.plan, credits, grantEntry }
    })
  }

  async countConsumedCreditsSince(startIso: string, tenantId?: string): Promise<number> {
    const result = await this.database.query<{ credits: number }>(
      `
      SELECT COALESCE(SUM(ABS(amount)), 0)::int AS credits
      FROM (
        SELECT tenant_id, entry_type, amount, created_at
        FROM billing_ledger_entries
        UNION ALL
        SELECT tenant_id, entry_type, amount, created_at
        FROM organization_billing_ledger_entries
      ) entries
      WHERE entry_type = 'generation'
        AND amount < 0
        AND created_at >= $1::timestamptz
        AND ($2::text IS NULL OR tenant_id = $2)
      `,
      [startIso, tenantId ?? null],
    )
    return result.rows[0]?.credits ?? 0
  }

  async hasImportedJsonEntries(): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      `
      SELECT id
      FROM billing_ledger_entries
      WHERE metadata->>'importedFromJson' = 'true'
      LIMIT 1
      `,
    )
    return Boolean(result.rows[0])
  }
}

async function resolveMembership(
  client: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }>
  },
  userId: string,
  tenantId: string,
): Promise<{ id: string } | null> {
  const result = await client.query<{ id: string }>(
    `
    SELECT m.id
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
    WHERE m.user_id = $1
      AND m.tenant_id = $2
      AND m.status = 'active'
    LIMIT 1
    `,
    [userId, tenantId],
  )
  return result.rows[0] ?? null
}

async function resolveAccountByMembershipId(
  client: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }>
  },
  membershipId: string,
): Promise<BillingAccountRecord | null> {
  const result = await client.query<{
    membership_id: string
    user_id: string
    tenant_id: string
    organization_type: OrganizationType | null
    roles: Role[]
    plan: Plan
    credits: number
  }>(
    `
    SELECT b.membership_id, m.user_id, m.tenant_id, t.organization_type, m.roles, b.plan, b.credits
    FROM billing_accounts b
    JOIN tenant_memberships m ON m.id = b.membership_id
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
    WHERE b.membership_id = $1
      AND m.status = 'active'
    FOR UPDATE OF b
    `,
    [membershipId],
  )
  const row = result.rows[0]
  return row
    ? {
        membershipId: row.membership_id,
        userId: row.user_id,
        tenantId: row.tenant_id,
        organizationType: row.organization_type,
        roles: row.roles,
        plan: row.plan,
        credits: row.credits,
      }
    : null
}

function bootstrapReferenceId(entryId: string): string {
  if (entryId.startsWith('generation-')) return entryId.slice('generation-'.length)
  return entryId
}

function toLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    amount: row.amount,
    balance: row.balance,
    type: row.entry_type,
    description: row.description,
    createdAt: toIso(row.created_at),
  }
}

function toOrganizationLedgerEntry(row: OrganizationLedgerEntryRow): OrganizationLedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    referenceId: row.reference_id,
    relatedEntryId: row.related_entry_id,
    amount: Number(row.amount),
    balance: Number(row.balance),
    type: row.entry_type,
    description: row.description,
    createdByUserId: row.created_by_user_id,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    createdAt: toIso(row.created_at),
  }
}

function organizationEntryToLedgerEntry(entry: OrganizationLedgerEntry): LedgerEntry {
  return {
    id: entry.id,
    userId: entry.userId ?? entry.createdByUserId ?? 'unknown',
    tenantId: entry.tenantId,
    amount: entry.amount,
    balance: entry.balance,
    type: entry.type,
    description: entry.description,
    createdAt: entry.createdAt,
  }
}

function monthlyUsageFromEntries(entries: readonly { id: string; type: LedgerEntry['type']; amount: number; createdAt: string }[]) {
  const periodStart = startOfChinaMonth()
  const orderedEntries = [...entries].sort((left, right) => {
    const createdAtOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    if (createdAtOrder !== 0) return createdAtOrder
    return right.id.localeCompare(left.id)
  })
  const monthlyEntries = orderedEntries.filter((entry) => entry.createdAt >= periodStart)
  const generationEntries = monthlyEntries.filter((entry) => entry.type === 'generation' && entry.amount < 0)
  const consumedCredits = generationEntries.reduce((total, entry) => total - entry.amount, 0)
  const refundedCredits = monthlyEntries
    .filter((entry) => entry.type === 'adjustment' && entry.amount > 0 && entry.id.startsWith('refund-'))
    .reduce((total, entry) => total + entry.amount, 0)

  return {
    periodStart,
    consumedCredits,
    refundedCredits,
    netCredits: Math.max(0, consumedCredits - refundedCredits),
    generationCount: generationEntries.length,
    includedCredits: 0,
  }
}

function billingAuditActionForWebhook(payload: BillingWebhookEvent, entry: LedgerEntry): string {
  if (payload.type === 'payment.refunded') return 'billing.credits.refunded'
  if (entry.type === 'grant') return 'billing.credits.granted'
  if (entry.type === 'generation') return 'billing.credits.reserved'
  return 'billing.credits.adjusted'
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function webhookEventId(provider: string, eventId: string): string {
  return `billing-webhook-${provider}-${eventId}`
}

function webhookLedgerMetadata(provider: string, payload: BillingWebhookEvent): BillingLedgerMetadata {
  return {
    ...payload.metadata,
    webhookProvider: provider,
    webhookEventId: payload.eventId,
    webhookEventType: payload.type,
  }
}

async function resolveAccountByPrincipal(
  client: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }>
  },
  userId: string,
  tenantId: string,
): Promise<BillingAccountRecord | null> {
  const membership = await resolveMembership(client, userId, tenantId)
  if (!membership) return null
  return resolveAccountByMembershipId(client, membership.id)
}

async function resolveBillingTargetByPrincipal(
  client: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }>
  },
  userId: string,
  tenantId: string,
): Promise<BillingTarget | null> {
  const account = await resolveAccountByPrincipal(client, userId, tenantId)
  if (!account) return null
  if (!usesOrganizationBilling(account)) return { scope: 'membership', account }
  const organization = await ensureOrganizationBillingAccount(client, account.tenantId, true)
  if (!organization) return { scope: 'membership', account }
  return { scope: 'organization', account, organization }
}

async function ensureOrganizationBillingAccount(
  client: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }>
  },
  tenantId: string,
  forUpdate: boolean,
): Promise<OrganizationBillingAccountRecord | null> {
  await client.query(
    `
    INSERT INTO organization_billing_accounts (tenant_id, credits, created_at, updated_at)
    SELECT id, 0, now(), now()
    FROM tenants
    WHERE id = $1
      AND status = 'active'
      AND organization_type = 'enterprise'
    ON CONFLICT (tenant_id) DO NOTHING
    `,
    [tenantId],
  )
  const result = await client.query<OrganizationBillingAccountRow>(
    `
    SELECT
      t.id AS tenant_id,
      t.name AS tenant_name,
      t.status AS tenant_status,
      t.organization_type,
      o.credits,
      o.updated_at
    FROM organization_billing_accounts o
    JOIN tenants t ON t.id = o.tenant_id AND t.status = 'active'
    WHERE o.tenant_id = $1
      AND t.organization_type = 'enterprise'
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF o' : ''}
    `,
    [tenantId],
  )
  const row = result.rows[0]
  return row
    ? {
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        tenantStatus: row.tenant_status,
        organizationType: row.organization_type,
        credits: Number(row.credits),
        updatedAt: toIso(row.updated_at),
      }
    : null
}

async function listMembershipLedgerEntries(
  client: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }>
  },
  userId: string,
  tenantId: string,
): Promise<LedgerEntry[]> {
  const result = await client.query<LedgerEntryRow>(
    `
    SELECT
      id,
      user_id,
      tenant_id,
      entry_type,
      amount,
      balance,
      description,
      created_at
    FROM billing_ledger_entries
    WHERE user_id = $1
      AND tenant_id = $2
    ORDER BY created_at DESC, id DESC
    `,
    [userId, tenantId],
  )
  return result.rows.map(toLedgerEntry)
}

async function listOrganizationLedgerEntries(
  client: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }>
  },
  tenantId: string,
  limit: number | null,
): Promise<OrganizationLedgerEntry[]> {
  const result = await client.query<OrganizationLedgerEntryRow>(
    `
    SELECT
      id,
      user_id,
      tenant_id,
      membership_id,
      reference_id,
      related_entry_id,
      entry_type,
      amount,
      balance,
      description,
      created_by_user_id,
      created_at,
      metadata
    FROM organization_billing_ledger_entries
    WHERE tenant_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT $2
    `,
    [tenantId, limit],
  )
  return result.rows.map(toOrganizationLedgerEntry)
}

async function insertOrganizationLedgerEntryIfAbsent(
  client: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }>
  },
  input: {
    organization: OrganizationBillingAccountRecord
    userId: string | null
    membershipId: string | null
    entryId: string
    referenceId: string
    relatedEntryId?: string | null
    entryType: LedgerEntry['type']
    amount: number
    description: string
    createdByUserId?: string | null
    createdAt?: string | undefined
    metadata?: BillingLedgerMetadata | undefined
    audit?: BillingLedgerAuditInput | undefined
  },
): Promise<OrganizationBillingRecordResult | null> {
  const duplicate = await client.query<{ id: string }>(
    `
    SELECT id
    FROM organization_billing_ledger_entries
    WHERE tenant_id = $1
      AND reference_id = $2
    LIMIT 1
    `,
    [input.organization.tenantId, input.referenceId],
  )
  if (duplicate.rows[0]) return null

  const nextCredits = input.organization.credits + input.amount
  if (nextCredits < 0) {
    throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
  }

  await client.query(
    `
    UPDATE organization_billing_accounts
    SET credits = $2,
        updated_at = now()
    WHERE tenant_id = $1
    `,
    [input.organization.tenantId, nextCredits],
  )

  const createdAt = input.createdAt ?? new Date().toISOString()
  const inserted = await client.query<OrganizationLedgerEntryRow>(
    `
    INSERT INTO organization_billing_ledger_entries (
      id,
      tenant_id,
      user_id,
      membership_id,
      reference_id,
      related_entry_id,
      entry_type,
      amount,
      balance,
      description,
      created_by_user_id,
      created_at,
      updated_at,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13)
    RETURNING
      id,
      user_id,
      tenant_id,
      membership_id,
      reference_id,
      related_entry_id,
      entry_type,
      amount,
      balance,
      description,
      created_by_user_id,
      created_at,
      metadata
    `,
    [
      input.entryId,
      input.organization.tenantId,
      input.userId,
      input.membershipId,
      input.referenceId,
      input.relatedEntryId ?? null,
      input.entryType,
      input.amount,
      nextCredits,
      input.description,
      input.createdByUserId ?? null,
      createdAt,
      JSON.stringify(input.metadata ?? {}),
    ],
  )
  const entry = toOrganizationLedgerEntry(inserted.rows[0]!)
  if (input.audit) {
    await insertAuditLog(client, {
      tenantId: input.organization.tenantId,
      userId: input.userId,
      actorUserId: input.audit.actorUserId,
      action: input.audit.action,
      resourceType: 'organization_billing_account',
      resourceId: input.organization.tenantId,
      ipAddress: input.audit.ipAddress,
      userAgent: input.audit.userAgent,
      metadata: {
        ...input.audit.metadata,
        organizationId: input.organization.tenantId,
        tenantId: input.organization.tenantId,
        membershipId: input.membershipId,
        ledgerEntryId: entry.id,
        entryType: entry.type,
        amount: entry.amount,
        balance: entry.balance,
      },
    })
  }

  return {
    entry,
    balance: nextCredits,
    tenantId: input.organization.tenantId,
  }
}

async function insertLedgerEntryIfAbsent(
  client: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }>
  },
  input: {
    account: BillingAccountRecord
    entryId: string
    referenceId: string
    entryType: LedgerEntry['type']
    amount: number
    currentCredits: number
    description: string
    createdAt: string
    metadata: BillingLedgerMetadata
  },
): Promise<BillingLedgerRecordResult | null> {
  const duplicate = await client.query<{ id: string }>(
    `
    SELECT id
    FROM billing_ledger_entries
    WHERE tenant_id = $1
      AND user_id = $2
      AND reference_id = $3
    LIMIT 1
    `,
    [input.account.tenantId, input.account.userId, input.referenceId],
  )
  if (duplicate.rows[0]) return null

  const nextCredits = input.currentCredits + input.amount
  if (nextCredits < 0) {
    throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
  }

  await client.query(
    `
    UPDATE billing_accounts
    SET credits = $2,
        updated_at = now()
    WHERE membership_id = $1
    `,
    [input.account.membershipId, nextCredits],
  )

  const inserted = await client.query<LedgerEntryRow>(
    `
    INSERT INTO billing_ledger_entries (
      id,
      tenant_id,
      user_id,
      membership_id,
      reference_id,
      related_entry_id,
      entry_type,
      amount,
      balance,
      description,
      created_by_user_id,
      created_at,
      updated_at,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, NULL, $10, $10, $11)
    RETURNING id, user_id, tenant_id, entry_type, amount, balance, description, created_at
    `,
    [
      input.entryId,
      input.account.tenantId,
      input.account.userId,
      input.account.membershipId,
      input.referenceId,
      input.entryType,
      input.amount,
      nextCredits,
      input.description,
      input.createdAt,
      JSON.stringify(input.metadata),
    ],
  )
  return { entry: toLedgerEntry(inserted.rows[0]!), balance: nextCredits }
}

function webhookResultFromRow(row: BillingWebhookEventRow, duplicate: boolean): BillingWebhookProcessResult {
  return {
    provider: row.provider,
    eventId: row.provider_event_id,
    eventType: row.event_type,
    duplicate,
    status: 'processed',
    tenantId: row.tenant_id,
    userId: row.user_id,
    membershipId: row.membership_id,
    plan: row.plan,
    credits: null,
    ledgerEntry: null,
  }
}

function monthlyGrantId(userId: string, now: Date | string = new Date()): string {
  return `membership-${userId}-${startOfChinaMonth(now).slice(0, 10)}`
}

function startOfChinaMonth(now: Date | string = new Date()): string {
  const inputDate = now instanceof Date ? now : new Date(now)
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(inputDate.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs,
  ).toISOString()
}

type BillingAccountRecord = {
  membershipId: string
  userId: string
  tenantId: string
  organizationType: OrganizationType | null
  roles: Role[]
  plan: Plan
  credits: number
}

type OrganizationBillingAccountRecord = {
  tenantId: string
  tenantName: string
  tenantStatus: 'active' | 'disabled'
  organizationType: OrganizationType
  credits: number
  updatedAt: string
}

type BillingTarget =
  | { scope: 'membership'; account: BillingAccountRecord }
  | { scope: 'organization'; account: BillingAccountRecord; organization: OrganizationBillingAccountRecord }

function canManageBillingAccount(
  principal: Pick<Principal, 'tenantId' | 'roles'>,
  account: BillingAccountRecord,
): boolean {
  if (principal.roles.includes(ROLES.OWNER) || principal.roles.includes(ROLES.SUPER_ADMIN)) return true
  if (principal.roles.includes(ROLES.ADMIN)) {
    return account.organizationType === 'personal' && account.roles.includes(ROLES.MEMBER)
  }
  if (principal.roles.includes(ROLES.ORGANIZATION_ADMIN)) {
    return (
      account.tenantId === principal.tenantId &&
      account.organizationType === 'enterprise' &&
      account.roles.includes(ROLES.ORGANIZATION_MEMBER)
    )
  }
  return false
}

function usesOrganizationBilling(account: BillingAccountRecord): boolean {
  return (
    account.organizationType === 'enterprise' &&
    (account.roles.includes(ROLES.ORGANIZATION_ADMIN) ||
      account.roles.includes(ROLES.ORGANIZATION_MEMBER))
  )
}

function canReadOrganizationBilling(
  principal: Pick<Principal, 'tenantId' | 'roles'>,
  organization: OrganizationBillingAccountRecord,
): boolean {
  if (principal.roles.includes(ROLES.OWNER) || principal.roles.includes(ROLES.SUPER_ADMIN)) return true
  return (
    principal.tenantId === organization.tenantId &&
    organization.organizationType === 'enterprise' &&
    (principal.roles.includes(ROLES.ORGANIZATION_ADMIN) ||
      principal.roles.includes(ROLES.ORGANIZATION_MEMBER))
  )
}

function canManageOrganizationBilling(
  principal: Pick<Principal, 'tenantId' | 'roles'>,
  organization: OrganizationBillingAccountRecord,
): boolean {
  if (principal.roles.includes(ROLES.OWNER) || principal.roles.includes(ROLES.SUPER_ADMIN)) return true
  return (
    principal.tenantId === organization.tenantId &&
    organization.organizationType === 'enterprise' &&
    principal.roles.includes(ROLES.ORGANIZATION_ADMIN)
  )
}

type LedgerEntryRow = {
  id: string
  user_id: string
  tenant_id: string
  entry_type: LedgerEntry['type']
  amount: number
  balance: number
  description: string
  created_at: Date | string
}

type OrganizationBillingAccountRow = {
  tenant_id: string
  tenant_name: string
  tenant_status: OrganizationBillingAccountRecord['tenantStatus']
  organization_type: OrganizationType
  credits: number | string
  updated_at: Date | string
}

type OrganizationLedgerEntryRow = {
  id: string
  user_id: string | null
  tenant_id: string
  membership_id: string | null
  reference_id: string
  related_entry_id: string | null
  entry_type: LedgerEntry['type']
  amount: number | string
  balance: number | string
  description: string
  created_by_user_id: string | null
  created_at: Date | string
  metadata: Record<string, unknown> | string
}

type BillingWebhookEventRow = {
  provider: string
  provider_event_id: string
  event_type: BillingWebhookEvent['type']
  status: 'processing' | 'processed'
  tenant_id: string | null
  user_id: string | null
  membership_id: string | null
  plan: Plan | null
  amount: number | null
}
