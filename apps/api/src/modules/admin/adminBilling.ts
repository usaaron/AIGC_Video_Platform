import { adminAdjustCreditsSchema, adminGrantCreditsSchema, PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { sessionMetadataFromRequest } from '../../core/auth/requestMetadata.js'
import { isPlatformAdmin } from '../../core/auth/roles.js'
import { AppError } from '../../core/errors.js'
import {
  billingAlertParams,
  billingMembershipParams,
  canAccessAdminMembership,
  parse,
  parseListQuery,
  requireAdminRepository,
  requireLedger,
  scopeAdminOptions,
  type AdminRouteContext,
} from './routeContext.js'

const reconciliationAlertUpdateSchema = z.object({
  status: z.enum(['acknowledged', 'resolved']),
  message: z.string().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export function registerAdminBillingRoutes(app: FastifyInstance, context: AdminRouteContext): void {
  app.get(
    '/admin/billing/accounts',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listBillingAccounts(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.get(
    '/admin/billing/ledger',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listBillingLedgerEntries(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.get(
    '/admin/billing/reconciliation',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listBillingPaymentReconciliation(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.get(
    '/admin/billing/reconciliation-alerts',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listBillingReconciliationAlerts(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.patch(
    '/admin/billing/reconciliation-alerts/:alertId',
    { preHandler: requirePermission(PERMISSIONS.BILLING_MANAGE) },
    async (request) => {
      const { alertId } = parse(billingAlertParams, request.params)
      const input = parse(reconciliationAlertUpdateSchema, request.body)
      const updated = await requireAdminRepository(context.adminRepository).updateBillingReconciliationAlert(
        request.principal!,
        alertId,
        {
          status: input.status,
          metadata: input.metadata,
          ...(input.message !== undefined ? { message: input.message } : {}),
        },
      )
      if (!updated) throw new AppError(404, 'ALERT_NOT_FOUND', 'Alert does not exist')
      return updated
    },
  )

  app.get(
    '/admin/billing/memberships/:membershipId',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      reply.header('Cache-Control', 'no-store')
      const detail = await requireAdminRepository(context.adminRepository).findMembership(membershipId)
      if (!detail) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      if (!canAccessAdminMembership(request.principal!, detail.membership)) {
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
      return await requireLedger(context.ledger).grantCredits(
        request.principal!,
        input.amount,
        input.reason,
        sessionMetadataFromRequest(request),
      )
    },
  )

  app.post(
    '/admin/billing/memberships/:membershipId/adjustments',
    { preHandler: requirePermission(PERMISSIONS.BILLING_MANAGE) },
    async (request) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      const input = parse(adminAdjustCreditsSchema, request.body)
      const detail = await requireAdminRepository(context.adminRepository).findMembership(membershipId)
      if (!detail) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      if (!canAccessAdminMembership(request.principal!, detail.membership)) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot adjust another workspace membership')
      }
      const principal = isPlatformAdmin(request.principal!)
        ? request.principal!
        : { ...request.principal!, tenantId: detail.membership.tenantId }
      return await requireLedger(context.ledger).adjustCredits(
        principal,
        membershipId,
        input.amount,
        input.reason,
        sessionMetadataFromRequest(request),
      )
    },
  )
}
