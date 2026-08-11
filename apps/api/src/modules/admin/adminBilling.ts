import {
  adminAdjustCreditsSchema,
  adminGrantCreditsSchema,
  adminUpdateMembershipPlanSchema,
  PERMISSIONS,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { sessionMetadataFromRequest } from '../../core/auth/requestMetadata.js'
import { AppError } from '../../core/errors.js'
import {
  billingAlertParams,
  billingMembershipParams,
  adminTenantParams,
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

  app.get(
    '/admin/billing/organizations/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.BILLING_READ_ALL) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      reply.header('Cache-Control', 'no-store')
      return await requireLedger(context.ledger).organizationBillingSummary(request.principal!, tenantId)
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
      return await requireLedger(context.ledger).adjustCredits(
        request.principal!,
        membershipId,
        input.amount,
        input.reason,
        sessionMetadataFromRequest(request),
      )
    },
  )

  app.post(
    '/admin/billing/organizations/:tenantId/adjustments',
    { preHandler: requirePermission(PERMISSIONS.BILLING_MANAGE) },
    async (request) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      const input = parse(adminAdjustCreditsSchema, request.body)
      return await requireLedger(context.ledger).adjustOrganizationCredits(
        request.principal!,
        tenantId,
        input.amount,
        input.reason,
        sessionMetadataFromRequest(request),
      )
    },
  )

  app.patch(
    '/admin/billing/memberships/:membershipId/plan',
    { preHandler: requirePermission(PERMISSIONS.BILLING_MANAGE) },
    async (request) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      const input = parse(adminUpdateMembershipPlanSchema, request.body)
      return await requireLedger(context.ledger).updateMembershipPlan(
        request.principal!,
        membershipId,
        input.plan,
        input.grantMonthlyCredits,
        input.reason,
        sessionMetadataFromRequest(request),
      )
    },
  )
}
