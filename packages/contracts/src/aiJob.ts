import { z } from 'zod'

export const aiJobStatusSchema = z.enum(['queued', 'paused', 'running', 'completed', 'failed', 'cancelled'])

export const createAiJobSchema = z.object({
  clientRequestId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  kind: z.string().min(1).max(128),
  label: z.string().min(1).max(200),
  provider: z.string().min(1).max(64).default('text'),
  input: z.record(z.string(), z.unknown()).default({}),
  costCredits: z.number().int().nonnegative().max(100_000),
  maxAttempts: z.number().int().min(1).max(10).optional(),
})

export const aiJobSchema = z.object({
  id: z.string().min(1),
  clientRequestId: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  kind: z.string().min(1).max(128),
  label: z.string().min(1).max(200),
  provider: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  status: aiJobStatusSchema,
  costCredits: z.number().int().nonnegative(),
  attempts: z.number().int().min(0).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  leaseOwnerId: z.string().min(1).max(128).nullable().optional(),
  leaseToken: z.string().min(1).max(128).nullable().optional(),
  leaseAcquiredAt: z.string().datetime().nullable().optional(),
  leaseHeartbeatAt: z.string().datetime().nullable().optional(),
  leaseExpiresAt: z.string().datetime().nullable().optional(),
  error: z.string().max(1_000).nullable(),
  refundedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type AiJobStatus = z.infer<typeof aiJobStatusSchema>
export type CreateAiJob = z.infer<typeof createAiJobSchema>
export type AiJob = z.infer<typeof aiJobSchema>
