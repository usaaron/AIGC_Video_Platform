import type { FastifyInstance, FastifyRequest } from 'fastify'
import { observabilityMetrics } from './metrics.js'
import { usageCollector } from './usage.js'

declare module 'fastify' {
  interface FastifyRequest {
    observabilityStartedAt: number
  }
}

export function installObservabilityHooks(app: FastifyInstance): void {
  app.decorateRequest('observabilityStartedAt', 0)
  app.addHook('onRequest', async (request, reply) => {
    request.observabilityStartedAt = Date.now()
    reply.header('x-request-id', request.id)
    reply.header('x-trace-id', request.id)
    usageCollector.startApiRequest({
      requestId: request.id,
      method: request.method,
      route: request.url.split('?', 1)[0] ?? 'unknown',
      traceId: request.id,
      now: request.observabilityStartedAt,
    })
  })
  app.addHook('preHandler', async (request) => {
    const route = request.routeOptions.url ?? request.url.split('?', 1)[0] ?? 'unknown'
    usageCollector.bindApiRequestIdentity(request.id, {
      tenantId: request.principal?.tenantId ?? null,
      organizationId: request.principal?.organizationId ?? request.principal?.tenantId ?? null,
      userId: request.principal?.userId ?? null,
      traceId: request.id,
      method: request.method,
      route,
    })
  })
  app.addHook('onResponse', async (request, reply) => {
    const context = requestLogContext(request)
    const route = request.routeOptions.url ?? request.url.split('?', 1)[0] ?? 'unknown'
    const durationMs = Math.max(0, Date.now() - request.observabilityStartedAt)
    observabilityMetrics.recordHttpRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs,
      tenantId: context.tenantId,
    })
    usageCollector.finishApiRequest({
      requestId: request.id,
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: context.userId,
      traceId: context.traceId,
    })
    request.log.info(
      {
        ...context,
        method: request.method,
        route,
        statusCode: reply.statusCode,
        durationMs,
      },
      'request completed',
    )
  })
}

export function requestLogContext(request: FastifyRequest): {
  requestId: string
  traceId: string
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  taskId: string | null
  jobId: string | null
  projectId: string | null
} {
  const params = objectValue(request.params)
  return {
    requestId: request.id,
    traceId: request.id,
    tenantId: request.principal?.tenantId ?? null,
    organizationId: request.principal?.organizationId ?? request.principal?.tenantId ?? null,
    userId: request.principal?.userId ?? null,
    taskId: stringValue(params.taskId),
    jobId: stringValue(params.jobId),
    projectId: stringValue(params.projectId),
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
