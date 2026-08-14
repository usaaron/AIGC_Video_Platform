import { createImage2BatchSchema, PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { Image2BatchService } from './service.js'

export async function registerImage2Routes(
  app: FastifyInstance,
  service: Image2BatchService,
): Promise<void> {
  app.post(
    '/image2/batches',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request, reply) => {
      const parsed = createImage2BatchSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return reply.code(202).send(await service.createBatch(parsed.data, request.principal!, request.id))
    },
  )
}
