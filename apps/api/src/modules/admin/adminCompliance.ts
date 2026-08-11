import {
  adminCompliancePromptActionSchema,
  adminCompliancePromptSourceSchema,
  PERMISSIONS,
  type Principal,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { isPlatformAdmin } from '../../core/auth/roles.js'
import { sessionMetadataFromRequest } from '../../core/auth/requestMetadata.js'
import { AppError } from '../../core/errors.js'
import {
  parse,
  parseCompliancePromptQuery,
  requireAdminRepository,
  type AdminRouteContext,
} from './routeContext.js'

const compliancePromptParams = z.object({
  source: adminCompliancePromptSourceSchema,
  sourceId: z.string().min(1).max(256),
})

export function registerAdminComplianceRoutes(app: FastifyInstance, context: AdminRouteContext): void {
  app.get(
    '/admin/compliance/prompts',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      assertCanReviewCompliance(request.principal!)
      reply.header('Cache-Control', 'no-store')
      return await requireAdminRepository(context.adminRepository).listCompliancePromptItems(
        parseCompliancePromptQuery(request.query),
      )
    },
  )

  app.post(
    '/admin/compliance/prompts/:source/:sourceId/actions',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async (request, reply) => {
      assertCanReviewCompliance(request.principal!)
      const { source, sourceId } = parse(compliancePromptParams, request.params)
      const input = parse(adminCompliancePromptActionSchema, request.body)
      const item = await requireAdminRepository(context.adminRepository).recordCompliancePromptAction(
        request.principal!,
        source,
        sourceId,
        input,
        sessionMetadataFromRequest(request),
      )
      if (!item) throw new AppError(404, 'COMPLIANCE_PROMPT_NOT_FOUND', 'Prompt record does not exist')
      reply.header('Cache-Control', 'no-store')
      return item
    },
  )
}

function assertCanReviewCompliance(principal: Principal): void {
  if (isPlatformAdmin(principal)) return
  throw new AppError(
    403,
    'COMPLIANCE_REVIEW_REQUIRES_PLATFORM_ADMIN',
    'Only owners or super admins can review user prompts',
  )
}
