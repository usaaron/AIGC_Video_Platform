import { PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../core/auth/authorization.js'
import { SESSION_COOKIE } from '../../core/auth/provider.js'
import { sessionMetadataFromRequest } from '../../core/auth/requestMetadata.js'
import { AppError } from '../../core/errors.js'
import {
  adminSessionParams,
  currentSessionIdFromCookie,
  parse,
  parseSessionListQuery,
  requireAdminRepository,
  scopeAdminOptions,
  type AdminRouteContext,
} from './routeContext.js'

export function registerAdminSessionsRoutes(app: FastifyInstance, context: AdminRouteContext): void {
  app.get(
    '/admin/sessions',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listSessions(
        scopeAdminOptions(request.principal!, parseSessionListQuery(request.query)),
        currentSessionIdFromCookie(request.cookies[SESSION_COOKIE], context.authSecret),
      )
    },
  )

  app.delete(
    '/admin/sessions/:sessionId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { sessionId } = parse(adminSessionParams, request.params)
      const revoked = await requireAdminRepository(context.adminRepository).revokeSession(
        request.principal!,
        sessionId,
        sessionMetadataFromRequest(request),
      )
      if (!revoked) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session does not exist')
      reply.header('Cache-Control', 'no-store')
      return reply.code(204).send()
    },
  )
}
