import {
  acceptTenantInvitationSchema,
  addTenantMemberSchema,
  createOrganizationSchema,
  createTenantInvitationSchema,
  createTenantUserSchema,
  createWorkspaceSchema,
  PERMISSIONS,
  registerAccountSchema,
  transferOrganizationAdminSchema,
  updateMembershipRolesSchema,
  updateOrganizationSchema,
  updateWorkspaceSchema,
  type AccountSession,
  type Session,
  type Workspace,
} from '@seqora/contracts'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { SESSION_COOKIE } from '../../core/auth/provider.js'
import { sessionMetadataFromRequest } from '../../core/auth/requestMetadata.js'
import { AppError } from '../../core/errors.js'
import type { AccountManagementService } from './service.js'

const tenantParams = z.object({ tenantId: z.string().min(1).max(256) })
const memberParams = tenantParams.extend({ userId: z.string().min(1).max(256) })
const invitationParams = tenantParams.extend({ invitationId: z.string().min(1).max(256) })
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
      const result = await requireService(service).registerAccount(
        parse(registerAccountSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return sendSession(reply.code(201), result, secureCookies)
    },
  )

  app.post(
    '/auth/invitations/accept',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const result = await requireService(service).acceptInvitation(
        parse(acceptTenantInvitationSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return sendSession(reply.code(201), result, secureCookies)
    },
  )

  app.post('/workspaces', { preHandler: requireAuthenticated }, async (request, reply) => {
    markDeprecated(reply, '/organizations')
    const result = await requireService(service).createWorkspace(
      request.principal!,
      parse(createWorkspaceSchema, request.body),
      sessionMetadataFromRequest(request),
    )
    return sendSession(reply.code(201), result, secureCookies)
  })
  app.post('/organizations', { preHandler: requireAuthenticated }, async (request, reply) => {
    const result = await requireService(service).createOrganization(
      request.principal!,
      parse(createOrganizationSchema, request.body),
      sessionMetadataFromRequest(request),
    )
    return sendSession(reply.code(201), result, secureCookies)
  })

  app.get('/workspaces', { preHandler: requireAuthenticated }, async (request, reply) => {
    markDeprecated(reply, '/organizations')
    reply.header('Cache-Control', 'no-store')
    return await requireService(service).listWorkspaces(request.principal!)
  })
  app.get('/organizations', { preHandler: requireAuthenticated }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return await requireService(service).listOrganizations(request.principal!)
  })

  app.patch(
    '/workspaces/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId))
      reply.header('Cache-Control', 'no-store')
      return await requireService(service).updateWorkspace(
        request.principal!,
        tenantId,
        parse(updateWorkspaceSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )
  app.patch(
    '/organizations/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      reply.header('Cache-Control', 'no-store')
      return await requireService(service).updateOrganization(
        request.principal!,
        tenantId,
        parse(updateOrganizationSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )

  app.delete(
    '/workspaces/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId))
      const result = await requireService(service).disableWorkspace(
        request.principal!,
        tenantId,
        sessionMetadataFromRequest(request),
      )
      reply.header('Cache-Control', 'no-store')
      if (result) return sendSession(reply, result, secureCookies)
      clearSessionCookie(reply, secureCookies)
      return reply.code(204).send()
    },
  )
  app.delete(
    '/organizations/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      const result = await requireService(service).disableOrganization(
        request.principal!,
        tenantId,
        sessionMetadataFromRequest(request),
      )
      reply.header('Cache-Control', 'no-store')
      if (result) return sendSession(reply, result, secureCookies)
      clearSessionCookie(reply, secureCookies)
      return reply.code(204).send()
    },
  )

  app.post(
    '/organizations/:tenantId/admin-transfer',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      reply.header('Cache-Control', 'no-store')
      return await requireService(service).transferOrganizationAdmin(
        request.principal!,
        tenantId,
        parse(transferOrganizationAdminSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )
  for (const path of [
    '/organizations/:tenantId/organization-admin-transfer',
    '/workspaces/:tenantId/organization-admin-transfer',
  ]) {
    app.post(path, { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) }, async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      reply
        .header('Cache-Control', 'no-store')
        .header('Deprecation', 'true')
        .header(
          'Link',
          `</api/v1/organizations/${encodeURIComponent(tenantId)}/admin-transfer>; rel="successor-version"`,
        )
      return await requireService(service).transferOrganizationAdmin(
        request.principal!,
        tenantId,
        parse(transferOrganizationAdminSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    })
  }

  app.post('/workspaces/:tenantId/leave', { preHandler: requireAuthenticated }, async (request, reply) => {
    const { tenantId } = parse(tenantParams, request.params)
    markDeprecated(reply, organizationSuccessor(tenantId, '/leave'))
    const result = await requireService(service).leaveWorkspace(
      request.principal!,
      tenantId,
      sessionMetadataFromRequest(request),
    )
    reply.header('Cache-Control', 'no-store')
    if (result) return sendSession(reply, result, secureCookies)
    clearSessionCookie(reply, secureCookies)
    return reply.code(204).send()
  })
  app.post('/organizations/:tenantId/leave', { preHandler: requireAuthenticated }, async (request, reply) => {
    const { tenantId } = parse(tenantParams, request.params)
    const result = await requireService(service).leaveOrganization(
      request.principal!,
      tenantId,
      sessionMetadataFromRequest(request),
    )
    reply.header('Cache-Control', 'no-store')
    if (result) return sendSession(reply, result, secureCookies)
    clearSessionCookie(reply, secureCookies)
    return reply.code(204).send()
  })

  app.post('/workspaces/:tenantId/switch', { preHandler: requireAuthenticated }, async (request, reply) => {
    const { tenantId } = parse(tenantParams, request.params)
    markDeprecated(reply, organizationSuccessor(tenantId, '/switch'))
    const result = await requireService(service).switchWorkspace(
      request.principal!,
      tenantId,
      sessionMetadataFromRequest(request),
    )
    return sendSession(reply, result, secureCookies)
  })
  app.post(
    '/organizations/:tenantId/switch',
    { preHandler: requireAuthenticated },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      const result = await requireService(service).switchOrganization(
        request.principal!,
        tenantId,
        sessionMetadataFromRequest(request),
      )
      return sendSession(reply, result, secureCookies)
    },
  )

  app.get(
    '/tenants/:tenantId/members',
    { preHandler: requirePermission(PERMISSIONS.USER_READ) },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId, '/members'))
      return await requireService(service).listMembers(request.principal!, tenantId)
    },
  )
  app.get(
    '/organizations/:tenantId/members',
    { preHandler: requirePermission(PERMISSIONS.USER_READ) },
    async (request) => {
      const { tenantId } = parse(tenantParams, request.params)
      return await requireService(service).listOrganizationMembers(request.principal!, tenantId)
    },
  )

  app.get(
    '/tenants/:tenantId/invitations',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId, '/invitations'))
      return await requireService(service).listInvitations(request.principal!, tenantId)
    },
  )
  app.get(
    '/organizations/:tenantId/invitations',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request) => {
      const { tenantId } = parse(tenantParams, request.params)
      return await requireService(service).listInvitations(request.principal!, tenantId)
    },
  )

  app.post(
    '/tenants/:tenantId/invitations',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId, '/invitations'))
      const invitation = await requireService(service).createInvitation(
        request.principal!,
        tenantId,
        parse(createTenantInvitationSchema, request.body),
      )
      return reply.code(201).send(invitation)
    },
  )
  app.post(
    '/organizations/:tenantId/invitations',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      const invitation = await requireService(service).createInvitation(
        request.principal!,
        tenantId,
        parse(createTenantInvitationSchema, request.body),
      )
      return reply.code(201).send(invitation)
    },
  )

  app.delete(
    '/tenants/:tenantId/invitations/:invitationId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, invitationId } = parse(invitationParams, request.params)
      markDeprecated(
        reply,
        organizationSuccessor(tenantId, `/invitations/${encodeURIComponent(invitationId)}`),
      )
      await requireService(service).revokeInvitation(request.principal!, tenantId, invitationId)
      return reply.code(204).send()
    },
  )
  app.delete(
    '/organizations/:tenantId/invitations/:invitationId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, invitationId } = parse(invitationParams, request.params)
      await requireService(service).revokeInvitation(request.principal!, tenantId, invitationId)
      return reply.code(204).send()
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
      markDeprecated(reply, organizationSuccessor(tenantId, '/members'))
      const member = await requireService(service).addMember(
        request.principal!,
        tenantId,
        parse(addTenantMemberSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return reply.code(201).send(member)
    },
  )
  app.post(
    '/organizations/:tenantId/members',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      const member = await requireService(service).addOrganizationMember(
        request.principal!,
        tenantId,
        parse(addTenantMemberSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return reply.code(201).send(member)
    },
  )

  app.post(
    '/tenants/:tenantId/users',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId, '/users'))
      const member = await requireService(service).createTenantUser(
        request.principal!,
        tenantId,
        parse(createTenantUserSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return reply.code(201).send(member)
    },
  )
  app.post(
    '/organizations/:tenantId/users',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      const member = await requireService(service).createOrganizationUser(
        request.principal!,
        tenantId,
        parse(createTenantUserSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return reply.code(201).send(member)
    },
  )

  app.patch(
    '/tenants/:tenantId/members/:userId/roles',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, userId } = parse(memberParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId, `/members/${encodeURIComponent(userId)}/roles`))
      return await requireService(service).updateMembershipRoles(
        request.principal!,
        tenantId,
        userId,
        parse(updateMembershipRolesSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )
  app.patch(
    '/organizations/:tenantId/members/:userId/roles',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request) => {
      const { tenantId, userId } = parse(memberParams, request.params)
      return await requireService(service).updateOrganizationMembershipRoles(
        request.principal!,
        tenantId,
        userId,
        parse(updateMembershipRolesSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )

  app.delete(
    '/tenants/:tenantId/members/:userId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, userId } = parse(memberParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId, `/members/${encodeURIComponent(userId)}`))
      await requireService(service).disableMembership(
        request.principal!,
        tenantId,
        userId,
        sessionMetadataFromRequest(request),
      )
      return reply.code(204).send()
    },
  )
  app.delete(
    '/organizations/:tenantId/members/:userId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, userId } = parse(memberParams, request.params)
      await requireService(service).disableOrganizationMembership(
        request.principal!,
        tenantId,
        userId,
        sessionMetadataFromRequest(request),
      )
      return reply.code(204).send()
    },
  )

  app.delete(
    '/tenants/:tenantId/accounts/:userId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, userId } = parse(memberParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId, `/accounts/${encodeURIComponent(userId)}`))
      await requireService(service).disableAccount(
        request.principal!,
        tenantId,
        userId,
        sessionMetadataFromRequest(request),
      )
      return reply.code(204).send()
    },
  )
  app.delete(
    '/organizations/:tenantId/accounts/:userId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, userId } = parse(memberParams, request.params)
      await requireService(service).disableOrganizationAccount(
        request.principal!,
        tenantId,
        userId,
        sessionMetadataFromRequest(request),
      )
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
    await requireService(service).revokeCurrentTenantSession(
      request.principal!,
      sessionId,
      sessionMetadataFromRequest(request),
    )
    reply.header('Cache-Control', 'no-store')
    if (revokingCurrentSession) clearSessionCookie(reply, secureCookies)
    return reply.code(204).send()
  })

  app.delete(
    '/tenants/:tenantId/sessions/:sessionId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, sessionId } = parse(tenantSessionParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId, `/sessions/${encodeURIComponent(sessionId)}`))
      await requireService(service).revokeTenantSession(
        request.principal!,
        tenantId,
        sessionId,
        sessionMetadataFromRequest(request),
      )
      return reply.code(204).send()
    },
  )
  app.delete(
    '/organizations/:tenantId/sessions/:sessionId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, sessionId } = parse(tenantSessionParams, request.params)
      await requireService(service).revokeOrganizationSession(
        request.principal!,
        tenantId,
        sessionId,
        sessionMetadataFromRequest(request),
      )
      return reply.code(204).send()
    },
  )

  app.get(
    '/tenants/:tenantId/sessions',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      markDeprecated(reply, organizationSuccessor(tenantId, '/sessions'))
      reply.header('Cache-Control', 'no-store')
      return await requireService(service).listTenantSessions(
        request.principal!,
        tenantId,
        request.cookies[SESSION_COOKIE],
      )
    },
  )
  app.get(
    '/organizations/:tenantId/sessions',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(tenantParams, request.params)
      reply.header('Cache-Control', 'no-store')
      return await requireService(service).listOrganizationSessions(
        request.principal!,
        tenantId,
        request.cookies[SESSION_COOKIE],
      )
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
  const payload: AccountSession = {
    ...result.session,
    workspace: result.workspace,
    organization: result.workspace,
  }
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

function markDeprecated(reply: FastifyReply, successorPath: string): void {
  reply.header('Deprecation', 'true')
  reply.header('Link', `</api/v1${successorPath}>; rel="successor-version"`)
}

function organizationSuccessor(tenantId: string, suffix = ''): string {
  return `/organizations/${encodeURIComponent(tenantId)}${suffix}`
}
