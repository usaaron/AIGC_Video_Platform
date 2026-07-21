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
    '/projects/:projectId/generation/tasks/events',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request, reply) => {
      const parsed = projectParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))

      const { projectId } = parsed.data
      const principal = request.principal!
      let lastPayload = ''
      let closed = false
      let timer: NodeJS.Timeout | null = null

      const close = () => {
        if (closed) return
        closed = true
        if (timer) clearInterval(timer)
      }

      const writeEvent = (event: string, data: unknown) => {
        if (closed || reply.raw.destroyed || reply.raw.writableEnded) return
        reply.raw.write(`event: ${event}\n`)
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
      }

      const sendTasks = async () => {
        try {
          const tasks = await service.listProjectTasks(projectId, principal)
          const payload = JSON.stringify({ tasks })
          if (payload === lastPayload) {
            if (!closed) reply.raw.write(`: heartbeat ${Date.now()}\n\n`)
            return
          }
          lastPayload = payload
          writeEvent('tasks', { tasks, emittedAt: new Date().toISOString() })
        } catch (error) {
          writeEvent('error', {
            message: error instanceof Error ? error.message : '任务推送失败',
          })
          close()
        }
      }

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      request.raw.on('close', close)
      timer = setInterval(() => void sendTasks(), 1_500)
      void sendTasks()
    },
  )

  app.post(
    '/generation/tasks/:taskId/retry',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request, reply) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const task = await service.retryTask(parsed.data.taskId, request.principal!)
      return reply.code(202).send(task)
    },
  )

  app.post(
    '/generation/tasks/:taskId/cancel',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request, reply) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const task = await service.cancelTask(parsed.data.taskId, request.principal!)
      return reply.code(202).send(task)
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
