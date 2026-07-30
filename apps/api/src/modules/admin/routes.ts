import {
  adminAccountStatusUpdateSchema,
  adminAdjustCreditsSchema,
  adminGrantCreditsSchema,
  PERMISSIONS,
  roleSchema,
  type AdminOverview,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { AdminListOptions, AdminRepository } from './repository.js'

const billingMembershipParams = z.object({ membershipId: z.string().min(1).max(512) })
const adminUserParams = z.object({ userId: z.string().min(1).max(256) })
const listQuery = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  tenantId: z.string().min(1).max(256).optional(),
  userId: z.string().min(1).max(256).optional(),
  membershipId: z.string().min(1).max(512).optional(),
  role: roleSchema.optional(),
  type: z.enum(['grant', 'generation', 'adjustment']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function registerAdminRoutes(
  app: FastifyInstance,
  store: AppStore,
  ledger: CreditLedger | null = null,
  adminRepository: AdminRepository | null = null,
): Promise<void> {
  app.get(
    '/admin/overview',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async () => {
      const today = startOfChinaDay()
      const creditsConsumedToday = ledger
        ? await ledger.consumedCreditsSince(today)
        : store.read((state) =>
            Math.abs(
              state.ledger
                .filter((entry) => entry.type === 'generation' && entry.createdAt >= today)
                .reduce((total, entry) => total + entry.amount, 0),
            ),
          )
      const overview: AdminOverview = {
        users: store.read((state) => state.users.length),
        activeTasks: store.read(
          (state) =>
            state.tasks.filter((task) => task.status === 'queued' || task.status === 'running').length,
        ),
        creditsConsumedToday,
        generatedAt: new Date().toISOString(),
      }
      return overview
    },
  )

  app.get(
    '/admin/users',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listUsers(parseListQuery(request.query))
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
      )
      if (!updated) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      return updated
    },
  )

  app.get(
    '/admin/tenants',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listTenants(parseListQuery(request.query))
    },
  )

  app.get(
    '/admin/memberships',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listMemberships(parseListQuery(request.query))
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
      return detail
    },
  )

  app.get(
    '/admin/billing/accounts',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listBillingAccounts(parseListQuery(request.query))
    },
  )

  app.get(
    '/admin/billing/ledger',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(adminRepository).listBillingLedgerEntries(
        parseListQuery(request.query),
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

function parseListQuery(value: unknown): AdminListOptions {
  return parse(listQuery, value)
}

function startOfChinaDay(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()) - chinaOffsetMs,
  ).toISOString()
}
