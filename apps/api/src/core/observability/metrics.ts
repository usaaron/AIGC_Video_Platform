import type { AiJob, GenerationTask, UsageMetrics } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import { usageCollector } from './usage.js'

type DurationStats = {
  count: number
  failures: number
  totalMs: number
  maxMs: number
  lastMs: number
  lastErrorCode: string | null
}

type CounterRecord = Record<string, number>
type DurationRecord = Record<string, DurationStats>

type ObservationLabels = Record<string, string | number | boolean | null | undefined>

export type ObservabilitySnapshot = {
  generatedAt: string
  process: {
    pid: number
    uptimeSeconds: number
  }
  http: {
    requests: CounterRecord
    durations: DurationRecord
  }
  queue: {
    published: CounterRecord
    wait: DurationRecord
    execution: DurationRecord
  }
  tasks: {
    queueWait: DurationRecord
    execution: DurationRecord
    terminal: CounterRecord
  }
  aiJobs: {
    queueWait: DurationRecord
    execution: DurationRecord
    terminal: CounterRecord
  }
  providers: {
    calls: DurationRecord
  }
  refunds: {
    count: number
    credits: number
    byTenant: CounterRecord
  }
  filmPreview: {
    executions: DurationRecord
  }
  usage: UsageMetrics
}

export type DailyOperationalSummary = {
  periodStart: string
  generatedAt: string
  creditsConsumed: number
  refundCount: number
  generationTasks: {
    created: number
    completed: number
    failed: number
    cancelled: number
    terminal: number
    successRate: number | null
  }
  aiJobs: {
    created: number
    completed: number
    failed: number
    cancelled: number
    terminal: number
    successRate: number | null
  }
  filmPreview: {
    terminal: number
    failed: number
    failureRate: number | null
  }
}

class ObservabilityMetrics {
  private readonly counters = new Map<string, number>()
  private readonly durations = new Map<string, DurationStats>()
  private readonly refundByTenant = new Map<string, number>()
  private readonly refundedCreditsByTenant = new Map<string, number>()
  private refundCount = 0
  private refundedCredits = 0

  recordHttpRequest(input: {
    method: string
    route: string
    statusCode: number
    durationMs: number
    tenantId?: string | null
  }): void {
    this.increment('http.requests', {
      method: input.method,
      route: input.route,
      status: statusClass(input.statusCode),
      tenantId: input.tenantId,
    })
    this.observe('http.duration', input.durationMs, input.statusCode >= 500, {
      method: input.method,
      route: input.route,
      status: statusClass(input.statusCode),
    })
  }

  recordQueuePublished(input: { reason: string; tenantId?: string | null }): void {
    this.increment('queue.published', { reason: input.reason, tenantId: input.tenantId })
  }

  recordQueueJob(input: {
    name: string
    reason?: string | null
    waitMs: number
    executionMs: number
    ok: boolean
    error?: unknown
  }): void {
    const labels = { name: input.name, reason: input.reason }
    this.observe('queue.wait', input.waitMs, false, labels)
    this.observe('queue.execution', input.executionMs, !input.ok, {
      ...labels,
      errorCode: input.ok ? null : errorCodeFor(input.error),
    })
  }

  recordTaskQueueWait(input: { kind: string; tenantId: string; taskId: string; waitMs: number }): void {
    this.observe('task.queue_wait', input.waitMs, false, {
      kind: input.kind,
      tenantId: input.tenantId,
    })
  }

  recordTaskExecution(input: {
    kind: string
    tenantId: string
    taskId: string
    durationMs: number
    ok: boolean
    error?: unknown
  }): void {
    this.observe('task.execution', input.durationMs, !input.ok, {
      kind: input.kind,
      tenantId: input.tenantId,
      errorCode: input.ok ? null : errorCodeFor(input.error),
    })
  }

  recordTaskTerminal(input: {
    kind: string
    tenantId: string
    taskId: string
    status: GenerationTask['status']
  }): void {
    this.increment('task.terminal', {
      kind: input.kind,
      tenantId: input.tenantId,
      status: input.status,
    })
  }

  recordAiJobQueueWait(input: { kind: string; tenantId: string; jobId: string; waitMs: number }): void {
    this.observe('ai_job.queue_wait', input.waitMs, false, {
      kind: input.kind,
      tenantId: input.tenantId,
    })
  }

  recordAiJobExecution(input: {
    kind: string
    tenantId: string
    jobId: string
    durationMs: number
    ok: boolean
    error?: unknown
  }): void {
    this.observe('ai_job.execution', input.durationMs, !input.ok, {
      kind: input.kind,
      tenantId: input.tenantId,
      errorCode: input.ok ? null : errorCodeFor(input.error),
    })
  }

  recordAiJobTerminal(input: {
    kind: string
    tenantId: string
    jobId: string
    status: AiJob['status']
  }): void {
    this.increment('ai_job.terminal', {
      kind: input.kind,
      tenantId: input.tenantId,
      status: input.status,
    })
  }

  recordProviderCall(input: {
    provider: string
    operation: string
    tenantId?: string | null
    taskId?: string | null
    jobId?: string | null
    durationMs: number
    ok: boolean
    error?: unknown
  }): void {
    this.observe('provider.call', input.durationMs, !input.ok, {
      provider: input.provider,
      operation: input.operation,
      tenantId: input.tenantId,
      errorCode: input.ok ? null : errorCodeFor(input.error),
    })
  }

  recordRefund(input: { tenantId: string; amount: number }): void {
    this.refundCount += 1
    this.refundedCredits += input.amount
    this.refundByTenant.set(input.tenantId, (this.refundByTenant.get(input.tenantId) ?? 0) + 1)
    this.refundedCreditsByTenant.set(
      input.tenantId,
      (this.refundedCreditsByTenant.get(input.tenantId) ?? 0) + input.amount,
    )
  }

  recordFilmPreview(input: {
    tenantId: string
    taskId: string
    durationMs: number
    ok: boolean
    error?: unknown
  }): void {
    this.observe('film_preview.execution', input.durationMs, !input.ok, {
      tenantId: input.tenantId,
      errorCode: input.ok ? null : errorCodeFor(input.error),
    })
  }

  snapshot(options: { tenantId?: string } = {}): ObservabilitySnapshot {
    return {
      generatedAt: new Date().toISOString(),
      process: {
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
      },
      http: {
        requests: countersWithPrefix(this.counters, 'http.requests', options.tenantId),
        durations: durationsWithPrefix(this.durations, 'http.duration', options.tenantId),
      },
      queue: {
        published: countersWithPrefix(this.counters, 'queue.published', options.tenantId),
        wait: durationsWithPrefix(this.durations, 'queue.wait', options.tenantId),
        execution: durationsWithPrefix(this.durations, 'queue.execution', options.tenantId),
      },
      tasks: {
        queueWait: durationsWithPrefix(this.durations, 'task.queue_wait', options.tenantId),
        execution: durationsWithPrefix(this.durations, 'task.execution', options.tenantId),
        terminal: countersWithPrefix(this.counters, 'task.terminal', options.tenantId),
      },
      aiJobs: {
        queueWait: durationsWithPrefix(this.durations, 'ai_job.queue_wait', options.tenantId),
        execution: durationsWithPrefix(this.durations, 'ai_job.execution', options.tenantId),
        terminal: countersWithPrefix(this.counters, 'ai_job.terminal', options.tenantId),
      },
      providers: {
        calls: durationsWithPrefix(this.durations, 'provider.call', options.tenantId),
      },
      refunds: {
        count: options.tenantId ? (this.refundByTenant.get(options.tenantId) ?? 0) : this.refundCount,
        credits: options.tenantId
          ? (this.refundedCreditsByTenant.get(options.tenantId) ?? 0)
          : this.refundedCredits,
        byTenant: Object.fromEntries(
          [...this.refundByTenant].filter(([tenantId]) => !options.tenantId || tenantId === options.tenantId),
        ),
      },
      filmPreview: {
        executions: durationsWithPrefix(this.durations, 'film_preview.execution', options.tenantId),
      },
      usage: usageCollector.snapshot(options.tenantId ? { tenantId: options.tenantId } : {}),
    }
  }

  private increment(name: string, labels: ObservationLabels = {}, by = 1): void {
    const key = metricKey(name, labels)
    this.counters.set(key, (this.counters.get(key) ?? 0) + by)
  }

  private observe(name: string, durationMs: number, failed: boolean, labels: ObservationLabels = {}): void {
    const key = metricKey(name, labels)
    const current =
      this.durations.get(key) ??
      ({
        count: 0,
        failures: 0,
        totalMs: 0,
        maxMs: 0,
        lastMs: 0,
        lastErrorCode: null,
      } satisfies DurationStats)
    current.count += 1
    current.failures += failed ? 1 : 0
    current.totalMs += durationMs
    current.maxMs = Math.max(current.maxMs, durationMs)
    current.lastMs = durationMs
    current.lastErrorCode = typeof labels.errorCode === 'string' ? labels.errorCode : current.lastErrorCode
    this.durations.set(key, current)
  }
}

export const observabilityMetrics = new ObservabilityMetrics()

export async function observeProviderCall<T>(
  input: {
    provider: string
    operation: string
    tenantId?: string | null
    organizationId?: string | null
    userId?: string | null
    taskId?: string | null
    jobId?: string | null
    traceId?: string | null
  },
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  const usageCallId = usageCollector.startProviderCall({
    provider: input.provider,
    operation: input.operation,
    tenantId: input.tenantId ?? null,
    organizationId: input.organizationId ?? input.tenantId ?? null,
    userId: input.userId ?? null,
    taskId: input.taskId ?? null,
    jobId: input.jobId ?? null,
    traceId: input.traceId ?? null,
    now: startedAt,
  })
  try {
    const result = await operation()
    observabilityMetrics.recordProviderCall({
      ...input,
      durationMs: Date.now() - startedAt,
      ok: true,
    })
    return result
  } catch (error) {
    observabilityMetrics.recordProviderCall({
      ...input,
      durationMs: Date.now() - startedAt,
      ok: false,
      error,
    })
    throw error
  } finally {
    usageCollector.finishProviderCall(usageCallId)
  }
}

export function dailyOperationalSummary(store: AppStore, tenantId?: string): DailyOperationalSummary {
  const periodStart = startOfChinaDay()
  return store.read((state) => {
    const scopedTasks = state.tasks.filter(
      (task) => task.createdAt >= periodStart && (!tenantId || task.tenantId === tenantId),
    )
    const scopedAiJobs = state.aiJobs.filter(
      (job) => job.createdAt >= periodStart && (!tenantId || job.tenantId === tenantId),
    )
    const completed = scopedTasks.filter((task) => task.status === 'completed').length
    const failed = scopedTasks.filter((task) => task.status === 'failed').length
    const cancelled = scopedTasks.filter((task) => task.status === 'cancelled').length
    const terminal = completed + failed + cancelled
    const aiJobsCompleted = scopedAiJobs.filter((job) => job.status === 'completed').length
    const aiJobsFailed = scopedAiJobs.filter((job) => job.status === 'failed').length
    const aiJobsCancelled = scopedAiJobs.filter((job) => job.status === 'cancelled').length
    const aiJobsTerminal = aiJobsCompleted + aiJobsFailed + aiJobsCancelled
    const filmPreviewTasks = scopedTasks.filter((task) => task.provider === 'local-compose')
    const filmPreviewTerminal = filmPreviewTasks.filter((task) =>
      ['completed', 'failed', 'cancelled'].includes(task.status),
    ).length
    const filmPreviewFailed = filmPreviewTasks.filter((task) => task.status === 'failed').length
    return {
      periodStart,
      generatedAt: new Date().toISOString(),
      creditsConsumed: state.ledger
        .filter(
          (entry) =>
            entry.type === 'generation' &&
            entry.amount < 0 &&
            entry.createdAt >= periodStart &&
            (!tenantId || entry.tenantId === tenantId),
        )
        .reduce((total, entry) => total + Math.abs(entry.amount), 0),
      refundCount: state.ledger.filter(
        (entry) =>
          entry.type === 'adjustment' &&
          entry.amount > 0 &&
          entry.id.startsWith('refund-') &&
          entry.createdAt >= periodStart &&
          (!tenantId || entry.tenantId === tenantId),
      ).length,
      generationTasks: {
        created: scopedTasks.length,
        completed,
        failed,
        cancelled,
        terminal,
        successRate: terminal > 0 ? completed / terminal : null,
      },
      aiJobs: {
        created: scopedAiJobs.length,
        completed: aiJobsCompleted,
        failed: aiJobsFailed,
        cancelled: aiJobsCancelled,
        terminal: aiJobsTerminal,
        successRate: aiJobsTerminal > 0 ? aiJobsCompleted / aiJobsTerminal : null,
      },
      filmPreview: {
        terminal: filmPreviewTerminal,
        failed: filmPreviewFailed,
        failureRate: filmPreviewTerminal > 0 ? filmPreviewFailed / filmPreviewTerminal : null,
      },
    }
  })
}

export function errorCodeFor(error: unknown): string {
  if (!error) return 'UNKNOWN'
  if (typeof error === 'object') {
    const value = error as { code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown }
    if (typeof value.code === 'string' && value.code) return value.code
    if (typeof value.status === 'number') return `HTTP_${value.status}`
    if (typeof value.statusCode === 'number') return `HTTP_${value.statusCode}`
    if (typeof value.name === 'string' && value.name && value.name !== 'Error') return value.name
  }
  return 'ERROR'
}

function metricKey(name: string, labels: ObservationLabels): string {
  const entries = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
  if (!entries.length) return name
  return `${name}{${entries.map(([key, value]) => `${key}=${String(value)}`).join(',')}}`
}

function countersWithPrefix(counters: Map<string, number>, prefix: string, tenantId?: string): CounterRecord {
  return Object.fromEntries(
    [...counters].filter(([key]) => key.startsWith(prefix) && metricMatchesTenant(key, tenantId)),
  )
}

function durationsWithPrefix(
  durations: Map<string, DurationStats>,
  prefix: string,
  tenantId?: string,
): DurationRecord {
  return Object.fromEntries(
    [...durations]
      .filter(([key]) => key.startsWith(prefix) && metricMatchesTenant(key, tenantId))
      .map(([key, value]) => [
        key,
        {
          ...value,
          totalMs: Math.round(value.totalMs),
          maxMs: Math.round(value.maxMs),
          lastMs: Math.round(value.lastMs),
        },
      ]),
  )
}

function metricMatchesTenant(key: string, tenantId?: string): boolean {
  if (!tenantId) return true
  if (!key.includes('tenantId=')) return true
  return key.includes(`tenantId=${tenantId}`)
}

function statusClass(statusCode: number): string {
  return `${Math.floor(statusCode / 100)}xx`
}

function startOfChinaDay(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()) - chinaOffsetMs,
  ).toISOString()
}
