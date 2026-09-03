import { z } from 'zod'

export const generationKindSchema = z.enum(['text', 'image', 'video', 'audio'])
export const seedanceTierSchema = z.enum(['mini', 'fast', 'pro'])
export const generationTaskStatusSchema = z.enum([
  'queued',
  'paused',
  'running',
  'completed',
  'failed',
  'cancelled',
])

export const generationOutputSchema = z.object({
  id: z.string().min(1),
  url: z.string().max(2_000),
  mediaType: z.enum(['image', 'video', 'audio']),
  view: z.enum(['single', 'front', 'side', 'back', 'detail', 'last-frame']).default('single'),
})

export const createGenerationTaskSchema = z.object({
  clientRequestId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  kind: generationKindSchema,
  label: z.string().min(1).max(200),
  prompt: z.string().max(20_000).optional(),
  negativePrompt: z.string().max(5_000).optional(),
  provider: z.string().min(1).max(64).default('local'),
  model: z.string().min(1).max(128).optional(),
  tier: seedanceTierSchema.optional(),
  estimatedCredits: z.number().int().positive().max(100_000),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const generationTaskSchema = z.object({
  id: z.string().min(1),
  clientRequestId: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  kind: generationKindSchema,
  label: z.string().min(1),
  prompt: z.string().max(20_000),
  negativePrompt: z.string().max(5_000),
  provider: z.string().min(1).max(64),
  model: z.string().max(128).nullable(),
  tier: seedanceTierSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  status: generationTaskStatusSchema,
  progress: z.number().int().min(0).max(100),
  estimatedCredits: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  attempts: z.number().int().min(0).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  leaseOwnerId: z.string().min(1).max(128).nullable().optional(),
  leaseToken: z.string().min(1).max(128).nullable().optional(),
  leaseAcquiredAt: z.string().datetime().nullable().optional(),
  leaseHeartbeatAt: z.string().datetime().nullable().optional(),
  leaseExpiresAt: z.string().datetime().nullable().optional(),
  resultUrl: z.string().max(2_000).nullable(),
  outputs: z.array(generationOutputSchema),
  error: z.string().max(1_000).nullable(),
})

// Polling only needs the fields that can change the queue UI. Prompts, lease
// internals and generated outputs stay on the full task contract.
export const generationTaskPollingSchema = z.object({
  id: z.string().min(1),
  clientRequestId: z.string().min(1),
  projectId: z.string().min(1),
  kind: generationKindSchema,
  label: z.string().min(1),
  provider: z.string().min(1).max(64),
  model: z.string().max(128).nullable(),
  status: generationTaskStatusSchema,
  progress: z.number().int().min(0).max(100),
  estimatedCredits: z.number().nonnegative(),
  metadata: z.record(z.string(), z.unknown()),
  resultUrl: z.string().max(2_000).nullable(),
  error: z.string().max(1_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type CreateGenerationTask = z.infer<typeof createGenerationTaskSchema>
export type GenerationTask = z.infer<typeof generationTaskSchema>
export type GenerationTaskPolling = z.infer<typeof generationTaskPollingSchema>
export type SeedanceTier = z.infer<typeof seedanceTierSchema>
