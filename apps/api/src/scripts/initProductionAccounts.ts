import 'dotenv/config'
import { loadConfig } from '../config.js'
import { AccountDatabase } from '../infra/postgres.js'
import { StoreCreditLedger } from '../modules/billing/creditLedger.js'
import { UserRepository } from '../modules/users/repository.js'
import { createRuntimeStore } from '../runtime/database.js'

const config = loadConfig()

if (!config.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for pnpm --filter @seqora/api accounts:init')
}

const store = createRuntimeStore(config)
await store.initialize()

const database = new AccountDatabase(config.DATABASE_URL)

try {
  await database.migrate()
  const users = new UserRepository(store, database)
  await users.bootstrapFromStore()
  const ledger = new StoreCreditLedger(store, users, false, database)
  await ledger.bootstrapFromStore()
  process.stdout.write('[accounts:init] bootstrap accounts are initialized\n')
} finally {
  await database.close()
}

