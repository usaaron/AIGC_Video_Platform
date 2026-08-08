import { PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../auth/authorization.js'
import { isPlatformAdmin } from '../auth/roles.js'
import type { AppStore } from '../../infra/store.js'
import type { AdminRepository } from '../../modules/admin/repository.js'
import { renderPrometheusMetrics } from './prometheus.js'
import { dailyOperationalSummary, observabilityMetrics } from './metrics.js'

export async function registerObservabilityRoutes(
  app: FastifyInstance,
  store: AppStore,
  adminRepository: AdminRepository | null = null,
): Promise<void> {
  app.get(
    '/observability/metrics',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const scopedTenantId = isPlatformAdmin(request.principal!) ? undefined : request.principal!.tenantId
      return {
        metrics: observabilityMetrics.snapshot(scopedTenantId ? { tenantId: scopedTenantId } : {}),
        daily: adminRepository
          ? await adminRepository.dailyOperationalSummary(scopedTenantId)
          : dailyOperationalSummary(store, scopedTenantId),
      }
    },
  )

  app.get(
    '/observability/metrics/prometheus',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      reply.type('text/plain; version=0.0.4; charset=utf-8')
      const scopedTenantId = isPlatformAdmin(request.principal!) ? undefined : request.principal!.tenantId
      return renderPrometheusMetrics(
        observabilityMetrics.snapshot(scopedTenantId ? { tenantId: scopedTenantId } : {}),
      )
    },
  )
}
