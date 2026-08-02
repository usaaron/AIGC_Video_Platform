import 'dotenv/config'
import { loadConfig } from '../config.js'
import { hashPassword } from '../core/auth/password.js'
import { AccountDatabase } from '../infra/postgres.js'
import {
  bootstrapIdentityId,
  bootstrapMembershipId,
  createBootstrapAccounts,
  systemTenantId,
} from './bootstrapAccounts.js'

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
const now = new Date().toISOString()
const bootstrapAccounts = createBootstrapAccounts(config)
assertBootstrapAccountsAreUnique(bootstrapAccounts)

try {
  await database.ensureLatestMigrations()
  await database.transaction(async (client) => {
    await client.query(
      `
      INSERT INTO tenants (id, name, status, is_system, created_at, updated_at)
      VALUES ($1, 'Seqora Local', 'active', true, $2, $2)
      ON CONFLICT (id) DO NOTHING
      `,
      [systemTenantId, now],
    )

    for (const account of bootstrapAccounts) {
      const normalizedEmail = account.email.toLowerCase()
      const membershipId = bootstrapMembershipId(account.id)
      await client.query(
        `
        INSERT INTO users (id, display_name, status, created_at, updated_at)
        VALUES ($1, $2, 'active', $3, $3)
        ON CONFLICT (id) DO NOTHING
        `,
        [account.id, account.name, now],
      )
      await client.query(
        `
        INSERT INTO auth_identities (
          id,
          user_id,
          provider,
          provider_subject,
          email,
          password_hash,
          is_primary,
          status,
          email_verified_at,
          email_verification_status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, 'local', $3, $3, $4, true, 'active', $5, 'verified', $5, $5)
        ON CONFLICT (id) DO NOTHING
        `,
        [bootstrapIdentityId(account.id), account.id, normalizedEmail, hashPassword(account.password), now],
      )
      await client.query(
        `
        INSERT INTO tenant_memberships (
          id,
          tenant_id,
          user_id,
          roles,
          is_primary,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, true, 'active', $5, $5)
        ON CONFLICT (id) DO NOTHING
        `,
        [membershipId, systemTenantId, account.id, account.roles, now],
      )
      await client.query(
        `
        INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT (membership_id) DO NOTHING
        `,
        [membershipId, account.plan, account.credits, now],
      )
    }

    const memberAccount = bootstrapAccounts.find((account) => account.id === 'user-member')!
    await client.query(
      `
      INSERT INTO billing_ledger_entries (
        id,
        tenant_id,
        user_id,
        membership_id,
        reference_id,
        related_entry_id,
        entry_type,
        amount,
        balance,
        description,
        created_by_user_id,
        created_at,
        updated_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $1, NULL, 'grant', $5, $5, 'New account trial credits', $3, $6, $6, '{}'::jsonb)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        'ledger-initial',
        systemTenantId,
        memberAccount.id,
        bootstrapMembershipId(memberAccount.id),
        memberAccount.credits,
        now,
      ],
    )
  })
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
