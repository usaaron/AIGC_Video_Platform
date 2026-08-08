import {
  adminAccountStatusUpdateSchema,
  adminPasswordResetRequirementUpdateSchema,
  adminSetUserPasswordSchema,
  createTenantInvitationSchema,
  createTenantUserSchema,
  PERMISSIONS,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../core/auth/authorization.js'
import { hashPassword } from '../../core/auth/password.js'
import { sessionMetadataFromRequest } from '../../core/auth/requestMetadata.js'
import { AppError } from '../../core/errors.js'
import {
  adminUserParams,
  parse,
  parseListQuery,
  requireAccountManagementService,
  requireAdminRepository,
  scopeAdminOptions,
  type AdminRouteContext,
} from './routeContext.js'

export function registerAdminUsersRoutes(app: FastifyInstance, context: AdminRouteContext): void {
  app.get(
    '/admin/users',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listUsers(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.post(
    '/admin/users',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const member = await requireAccountManagementService(
        context.accountManagementService,
      ).adminCreatePlatformUser(
        request.principal!,
        parse(createTenantUserSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return reply.code(201).send(member)
    },
  )

  app.post(
    '/admin/invitations',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const invitation = await requireAccountManagementService(
        context.accountManagementService,
      ).adminCreatePlatformInvitation(
        request.principal!,
        parse(createTenantInvitationSchema, request.body),
      )
      reply.header('Cache-Control', 'no-store')
      return reply.code(201).send(invitation)
    },
  )

  app.patch(
    '/admin/users/:userId/status',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request) => {
      const { userId } = parse(adminUserParams, request.params)
      const input = parse(adminAccountStatusUpdateSchema, request.body)
      const updated = await requireAdminRepository(context.adminRepository).setAccountStatus(
        request.principal!,
        userId,
        input.status,
        sessionMetadataFromRequest(request),
      )
      if (!updated) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      return updated
    },
  )

  app.patch(
    '/admin/users/:userId/password-reset-requirement',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request) => {
      const { userId } = parse(adminUserParams, request.params)
      const input = parse(adminPasswordResetRequirementUpdateSchema, request.body)
      const updated = await requireAdminRepository(context.adminRepository).setPasswordResetRequirement(
        request.principal!,
        userId,
        input,
        sessionMetadataFromRequest(request),
      )
      if (!updated) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      return updated
    },
  )

  app.put(
    '/admin/users/:userId/password',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request) => {
      const { userId } = parse(adminUserParams, request.params)
      const input = parse(adminSetUserPasswordSchema, request.body)
      const updated = await requireAdminRepository(context.adminRepository).setUserPassword(
        request.principal!,
        userId,
        { ...input, passwordHash: hashPassword(input.newPassword) },
        sessionMetadataFromRequest(request),
      )
      if (!updated) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      return updated
    },
  )
}
