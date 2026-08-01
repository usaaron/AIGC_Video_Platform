import { describe, expect, it } from 'vitest'
import type { ObservabilitySnapshot } from './metrics.js'
import { renderPrometheusMetrics } from './prometheus.js'

describe('renderPrometheusMetrics', () => {
  it('renders Prometheus counters and failure totals with stable labels', () => {
    const output = renderPrometheusMetrics(snapshot())

    expect(output).toContain('# TYPE seqora_http_requests_total counter')
    expect(output).toContain(
      'seqora_http_requests_total{method="GET",route="/api/v1/health/readiness",status="5xx"} 1',
    )
    expect(output).toContain('# TYPE seqora_http_request_duration_ms_failures counter')
    expect(output).toContain(
      'seqora_http_request_duration_ms_failures{method="GET",route="/api/v1/health/readiness",status="5xx"} 1',
    )
    expect(output.match(/^# TYPE seqora_http_requests_total counter$/gm)).toHaveLength(1)
    expect(output).toContain('# TYPE seqora_refunds_total counter')
  })
})

function snapshot(): ObservabilitySnapshot {
  return {
    generatedAt: '2026-08-01T00:00:00.000Z',
    process: {
      pid: 123,
      uptimeSeconds: 45,
    },
    http: {
      requests: {
        'http.requests{method=GET,route=/api/v1/health/readiness,status=5xx}': 1,
      },
      durations: {
        'http.duration{method=GET,route=/api/v1/health/readiness,status=5xx}': {
          count: 1,
          failures: 1,
          totalMs: 23,
          maxMs: 23,
          lastMs: 23,
          lastErrorCode: null,
        },
      },
    },
    queue: {
      published: {},
      wait: {},
      execution: {},
    },
    tasks: {
      queueWait: {},
      execution: {},
      terminal: {},
    },
    aiJobs: {
      queueWait: {},
      execution: {},
      terminal: {},
    },
    providers: {
      calls: {},
    },
    refunds: {
      count: 0,
      credits: 0,
      byTenant: {},
    },
    filmPreview: {
      executions: {},
    },
  }
}
