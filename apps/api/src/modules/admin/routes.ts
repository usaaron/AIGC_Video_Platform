import { PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../core/auth/authorization.js'
import { z } from 'zod'
import type { AuditLogReader } from '../../core/audit.js'
import type { AdminOverviewStore } from './repository.js'

export async function registerAdminRoutes(
  app: FastifyInstance,
  repository: AdminOverviewStore,
  auditLogs: AuditLogReader,
): Promise<void> {
  app.get('/admin/overview', { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) }, async () =>
    repository.overview(),
  )
  app.get(
    '/admin/audit-logs',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request) => {
      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
        .safeParse(request.query)
      const limit = query.success ? query.data.limit : 50
      return { logs: await auditLogs.list(request.principal!.tenantId, limit) }
    },
  )
}
