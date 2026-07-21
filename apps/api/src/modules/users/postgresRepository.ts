import type { Account } from '@seqora/contracts'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import { USER_COLUMNS, userFromRow, type UserRow } from '../../infra/postgresRows.js'
import type { StoredUser } from '../../infra/store.js'
import type { UserReader } from './repository.js'

export class PostgresUserRepository implements UserReader {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async findByEmail(email: string): Promise<StoredUser | null> {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query<UserRow>(
        `
          select ${USER_COLUMNS}
          from users
          where lower(email) = lower($1)
          order by created_at, id
          limit 1
        `,
        [email],
      )
      return result.rows[0] ? userFromRow(result.rows[0]) : null
    })
  }

  async findById(id: string): Promise<StoredUser | null> {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query<UserRow>(
        `
          select ${USER_COLUMNS}
          from users
          where id = $1
        `,
        [id],
      )
      return result.rows[0] ? userFromRow(result.rows[0]) : null
    })
  }

  toAccount(user: StoredUser): Account {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      roles: user.roles,
      plan: user.plan,
      credits: user.credits,
    }
  }
}
