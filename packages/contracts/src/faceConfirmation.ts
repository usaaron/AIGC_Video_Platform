import { z } from 'zod'
import { assetSchema, mediaReferenceSchema } from './project.js'
import { generationTaskSchema } from './generation.js'

export const faceConfirmationRequestSchema = z
  .object({
    faceReference: mediaReferenceSchema,
  })
  .strict()

export const faceConfirmationResponseSchema = z.object({
  asset: assetSchema,
  registrationTask: generationTaskSchema.nullable(),
  registrationError: z.string().nullable(),
})

export type FaceConfirmationRequest = z.infer<typeof faceConfirmationRequestSchema>
export type FaceConfirmationResponse = z.infer<typeof faceConfirmationResponseSchema>
