import type { Principal } from '@seqora/contracts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { UserRepository } from '../users/repository.js'
import { StoreCreditLedger } from './creditLedger.js'

const principal: Principal = {
  userId: 'user-creator',
  tenantId: 'tenant-seqora-demo',
  roles: ['creator'],
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

    const before = await ledger.summary(principal)
    expect(before.credits).toBe(286)
    expect(before.entries.map((entry) => entry.id)).toContain('ledger-initial')

    await expect(ledger.reserve(principal, 12, 'billing-task-1', 'Task debit')).resolves.toBe(true)
    await expect(ledger.reserve(principal, 12, 'billing-task-1', 'Duplicate task debit')).resolves.toBe(false)

    const debited = await ledger.summary(principal)
    expect(debited.credits).toBe(274)
    expect(debited.monthlyUsage).toMatchObject({
      consumedCredits: 12,
      refundedCredits: 0,
      netCredits: 12,
      generationCount: 1,
    })

    await ledger.refundReservation(principal, 'billing-task-1', 'Task refund')
    await ledger.refundReservation(principal, 'billing-task-1', 'Duplicate task refund')

    const refunded = await ledger.summary(principal)
    expect(refunded.credits).toBe(286)
    expect(refunded.monthlyUsage).toMatchObject({
      consumedCredits: 12,
      refundedCredits: 12,
      netCredits: 0,
      generationCount: 1,
    })
    expect(refunded.entries.filter((entry) => entry.id === 'refund-billing-task-1')).toHaveLength(1)
    expect(
      store.read((state) => state.ledger.filter((entry) => entry.id === 'refund-billing-task-1')),
    ).toHaveLength(1)

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

  it('updates plans and grants monthly member credits once', async () => {
    const { database, ledger } = await createLedger()

    await ledger.updatePlan(principal, 'member')
    await ledger.updatePlan(principal, 'free')
    const summary = await ledger.updatePlan(principal, 'member')

    expect(summary).toMatchObject({
      plan: 'member',
      credits: 786,
      planSelfServiceEnabled: true,
      monthlyUsage: { includedCredits: 500 },
    })

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

  const ledger = new StoreCreditLedger(store, users, true, database)
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
