import type { ObservabilitySnapshot } from './metrics.js'

type PrometheusLabels = Record<string, string>
type PrometheusMetricKind = 'counter' | 'gauge'

export function renderPrometheusMetrics(snapshot: ObservabilitySnapshot): string {
  const lines: string[] = []
  const declaredFamilies = new Set<string>()

  emitGauge(lines, declaredFamilies, 'seqora_process_pid', snapshot.process.pid)
  emitGauge(lines, declaredFamilies, 'seqora_process_uptime_seconds', snapshot.process.uptimeSeconds)

  emitCounterMap(lines, declaredFamilies, 'seqora_http_requests_total', snapshot.http.requests)
  emitDurationMap(lines, declaredFamilies, 'seqora_http_request_duration_ms', snapshot.http.durations)

  emitCounterMap(lines, declaredFamilies, 'seqora_queue_published_total', snapshot.queue.published)
  emitDurationMap(lines, declaredFamilies, 'seqora_queue_wait_duration_ms', snapshot.queue.wait)
  emitDurationMap(lines, declaredFamilies, 'seqora_queue_execution_duration_ms', snapshot.queue.execution)

  emitDurationMap(lines, declaredFamilies, 'seqora_task_queue_wait_duration_ms', snapshot.tasks.queueWait)
  emitDurationMap(lines, declaredFamilies, 'seqora_task_execution_duration_ms', snapshot.tasks.execution)
  emitCounterMap(lines, declaredFamilies, 'seqora_task_terminal_total', snapshot.tasks.terminal)

  emitDurationMap(lines, declaredFamilies, 'seqora_ai_job_queue_wait_duration_ms', snapshot.aiJobs.queueWait)
  emitDurationMap(lines, declaredFamilies, 'seqora_ai_job_execution_duration_ms', snapshot.aiJobs.execution)
  emitCounterMap(lines, declaredFamilies, 'seqora_ai_job_terminal_total', snapshot.aiJobs.terminal)

  emitDurationMap(lines, declaredFamilies, 'seqora_provider_call_duration_ms', snapshot.providers.calls)

  emitCounter(lines, declaredFamilies, 'seqora_refunds_total', snapshot.refunds.count)
  emitCounter(lines, declaredFamilies, 'seqora_refunded_credits_total', snapshot.refunds.credits)
  emitCounterMap(lines, declaredFamilies, 'seqora_refunds_by_tenant_total', snapshot.refunds.byTenant, 'tenantId')

  emitDurationMap(lines, declaredFamilies, 'seqora_film_preview_execution_duration_ms', snapshot.filmPreview.executions)

  return lines.join('\n') + '\n'
}

function emitCounterMap(
  lines: string[],
  declaredFamilies: Set<string>,
  metricName: string,
  values: Record<string, number>,
  tenantLabelName?: string,
): void {
  for (const [key, value] of Object.entries(values)) {
    const { labels } = parseMetricKey(key)
    if (tenantLabelName && !labels[tenantLabelName]) {
      labels[tenantLabelName] = key
    }
    emitSample(lines, declaredFamilies, metricName, labels, value, 'counter')
  }
}

function emitDurationMap(
  lines: string[],
  declaredFamilies: Set<string>,
  metricName: string,
  values: Record<
    string,
    {
      count: number
      failures: number
      totalMs: number
      maxMs: number
      lastMs: number
    }
  >,
): void {
  for (const [key, stats] of Object.entries(values)) {
    const { labels } = parseMetricKey(key)
    emitSample(lines, declaredFamilies, `${metricName}_count`, labels, stats.count, 'counter')
    emitSample(lines, declaredFamilies, `${metricName}_failures`, labels, stats.failures, 'counter')
    emitSample(lines, declaredFamilies, `${metricName}_sum_ms`, labels, stats.totalMs, 'counter')
    emitSample(lines, declaredFamilies, `${metricName}_max_ms`, labels, stats.maxMs, 'gauge')
    emitSample(lines, declaredFamilies, `${metricName}_last_ms`, labels, stats.lastMs, 'gauge')
  }
}

function emitGauge(
  lines: string[],
  declaredFamilies: Set<string>,
  metricName: string,
  value: number,
): void {
  emitSample(lines, declaredFamilies, metricName, {}, value, 'gauge')
}

function emitCounter(
  lines: string[],
  declaredFamilies: Set<string>,
  metricName: string,
  value: number,
): void {
  emitSample(lines, declaredFamilies, metricName, {}, value, 'counter')
}

function emitSample(
  lines: string[],
  declaredFamilies: Set<string>,
  metricName: string,
  labels: PrometheusLabels,
  value: number,
  kind: PrometheusMetricKind,
): void {
  emitMetricType(lines, declaredFamilies, metricName, kind)
  lines.push(`${metricName}${formatLabels(labels)} ${formatNumber(value)}`)
}

function emitMetricType(
  lines: string[],
  declaredFamilies: Set<string>,
  metricName: string,
  kind: PrometheusMetricKind,
): void {
  if (declaredFamilies.has(metricName)) return
  lines.push(`# TYPE ${metricName} ${kind}`)
  declaredFamilies.add(metricName)
}

function formatLabels(labels: PrometheusLabels): string {
  const entries = Object.entries(labels).filter(([, value]) => value !== '')
  if (!entries.length) return ''
  return `{${entries
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(',')}}`
}

function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

function parseMetricKey(key: string): { name: string; labels: PrometheusLabels } {
  const match = /^([^{}]+)(?:\{(.+)\})?$/.exec(key)
  if (!match) return { name: key, labels: {} }
  const name = match[1] ?? key
  const labels: PrometheusLabels = {}
  if (match[2]) {
    for (const entry of splitLabelEntries(match[2])) {
      const separator = entry.indexOf('=')
      if (separator <= 0) continue
      const labelName = entry.slice(0, separator).trim()
      const labelValue = entry.slice(separator + 1).trim()
      if (!labelName || !labelValue) continue
      labels[labelName] = labelValue
    }
  }
  return { name, labels }
}

function splitLabelEntries(value: string): string[] {
  if (!value) return []
  return value.split(',').map((entry) => entry.trim()).filter(Boolean)
}
