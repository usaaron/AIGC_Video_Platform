import { adminSessionStatusSchema, roleSchema, ROLES, type AdminOverview, type Principal } from '@seqora/contracts'
import type { FastifyReply } from 'fastify'
import { z } from 'zod'
import { parseIssuedSessionToken } from '../../core/auth/sessionToken.js'
import { isPlatformAdmin } from '../../core/auth/roles.js'
import { AppError } from '../../core/errors.js'
import type { AppStore } from '../../infra/store.js'
import type { AccountManagementService } from '../accountManagement/service.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { AdminListOptions, AdminRepository } from './repository.js'

export type AdminRouteContext = {
  store: AppStore
  ledger: CreditLedger | null
  adminRepository: AdminRepository | null
  accountManagementService: AccountManagementService | null
  authSecret?: string | undefined
}

export const billingMembershipParams = z.object({ membershipId: z.string().min(1).max(512) })
export const billingAlertParams = z.object({ alertId: z.string().min(1).max(512) })
export const adminTenantParams = z.object({ tenantId: z.string().min(1).max(256) })
export const adminUserParams = z.object({ userId: z.string().min(1).max(256) })
export const adminSessionParams = z.object({ sessionId: z.string().min(1).max(128) })

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
  alertStatus: z.enum(['open', 'acknowledged', 'resolved']).optional(),
  alertSeverity: z.enum(['warning', 'critical']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const sessionListQuery = listQuery.omit({ status: true, type: true }).extend({
  status: adminSessionStatusSchema.optional(),
})

const consoleQuery = listQuery.extend({
  sessionStatus: adminSessionStatusSchema.optional(),
})

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(result.error))
  return result.data
}

export function markDeprecated(reply: FastifyReply, successorPath: string): void {
  reply.header('Deprecation', 'true')
  reply.header('Link', `</api/v1${successorPath}>; rel="successor-version"`)
}

export function adminOrganizationSuccessor(tenantId: string, suffix = ''): string {
  return `/admin/organizations/${encodeURIComponent(tenantId)}${suffix}`
}

export function requireLedger(ledger: CreditLedger | null): CreditLedger {
  if (!ledger) throw new AppError(503, 'BILLING_LEDGER_REQUIRED', 'Billing ledger is required')
  return ledger
}

export function requireAdminRepository(adminRepository: AdminRepository | null): AdminRepository {
  if (!adminRepository) {
    throw new AppError(503, 'ACCOUNT_DATABASE_REQUIRED', 'Postgres account database is required')
  }
  return adminRepository
}

export function requireAccountManagementService(
  accountManagementService: AccountManagementService | null,
): AccountManagementService {
  if (!accountManagementService) {
    throw new AppError(503, 'ACCOUNT_DATABASE_REQUIRED', 'Postgres account database is required')
  }
  return accountManagementService
}

export function parseListQuery(value: unknown): AdminListOptions {
  return parse(listQuery, value)
}

export function parseSessionListQuery(value: unknown): AdminListOptions {
  const input = parse(sessionListQuery, value)
  return { ...input, sessionStatus: input.status }
}

export function parseConsoleQuery(value: unknown): AdminListOptions {
  return parse(consoleQuery, value)
}

export function scopeAdminOptions(principal: Principal, options: AdminListOptions): AdminListOptions {
  if (isPlatformAdmin(principal)) return options
  if (principal.roles.includes(ROLES.ADMIN)) {
    return { ...options, visibilityScope: 'personal' }
  }
  if (principal.roles.includes(ROLES.ORGANIZATION_ADMIN)) {
    return {
      ...options,
      tenantId: principal.tenantId,
      visibilityScope: 'organization',
      scopeTenantId: principal.tenantId,
    }
  }
  return { ...options, tenantId: principal.tenantId, visibilityScope: 'self', scopeTenantId: principal.tenantId }
}

export function currentSessionIdFromCookie(
  token: string | undefined,
  authSecret: string | undefined,
): string | null {
  if (!token || !authSecret) return null
  return parseIssuedSessionToken(token, authSecret)?.sessionId ?? null
}

export function canAccessAdminMembership(
  principal: Principal,
  membership: { tenantId: string; organizationType?: string | null | undefined; roles: readonly string[] },
): boolean {
  if (isPlatformAdmin(principal)) return true
  if (principal.roles.includes(ROLES.ADMIN)) {
    return membership.organizationType === 'personal' && membership.roles.includes('member')
  }
  if (principal.roles.includes(ROLES.ORGANIZATION_ADMIN)) {
    return (
      membership.tenantId === principal.tenantId &&
      membership.organizationType === 'enterprise' &&
      membership.roles.includes('organization_member')
    )
  }
  return membership.tenantId === principal.tenantId && membership.roles.includes('member')
}

export async function readAdminOverview(
  store: AppStore,
  ledger: CreditLedger | null,
  adminRepository: AdminRepository | null = null,
  principal?: Principal,
): Promise<AdminOverview> {
  const today = startOfChinaDay()
  const scopedTenantId = principal && !isPlatformAdmin(principal) ? principal.tenantId : undefined
  const scopedAdminOptions =
    principal && !isPlatformAdmin(principal)
      ? scopeAdminOptions(principal, { limit: 1, offset: 0 })
      : null
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
    ? (await adminRepository.listUsers(scopedAdminOptions ?? { limit: 1, offset: 0 })).meta.total
    : store.read((state) =>
        scopedTenantId
          ? state.users.filter((user) => user.tenantId === scopedTenantId).length
          : state.users.length,
      )
  const activeTasks = adminRepository
    ? await adminRepository.countActiveGenerationTasks(scopedTenantId)
    : store.read(
        (state) =>
          state.tasks.filter(
            (task) =>
              (task.status === 'queued' || task.status === 'running') &&
              (!scopedTenantId || task.tenantId === scopedTenantId),
          ).length,
      )
  return {
    users,
    activeTasks,
    creditsConsumedToday,
    generatedAt: new Date().toISOString(),
  }
}

function startOfChinaDay(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()) - chinaOffsetMs,
  ).toISOString()
}
