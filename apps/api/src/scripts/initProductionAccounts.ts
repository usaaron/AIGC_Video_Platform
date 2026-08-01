import 'dotenv/config'
import type { Plan, Role } from '@seqora/contracts'
import { loadConfig } from '../config.js'
import { hashPassword } from '../core/auth/password.js'
import { AccountDatabase } from '../infra/postgres.js'

const config = loadConfig()

if (!config.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for pnpm --filter @seqora/api accounts:init')
}

const database = new AccountDatabase(config.DATABASE_URL)
const systemTenantId = 'tenant-seqora-demo'
const now = new Date().toISOString()

const bootstrapAccounts: BootstrapAccount[] = [
  {
    id: 'user-member',
    name: config.BOOTSTRAP_MEMBER_NAME,
    email: config.BOOTSTRAP_MEMBER_EMAIL,
    password: config.BOOTSTRAP_MEMBER_PASSWORD,
    roles: ['member'],
    plan: 'free',
    credits: 286,
  },
  {
    id: 'user-owner',
    name: config.BOOTSTRAP_OWNER_NAME,
    email: config.BOOTSTRAP_OWNER_EMAIL,
    password: config.BOOTSTRAP_OWNER_PASSWORD,
    roles: ['owner'],
    plan: 'member',
    credits: 1_000,
  },
  {
    id: 'user-super-admin',
    name: config.BOOTSTRAP_SUPER_ADMIN_NAME,
    email: config.BOOTSTRAP_SUPER_ADMIN_EMAIL,
    password: config.BOOTSTRAP_SUPER_ADMIN_PASSWORD,
    roles: ['super_admin'],
    plan: 'member',
    credits: 1_000,
  },
  {
    id: 'user-admin',
    name: config.BOOTSTRAP_ADMIN_NAME,
    email: config.BOOTSTRAP_ADMIN_EMAIL,
    password: config.BOOTSTRAP_ADMIN_PASSWORD,
    roles: ['admin'],
    plan: 'member',
    credits: 1_000,
  },
]

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
      const membershipId = membershipIdFor(account.id, systemTenantId)
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
        [authIdentityIdFor(account.id), account.id, normalizedEmail, hashPassword(account.password), now],
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
        membershipIdFor(memberAccount.id, systemTenantId),
        memberAccount.credits,
        now,
      ],
    )
  })
  process.stdout.write('[accounts:init] bootstrap accounts are initialized\n')
} finally {
  await database.close()
}

type BootstrapAccount = {
  id: string
  name: string
  email: string
  password: string
  roles: Role[]
  plan: Plan
  credits: number
}

function membershipIdFor(userId: string, tenantId: string): string {
  return `membership-${tenantId}-${userId}`
}

function authIdentityIdFor(userId: string): string {
  return `identity-${userId}`
}
