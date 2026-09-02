import type { FastifyInstance } from 'fastify'
import { registerProjectAssetRoutes } from './routes/assets.js'
import { registerProjectCoreRoutes } from './routes/core.js'
import { registerProjectScriptRoutes } from './routes/scripts.js'
import { registerProjectShotRoutes } from './routes/shots.js'
import type { ProjectService } from './service.js'

export async function registerProjectRoutes(app: FastifyInstance, service: ProjectService): Promise<void> {
  registerProjectCoreRoutes(app, service)
  registerProjectScriptRoutes(app, service)
  registerProjectAssetRoutes(app, service)
  registerProjectShotRoutes(app, service)
}
