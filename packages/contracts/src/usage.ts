import { z } from 'zod'

export const USAGE_METRIC_NAMES = [
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
] as const

export const usageMetricNameSchema = z.enum(USAGE_METRIC_NAMES)
export type UsageMetricName = z.infer<typeof usageMetricNameSchema>

export const USAGE_METRIC_DEFINITIONS: Readonly<
  Record<
    UsageMetricName,
    {
      unit: 'count' | 'requests' | 'tokens' | 'credits' | 'ratio' | 'provider_units'
      window: 'realtime' | 'rolling_60s' | 'range'
      aggregation: 'gauge' | 'count' | 'sum' | 'ratio'
      description: string
    }
  >
> = {
  apiConcurrency: {
    unit: 'requests',
    window: 'realtime',
    aggregation: 'gauge',
    description: 'Current in-flight API requests for the subject.',
  },
  jobConcurrency: {
    unit: 'count',
    window: 'realtime',
    aggregation: 'gauge',
    description: 'Current running generation tasks for the subject.',
  },
  providerConcurrency: {
    unit: 'count',
    window: 'realtime',
    aggregation: 'gauge',
    description: 'Current external AI provider calls for the subject.',
  },
  rpm: {
    unit: 'requests',
    window: 'rolling_60s',
    aggregation: 'count',
    description: 'API requests completed or observed during the last 60 seconds.',
  },
  tpm: {
    unit: 'tokens',
    window: 'rolling_60s',
    aggregation: 'sum',
    description: 'Model tokens reported during the last 60 seconds; mainly applies to LLM calls.',
  },
  requestCount: {
    unit: 'requests',
    window: 'range',
    aggregation: 'count',
    description: 'Total API requests in the selected range.',
  },
  jobCount: {
    unit: 'count',
    window: 'range',
    aggregation: 'count',
    description: 'Terminal worker generation tasks and AI jobs in the selected range.',
  },
  inputTokens: {
    unit: 'tokens',
    window: 'range',
    aggregation: 'sum',
    description: 'Input or prompt tokens reported in the selected range.',
  },
  outputTokens: {
    unit: 'tokens',
    window: 'range',
    aggregation: 'sum',
    description: 'Output or completion tokens reported in the selected range.',
  },
  totalTokens: {
    unit: 'tokens',
    window: 'range',
    aggregation: 'sum',
    description: 'Total model tokens reported in the selected range.',
  },
  creditsUsed: {
    unit: 'credits',
    window: 'range',
    aggregation: 'sum',
    description: 'Actual credits deducted in the selected range.',
  },
  errorCount: {
    unit: 'count',
    window: 'range',
    aggregation: 'count',
    description: 'Failed requests in the selected range.',
  },
  errorRate: {
    unit: 'ratio',
    window: 'range',
    aggregation: 'ratio',
    description: 'errorCount divided by requestCount in the selected range; 0 when requestCount is 0.',
  },
  jobFailedCount: {
    unit: 'count',
    window: 'range',
    aggregation: 'count',
    description: 'Failed terminal worker generation tasks and AI jobs in the selected range.',
  },
  jobFailureRate: {
    unit: 'ratio',
    window: 'range',
    aggregation: 'ratio',
    description: 'jobFailedCount divided by jobCount in the selected range; 0 when jobCount is 0.',
  },
  providerUnits: {
    unit: 'provider_units',
    window: 'range',
    aggregation: 'sum',
    description: 'Provider-native usage units for non-token image or video providers when available.',
  },
}

export const usageRangeSchema = z.enum(['today', 'week', 'month'])
export const usageSubjectTypeSchema = z.enum(['global', 'organization', 'user'])

const nonnegativeInteger = z.number().int().nonnegative()
const nonnegativeNumber = z.number().nonnegative().finite()

export const usageRealtimeMetricsSchema = z.object({
  apiConcurrency: nonnegativeInteger,
  jobConcurrency: nonnegativeInteger,
  providerConcurrency: nonnegativeInteger,
  rpm: nonnegativeInteger,
  tpm: nonnegativeInteger,
})

export const usageRangeMetricsSchema = z.object({
  requestCount: nonnegativeInteger,
  jobCount: nonnegativeInteger,
  inputTokens: nonnegativeInteger,
  outputTokens: nonnegativeInteger,
  totalTokens: nonnegativeInteger,
  creditsUsed: nonnegativeInteger,
  errorCount: nonnegativeInteger,
  errorRate: z.number().min(0).max(1),
  jobFailedCount: nonnegativeInteger,
  jobFailureRate: z.number().min(0).max(1),
  providerUnits: nonnegativeNumber.default(0),
})

export const usageMetricsSchema = usageRealtimeMetricsSchema.merge(usageRangeMetricsSchema)

export const usageSummaryItemSchema = z.object({
  subjectType: usageSubjectTypeSchema,
  userId: z.string().min(1).nullable(),
  organizationId: z.string().min(1).nullable(),
  email: z.string().email().nullable(),
  name: z.string().min(1).nullable(),
  range: usageRangeSchema,
  generatedAt: z.string().datetime(),
  metrics: usageMetricsSchema,
})

export const usageSummarySchema = z.object({
  range: usageRangeSchema,
  generatedAt: z.string().datetime(),
  global: usageSummaryItemSchema,
  organizations: z.array(usageSummaryItemSchema),
  users: z.array(usageSummaryItemSchema),
})

export type UsageRange = z.infer<typeof usageRangeSchema>
export type UsageSubjectType = z.infer<typeof usageSubjectTypeSchema>
export type UsageRealtimeMetrics = z.infer<typeof usageRealtimeMetricsSchema>
export type UsageRangeMetrics = z.infer<typeof usageRangeMetricsSchema>
export type UsageMetrics = z.infer<typeof usageMetricsSchema>
export type UsageSummaryItem = z.infer<typeof usageSummaryItemSchema>
export type UsageSummary = z.infer<typeof usageSummarySchema>
