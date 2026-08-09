import 'dotenv/config'
import { loadConfig } from '../config.js'
import { AccountDatabase } from '../infra/postgres.js'
import { createBootstrapAccounts, initializeBootstrapAccounts } from './bootstrapAccounts.js'

const productionBootstrapInputKeys = [
  'BOOTSTRAP_MEMBER_EMAIL',
  'BOOTSTRAP_MEMBER_PASSWORD',
  'BOOTSTRAP_OWNER_EMAIL',
  'BOOTSTRAP_OWNER_PASSWORD',
  'BOOTSTRAP_SUPER_ADMIN_EMAIL',
  'BOOTSTRAP_SUPER_ADMIN_PASSWORD',
  'BOOTSTRAP_ADMIN_EMAIL',
  'BOOTSTRAP_ADMIN_PASSWORD',
] as const

const unsafeProductionPasswords = new Set([
  'MemberPassword123!',
  'OwnerPassword123!',
  'SuperAdmin123!',
  'Admin123!',
])

const config = loadConfig()

if (!config.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for pnpm --filter @seqora/api accounts:init')
}

assertSafeAccountInitializationConfig(config, process.env)

const database = new AccountDatabase(config.DATABASE_URL)
const bootstrapAccounts = createBootstrapAccounts(config)
assertBootstrapAccountsAreUnique(bootstrapAccounts)

try {
  await database.ensureLatestMigrations()
  await initializeBootstrapAccounts(database, config)
  process.stdout.write('[accounts:init] bootstrap accounts are initialized\n')
} finally {
  await database.close()
}

function assertSafeAccountInitializationConfig(
  config: ReturnType<typeof loadConfig>,
  environment: NodeJS.ProcessEnv,
): void {
  if (config.NODE_ENV !== 'production') return

  const missing = productionBootstrapInputKeys.filter((key) => !environment[key]?.trim())
  if (missing.length) {
    throw new Error(`[accounts:init] production account initialization requires ${missing.join(', ')}`)
  }

  for (const key of productionBootstrapInputKeys) {
    if (!key.endsWith('_PASSWORD')) continue
    const value = environment[key]?.trim() ?? ''
    if (unsafeProductionPasswords.has(value) || /^replace-with-/i.test(value)) {
      throw new Error(`[accounts:init] ${key} must be a unique production password`)
    }
  }
}

function assertBootstrapAccountsAreUnique(accounts: ReturnType<typeof createBootstrapAccounts>): void {
  const emails = new Set<string>()
  const passwords = new Set<string>()
  for (const account of accounts) {
    const email = account.email.trim().toLowerCase()
    if (emails.has(email)) {
      throw new Error('[accounts:init] bootstrap account emails must be unique')
    }
    emails.add(email)
    if (passwords.has(account.password)) {
      throw new Error('[accounts:init] bootstrap account passwords must be unique')
    }
    passwords.add(account.password)
  }
}
