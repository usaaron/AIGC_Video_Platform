import type { Account } from '@seqora/contracts'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AuthAccount, AuthAccounts, AuthSession } from './accounts.js'

export class AuthRepository implements AuthAccounts {
  readonly hasDatabase = true

  constructor(private readonly database: AccountDatabase) {}

  async findByEmail(email: string): Promise<AuthAccount | null> {
    const normalized = email.toLowerCase()
    const result = await this.database.query<AuthAccountRow>(
      `
      SELECT
        u.id AS id,
        ai.email AS email,
        u.display_name AS name,
        ai.password_hash AS password_hash,
        m.tenant_id AS tenant_id,
        m.roles AS roles,
        b.plan AS plan,
        b.credits AS credits
      FROM auth_identities ai
      JOIN users u ON u.id = ai.user_id
      JOIN tenant_memberships m ON m.user_id = u.id AND m.status = 'active'
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
    return result.rows[0] ? toAuthAccount(result.rows[0]) : null
  }

  async findById(id: string, tenantId?: string): Promise<AuthAccount | null> {
    const result = await this.database.query<AuthAccountRow>(
      `
      SELECT
        u.id AS id,
        ai.email AS email,
        u.display_name AS name,
        ai.password_hash AS password_hash,
        m.tenant_id AS tenant_id,
        m.roles AS roles,
        b.plan AS plan,
        b.credits AS credits
      FROM users u
      JOIN tenant_memberships m ON m.user_id = u.id AND m.status = 'active'
      JOIN billing_accounts b ON b.membership_id = m.id
      LEFT JOIN LATERAL (
        SELECT email, password_hash
        FROM auth_identities ai
        WHERE ai.user_id = u.id
          AND ai.provider = 'local'
          AND ai.status = 'active'
        ORDER BY ai.is_primary DESC, ai.created_at ASC
        LIMIT 1
      ) ai ON true
      WHERE u.id = $1
        AND ($2::text IS NULL OR m.tenant_id = $2)
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1
      `,
      [id, tenantId ?? null],
    )
    return result.rows[0] ? toAuthAccount(result.rows[0]) : null
  }

  async updatePassword(userId: string, tenantId: string, passwordHash: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const target = await client.query<{ id: string }>(
        `
        SELECT ai.id
        FROM auth_identities ai
        JOIN tenant_memberships m ON m.user_id = ai.user_id
        WHERE ai.user_id = $1
          AND m.tenant_id = $2
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
      return (updated.rowCount ?? 0) > 0
    })
  }

  async createSession(
    userId: string,
    tenantId: string,
    sessionId: string,
    tokenSecretHash: string,
    expiresAt: string,
  ): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const membership = await resolveMembership(client, userId, tenantId)
      if (!membership) return false
      const result = await client.query(
        `
        INSERT INTO sessions (
          id, membership_id, token_secret_hash, expires_at, revoked_at, created_at, last_seen_at
        )
        VALUES ($1, $2, $3, $4, NULL, now(), now())
        ON CONFLICT (id) DO NOTHING
        `,
        [sessionId, membership.id, tokenSecretHash, expiresAt],
      )
      return (result.rowCount ?? 0) > 0
    })
  }

  async resolveSession(sessionId: string): Promise<AuthSession | null> {
    const result = await this.database.query<AuthSessionRow>(
      `
      SELECT
        s.id AS session_id,
        m.user_id AS user_id,
        m.tenant_id AS tenant_id,
        m.roles AS roles,
        s.token_secret_hash AS token_secret_hash,
        s.expires_at AS expires_at,
        s.revoked_at AS revoked_at
      FROM sessions s
      JOIN tenant_memberships m ON m.id = s.membership_id
      WHERE s.id = $1
      LIMIT 1
      `,
      [sessionId],
    )
    return result.rows[0] ? toAuthSession(result.rows[0]) : null
  }

  async touchSession(sessionId: string): Promise<void> {
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

  toAccount(user: AuthAccount): Account {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      roles: user.roles,
      plan: user.plan,
      credits: user.credits,
    }
  }
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
    SELECT id
    FROM tenant_memberships
    WHERE user_id = $1
      AND tenant_id = $2
      AND status = 'active'
    LIMIT 1
    `,
    [userId, tenantId],
  )
  return result.rows[0] ?? null
}

type AuthAccountRow = {
  id: string
  email: string
  name: string
  password_hash: string | null
  tenant_id: string
  roles: AuthAccount['roles']
  plan: AuthAccount['plan']
  credits: number
}

type AuthSessionRow = {
  session_id: string
  user_id: string
  tenant_id: string
  roles: AuthAccount['roles']
  token_secret_hash: string
  expires_at: string
  revoked_at: string | null
}

function toAuthAccount(row: AuthAccountRow): AuthAccount {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash ?? '',
    tenantId: row.tenant_id,
    roles: row.roles,
    plan: row.plan,
    credits: row.credits,
  }
}

function toAuthSession(row: AuthSessionRow): AuthSession {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    roles: row.roles,
    tokenSecretHash: row.token_secret_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
}
