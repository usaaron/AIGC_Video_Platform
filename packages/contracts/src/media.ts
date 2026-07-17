import { z } from 'zod'

export const mediaKindSchema = z.enum(['image', 'audio'])

export const mediaObjectSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: mediaKindSchema,
  name: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive(),
  url: z.string().min(1).max(2_000),
  createdAt: z.string().datetime(),
})

export type MediaKind = z.infer<typeof mediaKindSchema>
export type MediaObject = z.infer<typeof mediaObjectSchema>
