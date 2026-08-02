import { PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../core/auth/authorization.js'
import {
  parseListQuery,
  requireAdminRepository,
  scopeAdminOptions,
  type AdminRouteContext,
} from './routeContext.js'

export function registerAdminAuditRoutes(app: FastifyInstance, context: AdminRouteContext): void {
  app.get(
    '/admin/audit-logs',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listAuditLogEntries(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )
}
