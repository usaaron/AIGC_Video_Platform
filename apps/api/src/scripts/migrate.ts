import 'dotenv/config'
import { resolve } from 'node:path'
import { runMigrations } from '../infra/postgresMigrations.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const migrationsDir = resolve(process.cwd(), 'migrations')
const result = await runMigrations(databaseUrl, migrationsDir)

process.stdout.write(
  `PostgreSQL migrations complete. applied=${result.applied.length} skipped=${result.skipped.length}`,
)
process.stdout.write('\n')
for (const migration of result.applied) process.stdout.write(`applied ${migration}\n`)
