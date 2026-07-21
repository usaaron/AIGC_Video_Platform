import type { AdminOverview } from '@seqora/contracts'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import type { StateStore } from '../../infra/store.js'

export interface AdminOverviewStore {
  overview(): Promise<AdminOverview>
}

export class StoreAdminRepository implements AdminOverviewStore {
  constructor(private readonly store: StateStore) {}

  async overview(): Promise<AdminOverview> {
    return this.store.read((state) => {
      const today = new Date().toISOString().slice(0, 10)
      return {
        users: state.users.length,
        activeTasks: state.tasks.filter((task) => task.status === 'queued' || task.status === 'running')
          .length,
        creditsConsumedToday: Math.abs(
          state.ledger
            .filter((entry) => entry.type === 'generation' && entry.createdAt.startsWith(today))
            .reduce((total, entry) => total + entry.amount, 0),
        ),
        generatedAt: new Date().toISOString(),
      }
    })
  }
}

export class PostgresAdminRepository implements AdminOverviewStore {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async overview(): Promise<AdminOverview> {
    return this.transactions.withTransaction(async (client) => {
      const today = new Date().toISOString().slice(0, 10)
      const users = await client.query<{ count: string }>('select count(*)::text as count from users')
      const activeTasks = await client.query<{ count: string }>(
        `
          select count(*)::text as count
          from generation_tasks
          where status in ('queued', 'running')
        `,
      )
      const credits = await client.query<{ total: string | null }>(
        `
          select coalesce(sum(amount), 0)::text as total
          from ledger_entries
          where type = 'generation' and created_at >= $1::date
        `,
        [today],
      )

      return {
        users: Number(users.rows[0]?.count ?? 0),
        activeTasks: Number(activeTasks.rows[0]?.count ?? 0),
        creditsConsumedToday: Math.abs(Number(credits.rows[0]?.total ?? 0)),
        generatedAt: new Date().toISOString(),
      }
    })
  }
}
