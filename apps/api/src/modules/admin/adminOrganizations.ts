import {
  adminTransferOrganizationAdminSchema,
  addTenantMemberSchema,
  createOrganizationSchema,
  createTenantInvitationSchema,
  createTenantUserSchema,
  PERMISSIONS,
  updateMembershipRolesSchema,
  updateOrganizationSchema,
  updateWorkspaceSchema,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../core/auth/authorization.js'
import { sessionMetadataFromRequest } from '../../core/auth/requestMetadata.js'
import { AppError } from '../../core/errors.js'
import { z } from 'zod'
import {
  adminOrganizationSuccessor,
  adminTenantParams,
  billingMembershipParams,
  markDeprecated,
  parse,
  parseListQuery,
  canAccessAdminMembership,
  requireAccountManagementService,
  requireAdminRepository,
  scopeAdminOptions,
  type AdminRouteContext,
} from './routeContext.js'

export function registerAdminOrganizationsRoutes(app: FastifyInstance, context: AdminRouteContext): void {
  app.get(
    '/admin/tenants',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      markDeprecated(reply, '/admin/organizations')
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listTenants(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.get(
    '/admin/organizations',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listTenants(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.post(
    '/admin/organizations',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const organization = await requireAccountManagementService(
        context.accountManagementService,
      ).adminCreateOrganization(
        request.principal!,
        parse(createOrganizationSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      reply.header('Cache-Control', 'no-store')
      return reply.code(201).send(organization)
    },
  )

  app.patch(
    '/admin/tenants/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      markDeprecated(reply, adminOrganizationSuccessor(tenantId))
      reply.header('Cache-Control', 'no-store')
      return await requireAccountManagementService(context.accountManagementService).adminUpdateWorkspace(
        request.principal!,
        tenantId,
        parse(updateWorkspaceSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )

  app.patch(
    '/admin/organizations/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      reply.header('Cache-Control', 'no-store')
      return await requireAccountManagementService(context.accountManagementService).adminUpdateOrganization(
        request.principal!,
        tenantId,
        parse(updateOrganizationSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )

  app.delete(
    '/admin/tenants/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      markDeprecated(reply, adminOrganizationSuccessor(tenantId))
      const workspace = await requireAccountManagementService(
        context.accountManagementService,
      ).adminDisableWorkspace(request.principal!, tenantId, sessionMetadataFromRequest(request))
      reply.header('Cache-Control', 'no-store')
      return workspace
    },
  )

  app.delete(
    '/admin/organizations/:tenantId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      const workspace = await requireAccountManagementService(
        context.accountManagementService,
      ).adminDisableOrganization(request.principal!, tenantId, sessionMetadataFromRequest(request))
      reply.header('Cache-Control', 'no-store')
      return workspace
    },
  )

  app.post(
    '/admin/organizations/:tenantId/admin-transfer',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      reply.header('Cache-Control', 'no-store')
      return await requireAccountManagementService(
        context.accountManagementService,
      ).adminTransferOrganizationAdmin(
        request.principal!,
        tenantId,
        parse(adminTransferOrganizationAdminSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )

  for (const path of [
    '/admin/organizations/:tenantId/organization-admin-transfer',
    '/admin/tenants/:tenantId/organization-admin-transfer',
  ]) {
    app.post(path, { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) }, async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      reply
        .header('Cache-Control', 'no-store')
        .header('Deprecation', 'true')
        .header(
          'Link',
          `</api/v1/admin/organizations/${encodeURIComponent(tenantId)}/admin-transfer>; rel="successor-version"`,
        )
      return await requireAccountManagementService(
        context.accountManagementService,
      ).adminTransferOrganizationAdmin(
        request.principal!,
        tenantId,
        parse(adminTransferOrganizationAdminSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    })
  }

  app.post(
    '/admin/tenants/:tenantId/users',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      markDeprecated(reply, adminOrganizationSuccessor(tenantId, '/users'))
      const member = await requireAccountManagementService(
        context.accountManagementService,
      ).adminCreateTenantUser(
        request.principal!,
        tenantId,
        parse(createTenantUserSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return reply.code(201).send(member)
    },
  )

  app.post(
    '/admin/organizations/:tenantId/users',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      const member = await requireAccountManagementService(
        context.accountManagementService,
      ).adminCreateOrganizationUser(
        request.principal!,
        tenantId,
        parse(createTenantUserSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      return reply.code(201).send(member)
    },
  )

  app.post(
    '/admin/organizations/:tenantId/members',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      const member = await requireAccountManagementService(
        context.accountManagementService,
      ).adminAddOrganizationMember(
        request.principal!,
        tenantId,
        parse(addTenantMemberSchema, request.body),
        sessionMetadataFromRequest(request),
      )
      reply.header('Cache-Control', 'no-store')
      return reply.code(201).send(member)
    },
  )

  app.get(
    '/admin/organizations/:tenantId/invitations',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      reply.header('Cache-Control', 'no-store')
      return await requireAccountManagementService(
        context.accountManagementService,
      ).adminListInvitations(request.principal!, tenantId)
    },
  )

  app.post(
    '/admin/organizations/:tenantId/invitations',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.USER_MANAGE),
    },
    async (request, reply) => {
      const { tenantId } = parse(adminTenantParams, request.params)
      const invitation = await requireAccountManagementService(
        context.accountManagementService,
      ).adminCreateInvitation(
        request.principal!,
        tenantId,
        parse(createTenantInvitationSchema, request.body),
      )
      reply.header('Cache-Control', 'no-store')
      return reply.code(201).send(invitation)
    },
  )

  app.delete(
    '/admin/organizations/:tenantId/invitations/:invitationId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { tenantId, invitationId } = parse(
        z.object({ tenantId: z.string().min(1).max(256), invitationId: z.string().min(1).max(256) }),
        request.params,
      )
      await requireAccountManagementService(context.accountManagementService).adminRevokeInvitation(
        request.principal!,
        tenantId,
        invitationId,
      )
      reply.header('Cache-Control', 'no-store')
      return reply.code(204).send()
    },
  )

  app.get(
    '/admin/memberships',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listMemberships(
        scopeAdminOptions(request.principal!, parseListQuery(request.query)),
      )
    },
  )

  app.patch(
    '/admin/memberships/:membershipId/roles',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      const detail = await requireAdminRepository(context.adminRepository).findMembership(membershipId)
      if (!detail) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      if (!canAccessAdminMembership(request.principal!, detail.membership)) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot manage another workspace membership')
      }
      reply.header('Cache-Control', 'no-store')
      return await requireAccountManagementService(
        context.accountManagementService,
      ).adminUpdateMembershipRoles(
        request.principal!,
        detail.membership.tenantId,
        detail.membership.userId,
        parse(updateMembershipRolesSchema, request.body),
        sessionMetadataFromRequest(request),
      )
    },
  )

  app.delete(
    '/admin/memberships/:membershipId',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      const detail = await requireAdminRepository(context.adminRepository).findMembership(membershipId)
      if (!detail) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      if (!canAccessAdminMembership(request.principal!, detail.membership)) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot manage another workspace membership')
      }
      await requireAccountManagementService(context.accountManagementService).adminDisableMembership(
        request.principal!,
        detail.membership.tenantId,
        detail.membership.userId,
        sessionMetadataFromRequest(request),
      )
      return reply.code(204).send()
    },
  )

  app.get(
    '/admin/memberships/:membershipId',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      reply.header('Cache-Control', 'no-store')
      const detail = await requireAdminRepository(context.adminRepository).findMembership(membershipId)
      if (!detail) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
      if (!canAccessAdminMembership(request.principal!, detail.membership)) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot read another workspace membership')
      }
      return detail
    },
  )
}
