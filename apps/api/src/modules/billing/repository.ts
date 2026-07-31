import type { LedgerEntry, Plan } from '@seqora/contracts'
import type { QueryResultRow } from 'pg'
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
}

export type BillingLedgerMetadata = Record<string, unknown>

export type BillingLedgerMembershipRecordInput = {
  membershipId: string
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

export type BillingPlanResult = {
  plan: Plan
  credits: number
  grantEntry: LedgerEntry | null
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
      SELECT id
      FROM billing_ledger_entries
      WHERE id = $1
        AND user_id = $2
        AND tenant_id = $3
      LIMIT 1
      `,
      [entryId, userId, tenantId],
    )
    return Boolean(result.rows[0])
  }

  async findEntryById(entryId: string, userId: string, tenantId: string): Promise<LedgerEntry | null> {
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
      WHERE id = $1
        AND user_id = $2
        AND tenant_id = $3
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
      const membership = await resolveMembership(client, input.userId, input.tenantId)
      if (!membership) {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
      }

      const account = await client.query<{ membership_id: string; credits: number }>(
        `
        SELECT membership_id, credits
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

      const nextCredits = current.credits + input.amount
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
        [membership.id, nextCredits],
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
          membership.id,
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
      return {
        entry: toLedgerEntry(inserted.rows[0]!),
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
  }): Promise<BillingLedgerRecordResult | null> {
    return this.recordEntry({
      tenantId: input.tenantId,
      userId: input.userId,
      entryId: input.refundEntryId,
      referenceId: input.refundEntryId,
      relatedEntryId: input.originalEntryId,
      entryType: 'adjustment',
      amount: input.amount,
      description: input.description,
      createdByUserId: input.createdByUserId ?? null,
      createdAt: input.createdAt,
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
      return {
        entry: toLedgerEntry(inserted.rows[0]!),
        balance: nextCredits,
        membershipId: account.membershipId,
        userId: account.userId,
        tenantId: account.tenantId,
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
      FROM billing_ledger_entries
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
): Promise<{ membershipId: string; userId: string; tenantId: string; credits: number } | null> {
  const result = await client.query<{
    membership_id: string
    user_id: string
    tenant_id: string
    credits: number
  }>(
    `
    SELECT b.membership_id, m.user_id, m.tenant_id, b.credits
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
        credits: row.credits,
      }
    : null
}

function monthlyGrantId(userId: string): string {
  return `membership-${userId}-${startOfChinaMonth().slice(0, 10)}`
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

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function startOfChinaMonth(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs,
  ).toISOString()
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
