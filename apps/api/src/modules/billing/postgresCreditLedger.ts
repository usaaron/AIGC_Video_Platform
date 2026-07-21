import type { BillingSummary, LedgerEntry, Plan, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { AppError } from '../../core/errors.js'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import {
  LEDGER_COLUMNS,
  USER_COLUMNS,
  ledgerFromRow,
  userFromRow,
  type LedgerRow,
  type UserRow,
} from '../../infra/postgresRows.js'
import type { StoredUser } from '../../infra/store.js'
import type { CreditLedger } from './creditLedger.js'

export class PostgresCreditLedger implements CreditLedger {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async reserve(
    principal: Principal,
    credits: number,
    referenceId: string,
    description = 'Generation task',
  ): Promise<void> {
    await this.transactions.withTransaction(async (client) => {
      const ledgerId = `generation-${referenceId}`
      const existing = await client.query<{ id: string }>(
        `
          select id
          from ledger_entries
          where id = $1 and user_id = $2 and tenant_id = $3
          for update
        `,
        [ledgerId, principal.userId, principal.tenantId],
      )
      if (existing.rows[0]) return

      const user = await lockedUser(client, principal)
      const nextCredits = user.credits - credits
      if (nextCredits < 0) throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')

      const now = new Date().toISOString()
      await client.query(
        `
          update users
          set credits = $1, updated_at = $2
          where id = $3 and tenant_id = $4
        `,
        [nextCredits, now, user.id, user.tenantId],
      )
      await client.query(
        `
          insert into ledger_entries (
            id, user_id, tenant_id, amount, balance, type, description, created_at
          )
          values ($1, $2, $3, $4, $5, 'generation', $6, $7)
        `,
        [ledgerId, user.id, user.tenantId, -credits, nextCredits, description, now],
      )
    })
  }

  async summary(principal: Principal): Promise<BillingSummary> {
    return this.transactions.withTransaction(async (client) => {
      const user = await readableUser(client, principal)
      const entries = await recentLedgerEntries(client, user.id, user.tenantId)
      return summaryFor(user, entries)
    })
  }

  async updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary> {
    return this.transactions.withTransaction(async (client) => {
      const user = await lockedUser(client, principal)
      const now = new Date().toISOString()
      let nextUser = user

      if (user.plan !== plan) {
        const grant = plan === 'member' ? 500 : 0
        const nextCredits = user.credits + grant
        const updated = await client.query<UserRow>(
          `
            update users
            set plan = $1, credits = $2, updated_at = $3
            where id = $4 and tenant_id = $5
            returning ${USER_COLUMNS}
          `,
          [plan, nextCredits, now, user.id, user.tenantId],
        )
        nextUser = userFromRow(updated.rows[0]!)

        if (grant > 0) {
          await client.query(
            `
              insert into ledger_entries (
                id, user_id, tenant_id, amount, balance, type, description, created_at
              )
              values ($1, $2, $3, $4, $5, 'grant', $6, $7)
            `,
            [randomUUID(), user.id, user.tenantId, grant, nextCredits, 'Member monthly credits', now],
          )
        }
      }

      const entries = await recentLedgerEntries(client, nextUser.id, nextUser.tenantId)
      return summaryFor(nextUser, entries)
    })
  }
}

async function readableUser(client: PoolClient, principal: Principal): Promise<StoredUser> {
  const result = await client.query<UserRow>(
    `
      select ${USER_COLUMNS}
      from users
      where id = $1 and tenant_id = $2
    `,
    [principal.userId, principal.tenantId],
  )
  if (!result.rows[0]) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account not found')
  return userFromRow(result.rows[0])
}

async function lockedUser(client: PoolClient, principal: Principal): Promise<StoredUser> {
  const result = await client.query<UserRow>(
    `
      select ${USER_COLUMNS}
      from users
      where id = $1 and tenant_id = $2
      for update
    `,
    [principal.userId, principal.tenantId],
  )
  if (!result.rows[0]) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account not found')
  return userFromRow(result.rows[0])
}

async function recentLedgerEntries(
  client: PoolClient,
  userId: string,
  tenantId: string,
): Promise<LedgerEntry[]> {
  const result = await client.query<LedgerRow>(
    `
      select ${LEDGER_COLUMNS}
      from ledger_entries
      where user_id = $1 and tenant_id = $2
      order by created_at desc, id
      limit 30
    `,
    [userId, tenantId],
  )
  return result.rows.map(ledgerFromRow)
}

function summaryFor(user: StoredUser, entries: LedgerEntry[]): BillingSummary {
  return {
    plan: user.plan,
    credits: user.credits,
    concurrency: user.plan === 'member' ? 3 : 1,
    entries,
  }
}
