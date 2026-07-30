import {
  addTenantMemberSchema,
  createWorkspaceSchema,
  PERMISSIONS,
  registerAccountSchema,
  updateMembershipRolesSchema,
  type AccountSession,
  type Session,
  type Workspace,
} from '@seqora/contracts'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { SESSION_COOKIE } from '../../core/auth/provider.js'
import { AppError } from '../../core/errors.js'
import type { AccountManagementService } from './service.js'

const tenantParams = z.object({ tenantId: z.string().min(1).max(256) })
const memberParams = tenantParams.extend({ userId: z.string().min(1).max(256) })
const sessionParams = z.object({ sessionId: z.string().min(1).max(128) })
const tenantSessionParams = tenantParams.extend({ sessionId: z.string().min(1).max(128) })

export async function registerAccountManagementRoutes(
  app: FastifyInstance,
  service: AccountManagementService | null,
  secureCookies: boolean,
): Promise<void> {
  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const result = await requireService(service).register(parse(registerAccountSchema, request.body))
      return sendSession(reply.code(201), result, secureCookies)
    },
  )

  app.post('/workspaces', { preHandler: requireAuthenticated }, async (request, reply) => {
    const result = await requireService(service).createWorkspace(
      request.principal!,
      parse(createWorkspaceSchema, request.body),
    )
    return sendSession(reply.code(201), result, secureCookies)
  })

  app.get(
    '/tenants/:tenantId/members',
    { preHandler: requirePermission(PERMISSIONS.USER_READ) },
    async (request) => {
      const { tenantId } = parse(tenantParams, request.params)
      return await requireService(service).listMembers(request.principal!, tenantId)
    },
  )

  app.post(
    '/tenants/:tenantId/members',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      const member = await requireService(service).addMember(
        request.principal!,
        tenantId,
        parse(addTenantMemberSchema, request.body),
      )
      return reply.code(201).send(member)
    },
  )

  app.patch(
    '/tenants/:tenantId/members/:userId/roles',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request) => {
      const { tenantId, userId } = parse(memberParams, request.params)
      return await requireService(service).updateMembershipRoles(
        request.principal!,
        tenantId,
        userId,
        parse(updateMembershipRolesSchema, request.body),
      )
    },
  )

  app.delete(
    '/tenants/:tenantId/members/:userId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, userId } = parse(memberParams, request.params)
      await requireService(service).disableMembership(request.principal!, tenantId, userId)
      return reply.code(204).send()
    },
  )

  app.delete(
    '/tenants/:tenantId/accounts/:userId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, userId } = parse(memberParams, request.params)
      await requireService(service).disableAccount(request.principal!, tenantId, userId)
      return reply.code(204).send()
    },
  )

  app.get('/auth/sessions', { preHandler: requireAuthenticated }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return await requireService(service).listSessions(request.principal!, request.cookies[SESSION_COOKIE])
  })

  app.delete('/auth/sessions/:sessionId', { preHandler: requireAuthenticated }, async (request, reply) => {
    const { sessionId } = parse(sessionParams, request.params)
    const sessions = await requireService(service).listSessions(
      request.principal!,
      request.cookies[SESSION_COOKIE],
    )
    const revokingCurrentSession = sessions.some(
      (session) => session.sessionId === sessionId && session.current,
    )
    await requireService(service).revokeCurrentTenantSession(request.principal!, sessionId)
    reply.header('Cache-Control', 'no-store')
    if (revokingCurrentSession) clearSessionCookie(reply, secureCookies)
    return reply.code(204).send()
  })

  app.delete(
    '/tenants/:tenantId/sessions/:sessionId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, sessionId } = parse(tenantSessionParams, request.params)
      await requireService(service).revokeTenantSession(request.principal!, tenantId, sessionId)
      return reply.code(204).send()
    },
  )
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(result.error))
  return result.data
}

async function requireAuthenticated(request: FastifyRequest): Promise<void> {
  if (!request.principal) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
  }
}

function requireService(service: AccountManagementService | null): AccountManagementService {
  if (!service) {
    throw new AppError(503, 'ACCOUNT_DATABASE_REQUIRED', 'Postgres account database is required')
  }
  return service
}

function sendSession(
  reply: FastifyReply,
  result: { session: Session; token: string; workspace: Workspace },
  secureCookies: boolean,
): FastifyReply {
  reply.header('Cache-Control', 'no-store')
  reply.setCookie(SESSION_COOKIE, result.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookies,
    maxAge: 60 * 60 * 24 * 7,
  })
  const payload: AccountSession = { ...result.session, workspace: result.workspace }
  return reply.send(payload)
}

function clearSessionCookie(reply: FastifyReply, secureCookies: boolean): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookies,
  })
}
