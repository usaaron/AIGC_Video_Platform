import { describe, expect, it } from 'vitest'
import {
  USAGE_METRIC_DEFINITIONS,
  USAGE_METRIC_NAMES,
  usageMetricsSchema,
  usageRangeMetricsSchema,
  usageSummarySchema,
} from './usage.js'

describe('usage metric contracts', () => {
  it('freezes the public usage metric names and definitions', () => {
    expect(USAGE_METRIC_NAMES).toEqual([
      'apiConcurrency',
      'jobConcurrency',
      'providerConcurrency',
      'rpm',
      'tpm',
      'requestCount',
      'jobCount',
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'creditsUsed',
      'errorCount',
      'errorRate',
      'jobFailedCount',
      'jobFailureRate',
      'providerUnits',
    ])
    expect(Object.keys(USAGE_METRIC_DEFINITIONS)).toEqual([...USAGE_METRIC_NAMES])
    expect(USAGE_METRIC_DEFINITIONS.apiConcurrency).toMatchObject({
      window: 'realtime',
      aggregation: 'gauge',
      unit: 'requests',
    })
    expect(USAGE_METRIC_DEFINITIONS.rpm).toMatchObject({
      window: 'rolling_60s',
      aggregation: 'count',
      unit: 'requests',
    })
    expect(USAGE_METRIC_DEFINITIONS.tpm).toMatchObject({
      window: 'rolling_60s',
      aggregation: 'sum',
      unit: 'tokens',
    })
    expect(USAGE_METRIC_DEFINITIONS.errorRate).toMatchObject({
      window: 'range',
      aggregation: 'ratio',
      unit: 'ratio',
    })
  })

  it('accepts complete usage metrics and defaults provider units', () => {
    expect(
      usageMetricsSchema.parse({
        apiConcurrency: 2,
        jobConcurrency: 1,
        providerConcurrency: 1,
        rpm: 30,
        tpm: 12_000,
        requestCount: 300,
        jobCount: 20,
        inputTokens: 40_000,
        outputTokens: 12_000,
        totalTokens: 52_000,
        creditsUsed: 180,
        errorCount: 3,
        errorRate: 0.01,
        jobFailedCount: 1,
        jobFailureRate: 0.05,
      }),
    ).toMatchObject({ providerUnits: 0 })
  })

  it('rejects negative counters and invalid error rates', () => {
    expect(
      usageRangeMetricsSchema.safeParse({
        requestCount: 1,
        jobCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        creditsUsed: -1,
        errorCount: 0,
        errorRate: 0,
        jobFailedCount: 0,
        jobFailureRate: 0,
      }).success,
    ).toBe(false)

    expect(
      usageRangeMetricsSchema.safeParse({
        requestCount: 1,
        jobCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        creditsUsed: 0,
        errorCount: 1,
        errorRate: 1.5,
        jobFailedCount: 0,
        jobFailureRate: 0,
      }).success,
    ).toBe(false)
  })

  it('validates the future admin usage summary shape', () => {
    const item = {
      subjectType: 'global',
      userId: null,
      organizationId: null,
      email: null,
      name: 'All users',
      range: 'today',
      generatedAt: '2026-08-07T00:00:00.000Z',
      metrics: {
        apiConcurrency: 2,
        jobConcurrency: 1,
        providerConcurrency: 1,
        rpm: 30,
        tpm: 12_000,
        requestCount: 300,
        jobCount: 20,
        inputTokens: 40_000,
        outputTokens: 12_000,
        totalTokens: 52_000,
        creditsUsed: 180,
        errorCount: 3,
        errorRate: 0.01,
        jobFailedCount: 1,
        jobFailureRate: 0.05,
      },
    }

    expect(
      usageSummarySchema.safeParse({
        range: 'today',
        generatedAt: '2026-08-07T00:00:00.000Z',
        global: item,
        organizations: [],
        users: [],
      }).success,
    ).toBe(true)
  })
})
