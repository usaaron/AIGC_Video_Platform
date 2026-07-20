import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'

export type MigrationResult = {
  applied: string[]
  skipped: string[]
}

export async function runMigrations(databaseUrl: string, migrationsDir: string): Promise<MigrationResult> {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const client = await pool.connect()
  try {
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()
    const applied: string[] = []
    const skipped: string[] = []

    for (const file of files) {
      const existing = await client.query('select 1 from schema_migrations where id = $1', [file])
      if (existing.rowCount) {
        skipped.push(file)
        continue
      }

      const sql = await readFile(join(migrationsDir, file), 'utf8')
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into schema_migrations (id) values ($1)', [file])
        await client.query('commit')
        applied.push(file)
      } catch (error) {
        await client.query('rollback')
        throw error
      }
    }

    return { applied, skipped }
  } finally {
    client.release()
    await pool.end()
  }
}
