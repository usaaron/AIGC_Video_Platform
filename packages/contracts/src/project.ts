import { z } from 'zod'

export const projectStatusSchema = z.enum(['draft', 'producing', 'completed', 'archived'])
export const assetKindSchema = z.enum(['character', 'scene', 'sound', 'prop'])

export const projectSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().min(1).max(120),
  contentType: z.enum(['short-drama', 'advertisement', 'animation']),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']),
  status: projectStatusSchema,
  synopsis: z.string().max(1_000),
  script: z.string().max(100_000),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contentType: z.enum(['short-drama', 'advertisement', 'animation']).default('short-drama'),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
})

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    status: projectStatusSchema.optional(),
    synopsis: z.string().max(1_000).optional(),
    script: z.string().max(100_000).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')

export const assetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  kind: assetKindSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  prompt: z.string().max(5_000),
  imageUrl: z.string().max(2_000).nullable(),
  status: z.enum(['draft', 'confirmed']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const createAssetSchema = z.object({
  kind: assetKindSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  prompt: z.string().max(5_000).default(''),
  imageUrl: z.string().max(2_000).nullable().default(null),
})

export const updateAssetSchema = createAssetSchema
  .omit({ kind: true })
  .partial()
  .extend({ status: z.enum(['draft', 'confirmed']).optional() })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')

export const shotSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  order: z.number().int().positive(),
  title: z.string().min(1).max(120),
  framing: z.string().min(1).max(80),
  duration: z.number().int().min(1).max(120),
  prompt: z.string().max(5_000),
  imageUrl: z.string().max(2_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const createShotSchema = z.object({
  title: z.string().trim().min(1).max(120),
  framing: z.string().trim().min(1).max(80).default('中景'),
  duration: z.number().int().min(1).max(120).default(4),
  prompt: z.string().max(5_000).default(''),
  imageUrl: z.string().max(2_000).nullable().default(null),
})

export const updateShotSchema = createShotSchema
  .partial()
  .extend({ order: z.number().int().positive().optional() })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')

export const projectWorkspaceSchema = z.object({
  project: projectSchema,
  assets: z.array(assetSchema),
  shots: z.array(shotSchema),
})

export type Project = z.infer<typeof projectSchema>
export type CreateProject = z.infer<typeof createProjectSchema>
export type UpdateProject = z.infer<typeof updateProjectSchema>
export type Asset = z.infer<typeof assetSchema>
export type CreateAsset = z.infer<typeof createAssetSchema>
export type UpdateAsset = z.infer<typeof updateAssetSchema>
export type Shot = z.infer<typeof shotSchema>
export type CreateShot = z.infer<typeof createShotSchema>
export type UpdateShot = z.infer<typeof updateShotSchema>
export type ProjectWorkspace = z.infer<typeof projectWorkspaceSchema>
