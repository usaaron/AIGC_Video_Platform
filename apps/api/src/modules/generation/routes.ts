import { createGenerationTaskSchema, PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { GenerationService } from './service.js'

const projectParamsSchema = z.object({ projectId: z.string().min(1).max(128) })
const taskParamsSchema = z.object({ taskId: z.string().min(1).max(128) })

export async function registerGenerationRoutes(
  app: FastifyInstance,
  service: GenerationService,
): Promise<void> {
  app.post(
    '/generation/tasks',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request, reply) => {
      const parsed = createGenerationTaskSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))

      const task = await service.createTask(parsed.data, request.principal!)
      return reply.code(202).send(task)
    },
  )

  app.get(
    '/projects/:projectId/generation/tasks',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request) => {
      const parsed = projectParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return service.listProjectTasks(parsed.data.projectId, request.principal!)
    },
  )

  app.get(
    '/generation/tasks/:taskId/content',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request, reply) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const content = await service.getVideoContent(parsed.data.taskId, request.principal!)
      reply.header('Cache-Control', 'private, no-store').type(content.contentType)
      if (content.contentLength) reply.header('Content-Length', content.contentLength)
      return reply.send(content.stream)
    },
  )

  app.delete(
    '/projects/:projectId/generation/tasks/completed',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request) => {
      const parsed = projectParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return { cleared: await service.clearCompleted(parsed.data.projectId, request.principal!) }
    },
  )
}
