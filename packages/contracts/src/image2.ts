import { z } from 'zod'
import { generationTaskSchema } from './generation.js'

export const IMAGE2_CREDITS_PER_IMAGE = 6
export const IMAGE2_MAX_IMAGES = 20
export const IMAGE2_MAX_REFERENCES = 3
export const IMAGE2_PROVIDER_DISPLAY_NAME = '序幕 image2'
export const IMAGE2_MODEL_ID = 'seqora-image2'
export const IMAGE2_IMAGE_SIZE_OPTIONS = [
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '1365x1024',
  '1024x1365',
  '1536x864',
  '864x1536',
  '1280x1024',
  '1024x1280',
  '2048x2048',
  '2560x1440',
  '1440x2560',
  '3840x2160',
  '2160x3840',
] as const
export const IMAGE2_ASPECT_RATIO_ALIASES = [
  '1:1',
  '9:16',
  '16:9',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
] as const
export const IMAGE2_ASPECT_RATIOS = [...IMAGE2_IMAGE_SIZE_OPTIONS, ...IMAGE2_ASPECT_RATIO_ALIASES] as const

export const image2AspectRatioSchema = z.enum(IMAGE2_ASPECT_RATIOS)
export const image2QualitySchema = z.enum(['low', 'medium', 'high'])

export const createImage2BatchSchema = z
  .object({
    clientRequestId: z.string().min(1).max(80).optional(),
    projectId: z.string().min(1).max(128),
    prompt: z.string().trim().min(1).max(20_000),
    negativePrompt: z.string().trim().max(5_000).optional(),
    aspectRatio: image2AspectRatioSchema.default('auto'),
    quality: image2QualitySchema.default('low'),
    imageCount: z.number().int().min(1).max(IMAGE2_MAX_IMAGES).default(1),
    referenceMediaIds: z.array(z.string().uuid()).max(IMAGE2_MAX_REFERENCES).default([]),
  })
  .strict()

export const image2BatchSchema = z.object({
  batchId: z.string().min(1).max(128),
  providerName: z.literal(IMAGE2_PROVIDER_DISPLAY_NAME),
  model: z.literal(IMAGE2_MODEL_ID),
  creditsPerImage: z.literal(IMAGE2_CREDITS_PER_IMAGE),
  estimatedCredits: z.number().int().positive(),
  tasks: z.array(generationTaskSchema).min(1).max(IMAGE2_MAX_IMAGES),
})

export type CreateImage2Batch = z.infer<typeof createImage2BatchSchema>
export type Image2AspectRatio = z.infer<typeof image2AspectRatioSchema>
export type Image2Quality = z.infer<typeof image2QualitySchema>
export type Image2Batch = z.infer<typeof image2BatchSchema>
