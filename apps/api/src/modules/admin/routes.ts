import { PERMISSIONS, type AdminConsole } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../core/auth/authorization.js'
import { SESSION_COOKIE } from '../../core/auth/provider.js'
import type { AppStore } from '../../infra/store.js'
import type { AccountManagementService } from '../accountManagement/service.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { registerAdminAuditRoutes } from './adminAudit.js'
import { registerAdminBillingRoutes } from './adminBilling.js'
import { registerAdminComplianceRoutes } from './adminCompliance.js'
import { registerAdminOrganizationsRoutes } from './adminOrganizations.js'
import { registerAdminSessionsRoutes } from './adminSessions.js'
import { registerAdminUsageRoutes } from './adminUsage.js'
import { registerAdminUsersRoutes } from './adminUsers.js'
import type { AdminRepository } from './repository.js'
import {
  currentSessionIdFromCookie,
  parseConsoleQuery,
  readAdminOverview,
  requireAdminRepository,
  scopeAdminOptions,
  type AdminRouteContext,
} from './routeContext.js'

export async function registerAdminRoutes(
  app: FastifyInstance,
  store: AppStore,
  ledger: CreditLedger | null = null,
  adminRepository: AdminRepository | null = null,
  accountManagementService: AccountManagementService | null = null,
  authSecret?: string,
): Promise<void> {
  const context: AdminRouteContext = {
    store,
    ledger,
    adminRepository,
    accountManagementService,
    authSecret,
  }

  registerAdminOverviewRoutes(app, context)
  registerAdminUsersRoutes(app, context)
  registerAdminOrganizationsRoutes(app, context)
  registerAdminBillingRoutes(app, context)
  registerAdminSessionsRoutes(app, context)
  registerAdminAuditRoutes(app, context)
  registerAdminUsageRoutes(app, context)
  registerAdminComplianceRoutes(app, context)
}

function registerAdminOverviewRoutes(app: FastifyInstance, context: AdminRouteContext): void {
  app.get(
    '/admin/access',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (_request, reply) => reply.header('Cache-Control', 'no-store').code(204).send(),
  )

  app.get(
    '/admin/overview',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await readAdminOverview(
        context.store,
        context.ledger,
        context.adminRepository,
        request.principal!,
      )
    },
  )

  app.get(
    '/admin/console',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const repository = requireAdminRepository(context.adminRepository)
      const options = scopeAdminOptions(request.principal!, parseConsoleQuery(request.query))
      const currentSessionId = currentSessionIdFromCookie(request.cookies[SESSION_COOKIE], context.authSecret)
      const [
        overview,
        users,
        tenants,
        memberships,
        billingAccounts,
        billingLedgerEntries,
        billingPaymentReconciliation,
        billingReconciliationAlerts,
        sessions,
        auditLogs,
      ] = await Promise.all([
        readAdminOverview(context.store, context.ledger, repository, request.principal!),
        repository.listUsers(options),
        repository.listTenants(options),
        repository.listMemberships(options),
        repository.listBillingAccounts(options),
        repository.listBillingLedgerEntries(options),
        repository.listBillingPaymentReconciliation(options),
        repository.listBillingReconciliationAlerts(options),
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
        billingReconciliationAlerts,
        sessions,
        auditLogs,
        generatedAt: new Date().toISOString(),
      }
      return snapshot
    },
  )
}
