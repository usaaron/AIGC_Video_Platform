import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../testing/postgresAuth.js'
import { AccountDatabase } from './postgres.js'

let postgres: PostgresAuthFixture | undefined

beforeAll(async () => {
  postgres = await startPostgresAuthFixture()
}, 120_000)

afterAll(async () => {
  await postgres?.close()
})

describe('postgres migrations', () => {
  it('checks pending migrations without applying them', async () => {
    const suffix = uniqueSuffix()
    const tableName = `migration_check_${suffix}`
    const migrationName = `900_${suffix}_check.sql`
    const migrationsPath = await createMigrationDirectory({
      [migrationName]: `CREATE TABLE ${tableName} (id TEXT PRIMARY KEY);`,
    })
    const database = await createDatabase(migrationsPath)

    try {
      await expect(database.ensureLatestMigrations()).rejects.toThrow(
        `Pending Postgres migrations: ${migrationName}`,
      )

      const table = await database.query<{ table_name: string | null }>(
        `SELECT to_regclass('public.${tableName}')::text AS table_name`,
      )
      expect(table.rows[0]?.table_name).toBeNull()
    } finally {
      await database.close()
      await rm(migrationsPath, { recursive: true, force: true })
    }
  })

  it('wraps each migration file in its own transaction', async () => {
    const suffix = uniqueSuffix()
    const okTableName = `migration_ok_${suffix}`
    const failedTableName = `migration_failed_${suffix}`
    const okMigrationName = `900_${suffix}_ok.sql`
    const failedMigrationName = `901_${suffix}_failed.sql`
    const migrationsPath = await createMigrationDirectory({
      [okMigrationName]: `
        CREATE TABLE ${okTableName} (id TEXT PRIMARY KEY);
        INSERT INTO ${okTableName} (id) VALUES ('ok');
      `,
      [failedMigrationName]: `
        CREATE TABLE ${failedTableName} (id TEXT PRIMARY KEY);
        INSERT INTO definitely_missing_migration_table (id) VALUES ('failed');
      `,
    })
    const database = await createDatabase(migrationsPath)

    try {
      await expect(database.migrate()).rejects.toThrow()

      const tables = await database.query<{
        ok_table_name: string | null
        failed_table_name: string | null
      }>(
        `
        SELECT
          to_regclass('public.${okTableName}')::text AS ok_table_name,
          to_regclass('public.${failedTableName}')::text AS failed_table_name
        `,
      )
      expect(tables.rows[0]).toEqual({
        ok_table_name: okTableName,
        failed_table_name: null,
      })

      const applied = await database.query<{ name: string }>(
        `
        SELECT name
        FROM schema_migrations
        WHERE name = ANY($1)
        ORDER BY name
        `,
        [[okMigrationName, failedMigrationName]],
      )
      expect(applied.rows).toEqual([{ name: okMigrationName }])
    } finally {
      await database.close()
      await rm(migrationsPath, { recursive: true, force: true })
    }
  })
})

async function createDatabase(migrationsPath: string): Promise<AccountDatabase> {
  if (!postgres) throw new Error('Postgres fixture is not ready')
  return new AccountDatabase(postgres.connectionString, migrationsPath)
}

async function createMigrationDirectory(files: Record<string, string>): Promise<string> {
  const migrationsPath = await mkdtemp(join(tmpdir(), 'seqora-migrations-'))
  await Promise.all(
    Object.entries(files).map(([name, sql]) => writeFile(join(migrationsPath, name), sql, 'utf8')),
  )
  return migrationsPath
}

function uniqueSuffix(): string {
  return randomUUID().replaceAll('-', '')
}
