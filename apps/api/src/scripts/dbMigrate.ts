import 'dotenv/config'
import { loadConfig } from '../config.js'
import { AccountDatabase } from '../infra/postgres.js'

const config = loadConfig()

if (!config.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for pnpm --filter @seqora/api db:migrate')
}

const database = new AccountDatabase(config.DATABASE_URL)

try {
  await database.migrate()
  process.stdout.write('[db:migrate] migrations are up to date\n')
} finally {
  await database.close()
}
