import { z } from 'zod'

export const generationKindSchema = z.enum(['text', 'image', 'video', 'audio'])
export const generationTaskStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled'])

export const generationOutputSchema = z.object({
  id: z.string().min(1),
  url: z.string().max(2_000),
  mediaType: z.enum(['image', 'video', 'audio']),
  view: z.enum(['single', 'front', 'side', 'back', 'detail']).default('single'),
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
  estimatedCredits: z.number().int().positive().max(100_000),
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
  metadata: z.record(z.string(), z.unknown()),
  status: generationTaskStatusSchema,
  progress: z.number().int().min(0).max(100),
  estimatedCredits: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resultUrl: z.string().max(2_000).nullable(),
  outputs: z.array(generationOutputSchema),
  error: z.string().max(1_000).nullable(),
})

export type CreateGenerationTask = z.infer<typeof createGenerationTaskSchema>
export type GenerationTask = z.infer<typeof generationTaskSchema>
