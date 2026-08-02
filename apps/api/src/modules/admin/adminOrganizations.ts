import {
  adminTransferOrganizationAdminSchema,
  createTenantUserSchema,
  PERMISSIONS,
  updateMembershipRolesSchema,
  updateOrganizationSchema,
  updateWorkspaceSchema,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../core/auth/authorization.js'
import { isPlatformAdmin } from '../../core/auth/roles.js'
import { sessionMetadataFromRequest } from '../../core/auth/requestMetadata.js'
import { AppError } from '../../core/errors.js'
import {
  adminOrganizationSuccessor,
  adminTenantParams,
  billingMembershipParams,
  markDeprecated,
  parse,
  parseListQuery,
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
      if (
        !isPlatformAdmin(request.principal!) &&
        detail.membership.tenantId !== request.principal!.tenantId
      ) {
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
      if (
        !isPlatformAdmin(request.principal!) &&
        detail.membership.tenantId !== request.principal!.tenantId
      ) {
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
      if (
        !isPlatformAdmin(request.principal!) &&
        detail.membership.tenantId !== request.principal!.tenantId
      ) {
        throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot read another workspace membership')
      }
      return detail
    },
  )
}
