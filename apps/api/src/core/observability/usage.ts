import type { UsageMetrics } from '@seqora/contracts'

type UsageIdentity = {
  tenantId?: string | null
  organizationId?: string | null
  userId?: string | null
  traceId?: string | null
}

type ActiveApiRequest = UsageIdentity & {
  requestId: string
  route?: string | null
  method?: string | null
  startedAt: number
}

type ApiRequestEvent = UsageIdentity & {
  requestId: string
  route: string
  method: string
  statusCode: number
  durationMs: number
  occurredAt: number
}

type ActiveJob = UsageIdentity & {
  jobId: string
  source: 'generation_task' | 'ai_job'
  kind: string
  startedAt: number
}

type JobEvent = UsageIdentity & {
  jobId: string
  source: 'generation_task' | 'ai_job'
  kind: string
  status: 'completed' | 'failed' | 'cancelled' | 'unknown'
  creditsUsed: number
  occurredAt: number
}

type ActiveProviderCall = UsageIdentity & {
  callId: string
  provider: string
  operation: string
  taskId?: string | null
  jobId?: string | null
  startedAt: number
}

type ProviderUsageEvent = UsageIdentity & {
  provider: string
  operation: string
  model?: string | null
  taskId?: string | null
  jobId?: string | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  providerUnits: number
  estimated: boolean
  occurredAt: number
}

type UsageScope = {
  tenantId?: string | null
  organizationId?: string | null
  userId?: string | null
}

export type ProviderTokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

type ProviderUsageContext = UsageIdentity & {
  taskId?: string | null
  jobId?: string | null
}

const MAX_EVENTS = 20_000
const ROLLING_WINDOW_MS = 60_000

export class UsageCollector {
  private readonly activeApiRequests = new Map<string, ActiveApiRequest>()
  private readonly activeJobs = new Map<string, ActiveJob>()
  private readonly activeProviderCalls = new Map<string, ActiveProviderCall>()
  private readonly apiRequestEvents: ApiRequestEvent[] = []
  private readonly jobEvents: JobEvent[] = []
  private readonly providerUsageEvents: ProviderUsageEvent[] = []
  private nextProviderCallSequence = 0

  startApiRequest(input: {
    requestId: string
    method?: string | null
    route?: string | null
    traceId?: string | null
    now?: number
  }): void {
    this.activeApiRequests.set(input.requestId, {
      requestId: input.requestId,
      method: input.method ?? null,
      route: input.route ?? null,
      traceId: input.traceId ?? input.requestId,
      startedAt: input.now ?? Date.now(),
    })
  }

  bindApiRequestIdentity(
    requestId: string,
    identity: UsageIdentity & { method?: string | null; route?: string | null },
  ): void {
    const current = this.activeApiRequests.get(requestId)
    if (!current) return
    this.activeApiRequests.set(requestId, {
      ...current,
      ...definedIdentity(identity),
      method: identity.method ?? current.method ?? null,
      route: identity.route ?? current.route ?? null,
    })
  }

  finishApiRequest(input: {
    requestId: string
    method: string
    route: string
    statusCode: number
    durationMs: number
    tenantId?: string | null
    organizationId?: string | null
    userId?: string | null
    traceId?: string | null
    now?: number
  }): void {
    const active = this.activeApiRequests.get(input.requestId)
    this.activeApiRequests.delete(input.requestId)
    this.apiRequestEvents.push({
      requestId: input.requestId,
      method: input.method,
      route: input.route,
      statusCode: input.statusCode,
      durationMs: Math.max(0, input.durationMs),
      tenantId: input.tenantId ?? active?.tenantId ?? null,
      organizationId:
        input.organizationId ?? active?.organizationId ?? input.tenantId ?? active?.tenantId ?? null,
      userId: input.userId ?? active?.userId ?? null,
      traceId: input.traceId ?? active?.traceId ?? input.requestId,
      occurredAt: input.now ?? Date.now(),
    })
    trimToMax(this.apiRequestEvents)
  }

  startJob(
    input: UsageIdentity & {
      jobId: string
      source: 'generation_task' | 'ai_job'
      kind: string
      now?: number
    },
  ): void {
    this.activeJobs.set(jobKey(input.source, input.jobId), {
      jobId: input.jobId,
      source: input.source,
      kind: input.kind,
      ...definedIdentity(input),
      organizationId: input.organizationId ?? input.tenantId ?? null,
      startedAt: input.now ?? Date.now(),
    })
  }

  finishJob(
    input: UsageIdentity & {
      jobId: string
      source: 'generation_task' | 'ai_job'
      kind: string
      status?: 'completed' | 'failed' | 'cancelled' | 'unknown'
      creditsUsed?: number | null
      recordUsage?: boolean
      now?: number
    },
  ): void {
    const key = jobKey(input.source, input.jobId)
    const active = this.activeJobs.get(key)
    this.activeJobs.delete(key)
    if (input.recordUsage === false) return
    this.pushJobEvent({
      jobId: input.jobId,
      source: input.source,
      kind: input.kind,
      status: input.status ?? 'unknown',
      creditsUsed: Math.max(0, Math.floor(input.creditsUsed ?? 0)),
      tenantId: input.tenantId ?? active?.tenantId ?? null,
      organizationId:
        input.organizationId ?? active?.organizationId ?? input.tenantId ?? active?.tenantId ?? null,
      userId: input.userId ?? active?.userId ?? null,
      traceId: input.traceId ?? active?.traceId ?? null,
      occurredAt: input.now ?? Date.now(),
    })
  }

  recordJobTerminal(
    input: UsageIdentity & {
      jobId: string
      source: 'generation_task' | 'ai_job'
      kind: string
      status: 'completed' | 'failed' | 'cancelled'
      creditsUsed?: number | null
      now?: number
    },
  ): void {
    this.pushJobEvent({
      jobId: input.jobId,
      source: input.source,
      kind: input.kind,
      status: input.status,
      creditsUsed: Math.max(0, Math.floor(input.creditsUsed ?? 0)),
      tenantId: input.tenantId ?? null,
      organizationId: input.organizationId ?? input.tenantId ?? null,
      userId: input.userId ?? null,
      traceId: input.traceId ?? null,
      occurredAt: input.now ?? Date.now(),
    })
  }

  startProviderCall(
    input: UsageIdentity & {
      provider: string
      operation: string
      taskId?: string | null
      jobId?: string | null
      now?: number
    },
  ): string {
    const callId = `provider-call-${Date.now()}-${(this.nextProviderCallSequence += 1)}`
    this.activeProviderCalls.set(callId, {
      callId,
      provider: input.provider,
      operation: input.operation,
      taskId: input.taskId ?? null,
      jobId: input.jobId ?? null,
      ...definedIdentity(input),
      organizationId: input.organizationId ?? input.tenantId ?? null,
      startedAt: input.now ?? Date.now(),
    })
    return callId
  }

  finishProviderCall(callId: string): void {
    this.activeProviderCalls.delete(callId)
  }

  recordProviderTokenUsage(
    input: UsageIdentity & {
      provider: string
      operation: string
      model?: string | null
      taskId?: string | null
      jobId?: string | null
      inputTokens?: number | null
      outputTokens?: number | null
      totalTokens?: number | null
      providerUnits?: number | null
      estimated?: boolean
      now?: number
    },
  ): void {
    const inputTokens = nonnegativeInteger(input.inputTokens)
    const outputTokens = nonnegativeInteger(input.outputTokens)
    const totalTokens = nonnegativeInteger(input.totalTokens ?? inputTokens + outputTokens)
    this.providerUsageEvents.push({
      provider: input.provider,
      operation: input.operation,
      model: input.model ?? null,
      taskId: input.taskId ?? null,
      jobId: input.jobId ?? null,
      inputTokens,
      outputTokens,
      totalTokens,
      providerUnits: nonnegativeNumber(input.providerUnits),
      estimated: input.estimated ?? totalTokens === 0,
      tenantId: input.tenantId ?? null,
      organizationId: input.organizationId ?? input.tenantId ?? null,
      userId: input.userId ?? null,
      traceId: input.traceId ?? null,
      occurredAt: input.now ?? Date.now(),
    })
    trimToMax(this.providerUsageEvents)
  }

  snapshot(scope: UsageScope = {}, now = Date.now(), rangeSince?: number): UsageMetrics {
    const activeApiRequests = [...this.activeApiRequests.values()].filter((event) =>
      matchesScope(event, scope),
    )
    const activeJobs = [...this.activeJobs.values()].filter((event) => matchesScope(event, scope))
    const activeProviderCalls = [...this.activeProviderCalls.values()].filter((event) =>
      matchesScope(event, scope),
    )
    const rollingSince = now - ROLLING_WINDOW_MS
    const rollingApiRequests = this.apiRequestEvents.filter(
      (event) => event.occurredAt >= rollingSince && matchesScope(event, scope),
    )
    const rollingProviderUsage = this.providerUsageEvents.filter(
      (event) => event.occurredAt >= rollingSince && matchesScope(event, scope),
    )
    const requestEvents = this.apiRequestEvents.filter(
      (event) => matchesScope(event, scope) && isInRange(event.occurredAt, rangeSince),
    )
    const providerUsageEvents = this.providerUsageEvents.filter(
      (event) => matchesScope(event, scope) && isInRange(event.occurredAt, rangeSince),
    )
    const jobEvents = this.jobEvents.filter(
      (event) => matchesScope(event, scope) && isInRange(event.occurredAt, rangeSince),
    )
    const terminalJobEvents = jobEvents.filter(isTerminalJobEvent)
    const errorCount = requestEvents.filter((event) => event.statusCode >= 400).length
    const requestCount = requestEvents.length
    const jobCount = terminalJobEvents.length
    const jobFailedCount = terminalJobEvents.filter((event) => event.status === 'failed').length

    return {
      apiConcurrency: activeApiRequests.length,
      jobConcurrency: activeJobs.length,
      providerConcurrency: activeProviderCalls.length,
      rpm: rollingApiRequests.length,
      tpm: sumBy(rollingProviderUsage, (event) => event.totalTokens),
      requestCount,
      jobCount,
      inputTokens: sumBy(providerUsageEvents, (event) => event.inputTokens),
      outputTokens: sumBy(providerUsageEvents, (event) => event.outputTokens),
      totalTokens: sumBy(providerUsageEvents, (event) => event.totalTokens),
      creditsUsed: sumBy(terminalJobEvents, (event) => event.creditsUsed),
      errorCount,
      errorRate: requestCount > 0 ? errorCount / requestCount : 0,
      jobFailedCount,
      jobFailureRate: jobCount > 0 ? jobFailedCount / jobCount : 0,
      providerUnits: sumBy(providerUsageEvents, (event) => event.providerUnits),
    }
  }

  private pushJobEvent(event: JobEvent): void {
    this.jobEvents.push(event)
    trimToMax(this.jobEvents)
  }

  resetForTests(): void {
    this.activeApiRequests.clear()
    this.activeJobs.clear()
    this.activeProviderCalls.clear()
    this.apiRequestEvents.length = 0
    this.jobEvents.length = 0
    this.providerUsageEvents.length = 0
    this.nextProviderCallSequence = 0
  }
}

export const usageCollector = new UsageCollector()

export function recordTextProviderUsage(input: {
  provider: string
  operation?: string
  model?: string | null
  usageContext?: ProviderUsageContext | null
  usage: ProviderTokenUsage | null
  now?: number
}): void {
  usageCollector.recordProviderTokenUsage({
    provider: input.provider,
    operation: input.operation ?? 'text.generate',
    model: input.model ?? null,
    tenantId: input.usageContext?.tenantId ?? null,
    organizationId: input.usageContext?.organizationId ?? input.usageContext?.tenantId ?? null,
    userId: input.usageContext?.userId ?? null,
    taskId: input.usageContext?.taskId ?? null,
    jobId: input.usageContext?.jobId ?? null,
    traceId: input.usageContext?.traceId ?? null,
    inputTokens: input.usage?.inputTokens ?? 0,
    outputTokens: input.usage?.outputTokens ?? 0,
    totalTokens: input.usage?.totalTokens ?? 0,
    estimated: input.usage === null,
    ...(input.now !== undefined ? { now: input.now } : {}),
  })
}

export function providerTokenUsageFromPayload(payload: unknown): ProviderTokenUsage | null {
  const value = recordValue(payload)
  if (!value) return null
  const usage =
    recordValue(value.usage) ??
    recordValue(value.token_usage) ??
    recordValue(value.tokenUsage) ??
    recordValue(value.usage_metadata) ??
    recordValue(value.usageMetadata) ??
    recordValue(recordValue(value.result)?.usage) ??
    recordValue(recordValue(value.data)?.usage) ??
    recordValue(recordValue(value.payload)?.usage) ??
    tokenUsageLikeValue(value)
  if (!usage) return null
  const inputTokens = nonnegativeInteger(
    numberValue(usage.prompt_tokens) ??
      numberValue(usage.input_tokens) ??
      numberValue(usage.promptTokens) ??
      numberValue(usage.inputTokens) ??
      numberValue(usage.prompt_token_count) ??
      numberValue(usage.input_token_count) ??
      numberValue(usage.promptTokenCount) ??
      numberValue(usage.inputTokenCount),
  )
  const outputTokens = nonnegativeInteger(
    numberValue(usage.completion_tokens) ??
      numberValue(usage.output_tokens) ??
      numberValue(usage.completionTokens) ??
      numberValue(usage.outputTokens) ??
      numberValue(usage.candidates_token_count) ??
      numberValue(usage.output_token_count) ??
      numberValue(usage.candidatesTokenCount) ??
      numberValue(usage.outputTokenCount),
  )
  const totalTokens = nonnegativeInteger(
    numberValue(usage.total_tokens) ??
      numberValue(usage.totalTokens) ??
      numberValue(usage.total_token_count) ??
      numberValue(usage.totalTokenCount) ??
      inputTokens + outputTokens,
  )
  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) return null
  return { inputTokens, outputTokens, totalTokens }
}

function tokenUsageLikeValue(value: Record<string, unknown>): Record<string, unknown> | null {
  return [
    'prompt_tokens',
    'input_tokens',
    'promptTokens',
    'inputTokens',
    'prompt_token_count',
    'input_token_count',
    'completion_tokens',
    'output_tokens',
    'completionTokens',
    'outputTokens',
    'candidates_token_count',
    'output_token_count',
    'total_tokens',
    'totalTokens',
    'total_token_count',
    'totalTokenCount',
  ].some((key) => key in value)
    ? value
    : null
}

function jobKey(source: string, jobId: string): string {
  return `${source}:${jobId}`
}

function isTerminalJobEvent(event: JobEvent): boolean {
  return event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled'
}

function definedIdentity(input: UsageIdentity): UsageIdentity {
  return {
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
  }
}

function matchesScope(event: UsageIdentity, scope: UsageScope): boolean {
  if (scope.userId && event.userId !== scope.userId) return false
  if (scope.organizationId) {
    const organizationId = event.organizationId ?? event.tenantId ?? null
    if (organizationId !== scope.organizationId) return false
  }
  if (scope.tenantId && event.tenantId !== scope.tenantId) return false
  return true
}

function isInRange(occurredAt: number, rangeSince: number | undefined): boolean {
  return rangeSince === undefined || occurredAt >= rangeSince
}

function trimToMax<T>(events: T[]): void {
  if (events.length <= MAX_EVENTS) return
  events.splice(0, events.length - MAX_EVENTS)
}

function sumBy<T>(events: T[], value: (event: T) => number): number {
  return events.reduce((total, event) => total + value(event), 0)
}

function nonnegativeInteger(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value ?? 0))
}

function nonnegativeNumber(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value ?? 0)
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
