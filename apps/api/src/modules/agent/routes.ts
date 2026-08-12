import {
  agentStageKeySchema,
  confirmAgentRunRequestSchema,
  createAgentPlanRequestSchema,
  PERMISSIONS,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { AgentService } from './service.js'

const runParamsSchema = z.object({ runId: z.string().uuid() })
const stageParamsSchema = runParamsSchema.extend({ stage: agentStageKeySchema })

export async function registerAgentRoutes(app: FastifyInstance, service: AgentService): Promise<void> {
  const access = { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) }
  app.post('/agent/plan', access, (request) =>
    service.plan(parse(createAgentPlanRequestSchema, request.body ?? {}), request.principal!),
  )
  app.get('/agent/runs', access, (request) => service.list(request.principal!))
  app.get('/agent/runs/:runId', access, (request) =>
    service.get(parse(runParamsSchema, request.params).runId, request.principal!),
  )
  app.post('/agent/runs/:runId/confirm', access, (request) => {
    const params = parse(runParamsSchema, request.params)
    const input = parse(confirmAgentRunRequestSchema, request.body ?? {})
    return service.confirm(params.runId, input.clientRequestId, request.principal!)
  })
  app.post('/agent/runs/:runId/pause', access, (request) =>
    service.pause(parse(runParamsSchema, request.params).runId, request.principal!),
  )
  app.post('/agent/runs/:runId/resume', access, (request) =>
    service.resume(parse(runParamsSchema, request.params).runId, request.principal!),
  )
  app.post('/agent/runs/:runId/retry', access, (request) =>
    service.retry(parse(runParamsSchema, request.params).runId, request.principal!),
  )
  app.post('/agent/runs/:runId/stages/:stage/skip', access, (request) => {
    const params = parse(stageParamsSchema, request.params)
    return service.skip(params.runId, params.stage, request.principal!)
  })
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
  return parsed.data
}
