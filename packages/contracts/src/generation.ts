import { z } from 'zod'

export const generationKindSchema = z.enum(['text', 'image', 'video', 'audio'])
export const generationTaskStatusSchema = z.enum([
  'queued',
  'paused',
  'running',
  'completed',
  'failed',
  'cancelled',
])
export const generationTaskLogLevelSchema = z.enum(['info', 'warn', 'error'])
export const videoGenerationModeSchema = z.enum([
  'text-to-video',
  'video-to-video',
  'first-last-frame',
  'extend',
  'inpaint',
  'replace-background',
  'relight',
  'upscale',
  'lip-sync',
])

export const videoGenerationMetadataSchema = z
  .object({
    videoMode: videoGenerationModeSchema.default('text-to-video'),
    sourceVideoUrl: z.string().max(2_000).optional(),
    sourceImageUrls: z.array(z.string().max(2_000)).default([]),
    firstFrameUrl: z.string().max(2_000).optional(),
    lastFrameUrl: z.string().max(2_000).optional(),
    maskUrl: z.string().max(2_000).optional(),
    backgroundReferenceUrl: z.string().max(2_000).optional(),
    lightingPreset: z.string().max(80).optional(),
    upscaleFactor: z.number().int().min(2).max(4).optional(),
    lipSyncAudioUrl: z.string().max(2_000).optional(),
    extendSeconds: z.number().int().min(1).max(60).optional(),
    templateId: z.string().max(80).optional(),
    agentPlanId: z.string().max(128).optional(),
  })
  .passthrough()

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

export const generationTaskLogSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  level: generationTaskLogLevelSchema,
  event: z.string().min(1).max(128),
  message: z.string().min(1).max(1_000),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
})

export type CreateGenerationTask = z.infer<typeof createGenerationTaskSchema>
export type GenerationTask = z.infer<typeof generationTaskSchema>
export type GenerationTaskLog = z.infer<typeof generationTaskLogSchema>
export type VideoGenerationMode = z.infer<typeof videoGenerationModeSchema>
export type VideoGenerationMetadata = z.infer<typeof videoGenerationMetadataSchema>
