import type { Membership, Plan, Role, SessionSummary, Workspace } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AuthAccount } from '../auth/accounts.js'

const defaultPlan: Plan = 'free'
const defaultCredits = 0

export type AccountWorkspace = {
  account: AuthAccount
  workspace: Workspace
  membership: Membership
}

export class AccountManagementRepository {
  constructor(private readonly database: AccountDatabase) {}

  async registerAccount(input: {
    name: string
    email: string
    passwordHash: string
    workspaceName: string
  }): Promise<AccountWorkspace | null> {
    return this.database.transaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        `
        SELECT id
        FROM auth_identities
        WHERE provider = 'local'
          AND lower(email) = lower($1)
        LIMIT 1
        `,
        [input.email],
      )
      if (existing.rows.length) return null

      const userId = `user-${randomUUID()}`
      const tenantId = `tenant-${randomUUID()}`
      const membershipId = membershipIdFor(userId, tenantId)

      await client.query(
        `
        INSERT INTO users (id, display_name, status, created_at, updated_at)
        VALUES ($1, $2, 'active', now(), now())
        `,
        [userId, input.name],
      )
      await client.query(
        `
        INSERT INTO auth_identities (
          id, user_id, provider, provider_subject, email, password_hash, is_primary, status, created_at, updated_at
        )
        VALUES ($1, $2, 'local', $3, $3, $4, true, 'active', now(), now())
        `,
        [authIdentityIdFor(userId), userId, input.email, input.passwordHash],
      )
      await client.query(
        `
        INSERT INTO tenants (id, name, status, created_by_user_id, created_at, updated_at)
        VALUES ($1, $2, 'active', $3, now(), now())
        `,
        [tenantId, input.workspaceName, userId],
      )
      await client.query(
        `
        INSERT INTO tenant_memberships (
          id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, true, 'active', now(), now())
        `,
        [membershipId, tenantId, userId, ['owner']],
      )
      await client.query(
        `
        INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
        VALUES ($1, $2, $3, now(), now())
        `,
        [membershipId, defaultPlan, defaultCredits],
      )

      return this.readAccountWorkspace(client, userId, tenantId)
    })
  }

  async createWorkspaceForUser(userId: string, name: string): Promise<AccountWorkspace | null> {
    return this.database.transaction(async (client) => {
      const tenantId = `tenant-${randomUUID()}`
      const membershipId = membershipIdFor(userId, tenantId)
      const user = await client.query<{ id: string }>(
        `
        SELECT id
        FROM users
        WHERE id = $1
          AND status = 'active'
        LIMIT 1
        `,
        [userId],
      )
      if (!user.rows.length) return null

      await client.query(
        `
        INSERT INTO tenants (id, name, status, created_by_user_id, created_at, updated_at)
        VALUES ($1, $2, 'active', $3, now(), now())
        `,
        [tenantId, name, userId],
      )
      await client.query(
        `
        INSERT INTO tenant_memberships (
          id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, false, 'active', now(), now())
        `,
        [membershipId, tenantId, userId, ['owner']],
      )
      await client.query(
        `
        INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
        VALUES ($1, $2, $3, now(), now())
        `,
        [membershipId, defaultPlan, defaultCredits],
      )

      return this.readAccountWorkspace(client, userId, tenantId)
    })
  }

  async addMemberByEmail(input: {
    tenantId: string
    email: string
    roles: Role[]
  }): Promise<Membership | null> {
    return this.database.transaction(async (client) => {
      const account = await client.query<{ user_id: string }>(
        `
        SELECT u.id AS user_id
        FROM auth_identities ai
        JOIN users u ON u.id = ai.user_id AND u.status = 'active'
        WHERE ai.provider = 'local'
          AND lower(ai.email) = lower($1)
          AND ai.status = 'active'
          AND ai.password_hash IS NOT NULL
        ORDER BY ai.is_primary DESC, ai.created_at ASC
        LIMIT 1
        `,
        [input.email],
      )
      const userId = account.rows[0]?.user_id
      if (!userId) return null

      const membershipId = membershipIdFor(userId, input.tenantId)
      await client.query(
        `
        INSERT INTO tenant_memberships (
          id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, false, 'active', now(), now())
        ON CONFLICT (tenant_id, user_id)
        DO UPDATE SET roles = EXCLUDED.roles,
                      status = 'active',
                      updated_at = now()
        `,
        [membershipId, input.tenantId, userId, input.roles],
      )
      await client.query(
        `
        INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
        VALUES ($1, $2, $3, now(), now())
        ON CONFLICT (membership_id) DO NOTHING
        `,
        [membershipId, defaultPlan, defaultCredits],
      )
      const member = await client.query<MembershipRow>(
        membershipSelectSql('WHERE m.tenant_id = $1 AND m.user_id = $2'),
        [input.tenantId, userId],
      )
      return member.rows[0] ? toMembership(member.rows[0]) : null
    })
  }

  async listMembers(tenantId: string): Promise<Membership[]> {
    const result = await this.database.query<MembershipRow>(membershipSelectSql('WHERE m.tenant_id = $1'), [
      tenantId,
    ])
    return result.rows.map(toMembership)
  }

  async findMembership(tenantId: string, userId: string): Promise<Membership | null> {
    const result = await this.database.query<MembershipRow>(
      membershipSelectSql('WHERE m.tenant_id = $1 AND m.user_id = $2'),
      [tenantId, userId],
    )
    return result.rows[0] ? toMembership(result.rows[0]) : null
  }

  async countActiveOwners(tenantId: string): Promise<number> {
    const result = await this.database.query<{ count: string }>(
      `
      SELECT count(*) AS count
      FROM tenant_memberships
      WHERE tenant_id = $1
        AND status = 'active'
        AND roles @> ARRAY['owner']::text[]
      `,
      [tenantId],
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async updateMembershipRoles(tenantId: string, userId: string, roles: Role[]): Promise<Membership | null> {
    const result = await this.database.transaction(async (client) => {
      const updated = await client.query<{ id: string }>(
        `
        UPDATE tenant_memberships
        SET roles = $3,
            updated_at = now()
        WHERE tenant_id = $1
          AND user_id = $2
          AND status = 'active'
        RETURNING id
        `,
        [tenantId, userId, roles],
      )
      return updated.rows[0]?.id ?? null
    })
    return result ? this.findMembership(tenantId, userId) : null
  }

  async disableMembership(tenantId: string, userId: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const updated = await client.query<{ id: string }>(
        `
        UPDATE tenant_memberships
        SET status = 'disabled',
            updated_at = now()
        WHERE tenant_id = $1
          AND user_id = $2
          AND status = 'active'
        RETURNING id
        `,
        [tenantId, userId],
      )
      const membershipId = updated.rows[0]?.id
      if (!membershipId) return false
      await client.query(
        `
        UPDATE sessions
        SET revoked_at = now()
        WHERE membership_id = $1
          AND revoked_at IS NULL
        `,
        [membershipId],
      )
      return true
    })
  }

  async disableAccount(userId: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const updated = await client.query(
        `
        UPDATE users
        SET status = 'disabled',
            updated_at = now()
        WHERE id = $1
          AND status = 'active'
        `,
        [userId],
      )
      if ((updated.rowCount ?? 0) === 0) return false
      await client.query(
        `
        UPDATE auth_identities
        SET status = 'disabled',
            updated_at = now()
        WHERE user_id = $1
        `,
        [userId],
      )
      await client.query(
        `
        UPDATE tenant_memberships
        SET status = 'disabled',
            updated_at = now()
        WHERE user_id = $1
        `,
        [userId],
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
        [userId],
      )
      return true
    })
  }

  async listUserSessions(
    userId: string,
    tenantId: string,
    currentSessionId: string | null,
  ): Promise<SessionSummary[]> {
    const result = await this.database.query<SessionRow>(
      `
      SELECT
        s.id AS session_id,
        m.user_id,
        m.tenant_id,
        t.name AS tenant_name,
        m.roles,
        s.created_at,
        s.last_seen_at,
        s.expires_at,
        s.revoked_at
      FROM sessions s
      JOIN tenant_memberships m ON m.id = s.membership_id
      JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
        AND m.tenant_id = $2
      ORDER BY s.created_at DESC
      `,
      [userId, tenantId],
    )
    return result.rows.map((row) => toSessionSummary(row, currentSessionId))
  }

  async revokeUserSession(userId: string, tenantId: string, sessionId: string): Promise<boolean> {
    const result = await this.database.query(
      `
      UPDATE sessions s
      SET revoked_at = now()
      FROM tenant_memberships m
      WHERE s.membership_id = m.id
        AND s.id = $1
        AND m.user_id = $2
        AND m.tenant_id = $3
        AND s.revoked_at IS NULL
      `,
      [sessionId, userId, tenantId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async revokeTenantSession(tenantId: string, sessionId: string): Promise<boolean> {
    const result = await this.database.query(
      `
      UPDATE sessions s
      SET revoked_at = now()
      FROM tenant_memberships m
      WHERE s.membership_id = m.id
        AND s.id = $1
        AND m.tenant_id = $2
        AND s.revoked_at IS NULL
      `,
      [sessionId, tenantId],
    )
    return (result.rowCount ?? 0) > 0
  }

  private async readAccountWorkspace(
    client: Queryable,
    userId: string,
    tenantId: string,
  ): Promise<AccountWorkspace> {
    const result = await client.query<AccountWorkspaceRow>(
      `
      SELECT
        u.id,
        ai.email,
        u.display_name AS name,
        ai.password_hash,
        m.id AS membership_id,
        m.tenant_id,
        m.roles,
        m.status AS membership_status,
        m.is_primary,
        m.created_at AS membership_created_at,
        m.updated_at AS membership_updated_at,
        t.name AS tenant_name,
        t.status AS tenant_status,
        t.created_at AS tenant_created_at,
        t.updated_at AS tenant_updated_at,
        b.plan,
        b.credits
      FROM users u
      JOIN tenant_memberships m ON m.user_id = u.id
      JOIN tenants t ON t.id = m.tenant_id
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
        AND m.tenant_id = $2
      LIMIT 1
      `,
      [userId, tenantId],
    )
    const row = result.rows[0]
    if (!row) throw new Error(`Could not read account workspace ${tenantId} for ${userId}`)
    return {
      account: {
        id: row.id,
        email: row.email,
        name: row.name,
        passwordHash: row.password_hash ?? '',
        tenantId: row.tenant_id,
        roles: row.roles,
        plan: row.plan,
        credits: row.credits,
      },
      workspace: toWorkspace(row),
      membership: toMembership(row),
    }
  }
}

type Queryable = {
  query<T extends { [key: string]: unknown } = { [key: string]: unknown }>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>
}

type AccountWorkspaceRow = MembershipRow & {
  password_hash: string | null
  plan: Plan
  credits: number
  tenant_status: Workspace['status']
  tenant_created_at: Date | string
  tenant_updated_at: Date | string
}

type MembershipRow = {
  id: string
  email: string
  name: string
  membership_id: string
  tenant_id: string
  tenant_name: string
  roles: Role[]
  membership_status: Membership['status']
  is_primary: boolean
  membership_created_at: Date | string
  membership_updated_at: Date | string
}

type SessionRow = {
  session_id: string
  user_id: string
  tenant_id: string
  tenant_name: string
  roles: Role[]
  created_at: Date | string
  last_seen_at: Date | string | null
  expires_at: Date | string
  revoked_at: Date | string | null
}

function membershipSelectSql(whereClause: string): string {
  return `
    SELECT
      u.id,
      ai.email,
      u.display_name AS name,
      m.id AS membership_id,
      m.tenant_id,
      t.name AS tenant_name,
      m.roles,
      m.status AS membership_status,
      m.is_primary,
      m.created_at AS membership_created_at,
      m.updated_at AS membership_updated_at
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id
    JOIN tenants t ON t.id = m.tenant_id
    LEFT JOIN LATERAL (
      SELECT email
      FROM auth_identities ai
      WHERE ai.user_id = u.id
        AND ai.provider = 'local'
      ORDER BY ai.is_primary DESC, ai.created_at ASC
      LIMIT 1
    ) ai ON true
    ${whereClause}
    ORDER BY m.created_at ASC
  `
}

function membershipIdFor(userId: string, tenantId: string): string {
  return `membership-${tenantId}-${userId}`
}

function authIdentityIdFor(userId: string): string {
  return `identity-${userId}`
}

function toWorkspace(row: AccountWorkspaceRow): Workspace {
  return {
    id: row.tenant_id,
    name: row.tenant_name,
    status: row.tenant_status,
    createdAt: toIso(row.tenant_created_at),
    updatedAt: toIso(row.tenant_updated_at),
  }
}

function toMembership(row: MembershipRow): Membership {
  return {
    id: row.membership_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    userId: row.id,
    email: row.email,
    name: row.name,
    roles: row.roles,
    status: row.membership_status,
    isPrimary: row.is_primary,
    createdAt: toIso(row.membership_created_at),
    updatedAt: toIso(row.membership_updated_at),
  }
}

function toSessionSummary(row: SessionRow, currentSessionId: string | null): SessionSummary {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    roles: row.roles,
    createdAt: toIso(row.created_at),
    lastSeenAt: row.last_seen_at ? toIso(row.last_seen_at) : null,
    expiresAt: toIso(row.expires_at),
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    current: currentSessionId === row.session_id,
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
