import {
  adminAccountStatusUpdateSchema,
  adminAdjustCreditsSchema,
  adminGrantCreditsSchema,
  adminPasswordResetRequirementUpdateSchema,
  adminSessionStatusSchema,
  adminSetUserPasswordSchema,
  createTenantUserSchema,
  PERMISSIONS,
  roleSchema,
  adminTransferOrganizationAdminSchema,
  updateMembershipRolesSchema,
  updateWorkspaceSchema,
  type AdminConsole,
  type AdminOverview,
  type Principal,
} from '@seqora/contracts'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { hashPassword } from '../../core/auth/password.js'
import { SESSION_COOKIE } from '../../core/auth/provider.js'
import { sessionMetadataFromRequest } from '../../core/auth/requestMetadata.js'
import { parseIssuedSessionToken } from '../../core/auth/sessionToken.js'
import { isPlatformAdmin } from '../../core/auth/roles.js'
import { AppError } from '../../core/errors.js'
import type { AppStore } from '../../infra/store.js'
import type { AccountManagementService } from '../accountManagement/service.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { AdminListOptions, AdminRepository } from './repository.js'

const billingMembershipParams = z.object({ membershipId: z.string().min(1).max(512) })
const adminTenantParams = z.object({ tenantId: z.string().min(1).max(256) })
const adminUserParams = z.object({ userId: z.string().min(1).max(256) })
const adminSessionParams = z.object({ sessionId: z.string().min(1).max(128) })
const listQuery = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  tenantId: z.string().min(1).max(256).optional(),
  userId: z.string().min(1).max(256).optional(),
  membershipId: z.string().min(1).max(512).optional(),
  role: roleSchema.optional(),
  type: z.enum(['grant', 'generation', 'adjustment']).optional(),
  action: z.string().min(1).max(120).optional(),
  resourceType: z.string().min(1).max(120).optional(),
  actorUserId: z.string().min(1).max(256).optional(),
  paymentStatus: z.enum(['processed', 'ignored', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
const sessionListQuery = listQuery.omit({ status: true, type: true }).extend({
  status: adminSessionStatusSchema.optional(),
})
const consoleQuery = listQuery.extend({
  sessionStatus: adminSessionStatusSchema.optional(),
})

export async function registerAdminRoutes(
  app: FastifyInstance,
  store: AppStore,
  ledger: CreditLedger | null = null,
  adminRepository: AdminRepository | null = null,
  accountManagementService: AccountManagementService | null = null,
  authSecret?: string,
): Promise<void> {
  app.get(
    '/admin/overview',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await readAdminOverview(store, ledger, adminRepository, request.principal!)
    },
  )

  app.get(
    '/admin/console',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const repository = requireAdminRepository(adminRepository)
      const options = scopeAdminOptions(request.principal!, parseConsoleQuery(request.query))
      const currentSessionId = currentSessionIdFromCookie(request.cookies[SESSION_COOKIE], authSecret)
      const [
        overview,
        users,
        tenants,
        memberships,
        billingAccounts,
        billingLedgerEntries,
        billingPaymentReconciliation,
        sessions,
        auditLogs,
      ] = await Promise.all([
        readAdminOverview(store, ledger, repository, request.principal!),
        repository.listUsers(options),
        repository.listTenants(options),
        repository.listMemberships(options),
        repository.listBillingAccounts(options),
        repository.listBillingLedgerEntries(options),
        repository.listBillingPaymentReconciliation(options),
        repository.listSessions(options, currentSessionId),
        repository.listAuditLogEntries(options),
      ])
      const snapshot: AdminConsole = {
        overview,
        users,
        tenants,
        organizations: tenants,
        memberships,
        billingAccounts,
        billingLedgerEntries,
        billingPaymentReconciliation,
        sessions,
        auditLogs,
        generatedAt: new Date().toISOString(),
      }
      return snapshot
    },
  )

  app.get(
    '/admin/users',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listUsers(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.patch(
    '/admin/users/:userId/status',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request) => {
      const { userId } = parse(adminUserParams, request.params)
      const input = parse(adminAccountStatusUpdateSchema, request.body)
      const updated = await requireAdminRepository(adminRepository).setAccountStatus(
        request.principal!,
        userId,
        input.status,
        sessionMetadataFromRequest(request),
      )
      if (!updated) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      return updated
    },
  )

  app.patch(
    '/admin/users/:userId/password-reset-requirement',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request) => {
      const { userId } = parse(adminUserParams, request.params)
      const input = parse(adminPasswordResetRequirementUpdateSchema, request.body)
      const updated = await requireAdminRepository(adminRepository).setPasswordResetRequirement(
        request.principal!,
        userId,
        input,
        sessionMetadataFromRequest(request),
      )
      if (!updated) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      return updated
    },
  )

  app.put(
    '/admin/users/:userId/password',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request) => {
      const { userId } = parse(adminUserParams, request.params)
      const input = parse(adminSetUserPasswordSchema, request.body)
      const updated = await requireAdminRepository(adminRepository).setUserPassword(
        request.principal!,
        userId,
        { ...input, passwordHash: hashPassword(input.newPassword) },
        sessionMetadataFromRequest(request),
      )
      if (!updated) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      return updated
    },
  )

  app.get(
    '/admin/tenants',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      markDeprecated(reply, '/admin/organizations')
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listTenants(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )
  app.get(
    '/admin/organizations',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listTenants(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.patch(
    '/admin/tenants/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      markDeprecated(reply, adminOrganizationSuccessor(tenantId))
      reply.header('Cache-Control', 'no-store')
      return await requireAccountManagementService(accountManagementService).adminUpdateWorkspace(
        request.principal!,
        tenantId,
        parse(updateWorkspaceSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )
  app.patch(
    '/admin/organizations/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      reply.header('Cache-Control', 'no-store')
      return await requireAccountManagementService(accountManagementService).adminUpdateWorkspace(
        request.principal!,
        tenantId,
        parse(updateWorkspaceSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )

  app.delete(
    '/admin/tenants/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      markDeprecated(reply, adminOrganizationSuccessor(tenantId))
      const workspace = await requireAccountManagementService(accountManagementService).adminDisableWorkspace(
        request.principal!,
        tenantId,
        sessionMetadataFromRequest(request),
      )
      reply.header('Cache-Control', 'no-store')
      return workspace
    },
  )
  app.delete(
    '/admin/organizations/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      const workspace = await requireAccountManagementService(accountManagementService).adminDisableWorkspace(
        request.principal!,
        tenantId,
        sessionMetadataFromRequest(request),
      )
      reply.header('Cache-Control', 'no-store')
      return workspace
    },
  )

  app.post(
    '/admin/organizations/:tenantId/admin-transfer',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      reply.header('Cache-Control', 'no-store')
      return await requireAccountManagementService(accountManagementService).adminTransferOrganizationAdmin(
        request.principal!,
        tenantId,
        parse(adminTransferOrganizationAdminSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )
  for (const path of [
    '/admin/organizations/:tenantId/organization-admin-transfer',
    '/admin/tenants/:tenantId/organization-admin-transfer',
  ]) {
    app.post(path, { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) }, async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      reply
        .header('Cache-Control', 'no-store')
        .header('Deprecation', 'true')
        .header(
          'Link',
          `</api/v1/admin/organizations/${encodeURIComponent(tenantId)}/admin-transfer>; rel="successor-version"`,
        )
      return await requireAccountManagementService(accountManagementService).adminTransferOrganizationAdmin(
        request.principal!,
        tenantId,
        parse(adminTransferOrganizationAdminSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    })
  }

  app.post(
    '/admin/tenants/:tenantId/users',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      markDeprecated(reply, adminOrganizationSuccessor(tenantId, '/users'))
      const member = await requireAccountManagementService(accountManagementService).adminCreateTenantUser(
        request.principal!,
        tenantId,
        parse(createTenantUserSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return reply.code(201).send(member)
    },
  )
  app.post(
    '/admin/organizations/:tenantId/users',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      const member = await requireAccountManagementService(accountManagementService).adminCreateTenantUser(
        request.principal!,
        tenantId,
        parse(createTenantUserSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return reply.code(201).send(member)
    },
  )

  app.get(
    '/admin/memberships',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listMemberships(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.patch(
    '/admin/memberships/:membershipId/roles',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      const detail = await requireAdminRepository(adminRepository).findMembership(membershipId)
      if (!detail) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      if (
        !isPlatformAdmin(request.principal!) &&
        detail.membership.tenantId !== request.principal!.tenantId
      ) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot manage another workspace membership')
      }
      reply.header('Cache-Control', 'no-store')
      return await requireAccountManagementService(accountManagementService).adminUpdateMembershipRoles(
        request.principal!,
        detail.membership.tenantId,
        detail.membership.userId,
        parse(updateMembershipRolesSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )

  app.delete(
    '/admin/memberships/:membershipId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      const detail = await requireAdminRepository(adminRepository).findMembership(membershipId)
      if (!detail) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      if (
        !isPlatformAdmin(request.principal!) &&
        detail.membership.tenantId !== request.principal!.tenantId
      ) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot manage another workspace membership')
      }
      await requireAccountManagementService(accountManagementService).adminDisableMembership(
        request.principal!,
        detail.membership.tenantId,
        detail.membership.userId,
        sessionMetadataFromRequest(request),
      )
      return reply.code(204).send()
    },
  )

  app.get(
    '/admin/memberships/:membershipId',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      reply.header('Cache-Control', 'no-store')
      const detail = await requireAdminRepository(adminRepository).findMembership(membershipId)
      if (!detail) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      if (
        !isPlatformAdmin(request.principal!) &&
        detail.membership.tenantId !== request.principal!.tenantId
      ) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot read another workspace membership')
      }
      return detail
    },
  )

  app.get(
    '/admin/billing/accounts',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listBillingAccounts(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.get(
    '/admin/billing/ledger',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listBillingLedgerEntries(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.get(
    '/admin/billing/reconciliation',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listBillingPaymentReconciliation(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.get(
    '/admin/sessions',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listSessions(
        scopeAdminOptions(request.principal!, parseSessionListQuery(request.query)),
        currentSessionIdFromCookie(request.cookies[SESSION_COOKIE], authSecret),
      )
    },
  )

  app.delete(
    '/admin/sessions/:sessionId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { sessionId } = parse(adminSessionParams, request.params)
      const revoked = await requireAdminRepository(adminRepository).revokeSession(
        request.principal!,
        sessionId,
        sessionMetadataFromRequest(request),
      )
      if (!revoked) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session does not exist')
      reply.header('Cache-Control', 'no-store')
      return reply.code(204).send()
    },
  )

  app.get(
    '/admin/audit-logs',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listAuditLogEntries(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.get(
    '/admin/billing/memberships/:membershipId',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      reply.header('Cache-Control', 'no-store')
      const detail = await requireAdminRepository(adminRepository).findMembership(membershipId)
      if (!detail) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      if (
        !isPlatformAdmin(request.principal!) &&
        detail.membership.tenantId !== request.principal!.tenantId
      ) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot read another workspace membership')
      }
      return detail
    },
  )

  app.post(
    '/admin/billing/grants',
    { preHandler: requirePermission(PERMISSIONS.BILLING_MANAGE) },
    async (request) => {
      const input = parse(adminGrantCreditsSchema, request.body)
      return await requireLedger(ledger).grantCredits(request.principal!, input.amount, input.reason)
    },
  )

  app.post(
    '/admin/billing/memberships/:membershipId/adjustments',
    { preHandler: requirePermission(PERMISSIONS.BILLING_MANAGE) },
    async (request) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      const input = parse(adminAdjustCreditsSchema, request.body)
      return await requireLedger(ledger).adjustCredits(
        request.principal!,
        membershipId,
        input.amount,
        input.reason,
      )
    },
  )
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(result.error))
  return result.data
}

function markDeprecated(reply: FastifyReply, successorPath: string): void {
  reply.header('Deprecation', 'true')
  reply.header('Link', `</api/v1${successorPath}>; rel="successor-version"`)
}

function adminOrganizationSuccessor(tenantId: string, suffix = ''): string {
  return `/admin/organizations/${encodeURIComponent(tenantId)}${suffix}`
}

function requireLedger(ledger: CreditLedger | null): CreditLedger {
  if (!ledger) throw new AppError(503, 'BILLING_LEDGER_REQUIRED', 'Billing ledger is required')
  return ledger
}

function requireAdminRepository(adminRepository: AdminRepository | null): AdminRepository {
  if (!adminRepository) {
    throw new AppError(503, 'ACCOUNT_DATABASE_REQUIRED', 'Postgres account database is required')
  }
  return adminRepository
}

function requireAccountManagementService(
  accountManagementService: AccountManagementService | null,
): AccountManagementService {
  if (!accountManagementService) {
    throw new AppError(503, 'ACCOUNT_DATABASE_REQUIRED', 'Postgres account database is required')
  }
  return accountManagementService
}

function parseListQuery(value: unknown): AdminListOptions {
  return parse(listQuery, value)
}

function parseSessionListQuery(value: unknown): AdminListOptions {
  const input = parse(sessionListQuery, value)
  return { ...input, sessionStatus: input.status }
}

function parseConsoleQuery(value: unknown): AdminListOptions {
  return parse(consoleQuery, value)
}

function scopeAdminOptions(principal: Principal, options: AdminListOptions): AdminListOptions {
  if (isPlatformAdmin(principal)) return options
  return { ...options, tenantId: principal.tenantId }
}

async function readAdminOverview(
  store: AppStore,
  ledger: CreditLedger | null,
  adminRepository: AdminRepository | null = null,
  principal?: Principal,
): Promise<AdminOverview> {
  const today = startOfChinaDay()
  const scopedTenantId = principal && !isPlatformAdmin(principal) ? principal.tenantId : undefined
  const creditsConsumedToday = ledger
    ? await ledger.consumedCreditsSince(today, scopedTenantId)
    : store.read((state) =>
        Math.abs(
          state.ledger
            .filter(
              (entry) =>
                entry.type === 'generation' &&
                entry.createdAt >= today &&
                (!scopedTenantId || entry.tenantId === scopedTenantId),
            )
            .reduce((total, entry) => total + entry.amount, 0),
        ),
      )
  const users = adminRepository
    ? (await adminRepository.listUsers({ limit: 1, offset: 0, tenantId: scopedTenantId })).meta.total
    : store.read((state) =>
        scopedTenantId
          ? state.users.filter((user) => user.tenantId === scopedTenantId).length
          : state.users.length,
      )
  return {
    users,
    activeTasks: store.read(
      (state) =>
        state.tasks.filter(
          (task) =>
            (task.status === 'queued' || task.status === 'running') &&
            (!scopedTenantId || task.tenantId === scopedTenantId),
        ).length,
    ),
    creditsConsumedToday,
    generatedAt: new Date().toISOString(),
  }
}

function currentSessionIdFromCookie(
  token: string | undefined,
  authSecret: string | undefined,
): string | null {
  if (!token || !authSecret) return null
  return parseIssuedSessionToken(token, authSecret)?.sessionId ?? null
}

function startOfChinaDay(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()) - chinaOffsetMs,
  ).toISOString()
}
