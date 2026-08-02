import { PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { AiJobService } from './service.js'

const projectParamsSchema = z.object({ projectId: z.string().min(1).max(128) })
const jobParamsSchema = z.object({ jobId: z.string().min(1).max(128) })

export async function registerAiJobRoutes(app: FastifyInstance, service: AiJobService): Promise<void> {
  app.get(
    '/projects/:projectId/ai-jobs',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request) => {
      const parsed = projectParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return service.listProjectJobs(parsed.data.projectId, request.principal!)
    },
  )

  app.get(
    '/ai-jobs/:jobId',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request) => {
      const parsed = jobParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const job = await service.findJob(parsed.data.jobId, request.principal!)
      if (!job) throw new AppError(404, 'AI_JOB_NOT_FOUND', 'AI job not found')
      return job
    },
  )
}
