import { z } from 'zod'
import { generationTaskSchema } from './generation.js'
import {
  assetSchema,
  characterAttributesSchema,
  costumeAttributesSchema,
  sceneAttributesSchema,
  textModelSchema,
} from './project.js'

const proposalBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  prompt: z.string().trim().min(1).max(5_000),
  negativePrompt: z.string().max(2_000).default(''),
})

export const quickStartAssetProposalSchema = z.discriminatedUnion('kind', [
  proposalBaseSchema.extend({
    kind: z.literal('character'),
    attributes: characterAttributesSchema,
  }),
  proposalBaseSchema.extend({
    kind: z.literal('costume'),
    attributes: costumeAttributesSchema,
  }),
  proposalBaseSchema.extend({
    kind: z.literal('scene'),
    attributes: sceneAttributesSchema,
  }),
])

export const quickStartEstimateSchema = z.object({
  assetCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  credits: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  queueAhead: z.number().int().nonnegative(),
  minSeconds: z.number().int().nonnegative(),
  maxSeconds: z.number().int().nonnegative(),
})

export const quickStartPlanSchema = z.object({
  summary: z.string().min(1).max(500),
  sourceScriptHash: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  assets: z.array(quickStartAssetProposalSchema).max(6),
  estimate: quickStartEstimateSchema,
})

export const quickStartPlanRequestSchema = z.object({
  model: textModelSchema.default('gpt-5.6'),
})

export const executeQuickStartRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128),
  sourceScriptHash: z.string().regex(/^[a-f0-9]{64}$/),
  assets: z.array(quickStartAssetProposalSchema).min(1).max(6),
})

export const quickStartExecutionResultSchema = z.object({
  batchId: z.string().min(1),
  createdAssets: z.array(assetSchema),
  tasks: z.array(generationTaskSchema),
  skippedAssets: z.array(z.string().min(1).max(120)),
  estimate: quickStartEstimateSchema,
  replayed: z.boolean(),
})

export type QuickStartAssetProposal = z.infer<typeof quickStartAssetProposalSchema>
export type QuickStartEstimate = z.infer<typeof quickStartEstimateSchema>
export type QuickStartPlan = z.infer<typeof quickStartPlanSchema>
export type QuickStartPlanRequest = z.infer<typeof quickStartPlanRequestSchema>
export type ExecuteQuickStartRequest = z.infer<typeof executeQuickStartRequestSchema>
export type QuickStartExecutionResult = z.infer<typeof quickStartExecutionResultSchema>
