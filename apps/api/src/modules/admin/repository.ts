import type {
  AdminAccountStatus,
  AdminAuditLogEntry,
  AdminAuditLogEntryList,
  AdminBillingAccount,
  AdminBillingAccountList,
  AdminBillingLedgerEntry,
  AdminBillingLedgerEntryList,
  AdminBillingReconciliationAlert,
  AdminBillingReconciliationAlertList,
  AdminBillingPaymentReconciliationItem,
  AdminBillingPaymentReconciliationList,
  AdminMembership,
  AdminMembershipDetail,
  AdminMembershipList,
  AdminPasswordResetRequirementUpdateInput,
  AdminSession,
  AdminSessionList,
  AdminSessionStatus,
  AdminSetUserPasswordInput,
  AdminTenant,
  AdminTenantList,
  AdminUser,
  AdminUserList,
  LedgerEntry,
  Plan,
  Principal,
  Role,
  BillingReconciliationAlertSeverity,
  BillingReconciliationAlertStatus,
} from '@seqora/contracts'
import { ROLES } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import {
  hasAdminRole,
  hasElevatedRole,
  hasOrganizationAdminRole,
  hasOwnerRole,
  hasSuperAdminRole,
  isOwner,
  isPlatformAdmin,
} from '../../core/auth/roles.js'
import { AppError } from '../../core/errors.js'
import type { DailyOperationalSummary } from '../../core/observability/metrics.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { SessionMetadata } from '../auth/accounts.js'

const defaultLimit = 50
const maxLimit = 100

export type AdminListOptions = {
  q?: string | undefined
  status?: string | undefined
  tenantId?: string | undefined
  scopeTenantId?: string | undefined
  visibilityScope?: 'all' | 'personal' | 'organization' | 'self' | undefined
  userId?: string | undefined
  membershipId?: string | undefined
  role?: Role | undefined
  type?: LedgerEntry['type'] | undefined
  action?: string | undefined
  resourceType?: string | undefined
  actorUserId?: string | undefined
  sessionStatus?: AdminSessionStatus | undefined
  paymentStatus?: 'processed' | 'ignored' | 'failed' | undefined
  alertStatus?: BillingReconciliationAlertStatus | undefined
  alertSeverity?: BillingReconciliationAlertSeverity | undefined
  limit: number
  offset: number
}

export class AdminRepository {
  constructor(private readonly database: AccountDatabase) {}

  async countActiveGenerationTasks(tenantId?: string): Promise<number> {
    const result = await this.database.query<{ count: number }>(
      `
      SELECT count(*)::int AS count
      FROM generation_tasks
      WHERE status IN ('queued', 'running')
        AND ($1::text IS NULL OR tenant_id = $1)
      `,
      [tenantId ?? null],
    )
    return result.rows[0]?.count ?? 0
  }

  async dailyOperationalSummary(tenantId?: string): Promise<DailyOperationalSummary> {
    const periodStart = startOfChinaDay()
    const [billing, generationTasks, aiJobs, filmPreview] = await Promise.all([
      this.database.query<{
        credits_consumed: number
        refund_count: number
      }>(
        `
        SELECT
          COALESCE(
            SUM(ABS(amount)) FILTER (WHERE entry_type = 'generation' AND amount < 0),
            0
          )::int AS credits_consumed,
          count(*) FILTER (
            WHERE entry_type = 'adjustment'
              AND amount > 0
              AND id LIKE 'refund-%'
          )::int AS refund_count
        FROM (
          SELECT id, tenant_id, entry_type, amount, created_at
          FROM billing_ledger_entries
          UNION ALL
          SELECT id, tenant_id, entry_type, amount, created_at
          FROM organization_billing_ledger_entries
        ) entries
        WHERE created_at >= $1::timestamptz
          AND ($2::text IS NULL OR tenant_id = $2)
        `,
        [periodStart, tenantId ?? null],
      ),
      this.database.query<OperationalStatusCountRow>(
        `
        SELECT
          count(*)::int AS created,
          count(*) FILTER (WHERE status = 'completed')::int AS completed,
          count(*) FILTER (WHERE status = 'failed')::int AS failed,
          count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
        FROM generation_tasks
        WHERE created_at >= $1::timestamptz
          AND ($2::text IS NULL OR tenant_id = $2)
        `,
        [periodStart, tenantId ?? null],
      ),
      this.database.query<OperationalStatusCountRow>(
        `
        SELECT
          count(*)::int AS created,
          count(*) FILTER (WHERE status = 'completed')::int AS completed,
          count(*) FILTER (WHERE status = 'failed')::int AS failed,
          count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
        FROM ai_jobs
        WHERE created_at >= $1::timestamptz
          AND ($2::text IS NULL OR tenant_id = $2)
        `,
        [periodStart, tenantId ?? null],
      ),
      this.database.query<{
        terminal: number
        failed: number
      }>(
        `
        SELECT
          count(*) FILTER (WHERE status IN ('completed', 'failed', 'cancelled'))::int AS terminal,
          count(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM generation_tasks
        WHERE provider = 'local-compose'
          AND created_at >= $1::timestamptz
          AND ($2::text IS NULL OR tenant_id = $2)
        `,
        [periodStart, tenantId ?? null],
      ),
    ])

    const taskCounts = operationalStatusCounts(generationTasks.rows[0])
    const aiJobCounts = operationalStatusCounts(aiJobs.rows[0])
    const filmPreviewTerminal = filmPreview.rows[0]?.terminal ?? 0
    const filmPreviewFailed = filmPreview.rows[0]?.failed ?? 0

    return {
      periodStart,
      generatedAt: new Date().toISOString(),
      creditsConsumed: billing.rows[0]?.credits_consumed ?? 0,
      refundCount: billing.rows[0]?.refund_count ?? 0,
      generationTasks: taskCounts,
      aiJobs: aiJobCounts,
      filmPreview: {
        terminal: filmPreviewTerminal,
        failed: filmPreviewFailed,
        failureRate: filmPreviewTerminal > 0 ? filmPreviewFailed / filmPreviewTerminal : null,
      },
    }
  }

  async listUsers(options: AdminListOptions): Promise<AdminUserList> {
    const filter = buildUserFilter(options)
    const visibleMembership = numberedVisibilityMembershipCondition(options, 'm', 't', filter.params.length)
    const visibleActiveMembership = numberedVisibilityActiveMembershipCondition(
      options,
      'm',
      't',
      filter.params.length + visibleMembership.params.length,
    )
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
        u.password_reset_required,
        COALESCE(
          array_agg(DISTINCT role_value.role) FILTER (
            WHERE role_value.role IS NOT NULL
              AND ${visibleMembership.clause}
          ),
          ARRAY[]::text[]
        ) AS roles,
        count(DISTINCT m.id) FILTER (WHERE ${visibleMembership.clause})::int AS membership_count,
        count(DISTINCT m.id) FILTER (WHERE ${visibleActiveMembership.clause})::int AS active_membership_count,
        u.created_at,
        u.updated_at
      FROM users u
      LEFT JOIN LATERAL (${primaryIdentitySql('u.id')}) ai ON true
      LEFT JOIN tenant_memberships m ON m.user_id = u.id
      LEFT JOIN tenants t ON t.id = m.tenant_id
      LEFT JOIN LATERAL unnest(m.roles) AS role_value(role) ON true
      ${filter.where}
      GROUP BY u.id, ai.email
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT $${filter.params.length + visibleMembership.params.length + visibleActiveMembership.params.length + 1}
      OFFSET $${filter.params.length + visibleMembership.params.length + visibleActiveMembership.params.length + 2}
      `,
      [
        ...filter.params,
        ...visibleMembership.params,
        ...visibleActiveMembership.params,
        paging.limit,
        paging.offset,
      ],
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
        t.is_system,
        t.organization_type,
        t.created_by_user_id,
        created_by_identity.email AS created_by_email,
        created_by.display_name AS created_by_name,
        count(DISTINCT m.id)::int AS membership_count,
        count(DISTINCT m.id) FILTER (WHERE m.status = 'active' AND u.status = 'active')::int
          AS active_membership_count,
        count(DISTINCT m.id) FILTER (
          WHERE m.status = 'active' AND u.status = 'active'
            AND m.roles @> ARRAY['organization_admin']::text[]
        )::int AS active_organization_admin_count,
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
        organizationId: membership.organizationId,
        organizationName: membership.organizationName,
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

  async listBillingPaymentReconciliation(
    options: AdminListOptions,
  ): Promise<AdminBillingPaymentReconciliationList> {
    const filter = buildPaymentReconciliationFilter(options)
    const total = await this.database.query<{ total: number }>(
      `
      SELECT count(*)::int AS total
      FROM billing_payment_reconciliation_items r
      ${filter.where}
      `,
      filter.params,
    )
    const paging = normalizePaging(options)
    const rows = await this.database.query<AdminBillingPaymentReconciliationRow>(
      `
      SELECT
        r.id,
        r.provider,
        r.provider_event_id,
        r.event_type,
        r.payment_session_id,
        r.billing_webhook_event_id,
        r.ledger_entry_id,
        r.tenant_id,
        r.user_id,
        r.membership_id,
        r.status,
        r.amount,
        r.currency,
        r.credits,
        r.message,
        r.metadata,
        r.created_at
      FROM billing_payment_reconciliation_items r
      ${filter.where}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $${filter.params.length + 1}
      OFFSET $${filter.params.length + 2}
      `,
      [...filter.params, paging.limit, paging.offset],
    )
    return listResult(
      rows.rows.map(toAdminBillingPaymentReconciliationItem),
      total.rows[0]?.total ?? 0,
      paging,
    )
  }

  async listBillingReconciliationAlerts(
    options: AdminListOptions,
  ): Promise<AdminBillingReconciliationAlertList> {
    const filter = buildBillingReconciliationAlertFilter(options)
    const total = await this.database.query<{ total: number }>(
      `
      SELECT count(*)::int AS total
      FROM billing_reconciliation_alerts a
      ${filter.where}
      `,
      filter.params,
    )
    const paging = normalizePaging(options)
    const rows = await this.database.query<BillingReconciliationAlertRow>(
      `
      SELECT
        a.id,
        a.provider,
        a.provider_event_id,
        a.event_type,
        a.alert_type,
        a.severity,
        a.status,
        a.payment_session_id,
        a.reconciliation_item_id,
        a.tenant_id,
        a.user_id,
        a.membership_id,
        a.message,
        a.metadata,
        a.notified_at,
        a.acknowledged_by_user_id,
        a.acknowledged_at,
        a.resolved_at,
        a.created_at,
        a.updated_at
      FROM billing_reconciliation_alerts a
      ${filter.where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${filter.params.length + 1}
      OFFSET $${filter.params.length + 2}
      `,
      [...filter.params, paging.limit, paging.offset],
    )
    return listResult(rows.rows.map(toAdminBillingReconciliationAlert), total.rows[0]?.total ?? 0, paging)
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
        throw new AppError(
          400,
          'CANNOT_REVOKE_SELF_SESSION',
          'Use the current account session API to sign out',
        )
      }
      const targetMembership = {
        tenant_id: row.tenant_id,
        organization_type: row.organization_type,
        roles: row.roles,
        status: row.membership_status,
      }
      if (!isPlatformAdmin(principal) && !canAccessMembershipRecord(principal, targetMembership)) {
        if (targetMembership.tenant_id === principal.tenantId && hasElevatedRole(row.roles)) {
          const ownerOnly = (hasOwnerRole(row.roles) || hasSuperAdminRole(row.roles)) && !isOwner(principal)
          throw new AppError(
            403,
            ownerOnly ? 'ELEVATED_SESSION_REQUIRES_OWNER' : 'ELEVATED_SESSION_REQUIRES_PLATFORM_ADMIN',
            ownerOnly
              ? 'Only owners can revoke owner or super admin sessions'
              : 'Only owners or super admins can revoke admin sessions',
          )
        }
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot revoke a session from another workspace')
      }
      if (!canManageElevatedRoles(principal, row.roles)) {
        const ownerOnly = (hasOwnerRole(row.roles) || hasSuperAdminRole(row.roles)) && !isOwner(principal)
        throw new AppError(
          403,
          ownerOnly ? 'ELEVATED_SESSION_REQUIRES_OWNER' : 'ELEVATED_SESSION_REQUIRES_PLATFORM_ADMIN',
          ownerOnly
            ? 'Only owners can revoke owner or super admin sessions'
            : 'Only owners or super admins can revoke admin sessions',
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

  async revokeUserSessions(
    principal: Principal,
    userId: string,
    metadata?: SessionMetadata,
  ): Promise<{ user: AdminUser; revokedSessionCount: number } | null> {
    return this.database.transaction(async (client) => {
      const target = await loadUserSessionManagementTarget(client, principal, userId)
      if (!target) return null

      const revokedSessionCount = await revokeSessionsForUser(client, userId)
      await insertAuditLog(client, {
        tenantId: null,
        userId,
        actorUserId: principal.userId,
        action: 'admin.user_sessions.revoked',
        resourceType: 'user',
        resourceId: userId,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: {
          revokedSessionCount,
          scope: 'admin_console',
        },
      })

      const user = await readAdminUser(client, userId)
      return user ? { user, revokedSessionCount } : null
    })
  }

  async updateBillingReconciliationAlert(
    principal: Principal,
    alertId: string,
    input: {
      status: BillingReconciliationAlertStatus
      message?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<AdminBillingReconciliationAlert | null> {
    return this.database.transaction(async (client) => {
      const alert = await client.query<BillingReconciliationAlertRow>(
        `
        SELECT *
        FROM billing_reconciliation_alerts
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
        `,
        [alertId],
      )
      const row = alert.rows[0]
      if (!row) return null
      if (!isPlatformAdmin(principal) && row.tenant_id !== principal.tenantId) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot update an alert from another workspace')
      }
      const updated = await client.query<BillingReconciliationAlertRow>(
        `
        UPDATE billing_reconciliation_alerts
        SET status = $2,
            acknowledged_by_user_id = CASE WHEN $2 = 'acknowledged' THEN $3 ELSE acknowledged_by_user_id END,
            acknowledged_at = CASE WHEN $2 = 'acknowledged' THEN COALESCE(acknowledged_at, now()) ELSE acknowledged_at END,
            resolved_at = CASE WHEN $2 = 'resolved' THEN COALESCE(resolved_at, now()) ELSE resolved_at END,
            message = COALESCE($4, message),
            metadata = metadata || $5::jsonb,
            updated_at = now()
        WHERE id = $1
        RETURNING *
        `,
        [
          alertId,
          input.status,
          principal.userId,
          input.message ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      )
      return updated.rows[0] ? toAdminBillingReconciliationAlert(updated.rows[0]) : null
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
      if (!isPlatformAdmin(principal)) {
        throw new AppError(
          403,
          'PLATFORM_ADMIN_REQUIRED',
          'Only owners or super admins can change account status',
        )
      }

      const memberships = await client.query<{ tenant_id: string; roles: Role[]; status: string }>(
        `
        SELECT tenant_id, roles, status
        FROM tenant_memberships
        WHERE user_id = $1
        `,
        [userId],
      )
      if (
        memberships.rows.some(
          (membership) =>
            (hasOwnerRole(membership.roles) || hasSuperAdminRole(membership.roles)) && !isOwner(principal),
        )
      ) {
        throw new AppError(
          403,
          'ELEVATED_ACCOUNT_REQUIRES_OWNER',
          'Only owners can change owner or super admin accounts',
        )
      }
      if (memberships.rows.some((membership) => !canManageElevatedRoles(principal, membership.roles))) {
        throw new AppError(
          403,
          'ELEVATED_ACCOUNT_REQUIRES_PLATFORM_ADMIN',
          'Only owners or super admins can manage elevated accounts',
        )
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

  async setPasswordResetRequirement(
    principal: Principal,
    userId: string,
    input: AdminPasswordResetRequirementUpdateInput,
    metadata?: SessionMetadata,
  ): Promise<AdminUser | null> {
    return this.database.transaction(async (client) => {
      const target = await loadPasswordManagementTarget(client, principal, userId)
      if (!target) return null

      await client.query(
        `
        UPDATE users
        SET password_reset_required = $2,
            password_reset_required_at = CASE WHEN $2 THEN now() ELSE NULL END,
            password_reset_required_by_user_id = CASE WHEN $2 THEN $3 ELSE NULL END,
            updated_at = now()
        WHERE id = $1
        `,
        [userId, input.required, principal.userId],
      )
      const revokedSessionCount = input.revokeSessions ? await revokeSessionsForUser(client, userId) : 0
      await insertAuditLog(client, {
        tenantId: null,
        userId,
        actorUserId: principal.userId,
        action: 'admin.password_reset_requirement.updated',
        resourceType: 'user',
        resourceId: userId,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: {
          previousRequired: target.user.password_reset_required,
          required: input.required,
          revokedSessionCount,
          scope: 'admin_console',
        },
      })

      return await readAdminUser(client, userId)
    })
  }

  async setUserPassword(
    principal: Principal,
    userId: string,
    input: AdminSetUserPasswordInput & { passwordHash: string },
    metadata?: SessionMetadata,
  ): Promise<AdminUser | null> {
    return this.database.transaction(async (client) => {
      const target = await loadPasswordManagementTarget(client, principal, userId)
      if (!target) return null

      await client.query(
        `
        UPDATE auth_identities
        SET password_hash = $2,
            updated_at = now()
        WHERE id = $1
        `,
        [target.identityId, input.passwordHash],
      )
      await client.query(
        `
        UPDATE users
        SET password_reset_required = $2,
            password_reset_required_at = CASE WHEN $2 THEN now() ELSE NULL END,
            password_reset_required_by_user_id = CASE WHEN $2 THEN $3 ELSE NULL END,
            updated_at = now()
        WHERE id = $1
        `,
        [userId, input.requireChange, principal.userId],
      )
      const revokedSessionCount = input.revokeSessions ? await revokeSessionsForUser(client, userId) : 0
      await insertAuditLog(client, {
        tenantId: null,
        userId,
        actorUserId: principal.userId,
        action: 'admin.password.temporary_set',
        resourceType: 'auth_identity',
        resourceId: target.identityId,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: {
          requireChange: input.requireChange,
          revokedSessionCount,
          scope: 'admin_console',
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

type OperationalStatusCountRow = {
  created: number
  completed: number
  failed: number
  cancelled: number
}

type AdminUserRow = {
  id: string
  email: string | null
  name: string
  status: AdminAccountStatus
  password_reset_required: boolean
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
  is_system: boolean
  organization_type: AdminTenant['organizationType'] | null
  created_by_user_id: string | null
  created_by_email: string | null
  created_by_name: string | null
  membership_count: number
  active_membership_count: number
  active_organization_admin_count: number
  created_at: Date | string
  updated_at: Date | string
}

type AdminMembershipRow = {
  id: string
  tenant_id: string
  tenant_name: string
  tenant_status: AdminTenant['status']
  organization_type: AdminMembership['organizationType'] | null
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

type AdminBillingPaymentReconciliationRow = {
  id: string
  provider: string
  provider_event_id: string
  event_type: string
  payment_session_id: string | null
  billing_webhook_event_id: string | null
  ledger_entry_id: string | null
  tenant_id: string | null
  user_id: string | null
  membership_id: string | null
  status: AdminBillingPaymentReconciliationItem['status']
  amount: number | null
  currency: string | null
  credits: number | null
  message: string
  metadata: Record<string, unknown> | string
  created_at: Date | string
}

type BillingReconciliationAlertRow = {
  id: string
  provider: string
  provider_event_id: string
  event_type: string
  alert_type: string
  severity: BillingReconciliationAlertSeverity
  status: BillingReconciliationAlertStatus
  payment_session_id: string | null
  reconciliation_item_id: string | null
  tenant_id: string | null
  user_id: string | null
  membership_id: string | null
  message: string
  metadata: Record<string, unknown> | string
  notified_at: Date | string | null
  acknowledged_by_user_id: string | null
  acknowledged_at: Date | string | null
  resolved_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

type AdminSessionRow = {
  session_id: string
  membership_id: string
  tenant_id: string
  tenant_name: string
  tenant_status: AdminTenant['status']
  organization_type: AdminMembership['organizationType'] | null
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

type SqlCondition = {
  clause: string
  params: unknown[]
}

function buildUserFilter(options: AdminListOptions): Filter {
  const builder = new FilterBuilder()
  addVisibilityUserFilter(builder, options, 'u.id')
  if (options.userId) builder.add('u.id = ?', options.userId)
  if (options.status) builder.add('u.status = ?', options.status)
  if (options.tenantId) {
    builder.add(
      'EXISTS (SELECT 1 FROM tenant_memberships tenant_filter WHERE tenant_filter.user_id = u.id AND tenant_filter.tenant_id = ?)',
      options.tenantId,
    )
  }
  addRoleUserFilter(builder, options, 'u.id')
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
  if (options.visibilityScope === 'personal') {
    builder.add('t.organization_type = ?', 'personal')
  } else if (options.visibilityScope === 'organization') {
    builder.add('t.id = ? AND t.organization_type = ?', options.scopeTenantId ?? '', 'enterprise')
  } else if (options.visibilityScope === 'self') {
    builder.add('t.id = ?', options.scopeTenantId ?? '')
  }
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
  addVisibilityMembershipFilter(builder, options, 'm', 't')
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

function addVisibilityUserFilter(
  builder: FilterBuilder,
  options: AdminListOptions,
  userIdSql: string,
): void {
  const condition = visibilityMembershipExistsCondition(options, userIdSql)
  if (condition) builder.add(condition.clause, ...condition.params)
}

function addVisibilityMembershipFilter(
  builder: FilterBuilder,
  options: AdminListOptions,
  membershipAlias: string,
  tenantAlias: string,
): void {
  const condition = visibilityMembershipCondition(options, membershipAlias, tenantAlias)
  if (condition) builder.add(condition.clause, ...condition.params)
}

function addRoleUserFilter(builder: FilterBuilder, options: AdminListOptions, userIdSql: string): void {
  if (!options.role) return
  const condition = visibilityMembershipCondition(options, 'role_filter', 'role_tenant')
  builder.add(
    `
      EXISTS (
        SELECT 1
        FROM tenant_memberships role_filter
        JOIN tenants role_tenant ON role_tenant.id = role_filter.tenant_id
        WHERE role_filter.user_id = ${userIdSql}
          ${options.tenantId ? 'AND role_filter.tenant_id = ?' : ''}
          AND ? = ANY(role_filter.roles)
          ${condition ? `AND ${condition.clause}` : ''}
      )
    `,
    ...(options.tenantId ? [options.tenantId] : []),
    options.role,
    ...(condition?.params ?? []),
  )
}

function visibilityMembershipExistsCondition(
  options: AdminListOptions,
  userIdSql: string,
): SqlCondition | null {
  const condition = visibilityMembershipCondition(options, 'visible_membership', 'visible_tenant')
  if (!condition) return null
  return {
    clause: `
      EXISTS (
        SELECT 1
        FROM tenant_memberships visible_membership
        JOIN tenants visible_tenant ON visible_tenant.id = visible_membership.tenant_id
        WHERE visible_membership.user_id = ${userIdSql}
          AND ${condition.clause}
      )
    `,
    params: condition.params,
  }
}

function visibilityMembershipCondition(
  options: AdminListOptions,
  membershipAlias: string,
  tenantAlias: string,
): SqlCondition | null {
  if (options.visibilityScope === 'personal') {
    return {
      clause: `${membershipAlias}.status = 'active' AND ${tenantAlias}.organization_type = ? AND ? = ANY(${membershipAlias}.roles)`,
      params: ['personal', ROLES.MEMBER],
    }
  }
  if (options.visibilityScope === 'organization') {
    return {
      clause: `${membershipAlias}.status = 'active' AND ${membershipAlias}.tenant_id = ? AND ${tenantAlias}.organization_type = ? AND ? = ANY(${membershipAlias}.roles)`,
      params: [options.scopeTenantId ?? '', 'enterprise', ROLES.ORGANIZATION_MEMBER],
    }
  }
  if (options.visibilityScope === 'self') {
    return {
      clause: `${membershipAlias}.status = 'active' AND ${membershipAlias}.tenant_id = ? AND ? = ANY(${membershipAlias}.roles)`,
      params: [options.scopeTenantId ?? '', ROLES.MEMBER],
    }
  }
  return null
}

function numberedVisibilityMembershipCondition(
  options: AdminListOptions,
  membershipAlias: string,
  tenantAlias: string,
  parameterOffset: number,
): SqlCondition {
  const condition = visibilityMembershipCondition(options, membershipAlias, tenantAlias) ?? {
    clause: 'true',
    params: [],
  }
  return numberedCondition(condition, parameterOffset)
}

function numberedVisibilityActiveMembershipCondition(
  options: AdminListOptions,
  membershipAlias: string,
  tenantAlias: string,
  parameterOffset: number,
): SqlCondition {
  const condition = visibilityMembershipCondition(options, membershipAlias, tenantAlias) ?? {
    clause: `${membershipAlias}.status = 'active'`,
    params: [],
  }
  return numberedCondition(condition, parameterOffset)
}

function numberedCondition(condition: SqlCondition, parameterOffset: number): SqlCondition {
  let index = parameterOffset
  return {
    clause: condition.clause.replace(/\?/g, () => `$${++index}`),
    params: condition.params,
  }
}

function addVisibilityRecordMembershipFilter(
  builder: FilterBuilder,
  options: AdminListOptions,
  membershipIdSql: string,
  userIdSql: string,
  tenantIdSql: string,
): void {
  const condition = visibilityMembershipCondition(options, 'visible_membership', 'visible_tenant')
  if (!condition) return
  builder.add(
    `(
      (
        ${membershipIdSql} IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM tenant_memberships visible_membership
          JOIN tenants visible_tenant ON visible_tenant.id = visible_membership.tenant_id
          WHERE visible_membership.id = ${membershipIdSql}
            AND ${condition.clause}
        )
      )
      OR (
        ${membershipIdSql} IS NULL
        AND ${userIdSql} IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM tenant_memberships visible_membership
          JOIN tenants visible_tenant ON visible_tenant.id = visible_membership.tenant_id
          WHERE visible_membership.user_id = ${userIdSql}
            AND (${tenantIdSql} IS NULL OR visible_membership.tenant_id = ${tenantIdSql})
            AND ${condition.clause}
        )
      )
    )`,
    ...condition.params,
    ...condition.params,
  )
}

function addVisibilityAuditFilter(builder: FilterBuilder, options: AdminListOptions): void {
  const condition = visibilityMembershipCondition(options, 'visible_membership', 'visible_tenant')
  if (!condition) return
  builder.add(
    `(
      (
        e.user_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM tenant_memberships visible_membership
          JOIN tenants visible_tenant ON visible_tenant.id = visible_membership.tenant_id
          WHERE visible_membership.user_id = e.user_id
            AND (e.tenant_id IS NULL OR visible_membership.tenant_id = e.tenant_id)
            AND ${condition.clause}
        )
      )
      OR (
        e.user_id IS NULL
        AND e.tenant_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM tenant_memberships visible_membership
          JOIN tenants visible_tenant ON visible_tenant.id = visible_membership.tenant_id
          WHERE visible_membership.tenant_id = e.tenant_id
            AND ${condition.clause}
        )
      )
    )`,
    ...condition.params,
    ...condition.params,
  )
}

function buildLedgerFilter(options: AdminListOptions): Filter {
  const builder = new FilterBuilder()
  addVisibilityRecordMembershipFilter(builder, options, 'e.membership_id', 'e.user_id', 'e.tenant_id')
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

function buildPaymentReconciliationFilter(options: AdminListOptions): Filter {
  const builder = new FilterBuilder()
  addVisibilityRecordMembershipFilter(builder, options, 'r.membership_id', 'r.user_id', 'r.tenant_id')
  if (options.membershipId) builder.add('r.membership_id = ?', options.membershipId)
  if (options.tenantId) builder.add('r.tenant_id = ?', options.tenantId)
  if (options.userId) builder.add('r.user_id = ?', options.userId)
  if (options.paymentStatus) builder.add('r.status = ?', options.paymentStatus)
  if (options.q?.trim()) {
    builder.add(
      '(lower(r.id) LIKE ? OR lower(r.provider_event_id) LIKE ? OR lower(r.event_type) LIKE ? OR lower(r.message) LIKE ?)',
      search(options.q),
      search(options.q),
      search(options.q),
      search(options.q),
    )
  }
  return builder.build()
}

function buildBillingReconciliationAlertFilter(options: AdminListOptions): Filter {
  const builder = new FilterBuilder()
  addVisibilityRecordMembershipFilter(builder, options, 'a.membership_id', 'a.user_id', 'a.tenant_id')
  if (options.membershipId) builder.add('a.membership_id = ?', options.membershipId)
  if (options.tenantId) builder.add('a.tenant_id = ?', options.tenantId)
  if (options.userId) builder.add('a.user_id = ?', options.userId)
  if (options.alertStatus) builder.add('a.status = ?', options.alertStatus)
  if (options.alertSeverity) builder.add('a.severity = ?', options.alertSeverity)
  if (options.q?.trim()) {
    builder.add(
      '(lower(a.id) LIKE ? OR lower(a.provider_event_id) LIKE ? OR lower(a.event_type) LIKE ? OR lower(a.alert_type) LIKE ? OR lower(a.message) LIKE ?)',
      search(options.q),
      search(options.q),
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
  addVisibilityMembershipFilter(builder, options, 'm', 't')
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
      "(lower(s.id) LIKE ? OR lower(m.user_id) LIKE ? OR lower(u.display_name) LIKE ? OR lower(ai.email) LIKE ? OR lower(t.name) LIKE ? OR lower(COALESCE(s.ip_address, '')) LIKE ? OR lower(COALESCE(s.device_label, '')) LIKE ?)",
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
  addVisibilityAuditFilter(builder, options)
  if (options.tenantId) {
    builder.add(
      `(e.tenant_id = ? OR (
        e.tenant_id IS NULL
        AND e.user_id IN (
          SELECT m.user_id
          FROM tenant_memberships m
          WHERE m.tenant_id = ?
        )
      ))`,
      options.tenantId,
      options.tenantId,
    )
  }
  if (options.userId) builder.add('e.user_id = ?', options.userId)
  if (options.actorUserId) builder.add('e.actor_user_id = ?', options.actorUserId)
  if (options.action) builder.add('e.action = ?', options.action)
  if (options.resourceType) builder.add('e.resource_type = ?', options.resourceType)
  if (options.q?.trim()) {
    builder.add(
      "(lower(e.id) LIKE ? OR lower(e.action) LIKE ? OR lower(e.resource_type) LIKE ? OR lower(COALESCE(e.resource_id, '')) LIKE ?)",
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
      u.password_reset_required,
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
      t.organization_type,
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
      t.organization_type,
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

function operationalStatusCounts(
  row: OperationalStatusCountRow | undefined,
): DailyOperationalSummary['generationTasks'] {
  const created = row?.created ?? 0
  const completed = row?.completed ?? 0
  const failed = row?.failed ?? 0
  const cancelled = row?.cancelled ?? 0
  const terminal = completed + failed + cancelled
  return {
    created,
    completed,
    failed,
    cancelled,
    terminal,
    successRate: terminal > 0 ? completed / terminal : null,
  }
}

function startOfChinaDay(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()) - chinaOffsetMs,
  ).toISOString()
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
    passwordResetRequired: row.password_reset_required,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

function toAdminTenant(row: AdminTenantRow): AdminTenant {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    isSystem: row.is_system,
    organizationType: row.organization_type ?? undefined,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    membershipCount: row.membership_count,
    activeMembershipCount: row.active_membership_count,
    activeOrganizationAdminCount: row.active_organization_admin_count,
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
    organizationType: row.organization_type ?? undefined,
    organizationId: row.tenant_id,
    organizationName: row.tenant_name,
    organizationStatus: row.tenant_status,
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
    organizationId: row.tenant_id,
    organizationName: row.tenant_name,
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

function toAdminBillingPaymentReconciliationItem(
  row: AdminBillingPaymentReconciliationRow,
): AdminBillingPaymentReconciliationItem {
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    eventType: row.event_type,
    paymentSessionId: row.payment_session_id,
    billingWebhookEventId: row.billing_webhook_event_id,
    ledgerEntryId: row.ledger_entry_id,
    tenantId: row.tenant_id,
    organizationId: row.tenant_id,
    userId: row.user_id,
    membershipId: row.membership_id,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    credits: row.credits,
    message: row.message,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    createdAt: toIso(row.created_at),
  }
}

function toAdminBillingReconciliationAlert(
  row: BillingReconciliationAlertRow,
): AdminBillingReconciliationAlert {
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    eventType: row.event_type,
    paymentSessionId: row.payment_session_id,
    reconciliationItemId: row.reconciliation_item_id,
    tenantId: row.tenant_id,
    organizationId: row.tenant_id,
    userId: row.user_id,
    membershipId: row.membership_id,
    alertType: row.alert_type,
    severity: row.severity,
    status: row.status,
    message: row.message,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    notifiedAt: row.notified_at ? toIso(row.notified_at) : null,
    acknowledgedByUserId: row.acknowledged_by_user_id,
    acknowledgedAt: row.acknowledged_at ? toIso(row.acknowledged_at) : null,
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
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
    organizationId: row.tenant_id,
    organizationName: row.tenant_name,
    organizationStatus: row.tenant_status,
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
    organizationId: row.tenant_id,
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

function canManageElevatedRoles(principal: Principal, roles: Role[]): boolean {
  if (principal.roles.includes(ROLES.ADMIN) && roles.includes(ROLES.ORGANIZATION_MEMBER)) return false
  if (principal.roles.includes(ROLES.ORGANIZATION_ADMIN) && roles.includes(ROLES.MEMBER)) return false
  if (!hasElevatedRole(roles)) return true
  if (isOwner(principal)) return true
  return (
    isPlatformAdmin(principal) &&
    (hasAdminRole(roles) || hasOrganizationAdminRole(roles)) &&
    !hasOwnerRole(roles) &&
    !hasSuperAdminRole(roles)
  )
}

function canAccessMembershipRecord(
  principal: Principal,
  membership: MembershipAccessRow,
): boolean {
  if (isPlatformAdmin(principal)) return true
  if (membership.status !== 'active') return false
  if (principal.roles.includes(ROLES.ADMIN)) {
    return membership.organization_type === 'personal' && membership.roles.includes(ROLES.MEMBER)
  }
  if (principal.roles.includes(ROLES.ORGANIZATION_ADMIN)) {
    return (
      membership.tenant_id === principal.tenantId &&
      membership.organization_type === 'enterprise' &&
      membership.roles.includes(ROLES.ORGANIZATION_MEMBER)
    )
  }
  return membership.tenant_id === principal.tenantId && membership.roles.includes(ROLES.MEMBER)
}

function assertNonPlatformCanManageVisibleMemberships(
  principal: Principal,
  memberships: MembershipAccessRow[],
  operation: 'password' | 'session',
  fallbackMessage: string,
): void {
  const activeMemberships = memberships.filter((membership) => membership.status === 'active')
  const visibleMemberships = activeMemberships.filter((membership) =>
    canAccessMembershipRecord(principal, membership),
  )
  if (visibleMemberships.length > 0 && visibleMemberships.length === activeMemberships.length) return

  if (activeMemberships.some((membership) => hasElevatedRole(membership.roles))) {
    throw new AppError(
      403,
      operation === 'session'
        ? 'ELEVATED_SESSION_REQUIRES_PLATFORM_ADMIN'
        : 'ELEVATED_ACCOUNT_REQUIRES_PLATFORM_ADMIN',
      operation === 'session'
        ? 'Only owners or super admins can revoke elevated account sessions'
        : 'Only owners or super admins can reset elevated account passwords',
    )
  }
  if (
    principal.roles.includes(ROLES.ADMIN) &&
    activeMemberships.some((membership) => membership.roles.includes(ROLES.ORGANIZATION_MEMBER))
  ) {
    throw new AppError(
      403,
      'ORGANIZATION_MEMBER_REQUIRES_ORGANIZATION_ADMIN',
      operation === 'session'
        ? 'Only organization administrators can revoke organization member sessions'
        : 'Only organization administrators can manage organization member accounts',
    )
  }
  if (
    principal.roles.includes(ROLES.ORGANIZATION_ADMIN) &&
    activeMemberships.some((membership) => membership.roles.includes(ROLES.MEMBER))
  ) {
    throw new AppError(
      403,
      'PLATFORM_MEMBER_REQUIRES_PLATFORM_ADMIN',
      operation === 'session'
        ? 'Only platform administrators can revoke member sessions'
        : 'Only platform administrators can manage member accounts',
    )
  }
  throw new AppError(403, 'TENANT_SCOPE_MISMATCH', fallbackMessage)
}

type PasswordManagementTarget = {
  user: {
    id: string
    status: AdminAccountStatus
    password_reset_required: boolean
  }
  identityId: string
  memberships: MembershipAccessRow[]
}

type MembershipAccessRow = {
  tenant_id: string
  organization_type: AdminMembership['organizationType'] | null
  roles: Role[]
  status: string
}

async function loadUserSessionManagementTarget(
  client: Queryable,
  principal: Principal,
  userId: string,
): Promise<Pick<PasswordManagementTarget, 'user' | 'memberships'> | null> {
  const user = await client.query<PasswordManagementTarget['user']>(
    `
    SELECT id, status, password_reset_required
    FROM users
    WHERE id = $1
    LIMIT 1
    FOR UPDATE
    `,
    [userId],
  )
  const userRow = user.rows[0]
  if (!userRow) return null

  const memberships = await client.query<MembershipAccessRow>(
    `
    SELECT m.tenant_id, t.organization_type, m.roles, m.status
    FROM tenant_memberships m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = $1
    `,
    [userId],
  )
  assertCanManageUserSessions(principal, userId, memberships.rows)
  return { user: userRow, memberships: memberships.rows }
}

async function loadPasswordManagementTarget(
  client: Queryable,
  principal: Principal,
  userId: string,
): Promise<PasswordManagementTarget | null> {
  const user = await client.query<PasswordManagementTarget['user']>(
    `
    SELECT id, status, password_reset_required
    FROM users
    WHERE id = $1
    LIMIT 1
    FOR UPDATE
    `,
    [userId],
  )
  const userRow = user.rows[0]
  if (!userRow) return null

  const identity = await client.query<{ id: string }>(
    `
    SELECT id
    FROM auth_identities
    WHERE user_id = $1
      AND provider = 'local'
    ORDER BY is_primary DESC, created_at ASC
    LIMIT 1
    FOR UPDATE
    `,
    [userId],
  )
  const identityId = identity.rows[0]?.id
  if (!identityId) {
    throw new AppError(
      409,
      'LOCAL_PASSWORD_IDENTITY_REQUIRED',
      'Account does not have a local password identity',
    )
  }

  const memberships = await client.query<MembershipAccessRow>(
    `
    SELECT m.tenant_id, t.organization_type, m.roles, m.status
    FROM tenant_memberships m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = $1
    `,
    [userId],
  )
  assertCanManageAccountPassword(principal, userId, memberships.rows)
  return { user: userRow, identityId, memberships: memberships.rows }
}

function assertCanManageUserSessions(
  principal: Principal,
  userId: string,
  memberships: MembershipAccessRow[],
): void {
  if (principal.userId === userId) {
    throw new AppError(
      400,
      'CANNOT_REVOKE_SELF_USER_SESSIONS',
      'Use the current account session API to sign out',
    )
  }

  if (!isPlatformAdmin(principal)) {
    assertNonPlatformCanManageVisibleMemberships(
      principal,
      memberships,
      'session',
      'Cannot revoke another workspace account sessions',
    )
    return
  }

  if (
    memberships.some(
      (membership) =>
        (hasOwnerRole(membership.roles) || hasSuperAdminRole(membership.roles)) && !isOwner(principal),
    )
  ) {
    throw new AppError(
      403,
      'ELEVATED_SESSION_REQUIRES_OWNER',
      'Only owners can revoke owner or super admin sessions',
    )
  }
  if (memberships.some((membership) => !canManageElevatedRoles(principal, membership.roles))) {
    throw new AppError(
      403,
      'ELEVATED_SESSION_REQUIRES_PLATFORM_ADMIN',
      'Only owners or super admins can revoke elevated account sessions',
    )
  }
}

function assertCanManageAccountPassword(
  principal: Principal,
  userId: string,
  memberships: MembershipAccessRow[],
): void {
  if (principal.userId === userId) {
    throw new AppError(400, 'CANNOT_MANAGE_SELF_PASSWORD', 'Use the current account password API')
  }

  if (!isPlatformAdmin(principal)) {
    assertNonPlatformCanManageVisibleMemberships(
      principal,
      memberships,
      'password',
      'Cannot manage another workspace account',
    )
    return
  }

  if (
    memberships.some(
      (membership) =>
        (hasOwnerRole(membership.roles) || hasSuperAdminRole(membership.roles)) && !isOwner(principal),
    )
  ) {
    throw new AppError(
      403,
      'ELEVATED_ACCOUNT_REQUIRES_OWNER',
      'Only owners can reset owner or super admin account passwords',
    )
  }
  if (memberships.some((membership) => !canManageElevatedRoles(principal, membership.roles))) {
    throw new AppError(
      403,
      'ELEVATED_ACCOUNT_REQUIRES_PLATFORM_ADMIN',
      'Only owners or super admins can reset elevated account passwords',
    )
  }
}

async function revokeSessionsForUser(client: Queryable, userId: string): Promise<number> {
  const revoked = await client.query<{ count: number }>(
    `
    WITH revoked AS (
      UPDATE sessions s
      SET revoked_at = now()
      FROM tenant_memberships m
      WHERE s.membership_id = m.id
        AND m.user_id = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      RETURNING s.id
    )
    SELECT count(*)::int AS count
    FROM revoked
    `,
    [userId],
  )
  return revoked.rows[0]?.count ?? 0
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
