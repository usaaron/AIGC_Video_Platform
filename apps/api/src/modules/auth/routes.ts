import type { FastifyInstance } from 'fastify'
import { permissionsFor } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/auth/me', async (request) => {
    if (!request.principal) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
    return { ...request.principal, permissions: [...permissionsFor(request.principal)] }
  })
}
