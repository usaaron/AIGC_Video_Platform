import pg from 'pg'
import type { AppState, StateStore } from './store.js'
import { loadPostgresState } from './postgresState.js'
import { replacePostgresState } from './postgresWrite.js'

const MUTATION_LOCK_NAMESPACE = 91_746
const MUTATION_LOCK_KEY = 240_001

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
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock($1, $2)', [MUTATION_LOCK_NAMESPACE, MUTATION_LOCK_KEY])
      const state = await loadPostgresState(client)
      const result = await mutator(state)
      await replacePostgresState(client, state)
      await client.query('commit')
      return structuredClone(result)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async replace(state: AppState): Promise<void> {
    await this.mutate((current) => {
      current.users = state.users
      current.projects = state.projects
      current.assets = state.assets
      current.shots = state.shots
      current.tasks = state.tasks
      current.ledger = state.ledger
      current.media = state.media
    })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
