import type { FastifyInstance } from 'fastify'
import { registerProjectAssetRoutes } from './routes/assets.js'
import { registerProjectCoreRoutes } from './routes/core.js'
import { registerProjectScriptRoutes } from './routes/scripts.js'
import { registerProjectShotRoutes } from './routes/shots.js'
import type { ProjectService } from './service.js'
import { rejectStandaloneProjectPath } from './projectSurface.js'

export async function registerProjectRoutes(app: FastifyInstance, service: ProjectService): Promise<void> {
  // Keep the reserved independent namespace out of every project-scoped route
  // before a service/repository can read or mutate it.
  await app.register(async (scope) => {
    scope.addHook('preHandler', rejectStandaloneProjectPath)
    registerProjectCoreRoutes(scope, service)
    registerProjectScriptRoutes(scope, service)
    registerProjectAssetRoutes(scope, service)
    registerProjectShotRoutes(scope, service)
  })
}
