import type {
  AdminAccountStatus,
  AdminAuditLogEntry,
  AdminAuditLogEntryList,
  AdminBillingAccount,
  AdminBillingAccountList,
  AdminBillingLedgerEntry,
  AdminBillingLedgerEntryList,
  AdminMembership,
  AdminMembershipDetail,
  AdminMembershipList,
  AdminSession,
  AdminSessionList,
  AdminSessionStatus,
  AdminTenant,
  AdminTenantList,
  AdminUser,
  AdminUserList,
  LedgerEntry,
  Plan,
  Principal,
  Role,
} from '@seqora/contracts'
import { ROLES } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../core/errors.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { SessionMetadata } from '../auth/accounts.js'

const defaultLimit = 50
const maxLimit = 100

export type AdminListOptions = {
  q?: string | undefined
  status?: string | undefined
  tenantId?: string | undefined
  userId?: string | undefined
  membershipId?: string | undefined
  role?: Role | undefined
  type?: LedgerEntry['type'] | undefined
  action?: string | undefined
  resourceType?: string | undefined
  actorUserId?: string | undefined
  sessionStatus?: AdminSessionStatus | undefined
  limit: number
  offset: number
}

export class AdminRepository {
  constructor(private readonly database: AccountDatabase) {}

  async listUsers(options: AdminListOptions): Promise<AdminUserList> {
    const filter = buildUserFilter(options)
    const total = await this.database.query<{ total: number }>(
      `
      SELECT count(*)::int AS total
      FROM users u
      LEFT JOIN LATERAL (${primaryIdentitySql('u.id')}) ai ON true
      ${filter.where}
      `,
      filter.params,
    )
    const paging = normalizePaging(options)
    const rows = await this.database.query<AdminUserRow>(
      `
      SELECT
        u.id,
        ai.email,
        u.display_name AS name,
        u.status,
        COALESCE(
          array_agg(DISTINCT role_value.role) FILTER (WHERE role_value.role IS NOT NULL),
          ARRAY[]::text[]
        ) AS roles,
        count(DISTINCT m.id)::int AS membership_count,
        count(DISTINCT m.id) FILTER (WHERE m.status = 'active')::int AS active_membership_count,
        u.created_at,
        u.updated_at
      FROM users u
      LEFT JOIN LATERAL (${primaryIdentitySql('u.id')}) ai ON true
      LEFT JOIN tenant_memberships m ON m.user_id = u.id
      LEFT JOIN LATERAL unnest(m.roles) AS role_value(role) ON true
      ${filter.where}
      GROUP BY u.id, ai.email
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT $${filter.params.length + 1}
      OFFSET $${filter.params.length + 2}
      `,
      [...filter.params, paging.limit, paging.offset],
    )
    return listResult(rows.rows.map(toAdminUser), total.rows[0]?.total ?? 0, paging)
  }

  async findUser(userId: string): Promise<AdminUser | null> {
    const result = await this.listUsers({
      userId,
      limit: 1,
      offset: 0,
    })
    return result.items[0] ?? null
  }

  async listTenants(options: AdminListOptions): Promise<AdminTenantList> {
    const filter = buildTenantFilter(options)
    const total = await this.database.query<{ total: number }>(
      `
      SELECT count(*)::int AS total
      FROM tenants t
      ${filter.where}
      `,
      filter.params,
    )
    const paging = normalizePaging(options)
    const rows = await this.database.query<AdminTenantRow>(
      `
      SELECT
        t.id,
        t.name,
        t.status,
        t.created_by_user_id,
        created_by_identity.email AS created_by_email,
        created_by.display_name AS created_by_name,
        count(DISTINCT m.id)::int AS membership_count,
        count(DISTINCT m.id) FILTER (WHERE m.status = 'active' AND u.status = 'active')::int
          AS active_membership_count,
        count(DISTINCT m.id) FILTER (
          WHERE m.status = 'active' AND u.status = 'active' AND m.roles @> ARRAY['owner']::text[]
        )::int AS active_owner_count,
        t.created_at,
        t.updated_at
      FROM tenants t
      LEFT JOIN users created_by ON created_by.id = t.created_by_user_id
      LEFT JOIN LATERAL (${primaryIdentitySql('created_by.id')}) created_by_identity ON true
      LEFT JOIN tenant_memberships m ON m.tenant_id = t.id
      LEFT JOIN users u ON u.id = m.user_id
      ${filter.where}
      GROUP BY t.id, created_by.id, created_by_identity.email
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${filter.params.length + 1}
      OFFSET $${filter.params.length + 2}
      `,
      [...filter.params, paging.limit, paging.offset],
    )
    return listResult(rows.rows.map(toAdminTenant), total.rows[0]?.total ?? 0, paging)
  }

  async listMemberships(options: AdminListOptions): Promise<AdminMembershipList> {
    const filter = buildMembershipFilter(options)
    const total = await this.database.query<{ total: number }>(
      `
      SELECT count(*)::int AS total
      FROM tenant_memberships m
      JOIN users u ON u.id = m.user_id
      JOIN tenants t ON t.id = m.tenant_id
      LEFT JOIN LATERAL (${primaryIdentitySql('u.id')}) ai ON true
      ${filter.where}
      `,
      filter.params,
    )
    const paging = normalizePaging(options)
    const rows = await this.database.query<AdminMembershipRow>(
      `
      ${membershipSelectSql()}
      ${filter.where}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $${filter.params.length + 1}
      OFFSET $${filter.params.length + 2}
      `,
      [...filter.params, paging.limit, paging.offset],
    )
    return listResult(rows.rows.map(toAdminMembership), total.rows[0]?.total ?? 0, paging)
  }

  async findMembership(membershipId: string): Promise<AdminMembershipDetail | null> {
    const membership = await this.database.query<AdminMembershipRow>(
      `
      ${membershipSelectSql()}
      WHERE m.id = $1
      LIMIT 1
      `,
      [membershipId],
    )
    const row = membership.rows[0]
    if (!row) return null
    const entries = await this.listBillingLedgerEntries({
      membershipId,
      limit: 30,
      offset: 0,
    })
    return {
      membership: toAdminMembership(row),
      billing: toAdminBillingAccount(row),
      entries: entries.items,
    }
  }

  async listBillingAccounts(options: AdminListOptions): Promise<AdminBillingAccountList> {
    const memberships = await this.listMemberships(options)
    return {
      items: memberships.items.map((membership) => ({
        membershipId: membership.id,
        tenantId: membership.tenantId,
        tenantName: membership.tenantName,
        userId: membership.userId,
        email: membership.email,
        name: membership.name,
        userStatus: membership.userStatus,
        membershipStatus: membership.status,
        roles: membership.roles,
        plan: membership.plan,
        credits: membership.credits,
        updatedAt: membership.updatedAt,
      })),
      meta: memberships.meta,
    }
  }

  async listBillingLedgerEntries(options: AdminListOptions): Promise<AdminBillingLedgerEntryList> {
    const filter = buildLedgerFilter(options)
    const total = await this.database.query<{ total: number }>(
      `
      SELECT count(*)::int AS total
      FROM billing_ledger_entries e
      ${filter.where}
      `,
      filter.params,
    )
    const paging = normalizePaging(options)
    const rows = await this.database.query<AdminBillingLedgerEntryRow>(
      `
      SELECT
        e.id,
        e.user_id,
        e.tenant_id,
        e.membership_id,
        e.reference_id,
        e.related_entry_id,
        e.entry_type,
        e.amount,
        e.balance,
        e.description,
        e.created_by_user_id,
        e.created_at,
        e.metadata
      FROM billing_ledger_entries e
      ${filter.where}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${filter.params.length + 1}
      OFFSET $${filter.params.length + 2}
      `,
      [...filter.params, paging.limit, paging.offset],
    )
    return listResult(rows.rows.map(toAdminBillingLedgerEntry), total.rows[0]?.total ?? 0, paging)
  }

  async listSessions(
    options: AdminListOptions,
    currentSessionId: string | null = null,
  ): Promise<AdminSessionList> {
    const filter = buildSessionFilter(options)
    const total = await this.database.query<{ total: number }>(
      `
      SELECT count(*)::int AS total
      FROM sessions s
      JOIN tenant_memberships m ON m.id = s.membership_id
      JOIN users u ON u.id = m.user_id
      JOIN tenants t ON t.id = m.tenant_id
      LEFT JOIN LATERAL (${primaryIdentitySql('u.id')}) ai ON true
      ${filter.where}
      `,
      filter.params,
    )
    const paging = normalizePaging(options)
    const rows = await this.database.query<AdminSessionRow>(
      `
      ${adminSessionSelectSql()}
      ${filter.where}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $${filter.params.length + 1}
      OFFSET $${filter.params.length + 2}
      `,
      [...filter.params, paging.limit, paging.offset],
    )
    return listResult(
      rows.rows.map((row) => toAdminSession(row, currentSessionId)),
      total.rows[0]?.total ?? 0,
      paging,
    )
  }

  async revokeSession(
    principal: Principal,
    sessionId: string,
    metadata?: SessionMetadata,
  ): Promise<AdminSession | null> {
    return this.database.transaction(async (client) => {
      const target = await client.query<AdminSessionRow>(
        `
        ${adminSessionSelectSql()}
        WHERE s.id = $1
        LIMIT 1
        FOR UPDATE OF s
        `,
        [sessionId],
      )
      const row = target.rows[0]
      if (!row || row.revoked_at) return null
      if (principal.userId === row.user_id) {
        throw new AppError(400, 'CANNOT_REVOKE_SELF_SESSION', 'Use the current account session API to sign out')
      }
      if (hasElevatedRole(row.roles) && !isOwner(principal)) {
        throw new AppError(
          403,
          'ELEVATED_SESSION_REQUIRES_OWNER',
          'Only owners can revoke owner or admin sessions',
        )
      }

      await client.query(
        `
        UPDATE sessions
        SET revoked_at = now()
        WHERE id = $1
          AND revoked_at IS NULL
        `,
        [sessionId],
      )
      await insertAuditLog(client, {
        tenantId: row.tenant_id,
        userId: row.user_id,
        actorUserId: principal.userId,
        action: 'admin.session.revoked',
        resourceType: 'session',
        resourceId: sessionId,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: {
          membershipId: row.membership_id,
          roles: row.roles,
          scope: 'admin_console',
        },
      })

      const revoked = await client.query<AdminSessionRow>(
        `
        ${adminSessionSelectSql()}
        WHERE s.id = $1
        LIMIT 1
        `,
        [sessionId],
      )
      const revokedRow = revoked.rows[0]
      return revokedRow ? toAdminSession(revokedRow, null) : null
    })
  }

  async listAuditLogEntries(options: AdminListOptions): Promise<AdminAuditLogEntryList> {
    const filter = buildAuditFilter(options)
    const total = await this.database.query<{ total: number }>(
      `
      SELECT count(*)::int AS total
      FROM audit_log_entries e
      ${filter.where}
      `,
      filter.params,
    )
    const paging = normalizePaging(options)
    const rows = await this.database.query<AdminAuditLogEntryRow>(
      `
      SELECT
        e.id,
        e.tenant_id,
        e.user_id,
        e.actor_user_id,
        e.action,
        e.resource_type,
        e.resource_id,
        e.ip_address,
        e.user_agent,
        e.metadata,
        e.created_at
      FROM audit_log_entries e
      ${filter.where}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${filter.params.length + 1}
      OFFSET $${filter.params.length + 2}
      `,
      [...filter.params, paging.limit, paging.offset],
    )
    return listResult(rows.rows.map(toAdminAuditLogEntry), total.rows[0]?.total ?? 0, paging)
  }

  async setAccountStatus(
    principal: Principal,
    userId: string,
    status: AdminAccountStatus,
    metadata?: SessionMetadata,
  ): Promise<AdminUser | null> {
    return this.database.transaction(async (client) => {
      const user = await client.query<{ id: string; status: AdminAccountStatus }>(
        `
        SELECT id, status
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [userId],
      )
      if (!user.rows[0]) return null
      if (principal.userId === userId && status === 'disabled') {
        throw new AppError(400, 'CANNOT_DISABLE_SELF_ACCOUNT', 'Cannot disable your own account')
      }

      const memberships = await client.query<{ tenant_id: string; roles: Role[]; status: string }>(
        `
        SELECT tenant_id, roles, status
        FROM tenant_memberships
        WHERE user_id = $1
        `,
        [userId],
      )
      if (memberships.rows.some((membership) => hasElevatedRole(membership.roles)) && !isOwner(principal)) {
        throw new AppError(403, 'ELEVATED_ACCOUNT_REQUIRES_OWNER', 'Only owners can manage elevated accounts')
      }

      if (status === 'disabled') {
        for (const membership of memberships.rows) {
          if (!membership.roles.includes(ROLES.OWNER) || membership.status !== 'active') continue
          const remainingOwners = await client.query<{ count: number }>(
            `
            SELECT count(*)::int AS count
            FROM tenant_memberships m
            JOIN users u ON u.id = m.user_id AND u.status = 'active'
            WHERE m.tenant_id = $1
              AND m.status = 'active'
              AND m.user_id <> $2
              AND m.roles @> ARRAY['owner']::text[]
            `,
            [membership.tenant_id, userId],
          )
          if ((remainingOwners.rows[0]?.count ?? 0) <= 0) {
            throw new AppError(409, 'LAST_OWNER_CANNOT_BE_DISABLED', 'The last owner cannot be disabled')
          }
        }
      }

      await client.query(
        `
        UPDATE users
        SET status = $2,
            updated_at = now()
        WHERE id = $1
        `,
        [userId, status],
      )
      await client.query(
        `
        UPDATE auth_identities
        SET status = $2,
            updated_at = now()
        WHERE user_id = $1
        `,
        [userId, status],
      )
      if (status === 'disabled') {
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
      }
      await insertAuditLog(client, {
        tenantId: null,
        userId,
        actorUserId: principal.userId,
        action: 'admin.account_status.updated',
        resourceType: 'user',
        resourceId: userId,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: {
          previousStatus: user.rows[0].status,
          status,
        },
      })

      return await readAdminUser(client, userId)
    })
  }
}

type Filter = {
  where: string
  params: unknown[]
}

type Paging = {
  limit: number
  offset: number
}

type Queryable = {
  query<T extends { [key: string]: unknown } = { [key: string]: unknown }>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>
}

type AdminUserRow = {
  id: string
  email: string | null
  name: string
  status: AdminAccountStatus
  roles: Role[]
  membership_count: number
  active_membership_count: number
  created_at: Date | string
  updated_at: Date | string
}

type AdminTenantRow = {
  id: string
  name: string
  status: AdminTenant['status']
  created_by_user_id: string | null
  created_by_email: string | null
  created_by_name: string | null
  membership_count: number
  active_membership_count: number
  active_owner_count: number
  created_at: Date | string
  updated_at: Date | string
}

type AdminMembershipRow = {
  id: string
  tenant_id: string
  tenant_name: string
  tenant_status: AdminTenant['status']
  user_id: string
  email: string | null
  name: string
  user_status: AdminAccountStatus
  roles: Role[]
  membership_status: AdminMembership['status']
  is_primary: boolean
  plan: Plan
  credits: number
  membership_created_at: Date | string
  membership_updated_at: Date | string
}

type AdminBillingLedgerEntryRow = {
  id: string
  user_id: string
  tenant_id: string
  membership_id: string
  reference_id: string
  related_entry_id: string | null
  entry_type: LedgerEntry['type']
  amount: number
  balance: number
  description: string
  created_by_user_id: string | null
  created_at: Date | string
  metadata: Record<string, unknown> | string
}

type AdminSessionRow = {
  session_id: string
  membership_id: string
  tenant_id: string
  tenant_name: string
  tenant_status: AdminTenant['status']
  user_id: string
  email: string | null
  name: string
  user_status: AdminAccountStatus
  roles: Role[]
  membership_status: AdminMembership['status']
  session_created_at: Date | string
  last_seen_at: Date | string | null
  expires_at: Date | string
  revoked_at: Date | string | null
  ip_address: string | null
  user_agent: string | null
  device_label: string | null
}

type AdminAuditLogEntryRow = {
  id: string
  tenant_id: string | null
  user_id: string | null
  actor_user_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  ip_address: string | null
  user_agent: string | null
  metadata: Record<string, unknown> | string
  created_at: Date | string
}

function buildUserFilter(options: AdminListOptions): Filter {
  const builder = new FilterBuilder()
  if (options.userId) builder.add('u.id = ?', options.userId)
  if (options.status) builder.add('u.status = ?', options.status)
  if (options.tenantId) {
    builder.add(
      'EXISTS (SELECT 1 FROM tenant_memberships tenant_filter WHERE tenant_filter.user_id = u.id AND tenant_filter.tenant_id = ?)',
      options.tenantId,
    )
  }
  if (options.q?.trim()) {
    builder.add(
      '(lower(u.id) LIKE ? OR lower(u.display_name) LIKE ? OR lower(ai.email) LIKE ?)',
      search(options.q),
      search(options.q),
      search(options.q),
    )
  }
  return builder.build()
}

function buildTenantFilter(options: AdminListOptions): Filter {
  const builder = new FilterBuilder()
  if (options.tenantId) builder.add('t.id = ?', options.tenantId)
  if (options.status) builder.add('t.status = ?', options.status)
  if (options.q?.trim()) {
    builder.add('(lower(t.id) LIKE ? OR lower(t.name) LIKE ?)', search(options.q), search(options.q))
  }
  return builder.build()
}

function buildMembershipFilter(options: AdminListOptions): Filter {
  const builder = new FilterBuilder()
  if (options.membershipId) builder.add('m.id = ?', options.membershipId)
  if (options.tenantId) builder.add('m.tenant_id = ?', options.tenantId)
  if (options.userId) builder.add('m.user_id = ?', options.userId)
  if (options.status) builder.add('m.status = ?', options.status)
  if (options.role) builder.add('? = ANY(m.roles)', options.role)
  if (options.q?.trim()) {
    builder.add(
      '(lower(m.id) LIKE ? OR lower(m.user_id) LIKE ? OR lower(u.display_name) LIKE ? OR lower(ai.email) LIKE ? OR lower(t.name) LIKE ?)',
      search(options.q),
      search(options.q),
      search(options.q),
      search(options.q),
      search(options.q),
    )
  }
  return builder.build()
}

function buildLedgerFilter(options: AdminListOptions): Filter {
  const builder = new FilterBuilder()
  if (options.membershipId) builder.add('e.membership_id = ?', options.membershipId)
  if (options.tenantId) builder.add('e.tenant_id = ?', options.tenantId)
  if (options.userId) builder.add('e.user_id = ?', options.userId)
  if (options.type) builder.add('e.entry_type = ?', options.type)
  if (options.q?.trim()) {
    builder.add(
      '(lower(e.id) LIKE ? OR lower(e.reference_id) LIKE ? OR lower(e.description) LIKE ?)',
      search(options.q),
      search(options.q),
      search(options.q),
    )
  }
  return builder.build()
}

function buildSessionFilter(options: AdminListOptions): Filter {
  const builder = new FilterBuilder()
  if (options.membershipId) builder.add('s.membership_id = ?', options.membershipId)
  if (options.tenantId) builder.add('m.tenant_id = ?', options.tenantId)
  if (options.userId) builder.add('m.user_id = ?', options.userId)
  if (options.role) builder.add('? = ANY(m.roles)', options.role)
  if (options.sessionStatus === 'active') {
    builder.add('s.revoked_at IS NULL AND s.expires_at > now()')
  } else if (options.sessionStatus === 'revoked') {
    builder.add('s.revoked_at IS NOT NULL')
  } else if (options.sessionStatus === 'expired') {
    builder.add('s.revoked_at IS NULL AND s.expires_at <= now()')
  }
  if (options.q?.trim()) {
    builder.add(
      '(lower(s.id) LIKE ? OR lower(m.user_id) LIKE ? OR lower(u.display_name) LIKE ? OR lower(ai.email) LIKE ? OR lower(t.name) LIKE ? OR lower(COALESCE(s.ip_address, \'\')) LIKE ? OR lower(COALESCE(s.device_label, \'\')) LIKE ?)',
      search(options.q),
      search(options.q),
      search(options.q),
      search(options.q),
      search(options.q),
      search(options.q),
      search(options.q),
    )
  }
  return builder.build()
}

function buildAuditFilter(options: AdminListOptions): Filter {
  const builder = new FilterBuilder()
  if (options.tenantId) builder.add('e.tenant_id = ?', options.tenantId)
  if (options.userId) builder.add('e.user_id = ?', options.userId)
  if (options.actorUserId) builder.add('e.actor_user_id = ?', options.actorUserId)
  if (options.action) builder.add('e.action = ?', options.action)
  if (options.resourceType) builder.add('e.resource_type = ?', options.resourceType)
  if (options.q?.trim()) {
    builder.add(
      '(lower(e.id) LIKE ? OR lower(e.action) LIKE ? OR lower(e.resource_type) LIKE ? OR lower(COALESCE(e.resource_id, \'\')) LIKE ?)',
      search(options.q),
      search(options.q),
      search(options.q),
      search(options.q),
    )
  }
  return builder.build()
}

class FilterBuilder {
  private readonly clauses: string[] = []
  private readonly params: unknown[] = []

  add(clause: string, ...values: unknown[]): void {
    let sql = clause
    for (const value of values) {
      this.params.push(value)
      sql = sql.replace('?', `$${this.params.length}`)
    }
    this.clauses.push(sql)
  }

  build(): Filter {
    return {
      where: this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '',
      params: this.params,
    }
  }
}

async function readAdminUser(client: Queryable, userId: string): Promise<AdminUser> {
  const result = await client.query<AdminUserRow>(
    `
    SELECT
      u.id,
      ai.email,
      u.display_name AS name,
      u.status,
      COALESCE(
        array_agg(DISTINCT role_value.role) FILTER (WHERE role_value.role IS NOT NULL),
        ARRAY[]::text[]
      ) AS roles,
      count(DISTINCT m.id)::int AS membership_count,
      count(DISTINCT m.id) FILTER (WHERE m.status = 'active')::int AS active_membership_count,
      u.created_at,
      u.updated_at
    FROM users u
    LEFT JOIN LATERAL (${primaryIdentitySql('u.id')}) ai ON true
    LEFT JOIN tenant_memberships m ON m.user_id = u.id
    LEFT JOIN LATERAL unnest(m.roles) AS role_value(role) ON true
    WHERE u.id = $1
    GROUP BY u.id, ai.email
    LIMIT 1
    `,
    [userId],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`Could not read admin user ${userId}`)
  return toAdminUser(row)
}

function membershipSelectSql(): string {
  return `
    SELECT
      m.id,
      m.tenant_id,
      t.name AS tenant_name,
      t.status AS tenant_status,
      m.user_id,
      ai.email,
      u.display_name AS name,
      u.status AS user_status,
      m.roles,
      m.status AS membership_status,
      m.is_primary,
      b.plan,
      b.credits,
      m.created_at AS membership_created_at,
      m.updated_at AS membership_updated_at
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id
    JOIN tenants t ON t.id = m.tenant_id
    JOIN billing_accounts b ON b.membership_id = m.id
    LEFT JOIN LATERAL (${primaryIdentitySql('u.id')}) ai ON true
  `
}

function adminSessionSelectSql(): string {
  return `
    SELECT
      s.id AS session_id,
      s.membership_id,
      m.tenant_id,
      t.name AS tenant_name,
      t.status AS tenant_status,
      m.user_id,
      ai.email,
      u.display_name AS name,
      u.status AS user_status,
      m.roles,
      m.status AS membership_status,
      s.created_at AS session_created_at,
      s.last_seen_at,
      s.expires_at,
      s.revoked_at,
      s.ip_address,
      s.user_agent,
      s.device_label
    FROM sessions s
    JOIN tenant_memberships m ON m.id = s.membership_id
    JOIN users u ON u.id = m.user_id
    JOIN tenants t ON t.id = m.tenant_id
    LEFT JOIN LATERAL (${primaryIdentitySql('u.id')}) ai ON true
  `
}

function primaryIdentitySql(userIdSql: string): string {
  return `
    SELECT email
    FROM auth_identities ai
    WHERE ai.user_id = ${userIdSql}
      AND ai.provider = 'local'
    ORDER BY ai.is_primary DESC, ai.created_at ASC
    LIMIT 1
  `
}

function normalizePaging(options: AdminListOptions): Paging {
  return {
    limit: Math.min(Math.max(options.limit || defaultLimit, 1), maxLimit),
    offset: Math.max(options.offset || 0, 0),
  }
}

function listResult<T>(items: T[], total: number, paging: Paging) {
  return {
    items,
    meta: {
      limit: paging.limit,
      offset: paging.offset,
      total,
    },
  }
}

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    roles: row.roles,
    membershipCount: row.membership_count,
    activeMembershipCount: row.active_membership_count,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

function toAdminTenant(row: AdminTenantRow): AdminTenant {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    membershipCount: row.membership_count,
    activeMembershipCount: row.active_membership_count,
    activeOwnerCount: row.active_owner_count,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

function toAdminMembership(row: AdminMembershipRow): AdminMembership {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantStatus: row.tenant_status,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    userStatus: row.user_status,
    roles: row.roles,
    status: row.membership_status,
    isPrimary: row.is_primary,
    plan: row.plan,
    credits: row.credits,
    createdAt: toIso(row.membership_created_at),
    updatedAt: toIso(row.membership_updated_at),
  }
}

function toAdminBillingAccount(row: AdminMembershipRow): AdminBillingAccount {
  return {
    membershipId: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    userStatus: row.user_status,
    membershipStatus: row.membership_status,
    roles: row.roles,
    plan: row.plan,
    credits: row.credits,
    updatedAt: toIso(row.membership_updated_at),
  }
}

function toAdminBillingLedgerEntry(row: AdminBillingLedgerEntryRow): AdminBillingLedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    referenceId: row.reference_id,
    relatedEntryId: row.related_entry_id,
    amount: row.amount,
    balance: row.balance,
    type: row.entry_type,
    description: row.description,
    createdByUserId: row.created_by_user_id,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    createdAt: toIso(row.created_at),
  }
}

function toAdminSession(row: AdminSessionRow, currentSessionId: string | null): AdminSession {
  const expiresAt = toIso(row.expires_at)
  const revokedAt = row.revoked_at ? toIso(row.revoked_at) : null
  return {
    sessionId: row.session_id,
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantStatus: row.tenant_status,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    userStatus: row.user_status,
    membershipStatus: row.membership_status,
    roles: row.roles,
    status: sessionStatus(expiresAt, revokedAt),
    createdAt: toIso(row.session_created_at),
    lastSeenAt: row.last_seen_at ? toIso(row.last_seen_at) : null,
    expiresAt,
    revokedAt,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    deviceLabel: row.device_label,
    current: currentSessionId === row.session_id,
  }
}

function toAdminAuditLogEntry(row: AdminAuditLogEntryRow): AdminAuditLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    createdAt: toIso(row.created_at),
  }
}

function search(value: string): string {
  return `%${value.trim().toLowerCase()}%`
}

function isOwner(principal: Principal): boolean {
  return principal.roles.includes(ROLES.OWNER)
}

function hasElevatedRole(roles: Role[]): boolean {
  return roles.includes(ROLES.OWNER) || roles.includes(ROLES.ADMIN)
}

function sessionStatus(expiresAt: string, revokedAt: string | null): AdminSessionStatus {
  if (revokedAt) return 'revoked'
  return new Date(expiresAt).getTime() <= Date.now() ? 'expired' : 'active'
}

async function insertAuditLog(
  client: Queryable,
  input: {
    tenantId: string | null
    userId: string | null
    actorUserId: string | null
    action: string
    resourceType: string
    resourceId: string | null
    ipAddress: string | null
    userAgent: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
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

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
