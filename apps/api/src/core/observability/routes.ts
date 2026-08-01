import { PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../auth/authorization.js'
import { isPlatformAdmin } from '../auth/roles.js'
import type { AppStore } from '../../infra/store.js'
import { dailyOperationalSummary, observabilityMetrics } from './metrics.js'

export async function registerObservabilityRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.get(
    '/observability/metrics',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const scopedTenantId = isPlatformAdmin(request.principal!) ? undefined : request.principal!.tenantId
      return {
        metrics: observabilityMetrics.snapshot(scopedTenantId ? { tenantId: scopedTenantId } : {}),
        daily: dailyOperationalSummary(store, scopedTenantId),
      }
    },
  )
}
