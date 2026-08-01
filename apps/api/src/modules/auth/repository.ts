import type { Account } from '@seqora/contracts'
import { createHash, randomUUID } from 'node:crypto'
import type { AccountDatabase } from '../../infra/postgres.js'
import type {
  AuditLogInput,
  AuthAccount,
  AuthAccounts,
  AuthSession,
  PasswordResetTokenInput,
  PasswordResetTokenResult,
  ResetPasswordTokenInput,
  SessionMetadata,
} from './accounts.js'

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
        b.credits AS credits,
        u.password_reset_required AS password_reset_required
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
        b.credits AS credits,
        u.password_reset_required AS password_reset_required
      FROM users u
      JOIN tenant_memberships m ON m.user_id = u.id AND m.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
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
        AND u.status = 'active'
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
  }

  async createSession(
    userId: string,
    tenantId: string,
    sessionId: string,
    tokenSecretHash: string,
    expiresAt: string,
    metadata?: SessionMetadata,
  ): Promise<boolean> {
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

  async createPasswordResetToken(
    input: PasswordResetTokenInput,
  ): Promise<PasswordResetTokenResult | null> {
    return this.database.transaction(async (client) => {
      const account = await client.query<PasswordResetAccountRow>(
        `
        SELECT
          ai.id AS identity_id,
          ai.user_id
        FROM auth_identities ai
        JOIN users u ON u.id = ai.user_id AND u.status = 'active'
        WHERE ai.provider = 'local'
          AND lower(ai.email) = lower($1)
          AND ai.status = 'active'
          AND ai.password_hash IS NOT NULL
        ORDER BY ai.is_primary DESC, ai.created_at ASC
        LIMIT 1
        FOR UPDATE OF ai
        `,
        [input.email],
      )
      const row = account.rows[0]
      if (!row) {
        await insertAuditLog(client, {
          tenantId: null,
          userId: null,
          actorUserId: null,
          action: 'auth.password_reset.requested',
          resourceType: 'email',
          resourceId: null,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: { emailHash: hashAuditValue(input.email.toLowerCase()) },
        })
        return null
      }

      await client.query(
        `
        UPDATE password_reset_tokens
        SET revoked_at = now(),
            updated_at = now()
        WHERE identity_id = $1
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
        `,
        [row.identity_id],
      )
      await client.query(
        `
        INSERT INTO password_reset_tokens (
          id, user_id, identity_id, token_secret_hash, expires_at, used_at, revoked_at,
          requested_ip, requested_user_agent, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, now(), now())
        `,
        [
          `password-reset-${randomUUID()}`,
          row.user_id,
          row.identity_id,
          input.tokenSecretHash,
          input.expiresAt,
          input.ipAddress,
          input.userAgent,
        ],
      )
      await insertAuditLog(client, {
        tenantId: null,
        userId: row.user_id,
        actorUserId: null,
        action: 'auth.password_reset.requested',
        resourceType: 'auth_identity',
        resourceId: row.identity_id,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: {},
      })
      return { userId: row.user_id, identityId: row.identity_id, expiresAt: input.expiresAt }
    })
  }

  async resetPasswordWithToken(input: ResetPasswordTokenInput): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const token = await client.query<PasswordResetTokenRow>(
        `
        SELECT
          prt.id AS token_id,
          prt.user_id,
          prt.identity_id
        FROM password_reset_tokens prt
        JOIN auth_identities ai ON ai.id = prt.identity_id
        JOIN users u ON u.id = prt.user_id
        WHERE prt.token_secret_hash = $1
          AND prt.used_at IS NULL
          AND prt.revoked_at IS NULL
          AND prt.expires_at > now()
          AND ai.status = 'active'
          AND ai.provider = 'local'
          AND ai.password_hash IS NOT NULL
          AND u.status = 'active'
        LIMIT 1
        FOR UPDATE OF prt
        `,
        [input.tokenSecretHash],
      )
      const row = token.rows[0]
      if (!row) {
        await insertAuditLog(client, {
          tenantId: null,
          userId: null,
          actorUserId: null,
          action: 'auth.password_reset.failed',
          resourceType: 'password_reset_token',
          resourceId: null,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: { reason: 'invalid_or_expired' },
        })
        return false
      }

      await client.query(
        `
        UPDATE auth_identities
        SET password_hash = $2,
            updated_at = now()
        WHERE id = $1
        `,
        [row.identity_id, input.passwordHash],
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
        [row.user_id],
      )
      await client.query(
        `
        UPDATE password_reset_tokens
        SET used_at = now(),
            updated_at = now()
        WHERE id = $1
        `,
        [row.token_id],
      )
      await client.query(
        `
        UPDATE sessions s
        SET revoked_at = now()
        FROM tenant_memberships m
        WHERE s.membership_id = m.id
          AND m.user_id = $1
          AND s.revoked_at IS NULL
        `,
        [row.user_id],
      )
      await insertAuditLog(client, {
        tenantId: null,
        userId: row.user_id,
        actorUserId: row.user_id,
        action: 'auth.password_reset.completed',
        resourceType: 'auth_identity',
        resourceId: row.identity_id,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { resetTokenId: row.token_id },
      })
      return true
    })
  }

  async recordAuditLog(input: AuditLogInput): Promise<void> {
    await insertAuditLog(this.database, input)
  }

  async resolveSession(sessionId: string): Promise<AuthSession | null> {
    const result = await this.database.query<AuthSessionRow>(
      `
      SELECT
        s.id AS session_id,
        m.user_id AS user_id,
        m.tenant_id AS tenant_id,
        m.roles AS roles,
        u.password_reset_required AS password_reset_required,
        s.token_secret_hash AS token_secret_hash,
        s.expires_at AS expires_at,
        s.revoked_at AS revoked_at
      FROM sessions s
      JOIN tenant_memberships m ON m.id = s.membership_id
      JOIN users u ON u.id = m.user_id AND u.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
      WHERE s.id = $1
        AND m.status = 'active'
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
      organizationId: user.organizationId,
      roles: user.roles,
      plan: user.plan,
      credits: user.credits,
      passwordResetRequired: user.passwordResetRequired,
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

type AuthAccountRow = {
  id: string
  email: string
  name: string
  password_hash: string | null
  tenant_id: string
  roles: AuthAccount['roles']
  plan: AuthAccount['plan']
  credits: number
  password_reset_required: boolean
}

type AuthSessionRow = {
  session_id: string
  user_id: string
  tenant_id: string
  roles: AuthAccount['roles']
  password_reset_required: boolean
  token_secret_hash: string
  expires_at: string
  revoked_at: string | null
}

type PasswordResetAccountRow = {
  identity_id: string
  user_id: string
}

type PasswordResetTokenRow = {
  token_id: string
  user_id: string
  identity_id: string
}

type Queryable = {
  query<T extends { [key: string]: unknown } = { [key: string]: unknown }>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>
}

async function insertAuditLog(client: Queryable, input: AuditLogInput): Promise<void> {
  await client.query(
    `
    INSERT INTO audit_log_entries (
      id, tenant_id, user_id, actor_user_id, action, resource_type, resource_id,
      ip_address, user_agent, metadata, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
    `,
    [
      `audit-${randomUUID()}`,
      input.tenantId,
      input.userId,
      input.actorUserId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.ipAddress,
      input.userAgent,
      JSON.stringify(input.metadata ?? {}),
    ],
  )
}

function hashAuditValue(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function toAuthAccount(row: AuthAccountRow): AuthAccount {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash ?? '',
    tenantId: row.tenant_id,
    organizationId: row.tenant_id,
    roles: row.roles,
    plan: row.plan,
    credits: row.credits,
    passwordResetRequired: row.password_reset_required,
  }
}

function toAuthSession(row: AuthSessionRow): AuthSession {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    organizationId: row.tenant_id,
    roles: row.roles,
    passwordResetRequired: row.password_reset_required,
    tokenSecretHash: row.token_secret_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
}
