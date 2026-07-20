import { z } from 'zod'
import { generationOutputSchema } from './generation.js'

export const projectStatusSchema = z.enum(['draft', 'producing', 'completed', 'archived'])
export const assetKindSchema = z.enum(['character', 'scene', 'prop', 'costume', 'audio'])
export const assetSourceSchema = z.enum(['import', 'generate'])
export const promptModeSchema = z.enum(['standard', 'advanced'])
export const customPromptModeSchema = z.enum(['append', 'replace'])
export const visualStyleSchema = z.enum([
  'photorealistic',
  'cinematic-cg',
  'chinese-3d',
  'chinese-2d',
  'anime',
  'storybook',
])

export const mediaReferenceSchema = z.object({
  id: z.string().min(1).max(128),
  url: z.string().min(1).max(2_000),
  name: z.string().min(1).max(255),
})

export const characterAttributesSchema = z.object({
  type: z.literal('character'),
  subjectType: z.enum(['human', 'animal']),
  gender: z.enum(['male', 'female', 'unspecified']),
  ageGroup: z.enum(['child', 'teen', 'young', 'middle', 'senior']),
  exactAge: z.number().int().min(1).max(120).nullable(),
  species: z.string().max(80),
  anthropomorphic: z.boolean(),
  visualStyle: visualStyleSchema,
  framing: z.enum(['portrait', 'half', 'full']),
  bodyType: z.enum(['slim', 'balanced', 'athletic', 'full']),
  background: z.enum(['solid', 'transparent', 'environment']),
  faceStatus: z.enum(['pending', 'approved']),
  bodyStatus: z.enum(['pending', 'approved']),
  faceReference: mediaReferenceSchema.nullable(),
  bodyReference: mediaReferenceSchema.nullable(),
  legStretch: z.boolean(),
  faceBrightening: z.boolean().default(false),
  turnaround: z.boolean(),
  turnaroundReferences: z.array(generationOutputSchema).max(3).default([]),
  turnaroundLayout: z.enum(['sheet', 'separate']),
})

export const sceneAttributesSchema = z.object({
  type: z.literal('scene'),
  space: z.enum(['interior', 'exterior']),
  sceneType: z.enum([
    'city',
    'street',
    'residential',
    'commercial',
    'nature',
    'ancient',
    'industrial',
    'fantasy',
  ]),
  era: z.enum(['ancient', 'recent', 'modern', 'future']),
  time: z.enum(['dawn', 'day', 'sunset', 'night']),
  weather: z.enum(['clear', 'cloudy', 'rain', 'snow', 'fog']),
  mood: z.enum(['warm', 'tense', 'mystery', 'romantic', 'epic', 'desolate']),
  camera: z.enum(['eye-level', 'overhead', 'low-angle', 'aerial', 'wide']),
  visualStyle: visualStyleSchema,
  emptyScene: z.boolean(),
  activitySpace: z.boolean(),
})

export const propAttributesSchema = z.object({
  type: z.literal('prop'),
  usage: z.enum(['key', 'recurring']).default('key'),
  category: z.enum(['weapon', 'vehicle', 'furniture', 'electronics', 'jewelry', 'food', 'daily', 'other']),
  material: z.enum(['wood', 'metal', 'glass', 'fabric', 'leather', 'ceramic', 'mixed']),
  condition: z.enum(['new', 'used', 'aged', 'damaged']),
  view: z.enum(['front', 'side', 'turnaround']),
  background: z.enum(['solid', 'transparent', 'environment']),
  visualStyle: visualStyleSchema,
})

export const costumeAttributesSchema = z.object({
  type: z.literal('costume'),
  audience: z.enum(['male', 'female', 'unisex']),
  category: z.enum([
    'daily',
    'formal',
    'professional',
    'uniform',
    'ancient',
    'ceremonial',
    'fantasy',
    'armor',
  ]),
  season: z.enum(['spring-summer', 'autumn-winter', 'all-season']),
  design: z.enum(['minimal', 'luxury', 'retro', 'future', 'chinese']),
  presentation: z.enum(['flat', 'model', 'worn']),
  visualStyle: visualStyleSchema,
  turnaround: z.boolean(),
})

export const audioAttributesSchema = z.object({
  type: z.literal('audio'),
  audioType: z.enum(['voice', 'ambience', 'sfx', 'music']),
  gender: z.enum(['male', 'female', 'unspecified']),
  ageGroup: z.enum(['child', 'teen', 'young', 'middle', 'senior']),
  emotion: z.enum(['neutral', 'happy', 'sad', 'angry', 'tense', 'warm']),
  tone: z.enum(['bright', 'warm', 'deep', 'cold']),
  speed: z.enum(['slow', 'normal', 'fast']),
  language: z.enum(['mandarin', 'dialect', 'english', 'none']),
  duration: z.number().int().min(1).max(300),
  loop: z.boolean(),
})

export const assetAttributesSchema = z.discriminatedUnion('type', [
  characterAttributesSchema,
  sceneAttributesSchema,
  propAttributesSchema,
  costumeAttributesSchema,
  audioAttributesSchema,
])

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
  sourceMode: assetSourceSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  prompt: z.string().max(5_000),
  promptMode: promptModeSchema,
  customPromptMode: customPromptModeSchema,
  customPrompt: z.string().max(5_000),
  negativePrompt: z.string().max(2_000),
  references: z.array(mediaReferenceSchema).max(3),
  attributes: assetAttributesSchema,
  imageUrl: z.string().max(2_000).nullable(),
  status: z.enum(['draft', 'confirmed']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

const assetInputSchema = z.object({
  kind: assetKindSchema,
  sourceMode: assetSourceSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  prompt: z.string().max(5_000).default(''),
  promptMode: promptModeSchema.default('standard'),
  customPromptMode: customPromptModeSchema.default('append'),
  customPrompt: z.string().max(5_000).default(''),
  negativePrompt: z.string().max(2_000).default(''),
  references: z.array(mediaReferenceSchema).max(3).default([]),
  attributes: assetAttributesSchema,
  imageUrl: z.string().max(2_000).nullable().default(null),
})

export const createAssetSchema = assetInputSchema.superRefine((input, context) => {
  if (input.kind !== input.attributes.type) {
    context.addIssue({
      code: 'custom',
      path: ['attributes', 'type'],
      message: 'Asset kind must match attributes',
    })
  }
  if (input.sourceMode === 'import' && input.references.length === 0 && !input.imageUrl) {
    context.addIssue({
      code: 'custom',
      path: ['references'],
      message: 'Imported assets require a reference',
    })
  }
})

export const updateAssetSchema = assetInputSchema
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
