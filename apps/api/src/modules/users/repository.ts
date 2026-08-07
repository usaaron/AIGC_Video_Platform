import type { Account, Plan, Role } from '@seqora/contracts'
import type { AppStore, StoredUser } from '../../infra/store.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type {
  AuditLogInput,
  AuthAccounts,
  EmailVerificationTokenInput,
  EmailVerificationTokenResult,
  PasswordResetTokenInput,
  PasswordResetTokenResult,
  ResetPasswordTokenInput,
  SessionMetadata,
  VerifyEmailTokenInput,
} from '../auth/accounts.js'

export type StoredSession = {
  sessionId: string
  userId: string
  tenantId: string
  roles: Role[]
  tokenSecretHash: string
  expiresAt: string
  revokedAt: string | null
  passwordResetRequired: boolean
  emailVerified: boolean
}

type BillingAccount = {
  plan: Plan
  credits: number
}

type AccountSeed = {
  id: string
  name: string
  email: string
  passwordHash: string
  tenantId: string
  roles: Role[]
  plan: Plan
  credits: number
}

const systemTenantId = 'tenant-seqora-demo'

export class UserRepository implements AuthAccounts {
  constructor(
    private readonly store: AppStore | null,
    private readonly database: AccountDatabase | null = null,
  ) {}

  get hasDatabase(): boolean {
    return this.database !== null
  }

  async bootstrapFromStore(): Promise<void> {
    if (!this.database || !this.store) return
    const users = this.store.read((state) => state.users)
    if (!users.length) return

    await this.database.transaction(async (client) => {
      for (const user of users) {
        const seed = user as AccountSeed
        const userId = seed.id
        const membershipId = membershipIdFor(seed.id, seed.tenantId)
        const isSystemOrganization = seed.tenantId === systemTenantId
        const organizationType = isSystemOrganization
          ? 'system'
          : seed.roles.some((role) =>
              ['owner', 'super_admin', 'admin', 'organization_admin', 'organization_member'].includes(role),
            )
            ? 'enterprise'
            : 'personal'
        await client.query(
          `
          INSERT INTO users (id, display_name, status, created_at, updated_at)
          VALUES ($1, $2, 'active', now(), now())
          ON CONFLICT (id) DO NOTHING
        `,
          [userId, seed.name],
        )
        await client.query(
          `
          INSERT INTO auth_identities (
            id, user_id, provider, provider_subject, email, password_hash, is_primary, status,
            email_verified_at, email_verification_status, created_at, updated_at
          )
          VALUES ($1, $2, 'local', $3, $4, $5, true, 'active', now(), 'verified', now(), now())
          ON CONFLICT (id) DO NOTHING
        `,
          [
            authIdentityIdFor(userId),
            userId,
            seed.email.toLowerCase(),
            seed.email.toLowerCase(),
            seed.passwordHash,
          ],
        )
        await client.query(
          `
          INSERT INTO tenants (id, name, status, created_by_user_id, is_system, organization_type, created_at, updated_at)
          VALUES ($1, $2, 'active', $3, $4, $5, now(), now())
          ON CONFLICT (id) DO NOTHING
        `,
          [seed.tenantId, seed.tenantId, userId, isSystemOrganization, organizationType],
        )
        await client.query(
          `
          INSERT INTO tenant_memberships (
            id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, true, 'active', now(), now())
          ON CONFLICT (id) DO NOTHING
        `,
          [membershipId, seed.tenantId, userId, seed.roles],
        )
        await client.query(
          `
          INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
          VALUES ($1, $2, $3, now(), now())
          ON CONFLICT (membership_id) DO NOTHING
        `,
          [membershipId, seed.plan, seed.credits],
        )
      }
    })
  }

  async refreshRuntimeCacheFromDatabase(): Promise<void> {
    if (!this.database || !this.store) return
    const result = await this.database.query<StoredUserRow>(
      `
      SELECT
        u.id AS id,
        COALESCE(ai.email, '') AS email,
        u.display_name AS name,
        ai.password_hash AS password_hash,
        m.tenant_id AS tenant_id,
        m.roles AS roles,
        b.plan AS plan,
        b.credits AS credits,
        u.password_reset_required AS password_reset_required,
        COALESCE(ai.email_verification_status = 'verified', false) AS email_verified
      FROM users u
      JOIN tenant_memberships m ON m.user_id = u.id AND m.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
      JOIN billing_accounts b ON b.membership_id = m.id
      LEFT JOIN LATERAL (
        SELECT email, password_hash, email_verification_status
        FROM auth_identities ai
        WHERE ai.user_id = u.id
          AND ai.provider = 'local'
          AND ai.status = 'active'
        ORDER BY ai.is_primary DESC, ai.created_at ASC
        LIMIT 1
      ) ai ON true
      WHERE u.status = 'active'
      ORDER BY m.created_at ASC, u.id ASC
      `,
    )
    const ledger = this.store.read((state) => state.ledger)
    this.store.replaceAccountRuntimeCache({ users: result.rows.map(toStoredUser), ledger })
  }

  async findByEmail(email: string): Promise<StoredUser | null> {
    const normalized = email.toLowerCase()
    if (!this.database) {
      return this.requireStore().read(
        (state) => state.users.find((user) => user.email === normalized) ?? null,
      )
    }

    const result = await this.database.query<StoredUserRow>(
      `
      SELECT
        u.id AS id,
        ai.email AS email,
        u.display_name AS name,
        ai.password_hash AS password_hash,
        m.tenant_id AS tenant_id,
        m.roles AS roles,
        b.plan AS plan,
        b.credits AS credits,
        u.password_reset_required AS password_reset_required,
        COALESCE(ai.email_verification_status = 'verified', false) AS email_verified
      FROM auth_identities ai
      JOIN users u ON u.id = ai.user_id AND u.status = 'active'
      JOIN tenant_memberships m ON m.user_id = u.id AND m.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
      JOIN billing_accounts b ON b.membership_id = m.id
      WHERE ai.provider = 'local'
        AND lower(ai.email) = lower($1)
        AND ai.status = 'active'
        AND ai.password_hash IS NOT NULL
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1
      `,
      [normalized],
    )
    return result.rows[0] ? toStoredUser(result.rows[0]) : null
  }

  async findById(id: string, tenantId?: string): Promise<StoredUser | null> {
    if (!this.database) {
      return this.requireStore().read(
        (state) =>
          state.users.find((user) => user.id === id && (tenantId ? user.tenantId === tenantId : true)) ??
          null,
      )
    }

    const result = await this.database.query<StoredUserRow>(
      `
      SELECT
        u.id AS id,
        ai.email AS email,
        u.display_name AS name,
        ai.password_hash AS password_hash,
        m.tenant_id AS tenant_id,
        m.roles AS roles,
        b.plan AS plan,
        b.credits AS credits,
        u.password_reset_required AS password_reset_required,
        COALESCE(ai.email_verification_status = 'verified', false) AS email_verified
      FROM users u
      JOIN tenant_memberships m ON m.user_id = u.id AND m.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
      JOIN billing_accounts b ON b.membership_id = m.id
      LEFT JOIN LATERAL (
        SELECT email, password_hash, email_verification_status
        FROM auth_identities ai
        WHERE ai.user_id = u.id
          AND ai.provider = 'local'
          AND ai.status = 'active'
        ORDER BY ai.is_primary DESC, ai.created_at ASC
        LIMIT 1
      ) ai ON true
      WHERE u.id = $1
        AND u.status = 'active'
        AND ($2::text IS NULL OR m.tenant_id = $2)
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1
      `,
      [id, tenantId ?? null],
    )
    return result.rows[0] ? toStoredUser(result.rows[0]) : null
  }

  async updatePassword(userId: string, tenantId: string, passwordHash: string): Promise<boolean> {
    if (!this.database) {
      return this.requireStore().mutate((state) => {
        const user = state.users.find((item) => item.id === userId && item.tenantId === tenantId)
        if (!user) return false
        user.passwordHash = passwordHash
        user.passwordResetRequired = false
        return true
      })
    }

    const result = await this.database.transaction(async (client) => {
      const target = await client.query<{ id: string }>(
        `
        SELECT ai.id
        FROM auth_identities ai
        JOIN users u ON u.id = ai.user_id AND u.status = 'active'
        JOIN tenant_memberships m ON m.user_id = ai.user_id
        JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
        WHERE ai.user_id = $1
          AND m.tenant_id = $2
          AND m.status = 'active'
          AND ai.provider = 'local'
          AND ai.status = 'active'
        ORDER BY ai.is_primary DESC, ai.created_at ASC
        LIMIT 1
        `,
        [userId, tenantId],
      )
      const identityId = target.rows[0]?.id
      if (!identityId) return false
      const updated = await client.query(
        `
        UPDATE auth_identities
        SET password_hash = $2,
            updated_at = now()
        WHERE id = $1
        `,
        [identityId, passwordHash],
      )
      await client.query(
        `
        UPDATE users
        SET password_reset_required = false,
            password_reset_required_at = NULL,
            password_reset_required_by_user_id = NULL,
            updated_at = now()
        WHERE id = $1
        `,
        [userId],
      )
      return (updated.rowCount ?? 0) > 0
    })

    return result
  }

  async findBillingAccount(userId: string, tenantId: string): Promise<BillingAccount | null> {
    if (!this.database) {
      return this.requireStore().read((state) => {
        const user = state.users.find((item) => item.id === userId && item.tenantId === tenantId)
        return user ? { plan: user.plan, credits: user.credits } : null
      })
    }

    const result = await this.database.query<BillingAccountRow>(
      `
      SELECT b.plan, b.credits
      FROM billing_accounts b
      JOIN tenant_memberships m ON m.id = b.membership_id
      JOIN users u ON u.id = m.user_id AND u.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
      WHERE m.user_id = $1
        AND m.tenant_id = $2
        AND m.status = 'active'
      LIMIT 1
      `,
      [userId, tenantId],
    )
    return result.rows[0] ? { plan: result.rows[0].plan, credits: result.rows[0].credits } : null
  }

  async adjustBillingCredits(
    userId: string,
    tenantId: string,
    delta: number,
  ): Promise<BillingAccount | null> {
    if (!this.database) {
      return this.requireStore().mutate((state) => {
        const user = state.users.find((item) => item.id === userId && item.tenantId === tenantId)
        if (!user) return null
        const nextCredits = user.credits + delta
        if (nextCredits < 0) return null
        user.credits = nextCredits
        return { plan: user.plan, credits: user.credits }
      })
    }

    const result = await this.database.transaction(async (client) => {
      const updated = await client.query<BillingAccountRow>(
        `
        UPDATE billing_accounts b
        SET credits = b.credits + $3,
            updated_at = now()
        FROM tenant_memberships m
        JOIN users u ON u.id = m.user_id AND u.status = 'active'
        JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
        WHERE b.membership_id = m.id
          AND m.user_id = $1
          AND m.tenant_id = $2
          AND m.status = 'active'
          AND b.credits + $3 >= 0
        RETURNING b.plan, b.credits
        `,
        [userId, tenantId, delta],
      )
      return updated.rows[0] ? { plan: updated.rows[0].plan, credits: updated.rows[0].credits } : null
    })

    return result
  }

  async setBillingPlan(userId: string, tenantId: string, plan: Plan): Promise<BillingAccount | null> {
    if (!this.database) {
      return this.requireStore().mutate((state) => {
        const user = state.users.find((item) => item.id === userId && item.tenantId === tenantId)
        if (!user) return null
        user.plan = plan
        return { plan: user.plan, credits: user.credits }
      })
    }

    const result = await this.database.transaction(async (client) => {
      const updated = await client.query<BillingAccountRow>(
        `
        UPDATE billing_accounts b
        SET plan = $3,
            updated_at = now()
        FROM tenant_memberships m
        JOIN users u ON u.id = m.user_id AND u.status = 'active'
        JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
        WHERE b.membership_id = m.id
          AND m.user_id = $1
          AND m.tenant_id = $2
          AND m.status = 'active'
        RETURNING b.plan, b.credits
        `,
        [userId, tenantId, plan],
      )
      return updated.rows[0] ? { plan: updated.rows[0].plan, credits: updated.rows[0].credits } : null
    })

    return result
  }

  async createSession(
    userId: string,
    tenantId: string,
    sessionId: string,
    tokenSecretHash: string,
    expiresAt: string,
    metadata?: SessionMetadata,
  ): Promise<boolean> {
    if (!this.database) return true

    return this.database.transaction(async (client) => {
      const membership = await resolveMembership(client, userId, tenantId)
      if (!membership) return false
      const result = await client.query(
        `
        INSERT INTO sessions (
          id, membership_id, token_secret_hash, expires_at, revoked_at, created_at, last_seen_at,
          ip_address, user_agent, device_label
        )
        VALUES ($1, $2, $3, $4, NULL, now(), now(), $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
        `,
        [
          sessionId,
          membership.id,
          tokenSecretHash,
          expiresAt,
          metadata?.ipAddress ?? null,
          metadata?.userAgent ?? null,
          metadata?.deviceLabel ?? null,
        ],
      )
      return (result.rowCount ?? 0) > 0
    })
  }

  async createPasswordResetToken(_input: PasswordResetTokenInput): Promise<PasswordResetTokenResult | null> {
    return null
  }

  async resetPasswordWithToken(_input: ResetPasswordTokenInput): Promise<boolean> {
    return false
  }

  async createEmailVerificationToken(
    _input: EmailVerificationTokenInput,
  ): Promise<EmailVerificationTokenResult | null> {
    return null
  }

  async verifyEmailWithToken(_input: VerifyEmailTokenInput): Promise<boolean> {
    return false
  }

  async recordAuditLog(_input: AuditLogInput): Promise<void> {}

  async resolveSession(sessionId: string): Promise<StoredSession | null> {
    if (!this.database) return null

    const result = await this.database.query<StoredSessionRow>(
      `
      SELECT
        s.id AS session_id,
        m.user_id AS user_id,
        m.tenant_id AS tenant_id,
        m.roles AS roles,
        u.password_reset_required AS password_reset_required,
        COALESCE(ai.email_verification_status = 'verified', false) AS email_verified,
        s.token_secret_hash AS token_secret_hash,
        s.expires_at AS expires_at,
        s.revoked_at AS revoked_at
      FROM sessions s
      JOIN tenant_memberships m ON m.id = s.membership_id
      JOIN users u ON u.id = m.user_id AND u.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
      LEFT JOIN LATERAL (
        SELECT email_verification_status
        FROM auth_identities ai
        WHERE ai.user_id = u.id
          AND ai.provider = 'local'
          AND ai.status = 'active'
        ORDER BY ai.is_primary DESC, ai.created_at ASC
        LIMIT 1
      ) ai ON true
      WHERE s.id = $1
        AND m.status = 'active'
      LIMIT 1
      `,
      [sessionId],
    )
    return result.rows[0] ? toStoredSession(result.rows[0]) : null
  }

  async touchSession(sessionId: string): Promise<void> {
    if (!this.database) return
    await this.database.query(
      `
      UPDATE sessions
      SET last_seen_at = now()
      WHERE id = $1
      `,
      [sessionId],
    )
  }

  async revokeSession(sessionId: string): Promise<void> {
    if (!this.database) return
    await this.database.query(
      `
      UPDATE sessions
      SET revoked_at = now()
      WHERE id = $1
      `,
      [sessionId],
    )
  }

  async revokeSessionsForUser(userId: string, tenantId: string): Promise<void> {
    if (!this.database) return
    await this.database.query(
      `
      UPDATE sessions s
      SET revoked_at = now()
      FROM tenant_memberships m
      WHERE s.membership_id = m.id
        AND m.user_id = $1
        AND m.tenant_id = $2
        AND s.revoked_at IS NULL
      `,
      [userId, tenantId],
    )
  }

  toAccount(user: StoredUser): Account {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      organizationId: user.tenantId,
      roles: user.roles,
      plan: user.plan,
      credits: user.credits,
      passwordResetRequired: user.passwordResetRequired ?? false,
      emailVerified: user.emailVerified ?? true,
    }
  }

  private requireStore(): AppStore {
    if (!this.store) {
      throw new Error('JSON AppStore is unavailable; UserRepository must use Postgres in runtime')
    }
    return this.store
  }
}

function membershipIdFor(userId: string, tenantId: string): string {
  return `membership-${tenantId}-${userId}`
}

function authIdentityIdFor(userId: string): string {
  return `identity-${userId}`
}

async function resolveMembership(
  client: {
    query<T extends { [key: string]: unknown } = { [key: string]: unknown }>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }>
  },
  userId: string,
  tenantId: string,
): Promise<{ id: string } | null> {
  const result = await client.query<{ id: string }>(
    `
    SELECT m.id
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
    WHERE m.user_id = $1
      AND m.tenant_id = $2
      AND m.status = 'active'
    LIMIT 1
    `,
    [userId, tenantId],
  )
  return result.rows[0] ?? null
}

type StoredUserRow = {
  id: string
  email: string
  name: string
  password_hash: string | null
  tenant_id: string
  roles: Role[]
  plan: Plan
  credits: number
  password_reset_required: boolean
  email_verified: boolean
}

type BillingAccountRow = {
  plan: Plan
  credits: number
}

type StoredSessionRow = {
  session_id: string
  user_id: string
  tenant_id: string
  roles: Role[]
  password_reset_required: boolean
  email_verified: boolean
  token_secret_hash: string
  expires_at: string
  revoked_at: string | null
}

function toStoredUser(row: StoredUserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash ?? '',
    tenantId: row.tenant_id,
    roles: row.roles,
    plan: row.plan,
    credits: row.credits,
    passwordResetRequired: row.password_reset_required ?? false,
    emailVerified: row.email_verified ?? false,
  }
}

function toStoredSession(row: StoredSessionRow): StoredSession {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    roles: row.roles,
    passwordResetRequired: row.password_reset_required ?? false,
    emailVerified: row.email_verified ?? false,
    tokenSecretHash: row.token_secret_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
}
