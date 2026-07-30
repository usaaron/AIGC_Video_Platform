import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url))

const schemaMigrationsSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

export class AccountDatabase {
  private readonly pool: Pool
  private initialized = false
  private initializePromise: Promise<void> | null = null

  constructor(
    connectionString: string,
    private readonly migrationsPath: string = migrationsDirectory,
  ) {
    this.pool = new Pool({ connectionString })
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initializePromise ??= this.runPendingMigrations()
      .then(() => {
        this.initialized = true
      })
      .catch((error) => {
        this.initializePromise = null
        throw error
      })
    await this.initializePromise
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

  private async runPendingMigrations(): Promise<void> {
    const migrations = await loadMigrationFiles(this.migrationsPath)
    await this.transaction(async (client) => {
      await client.query(schemaMigrationsSql)
      const applied = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
      const appliedNames = new Set(applied.rows.map((row) => row.name))

      for (const migration of migrations) {
        if (appliedNames.has(migration.name)) continue
        await client.query(migration.sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name])
      }
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
