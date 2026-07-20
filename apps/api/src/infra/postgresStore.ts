import pg from 'pg'
import type { PoolClient } from 'pg'
import type { AppState, StateStore } from './store.js'
import { loadPostgresState } from './postgresState.js'
import { syncPostgresState } from './postgresWrite.js'

export interface PostgresTransactionRunner {
  withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T>
}

export class PostgresStateStore implements StateStore {
  private readonly pool: pg.Pool

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  async initialize(): Promise<void> {
    await this.pool.query('select 1')
  }

  async read<T>(reader: (state: Readonly<AppState>) => T | Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('set transaction read only')
      const state = await loadPostgresState(client)
      const result = await reader(state)
      await client.query('commit')
      return structuredClone(result)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async mutate<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.withTransaction(async (client) => {
      const previous = await loadPostgresState(client, { lockRows: true })
      const next = structuredClone(previous)
      const result = await mutator(next)
      await syncPostgresState(client, previous, next)
      return structuredClone(result)
    })
  }

  async replace(state: AppState): Promise<void> {
    await this.withTransaction(async (client) => {
      const previous = await loadPostgresState(client, { lockRows: true })
      await syncPostgresState(client, previous, state)
    })
  }

  async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const result = await operation(client)
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
