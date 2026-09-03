import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { Pool as PgPool, PoolClient, QueryResult, QueryResultRow } from 'pg'

const { Pool } = pg as typeof import('pg')

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url))

const schemaMigrationsSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

export type DatabaseMigrationMode = 'migrate' | 'check'

export type DatabaseInitializeOptions = {
  mode?: DatabaseMigrationMode
}

export type AccountDatabaseOptions = {
  max?: number
  min?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
}

export class AccountDatabase {
  private readonly pool: PgPool
  private initialized = false
  private initializePromise: Promise<void> | null = null

  constructor(
    connectionString: string,
    private readonly migrationsPath: string = migrationsDirectory,
    options: AccountDatabaseOptions = {},
  ) {
    this.pool = new Pool({ connectionString, ...options })
  }

  async initialize(options: DatabaseInitializeOptions = {}): Promise<void> {
    if (this.initialized) return
    const mode = options.mode ?? 'migrate'
    this.initializePromise ??= this.runInitialization(mode)
      .then(() => {
        this.initialized = true
      })
      .catch((error) => {
        this.initializePromise = null
        throw error
      })
    await this.initializePromise
  }

  async migrate(): Promise<void> {
    await this.initialize({ mode: 'migrate' })
  }

  async ensureLatestMigrations(): Promise<void> {
    await this.initialize({ mode: 'check' })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as unknown[])
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async withAdvisoryLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect()
    let acquired = false
    try {
      const lock = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [lockKey],
      )
      acquired = lock.rows[0]?.acquired === true
      if (!acquired) return null
      return await operation()
    } finally {
      if (acquired) {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch((error: unknown) => {
          process.emitWarning(
            `Failed to release Postgres advisory lock ${lockKey}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { code: 'SEQORA_POSTGRES_ADVISORY_LOCK_RELEASE_FAILED' },
          )
        })
      }
      client.release()
    }
  }

  private async runInitialization(mode: DatabaseMigrationMode): Promise<void> {
    if (mode === 'migrate') {
      await this.runPendingMigrations()
      return
    }
    await this.verifyNoPendingMigrations()
  }

  private async runPendingMigrations(): Promise<void> {
    const migrations = await loadMigrationFiles(this.migrationsPath)
    await this.ensureSchemaMigrationsTable()
    const appliedNames = await this.loadAppliedMigrationNames()

    for (const migration of migrations) {
      if (appliedNames.has(migration.name)) continue
      await this.applyMigration(migration)
    }
  }

  private async verifyNoPendingMigrations(): Promise<void> {
    const migrations = await loadMigrationFiles(this.migrationsPath)
    const appliedNames = await this.loadAppliedMigrationNames()
    const pending = migrations.filter((migration) => !appliedNames.has(migration.name))
    if (pending.length) {
      throw new Error(
        [
          `Pending Postgres migrations: ${pending.map((migration) => migration.name).join(', ')}`,
          'Run `pnpm --filter @seqora/api db:migrate` before starting the production API.',
        ].join('. '),
      )
    }
  }

  private async ensureSchemaMigrationsTable(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(schemaMigrationsSql)
    })
  }

  private async loadAppliedMigrationNames(): Promise<Set<string>> {
    const table = await this.query<{ table_name: string | null }>(
      "SELECT to_regclass('schema_migrations')::text AS table_name",
    )
    if (!table.rows[0]?.table_name) {
      throw new Error(
        'Postgres schema_migrations table is missing. Run `pnpm --filter @seqora/api db:migrate` before starting the production API.',
      )
    }

    const applied = await this.query<{ name: string }>('SELECT name FROM schema_migrations')
    return new Set(applied.rows.map((row) => row.name))
  }

  private async applyMigration(migration: MigrationFile): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(migration.sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name])
    })
  }
}

type MigrationFile = {
  name: string
  sql: string
}

async function loadMigrationFiles(migrationsPath: string): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsPath, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en-US'))

  if (!names.length) {
    throw new Error(`No Postgres migration files found in ${migrationsPath}`)
  }

  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(join(migrationsPath, name), 'utf8'),
    })),
  )
}
