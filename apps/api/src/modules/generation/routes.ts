import { createGenerationTaskSchema, PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { GenerationService } from './service.js'

const projectParamsSchema = z.object({ projectId: z.string().min(1).max(128) })
const filmPreviewBodySchema = z.object({
  mode: z.enum(['full', 'partial']).default('full'),
  force: z.boolean().default(false),
  episodeNumber: z.number().int().positive().nullable().default(null),
})
const taskParamsSchema = z.object({ taskId: z.string().min(1).max(128) })
const outputParamsSchema = taskParamsSchema.extend({
  view: z.enum(['single', 'front', 'side', 'back', 'detail', 'last-frame']),
})

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

      const task = await service.createTask(parsed.data, request.principal!, request.id)
      return reply.code(202).send(task)
    },
  )

  app.get(
    '/generation/tasks/recent',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    (request) => service.listRecentTasks(request.principal!),
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

  app.post(
    '/projects/:projectId/film-preview',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request, reply) => {
      const parsed = projectParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const body = filmPreviewBodySchema.safeParse(request.body ?? {})
      if (!body.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(body.error))
      return reply
        .code(202)
        .send(
          await service.createFilmPreview(
            parsed.data.projectId,
            request.principal!,
            body.data.mode,
            body.data.force,
            body.data.episodeNumber,
            request.id,
          ),
        )
    },
  )

  app.post(
    '/generation/tasks/:taskId/pause',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return service.pauseTask(parsed.data.taskId, request.principal!)
    },
  )

  app.post(
    '/generation/tasks/:taskId/resume',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return service.resumeTask(parsed.data.taskId, request.principal!, request.id)
    },
  )

  app.delete(
    '/generation/tasks/:taskId',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request, reply) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      await service.deleteTask(parsed.data.taskId, request.principal!)
      return reply.code(204).send()
    },
  )

  app.get(
    '/generation/tasks/:taskId/content',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request, reply) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const range = typeof request.headers.range === 'string' ? request.headers.range : undefined
      const content = await service.getVideoContent(parsed.data.taskId, request.principal!, range)
      reply.header('Cache-Control', 'private, no-store').type(content.contentType)
      if (content.contentLength) reply.header('Content-Length', content.contentLength)
      if (content.acceptRanges) reply.header('Accept-Ranges', content.acceptRanges)
      if (content.contentRange) reply.header('Content-Range', content.contentRange)
      return reply.code(content.statusCode).send(content.stream)
    },
  )

  app.get(
    '/generation/tasks/:taskId/outputs/:view',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request, reply) => {
      const parsed = outputParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const output = await service.getImageOutput(parsed.data.taskId, parsed.data.view, request.principal!)
      return reply
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .type(output.contentType)
        .send(output.content)
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
