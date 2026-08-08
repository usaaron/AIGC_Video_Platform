import type { Principal } from '@seqora/contracts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { UserRepository } from '../users/repository.js'
import { StoreCreditLedger } from './creditLedger.js'

const principal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

const adminPrincipal: Principal = {
  userId: 'user-admin',
  tenantId: 'tenant-seqora-demo',
  roles: ['admin'],
}

let authDatabase: PostgresAuthFixture | undefined
let openDatabases: AccountDatabase[] = []

beforeAll(async () => {
  authDatabase = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await authDatabase?.reset()
})

afterEach(async () => {
  await Promise.all(openDatabases.map((database) => database.close()))
  openDatabases = []
})

afterAll(async () => {
  await authDatabase?.close()
})

describe('postgres billing ledger', () => {
  it('stores debits and refunds with idempotent references', async () => {
    const { database, ledger, store } = await createLedger()

    const before = await ledger.billingSummary(principal)
    expect(before.credits).toBe(286)
    expect(before.entries.map((entry) => entry.id)).toContain('ledger-initial')

    const imported = await database.query<{ imported_from_json: boolean }>(
      `
      SELECT (metadata->>'importedFromJson')::boolean AS imported_from_json
      FROM billing_ledger_entries
      WHERE id = 'ledger-initial'
      `,
    )
    expect(imported.rows[0]?.imported_from_json).toBe(true)

    await expect(ledger.reserveCredits(principal, 12, 'billing-task-1', 'Task debit')).resolves.toBe(true)
    await expect(
      ledger.reserveCredits(principal, 12, 'billing-task-1', 'Duplicate task debit'),
    ).resolves.toBe(false)

    const debited = await ledger.billingSummary(principal)
    expect(debited.credits).toBe(274)
    expect(debited.monthlyUsage).toMatchObject({
      consumedCredits: 12,
      refundedCredits: 0,
      netCredits: 12,
      generationCount: 1,
    })

    await ledger.refundCredits(principal, 'billing-task-1', 'Task refund')
    await ledger.refundCredits(principal, 'billing-task-1', 'Duplicate task refund')

    const refunded = await ledger.billingSummary(principal)
    expect(refunded.credits).toBe(286)
    expect(refunded.monthlyUsage).toMatchObject({
      consumedCredits: 12,
      refundedCredits: 12,
      netCredits: 0,
      generationCount: 1,
    })
    await expect(ledger.consumedCreditsSince(before.monthlyUsage.periodStart)).resolves.toBe(12)
    expect(refunded.entries.filter((entry) => entry.id === 'refund-billing-task-1')).toHaveLength(1)
    const mirroredIds = store.read((state) => state.ledger.map((entry) => entry.id))
    expect(mirroredIds).not.toContain('generation-billing-task-1')
    expect(mirroredIds).not.toContain('refund-billing-task-1')

    const rows = await database.query<LedgerAuditRow>(
      `
      SELECT id, reference_id, related_entry_id, entry_type, amount, balance
      FROM billing_ledger_entries
      WHERE user_id = $1
        AND tenant_id = $2
        AND id IN ('generation-billing-task-1', 'refund-billing-task-1')
      ORDER BY id
      `,
      [principal.userId, principal.tenantId],
    )
    expect(rows.rows).toEqual([
      {
        id: 'generation-billing-task-1',
        reference_id: 'billing-task-1',
        related_entry_id: null,
        entry_type: 'generation',
        amount: -12,
        balance: 274,
      },
      {
        id: 'refund-billing-task-1',
        reference_id: 'refund-billing-task-1',
        related_entry_id: 'generation-billing-task-1',
        entry_type: 'adjustment',
        amount: 12,
        balance: 286,
      },
    ])
  })

  it('records idempotent administrator balance adjustments', async () => {
    const { database, ledger } = await createLedger()

    const topUp = await ledger.adjustBalance(principal, 40, 'admin-topup-1', 'Admin top-up')
    expect(topUp.credits).toBe(326)

    const duplicateTopUp = await ledger.adjustBalance(
      principal,
      40,
      'admin-topup-1',
      'Duplicate admin top-up',
    )
    expect(duplicateTopUp.credits).toBe(326)

    const correction = await ledger.adjustBalance(principal, -20, 'admin-correction-1', 'Admin correction')
    expect(correction.credits).toBe(306)

    const rows = await database.query<AdjustmentAuditRow>(
      `
      SELECT reference_id, entry_type, amount, balance, created_by_user_id
      FROM billing_ledger_entries
      WHERE user_id = $1
        AND tenant_id = $2
        AND reference_id IN ('admin-topup-1', 'admin-correction-1')
      ORDER BY reference_id
      `,
      [principal.userId, principal.tenantId],
    )
    expect(rows.rows).toEqual([
      {
        reference_id: 'admin-correction-1',
        entry_type: 'adjustment',
        amount: -20,
        balance: 306,
        created_by_user_id: principal.userId,
      },
      {
        reference_id: 'admin-topup-1',
        entry_type: 'adjustment',
        amount: 40,
        balance: 326,
        created_by_user_id: principal.userId,
      },
    ])
  })

  it('grants credits and lets administrators adjust a target membership from postgres', async () => {
    const { database, ledger, store } = await createLedger()

    const granted = await ledger.grantCredits(principal, 30, 'Launch promotional grant')
    expect(granted.credits).toBe(316)

    const adjusted = await ledger.adjustCredits(
      adminPrincipal,
      'membership-tenant-seqora-demo-user-member',
      25,
      'Admin manual top-up',
    )
    expect(adjusted.credits).toBe(341)
    expect(store.read((state) => state.users.find((user) => user.id === principal.userId)?.credits)).toBe(286)
    expect(
      store.read((state) => state.ledger.some((entry) => entry.description === 'Admin manual top-up')),
    ).toBe(false)
    expect(
      store.read((state) => state.ledger.some((entry) => entry.description === 'Launch promotional grant')),
    ).toBe(false)

    const rows = await database.query<{
      membership_id: string
      entry_type: string
      amount: number
      created_by_user_id: string | null
    }>(
      `
      SELECT membership_id, entry_type, amount, created_by_user_id
      FROM billing_ledger_entries
      WHERE description IN ('Launch promotional grant', 'Admin manual top-up')
      ORDER BY amount
      `,
    )
    expect(rows.rows).toEqual([
      {
        membership_id: 'membership-tenant-seqora-demo-user-member',
        entry_type: 'adjustment',
        amount: 25,
        created_by_user_id: adminPrincipal.userId,
      },
      {
        membership_id: 'membership-tenant-seqora-demo-user-member',
        entry_type: 'grant',
        amount: 30,
        created_by_user_id: principal.userId,
      },
    ])

    const auditRows = await database.query<{
      action: string
      user_id: string
      actor_user_id: string
      resource_id: string
      metadata: Record<string, unknown>
    }>(
      `
      SELECT action, user_id, actor_user_id, resource_id, metadata
      FROM audit_log_entries
      WHERE action IN ('billing.credits.granted', 'billing.credits.adjusted')
        AND resource_id = 'membership-tenant-seqora-demo-user-member'
      ORDER BY action
      `,
    )
    expect(auditRows.rows).toEqual([
      expect.objectContaining({
        action: 'billing.credits.adjusted',
        user_id: principal.userId,
        actor_user_id: adminPrincipal.userId,
        resource_id: 'membership-tenant-seqora-demo-user-member',
        metadata: expect.objectContaining({ amount: 25, reason: 'Admin manual top-up' }),
      }),
      expect.objectContaining({
        action: 'billing.credits.granted',
        user_id: principal.userId,
        actor_user_id: principal.userId,
        resource_id: 'membership-tenant-seqora-demo-user-member',
        metadata: expect.objectContaining({ amount: 30, reason: 'Launch promotional grant' }),
      }),
    ])
  })

  it('processes subscription webhooks and grants monthly member credits once', async () => {
    const { database, ledger, store } = await createLedger()

    await expect(ledger.updatePlan(principal, 'member')).rejects.toMatchObject({
      code: 'PLAN_CHANGE_REQUIRES_ADMIN',
    })

    const activated = await ledger.processBillingWebhook('testpay', {
      eventId: 'evt-subscription-activated',
      type: 'subscription.activated',
      membershipId: 'membership-tenant-seqora-demo-user-member',
      occurredAt: '2026-07-01T00:00:00.000Z',
      metadata: { subscriptionId: 'sub_1' },
    })
    const duplicate = await ledger.processBillingWebhook('testpay', {
      eventId: 'evt-subscription-activated',
      type: 'subscription.activated',
      membershipId: 'membership-tenant-seqora-demo-user-member',
      occurredAt: '2026-07-01T00:00:00.000Z',
      metadata: { subscriptionId: 'sub_1' },
    })
    const summary = await ledger.billingSummary(principal)

    expect(activated).toMatchObject({
      duplicate: false,
      plan: 'member',
      credits: 786,
      ledgerEntry: { type: 'grant', amount: 500 },
    })
    expect(duplicate).toMatchObject({ duplicate: true, plan: 'member' })
    expect(summary).toMatchObject({
      plan: 'member',
      credits: 786,
      planSelfServiceEnabled: false,
      monthlyUsage: { includedCredits: 500 },
    })
    expect(store.read((state) => state.users.find((user) => user.id === principal.userId))).toMatchObject({
      plan: 'free',
      credits: 286,
    })
    expect(store.read((state) => state.ledger.some((entry) => entry.amount === 500))).toBe(false)

    const grants = await database.query<{ count: number }>(
      `
      SELECT count(*)::int AS count
      FROM billing_ledger_entries
      WHERE user_id = $1
        AND tenant_id = $2
        AND reference_id LIKE $3
        AND entry_type = 'grant'
        AND amount = 500
      `,
      [principal.userId, principal.tenantId, `membership-${principal.userId}-%`],
    )
    expect(grants.rows[0]?.count).toBe(1)

    const cancelled = await ledger.processBillingWebhook('testpay', {
      eventId: 'evt-subscription-cancelled',
      type: 'subscription.cancelled',
      membershipId: 'membership-tenant-seqora-demo-user-member',
      metadata: { subscriptionId: 'sub_1' },
    })
    expect(cancelled).toMatchObject({ plan: 'free', credits: 786 })
    await expect(ledger.billingSummary(principal)).resolves.toMatchObject({ plan: 'free', credits: 786 })
  })
})

async function createLedger(): Promise<{
  database: AccountDatabase
  ledger: StoreCreditLedger
  store: AppStore
}> {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')

  const database = new AccountDatabase(authDatabase.connectionString)
  openDatabases.push(database)
  await database.migrate()

  const store = new AppStore(null)
  await store.initialize()

  const users = new UserRepository(store, database)
  await users.bootstrapFromStore()

  const ledger = new StoreCreditLedger(store, users, false, database)
  await ledger.bootstrapFromStore()

  return { database, ledger, store }
}

type LedgerAuditRow = {
  id: string
  reference_id: string
  related_entry_id: string | null
  entry_type: string
  amount: number
  balance: number
}

type AdjustmentAuditRow = {
  reference_id: string
  entry_type: string
  amount: number
  balance: number
  created_by_user_id: string | null
}
