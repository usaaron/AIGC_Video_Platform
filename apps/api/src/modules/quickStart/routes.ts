import {
  executeQuickStartRequestSchema,
  PERMISSIONS,
  quickStartPlanRequestSchema,
  type Permission,
} from '@seqora/contracts'
import type { FastifyInstance, preHandlerHookHandler } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { QuickStartService } from './service.js'

const projectParams = z.object({ projectId: z.string().min(1) })

export async function registerQuickStartRoutes(
  app: FastifyInstance,
  service: QuickStartService,
): Promise<void> {
  app.post(
    '/projects/:projectId/quick-start/plan',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_READ),
    },
    (request) =>
      service.plan(
        parse(projectParams, request.params).projectId,
        request.principal!,
        parse(quickStartPlanRequestSchema, request.body ?? {}).model,
      ),
  )
  app.post(
    '/projects/:projectId/quick-start/execute',
    {
      preHandler: requirePermissions(PERMISSIONS.ASSET_WRITE, PERMISSIONS.GENERATION_TASK_CREATE),
    },
    async (request, reply) => {
      const result = await service.execute(
        parse(projectParams, request.params).projectId,
        parse(executeQuickStartRequestSchema, request.body),
        request.principal!,
        request.id,
      )
      return reply.code(202).send(result)
    },
  )
}

function requirePermissions(...permissions: Permission[]): preHandlerHookHandler[] {
  return permissions.map(requirePermission)
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(result.error))
  return result.data
}
