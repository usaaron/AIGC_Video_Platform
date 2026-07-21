import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AuditLogEntry, AuditLogWriter } from './audit.js'

export type RequestObservation = {
  requestId: string
  traceId: string
  spanId: string
  startedAt: number
}

declare module 'fastify' {
  interface FastifyRequest {
    observation: RequestObservation | null
  }
}

type MetricsKey = {
  method: string
  route: string
  status?: number
  scope?: string
  outcome?: string
}

type RequestTiming = {
  count: number
  totalMs: number
}

export class ObservabilityMetrics {
  private readonly requestCounts = new Map<string, number>()
  private readonly requestTimings = new Map<string, RequestTiming>()
  private readonly rateLimitHits = new Map<string, number>()
  private readonly auditEvents = new Map<string, number>()

  recordRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    this.increment(this.requestCounts, metricsKey({ method, route, status: statusCode }))
    const timingKey = metricsKey({ method, route })
    const current = this.requestTimings.get(timingKey) ?? { count: 0, totalMs: 0 }
    current.count += 1
    current.totalMs += durationMs
    this.requestTimings.set(timingKey, current)
  }

  recordRateLimit(scope: string): void {
    this.increment(this.rateLimitHits, metricsKey({ method: 'all', route: 'all', scope }))
  }

  recordAudit(outcome: AuditLogEntry['outcome']): void {
    this.increment(this.auditEvents, metricsKey({ method: 'all', route: 'all', outcome }))
  }

  render(): string {
    const lines: string[] = [
      '# HELP seqora_http_requests_total Total HTTP responses by method, route and status.',
      '# TYPE seqora_http_requests_total counter',
    ]

    for (const [key, value] of sortEntries(this.requestCounts)) {
      lines.push(`seqora_http_requests_total{${renderLabels(key)}} ${value}`)
    }

    lines.push('# HELP seqora_http_request_duration_ms_sum Total response duration in milliseconds.')
    lines.push('# TYPE seqora_http_request_duration_ms_sum counter')
    for (const [key, value] of sortEntries(this.requestTimings)) {
      const labels = renderLabels(key)
      lines.push(`seqora_http_request_duration_ms_sum{${labels}} ${value.totalMs.toFixed(3)}`)
      lines.push(`seqora_http_request_duration_ms_count{${labels}} ${value.count}`)
    }

    lines.push('# HELP seqora_rate_limit_hits_total Total rate limit rejections by scope.')
    lines.push('# TYPE seqora_rate_limit_hits_total counter')
    for (const [key, value] of sortEntries(this.rateLimitHits)) {
      lines.push(`seqora_rate_limit_hits_total{${renderLabels(key)}} ${value}`)
    }

    lines.push('# HELP seqora_audit_events_total Total audit log entries by outcome.')
    lines.push('# TYPE seqora_audit_events_total counter')
    for (const [key, value] of sortEntries(this.auditEvents)) {
      lines.push(`seqora_audit_events_total{${renderLabels(key)}} ${value}`)
    }

    return `${lines.join('\n')}\n`
  }

  private increment(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1)
  }
}

export function installObservability(
  app: FastifyInstance,
  options: {
    auditLogWriter: AuditLogWriter
    metrics: ObservabilityMetrics
  },
): void {
  app.decorateRequest('observation', null)

  app.addHook('onRequest', async (request, reply) => {
    const observation = createObservation(request)
    request.observation = observation
    reply.header('x-request-id', observation.requestId)
    reply.header('traceparent', formatTraceparent(observation))
  })

  app.addHook('onResponse', async (request, reply) => {
    const observation = request.observation
    const route = routePatternFor(request)
    const durationMs = observation ? performance.now() - observation.startedAt : 0
    options.metrics.recordRequest(request.method, route, reply.statusCode, durationMs)

    if (!shouldAudit(route, request.url)) return
    const principal = request.principal
    const fallbackId = toHexId(16)
    const requestId = observation?.requestId ?? fallbackId
    const entry: AuditLogEntry = {
      id: requestId,
      requestId,
      traceId: observation?.traceId ?? requestId,
      tenantId: principal?.tenantId ?? null,
      userId: principal?.userId ?? null,
      roles: principal?.roles ?? [],
      method: request.method,
      routePattern: route,
      path: pathFor(request),
      action: `${request.method} ${route}`,
      statusCode: reply.statusCode,
      outcome: reply.statusCode < 400 ? 'success' : 'failure',
      ip: request.ip ?? null,
      userAgent: headerValue(request, 'user-agent'),
      details: {
        durationMs: Number(durationMs.toFixed(3)),
        params: isPlainObject(request.params) ? request.params : {},
      },
      createdAt: new Date().toISOString(),
    }

    try {
      await options.auditLogWriter.record(entry)
      options.metrics.recordAudit(entry.outcome)
    } catch (error) {
      request.log.error(
        { error, requestId: entry.requestId, traceId: entry.traceId, route: entry.routePattern },
        'audit_log.write_failed',
      )
    }
  })

  app.addHook('onError', async (request, _reply, error) => {
    const observation = request.observation
    request.log.error(
      {
        error,
        requestId: observation?.requestId,
        traceId: observation?.traceId,
        route: routePatternFor(request),
        path: pathFor(request),
      },
      'request.failed',
    )
  })
}

function createObservation(request: FastifyRequest): RequestObservation {
  const incomingTraceparent = headerValue(request, 'traceparent')
  const traceId = parseTraceparent(incomingTraceparent)?.traceId ?? toHexId(16)
  return {
    requestId: traceId,
    traceId,
    spanId: toHexId(8),
    startedAt: performance.now(),
  }
}

function formatTraceparent(observation: RequestObservation): string {
  return `00-${observation.traceId}-${observation.spanId}-01`
}

function parseTraceparent(value: string | null | undefined): { traceId: string } | null {
  if (!value) return null
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(value.trim())
  if (!match) return null
  const traceId = match[2]
  return traceId ? { traceId: traceId.toLowerCase() } : null
}

function shouldAudit(routePattern: string, path: string): boolean {
  const normalized = `${routePattern} ${path}`.toLowerCase()
  if (normalized.includes('/api/v1/health')) return false
  if (normalized.includes('/api/v1/metrics')) return false
  if (normalized.includes('/metrics')) return false
  return true
}

function routePatternFor(request: FastifyRequest): string {
  return request.routeOptions.url ?? pathFor(request)
}

function pathFor(request: FastifyRequest): string {
  return request.url.split('?')[0] ?? '/'
}

function headerValue(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name]
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === 'string' ? value : null
}

function toHexId(byteLength: number): string {
  return randomBytes(byteLength).toString('hex')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function metricsKey(key: MetricsKey): string {
  return JSON.stringify({
    method: key.method,
    route: key.route,
    status: key.status ?? null,
    scope: key.scope ?? null,
    outcome: key.outcome ?? null,
  })
}

function sortEntries<T>(map: Map<string, T>): Array<[string, T]> {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function renderLabels(key: string): string {
  const parsed = JSON.parse(key) as MetricsKey
  const labels: string[] = []
  if (parsed.method) labels.push(`method="${escapeLabel(parsed.method)}"`)
  if (parsed.route) labels.push(`route="${escapeLabel(parsed.route)}"`)
  if (parsed.status !== undefined && parsed.status !== null) {
    labels.push(`status="${escapeLabel(String(parsed.status))}"`)
  }
  if (parsed.scope) labels.push(`scope="${escapeLabel(parsed.scope)}"`)
  if (parsed.outcome) labels.push(`outcome="${escapeLabel(parsed.outcome)}"`)
  return labels.join(',')
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}
