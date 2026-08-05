import { z } from 'zod'

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

export const projectGenerationTaskSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(200),
  kind: z.enum(['text', 'image', 'video', 'audio']),
  status: z.enum(['queued', 'paused', 'running', 'failed']),
  progress: z.number().int().min(0).max(100),
  updatedAt: z.string().datetime(),
})

export const projectGenerationSummarySchema = z.object({
  queued: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  latest: z.array(projectGenerationTaskSummarySchema).max(3),
})

export const DEFAULT_SCRIPT_DIRECTION = {
  style: 'auto',
  composition: 'auto',
  lighting: 'auto',
  camera: 'auto',
  focus: 'balanced',
} as const

export const scriptProductionModeSchema = z.enum(['short-video', 'web-series'])
export const FORCE_EPISODE_BREAK_MARKER = '【强制下一集】'
export const FORCE_SHOT_BREAK_MARKER = '【强制分镜】'

// Keep the original logical values for stored tasks, while allowing models that
// are actually available from the configured OpenAI-compatible relay.
export const scriptModelSchema = z.enum([
  'seqora-5.6',
  'seqora-op-5',
  'kimi-3',
  'deepseek-v3',
  'qwen3.8',
  'gpt-5.6-terra',
  'kimi-k3',
  'glm-5.2',
  'glm-5.2-fast',
  'kimi-k2.5',
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6',
])
export const textModelSchema = scriptModelSchema
export const DEFAULT_SCRIPT_MODEL = 'glm-5.2' as const

export const scriptCreativeDirectionSchema = z.object({
  style: z
    .enum(['auto', 'photorealistic', 'cinematic-cg', 'chinese-3d', 'chinese-2d', 'anime', 'storybook'])
    .default('auto'),
  composition: z
    .enum(['auto', 'rule-of-thirds', 'centered', 'symmetry', 'negative-space', 'dynamic'])
    .default('auto'),
  lighting: z.enum(['auto', 'natural-soft', 'high-contrast', 'low-key', 'backlight', 'neon']).default('auto'),
  camera: z.enum(['auto', 'restrained', 'immersive', 'dynamic', 'documentary', 'suspense']).default('auto'),
  focus: z.enum(['balanced', 'scene', 'character', 'dialogue']).default('balanced'),
})

export const scriptGenerationSegmentSchema = z.object({
  goal: z.string().trim().max(500).default(''),
  targetMinutes: z.number().int().min(1).max(15).default(5),
  targetSeconds: z.number().int().min(15).max(900).optional(),
})

export const generateScriptRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  draft: z.string().max(100_000).default(''),
  direction: scriptCreativeDirectionSchema.default(DEFAULT_SCRIPT_DIRECTION),
  mode: z.enum(['quick', 'segment']).default('quick'),
  segment: scriptGenerationSegmentSchema.default({ goal: '', targetMinutes: 5 }),
  productionMode: scriptProductionModeSchema.default('short-video'),
  episodeMinutes: z.number().int().min(1).max(5).default(1),
  episodeDurationSeconds: z.number().int().min(30).max(300).default(60),
  model: scriptModelSchema.default(DEFAULT_SCRIPT_MODEL),
  revisionNote: z.string().trim().max(2_000).default(''),
})

export const enrichScriptRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  script: z.string().max(100_000).default(''),
  direction: scriptCreativeDirectionSchema.default(DEFAULT_SCRIPT_DIRECTION),
  productionMode: scriptProductionModeSchema.default('short-video'),
  episodeMinutes: z.number().int().min(1).max(5).default(1),
  episodeDurationSeconds: z.number().int().min(30).max(300).default(60),
  model: scriptModelSchema.default(DEFAULT_SCRIPT_MODEL),
  revisionNote: z.string().trim().max(2_000).default(''),
})

export const reviewScriptRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  script: z.string().max(100_000).default(''),
  direction: scriptCreativeDirectionSchema.default(DEFAULT_SCRIPT_DIRECTION),
  model: scriptModelSchema.default(DEFAULT_SCRIPT_MODEL),
})

export const scriptReviewDimensionKeySchema = z.enum([
  'plot',
  'character',
  'dialogue',
  'style',
  'composition',
  'lighting',
  'camera',
])

export const scriptReviewDimensionSchema = z.object({
  key: scriptReviewDimensionKeySchema,
  score: z.number().int().min(0).max(100),
  finding: z.string().min(1).max(600),
  suggestion: z.string().min(1).max(800),
})

export const scriptReviewContentSchema = z.object({
  score: z.number().int().min(0).max(100),
  verdict: z.string().min(1).max(1_000),
  dimensions: z.array(scriptReviewDimensionSchema).min(5).max(7),
  priorityActions: z.array(z.string().min(1).max(500)).min(1).max(5),
})

export const scriptReviewResultSchema = scriptReviewContentSchema.extend({
  generatedAt: z.string().datetime(),
})

export const generateShotsRequestSchema = z.object({
  maxShots: z.number().int().min(3).max(120).default(8),
  mode: z.enum(['scene', 'beat']).default('scene'),
  episodeDurationSeconds: z.number().int().min(30).max(300).default(60),
})

export const autoSplitShotsRequestSchema = z.object({
  episodeDurationSeconds: z.number().int().min(30).max(300).default(60),
})

export const mediaReferenceSchema = z.object({
  id: z.string().min(1).max(128),
  url: z.string().min(1).max(2_000),
  name: z.string().min(1).max(255),
})

export const characterAppearanceVariantSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(80),
  bodyReference: mediaReferenceSchema.nullable().default(null),
  turnaroundReferences: z.array(mediaReferenceSchema).max(3).default([]),
  turnaroundLayout: z.enum(['sheet', 'separate']).default('sheet'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const trustedPortraitSchema = z.object({
  assetId: z.string().min(1).max(128),
  groupId: z.string().min(1).max(128),
  groupType: z.enum(['AIGC', 'LivenessFace']),
  status: z.enum(['processing', 'active', 'failed']),
  name: z.string().max(255),
  previewUrl: z.string().max(2_000).nullable(),
  errorCode: z.string().max(255).nullable(),
  errorMessage: z.string().max(1_000).nullable(),
  checkedAt: z.string().datetime(),
})

export const characterAttributesSchema = z.object({
  type: z.literal('character'),
  subjectType: z.enum(['human', 'animal']),
  gender: z.enum(['male', 'female', 'unspecified']),
  ageGroup: z.enum(['child', 'teen', 'young', 'middle', 'senior']),
  exactAge: z.number().int().min(1).max(120).nullable(),
  ethnicity: z
    .enum([
      'unspecified',
      'east-asian',
      'south-asian',
      'southeast-asian',
      'white',
      'black',
      'latino',
      'middle-eastern',
      'mixed',
      'other',
    ])
    .default('unspecified'),
  skinTone: z.enum(['unspecified', 'fair', 'light', 'medium', 'tan', 'deep', 'dark']).default('unspecified'),
  eyeColor: z
    .enum(['unspecified', 'black', 'dark-brown', 'brown', 'hazel', 'green', 'blue', 'gray', 'amber'])
    .default('unspecified'),
  hairColor: z
    .enum(['unspecified', 'black', 'dark-brown', 'brown', 'blonde', 'red', 'gray', 'white', 'other'])
    .default('unspecified'),
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
  portraitSource: z.enum(['ai-virtual', 'authorized-real']).default('ai-virtual'),
  trustedPortrait: trustedPortraitSchema.nullable().default(null),
  legStretch: z.boolean(),
  turnaround: z.boolean(),
  turnaroundLayout: z.enum(['sheet', 'separate']),
  stagePrompts: z
    .object({
      face: z.string().max(5_000),
      body: z.string().max(5_000),
      turnaround: z.string().max(5_000),
    })
    .optional(),
  appearanceVariants: z.array(characterAppearanceVariantSchema).max(12).default([]),
  activeAppearanceVariantId: z.string().max(128).nullable().default(null),
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

const scriptAssetSuggestionBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  prompt: z.string().trim().min(1).max(5_000),
  negativePrompt: z.string().max(2_000).default(''),
  reason: z.string().trim().min(1).max(500),
  priority: z.number().int().min(1).max(5).default(3),
})

export const scriptAssetSuggestionSchema = z.discriminatedUnion('kind', [
  scriptAssetSuggestionBaseSchema.extend({
    kind: z.literal('character'),
    attributes: characterAttributesSchema,
  }),
  scriptAssetSuggestionBaseSchema.extend({
    kind: z.literal('scene'),
    attributes: sceneAttributesSchema,
  }),
  scriptAssetSuggestionBaseSchema.extend({
    kind: z.literal('prop'),
    attributes: propAttributesSchema,
  }),
  scriptAssetSuggestionBaseSchema.extend({
    kind: z.literal('costume'),
    attributes: costumeAttributesSchema,
  }),
])

export const generateScriptAssetSuggestionsRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  script: z.string().trim().min(1).max(100_000),
  direction: scriptCreativeDirectionSchema.default(DEFAULT_SCRIPT_DIRECTION),
  model: scriptModelSchema.default(DEFAULT_SCRIPT_MODEL),
})

export const scriptAssetSuggestionsContentSchema = z.object({
  summary: z.string().min(1).max(700),
  assets: z.array(scriptAssetSuggestionSchema).max(16),
})

export const scriptAssetSuggestionsResultSchema = scriptAssetSuggestionsContentSchema.extend({
  generatedAt: z.string().datetime(),
  warnings: z.array(z.string().min(1).max(500)).default([]),
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
  // Visual direction is a project rule. Asset-level values are retained only
  // for legacy compatibility and are normalized to this value by the API.
  visualStyle: visualStyleSchema.optional(),
  episodeDurationSeconds: z.number().int().min(30).max(300).optional(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']),
  status: projectStatusSchema,
  synopsis: z.string().max(1_000),
  script: z.string().max(100_000),
  version: z.number().int().positive(),
  previewUrl: z.string().max(2_000).nullable().optional(),
  generationSummary: projectGenerationSummarySchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contentType: z.enum(['short-drama', 'advertisement', 'animation']).default('short-drama'),
  visualStyle: visualStyleSchema.default('cinematic-cg'),
  episodeDurationSeconds: z.number().int().min(30).max(300).default(60),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
})

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    status: projectStatusSchema.optional(),
    visualStyle: visualStyleSchema.optional(),
    episodeDurationSeconds: z.number().int().min(30).max(300).optional(),
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

const assetInputFields = {
  sourceMode: assetSourceSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500),
  prompt: z.string().max(5_000),
  promptMode: promptModeSchema,
  customPromptMode: customPromptModeSchema,
  customPrompt: z.string().max(5_000),
  negativePrompt: z.string().max(2_000),
  references: z.array(mediaReferenceSchema).max(3),
  attributes: assetAttributesSchema,
  imageUrl: z.string().max(2_000).nullable(),
} as const

const assetInputSchema = z.object({
  kind: assetKindSchema,
  sourceMode: assetInputFields.sourceMode,
  name: assetInputFields.name,
  description: assetInputFields.description.default(''),
  prompt: assetInputFields.prompt.default(''),
  promptMode: assetInputFields.promptMode.default('standard'),
  customPromptMode: assetInputFields.customPromptMode.default('append'),
  customPrompt: assetInputFields.customPrompt.default(''),
  negativePrompt: assetInputFields.negativePrompt.default(''),
  references: assetInputFields.references.default([]),
  attributes: assetInputFields.attributes,
  imageUrl: assetInputFields.imageUrl.default(null),
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

export const updateAssetSchema = z
  .object({
    sourceMode: assetInputFields.sourceMode.optional(),
    name: assetInputFields.name.optional(),
    description: assetInputFields.description.optional(),
    prompt: assetInputFields.prompt.optional(),
    promptMode: assetInputFields.promptMode.optional(),
    customPromptMode: assetInputFields.customPromptMode.optional(),
    customPrompt: assetInputFields.customPrompt.optional(),
    negativePrompt: assetInputFields.negativePrompt.optional(),
    references: assetInputFields.references.optional(),
    attributes: assetInputFields.attributes.optional(),
    imageUrl: assetInputFields.imageUrl.optional(),
    status: z.enum(['draft', 'confirmed']).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')

export const shotSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  order: z.number().int().positive(),
  title: z.string().min(1).max(120),
  framing: z.string().min(1).max(80),
  duration: z.number().int().min(3).max(15),
  prompt: z.string().max(5_000),
  negativePrompt: z.string().max(2_000).default(''),
  imageUrl: z.string().max(2_000).nullable(),
  selectedImageTaskId: z.string().min(1).max(128).nullable().optional(),
  selectedVideoTaskId: z.string().min(1).max(128).nullable().optional(),
  continuityMode: z.enum(['independent', 'continue']).default('continue'),
  continuityNote: z.string().max(2_000).default(''),
  episodeBreakBefore: z.boolean().default(false),
  episodeNumber: z.number().int().positive().default(1),
  episodeTitle: z.string().max(120).default('主故事'),
  episodeKind: z.enum(['standard', 'hook']).default('standard'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

const shotInputFields = {
  title: z.string().trim().min(1).max(120),
  framing: z.string().trim().min(1).max(80),
  duration: z.number().int().min(3).max(15),
  prompt: z.string().max(5_000),
  negativePrompt: z.string().max(2_000),
  imageUrl: z.string().max(2_000).nullable(),
  selectedImageTaskId: z.string().min(1).max(128).nullable(),
  selectedVideoTaskId: z.string().min(1).max(128).nullable(),
  continuityMode: z.enum(['independent', 'continue']),
  continuityNote: z.string().max(2_000),
  episodeBreakBefore: z.boolean(),
  episodeNumber: z.number().int().positive(),
  episodeTitle: z.string().max(120),
  episodeKind: z.enum(['standard', 'hook']),
} as const

export const createShotSchema = z.object({
  title: shotInputFields.title,
  framing: shotInputFields.framing.default('中景'),
  duration: shotInputFields.duration.default(4),
  prompt: shotInputFields.prompt.default(''),
  negativePrompt: shotInputFields.negativePrompt.default(''),
  imageUrl: shotInputFields.imageUrl.default(null),
  selectedImageTaskId: shotInputFields.selectedImageTaskId.optional(),
  selectedVideoTaskId: shotInputFields.selectedVideoTaskId.optional(),
  continuityMode: shotInputFields.continuityMode.default('continue'),
  continuityNote: shotInputFields.continuityNote.default(''),
  episodeBreakBefore: shotInputFields.episodeBreakBefore.default(false),
  episodeNumber: shotInputFields.episodeNumber.default(1),
  episodeTitle: shotInputFields.episodeTitle.default('主故事'),
  episodeKind: shotInputFields.episodeKind.default('standard'),
})

export const updateShotSchema = z
  .object({
    title: shotInputFields.title.optional(),
    framing: shotInputFields.framing.optional(),
    duration: shotInputFields.duration.optional(),
    prompt: shotInputFields.prompt.optional(),
    negativePrompt: shotInputFields.negativePrompt.optional(),
    imageUrl: shotInputFields.imageUrl.optional(),
    selectedImageTaskId: shotInputFields.selectedImageTaskId.optional(),
    selectedVideoTaskId: shotInputFields.selectedVideoTaskId.optional(),
    continuityMode: shotInputFields.continuityMode.optional(),
    continuityNote: shotInputFields.continuityNote.optional(),
    episodeBreakBefore: shotInputFields.episodeBreakBefore.optional(),
    episodeNumber: shotInputFields.episodeNumber.optional(),
    episodeTitle: shotInputFields.episodeTitle.optional(),
    episodeKind: shotInputFields.episodeKind.optional(),
    order: z.number().int().positive().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')

export const projectWorkspaceSchema = z.object({
  project: projectSchema,
  assets: z.array(assetSchema),
  shots: z.array(shotSchema),
})

export type Project = z.infer<typeof projectSchema>
export type ProjectGenerationSummary = z.infer<typeof projectGenerationSummarySchema>
export type CreateProject = z.infer<typeof createProjectSchema>
export type UpdateProject = z.infer<typeof updateProjectSchema>
export type Asset = z.infer<typeof assetSchema>
export type CharacterAppearanceVariant = z.infer<typeof characterAppearanceVariantSchema>
export type TrustedPortrait = z.infer<typeof trustedPortraitSchema>
export type CreateAsset = z.infer<typeof createAssetSchema>
export type UpdateAsset = z.infer<typeof updateAssetSchema>
export type Shot = z.infer<typeof shotSchema>
export type CreateShot = z.infer<typeof createShotSchema>
export type UpdateShot = z.infer<typeof updateShotSchema>
export type ProjectWorkspace = z.infer<typeof projectWorkspaceSchema>
export type ScriptCreativeDirection = z.infer<typeof scriptCreativeDirectionSchema>
export type ScriptModel = z.infer<typeof scriptModelSchema>
export type TextModel = ScriptModel
export type ScriptProductionMode = z.infer<typeof scriptProductionModeSchema>
export type GenerateScriptAssetSuggestionsRequest = z.infer<
  typeof generateScriptAssetSuggestionsRequestSchema
>
export type ScriptAssetSuggestion = z.infer<typeof scriptAssetSuggestionSchema>
export type ScriptAssetSuggestionsResult = z.infer<typeof scriptAssetSuggestionsResultSchema>
export type GenerateScriptRequest = z.infer<typeof generateScriptRequestSchema>
export type EnrichScriptRequest = z.infer<typeof enrichScriptRequestSchema>
export type ReviewScriptRequest = z.infer<typeof reviewScriptRequestSchema>
export type ScriptReviewContent = z.infer<typeof scriptReviewContentSchema>
export type ScriptReviewResult = z.infer<typeof scriptReviewResultSchema>
export type GenerateShotsRequest = z.infer<typeof generateShotsRequestSchema>
export type AutoSplitShotsRequest = z.infer<typeof autoSplitShotsRequestSchema>
