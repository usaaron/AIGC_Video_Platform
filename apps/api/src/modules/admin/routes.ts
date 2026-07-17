import { PERMISSIONS, type AdminOverview } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../core/auth/authorization.js'

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/admin/overview',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async () => {
      const overview: AdminOverview = {
        users: 1,
        activeTasks: 0,
        creditsConsumedToday: 0,
        generatedAt: new Date().toISOString(),
      }
      return overview
    },
  )
}
