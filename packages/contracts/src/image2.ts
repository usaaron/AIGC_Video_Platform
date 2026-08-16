import { z } from 'zod'
import { generationTaskSchema } from './generation.js'

export const IMAGE2_CREDITS_PER_IMAGE = 6
export const IMAGE2_MAX_IMAGES = 20
export const IMAGE2_MAX_REFERENCE_IMAGES = 4
export const IMAGE2_MAX_INPUT_IMAGES = IMAGE2_MAX_REFERENCE_IMAGES + 1
export const IMAGE2_MAX_REFERENCES = IMAGE2_MAX_INPUT_IMAGES
export const IMAGE2_REFERENCE_NUMBER_MAX = 999
export const IMAGE2_PROVIDER_DISPLAY_NAME = '序幕 image2'
export const IMAGE2_MODEL_ID = 'seqora-image2'
export const IMAGE2_REFERENCE_ROLES = [
  'subject',
  'clothing',
  'accessory',
  'style',
  'composition',
  'color',
] as const
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
export const image2ReferenceRoleSchema = z.enum(IMAGE2_REFERENCE_ROLES)

export const image2ReferenceInputSchema = z
  .object({
    mediaId: z.string().uuid(),
    role: image2ReferenceRoleSchema.default('style'),
    referenceNumber: z.number().int().min(1).max(IMAGE2_REFERENCE_NUMBER_MAX).optional(),
  })
  .strict()

function normalizeReferences(
  references: Array<z.infer<typeof image2ReferenceInputSchema>>,
): Array<z.infer<typeof image2ReferenceInputSchema> & { referenceNumber: number }> {
  return references.map((reference, index) => ({
    ...reference,
    referenceNumber: reference.referenceNumber ?? index + 1,
  }))
}

export const image2AssistSchema = z
  .object({
    promptOptimization: z.boolean().default(false),
    referenceVision: z.boolean().default(false),
  })
  .strict()

export const createImage2BatchSchema = z
  .object({
    clientRequestId: z.string().min(1).max(80).optional(),
    sourceTaskId: z.string().min(1).max(128).optional(),
    projectId: z.string().min(1).max(128),
    prompt: z.string().trim().min(1).max(20_000),
    negativePrompt: z.string().trim().max(5_000).optional(),
    aspectRatio: image2AspectRatioSchema.default('auto'),
    quality: image2QualitySchema.default('low'),
    imageCount: z.number().int().min(1).max(IMAGE2_MAX_IMAGES).default(1),
    references: z.array(image2ReferenceInputSchema).max(IMAGE2_MAX_INPUT_IMAGES).default([]),
    referenceMediaIds: z.array(z.string().uuid()).max(IMAGE2_MAX_INPUT_IMAGES).optional(),
    assist: image2AssistSchema.default({ promptOptimization: false, referenceVision: false }),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.references.length && input.referenceMediaIds?.length) {
      context.addIssue({
        code: 'custom',
        path: ['references'],
        message: 'Use either references or referenceMediaIds, not both',
      })
    }

    const references = input.references.length
      ? normalizeReferences(input.references)
      : normalizeReferences(
          (input.referenceMediaIds ?? []).map((mediaId, index) => ({
            mediaId,
            role: index === 0 ? 'subject' : 'style',
          })),
        )
    const mediaIds = new Set<string>()
    const referenceNumbers = new Set<number>()
    let subjectCount = 0
    let referenceCount = 0

    for (const reference of references) {
      if (mediaIds.has(reference.mediaId)) {
        context.addIssue({
          code: 'custom',
          path: ['references'],
          message: 'Reference media ids must be unique',
        })
      }
      mediaIds.add(reference.mediaId)

      if (referenceNumbers.has(reference.referenceNumber)) {
        context.addIssue({
          code: 'custom',
          path: ['references'],
          message: 'Reference image numbers must be unique',
        })
      }
      referenceNumbers.add(reference.referenceNumber)

      if (reference.role === 'subject') subjectCount += 1
      else referenceCount += 1
    }

    if (subjectCount > 1) {
      context.addIssue({
        code: 'custom',
        path: ['references'],
        message: 'Only one subject image is allowed',
      })
    }

    if (referenceCount > IMAGE2_MAX_REFERENCE_IMAGES) {
      context.addIssue({
        code: 'custom',
        path: ['references'],
        message: 'At most four non-subject reference images are allowed',
      })
    }
  })
  .transform(({ referenceMediaIds, ...input }) => ({
    ...input,
    references: input.references.length
      ? normalizeReferences(input.references)
      : normalizeReferences(
          (referenceMediaIds ?? []).map((mediaId, index) => ({
            mediaId,
            role: index === 0 ? 'subject' : 'style',
          })),
        ),
  }))

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
export type Image2ReferenceRole = z.infer<typeof image2ReferenceRoleSchema>
export type Image2ReferenceInput = z.infer<typeof image2ReferenceInputSchema>
export type Image2Assist = z.infer<typeof image2AssistSchema>
export type Image2Batch = z.infer<typeof image2BatchSchema>
