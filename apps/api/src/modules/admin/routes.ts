import { PERMISSIONS, type AdminOverview } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../core/auth/authorization.js'
import type { AppStore } from '../../infra/store.js'

export async function registerAdminRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.get('/admin/overview', { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) }, async () =>
    store.read((state) => {
      const today = new Date().toISOString().slice(0, 10)
      const overview: AdminOverview = {
        users: state.users.length,
        activeTasks: state.tasks.filter((task) => task.status === 'queued' || task.status === 'running')
          .length,
        creditsConsumedToday: Math.abs(
          state.ledger
            .filter((entry) => entry.type === 'generation' && entry.createdAt.startsWith(today))
            .reduce((total, entry) => total + entry.amount, 0),
        ),
        generatedAt: new Date().toISOString(),
      }
      return overview
    }),
  )
}
