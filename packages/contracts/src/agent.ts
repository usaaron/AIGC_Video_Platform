import { z } from 'zod'
import { SCRIPT_OPERATION_CREDITS } from './billing.js'
import { visualStyleSchema } from './project.js'

export const AGENT_STAGE_KEYS = [
  'script',
  'asset-analysis',
  'asset-generation',
  'identity-baseline',
  'storyboard',
  'video-generation',
  'film-compose',
  'delivery',
] as const

export const AGENT_CREDIT_COSTS = {
  script: SCRIPT_OPERATION_CREDITS.generate,
  assetAnalysis: SCRIPT_OPERATION_CREDITS.suggestAssets,
  characterFace: 4,
  assetImage: 6,
  trustedPortrait: 1,
  videoShot: 18,
} as const

export const agentContentTypeSchema = z.enum(['web-series', 'advertisement', 'short-film'])
export const agentAspectRatioSchema = z.enum(['9:16', '16:9', '1:1'])
export const agentMissingFieldSchema = z.enum([
  'storyBrief',
  'contentType',
  'durationSeconds',
  'aspectRatio',
  'visualStyle',
])

export const agentEstimateSchema = z.object({
  scriptCredits: z.number().int().nonnegative(),
  assetCredits: z.number().int().nonnegative(),
  videoCredits: z.number().int().nonnegative(),
  totalCredits: z.number().int().nonnegative(),
  estimatedShots: z.number().int().positive(),
  estimatedAssets: z.number().int().nonnegative(),
  estimatedEpisodes: z.number().int().positive(),
  minMinutes: z.number().int().positive(),
  maxMinutes: z.number().int().positive(),
})

export const agentPlanSchema = z.object({
  contentType: agentContentTypeSchema.nullable(),
  durationSeconds: z.number().int().min(5).max(300).nullable(),
  episodeDurationSeconds: z.number().int().min(5).max(300).nullable(),
  episodeCount: z.number().int().positive().max(120).nullable(),
  aspectRatio: agentAspectRatioSchema.nullable(),
  visualStyle: visualStyleSchema.nullable(),
  storyBrief: z.string().trim().max(20_000),
  projectName: z.string().trim().min(1).max(120),
  missingFields: z.array(agentMissingFieldSchema),
  estimate: agentEstimateSchema.nullable(),
})

export const agentPlanOverridesSchema = z.object({
  contentType: agentContentTypeSchema.optional(),
  durationSeconds: z.number().int().min(5).max(300).optional(),
  episodeDurationSeconds: z.number().int().min(5).max(300).optional(),
  aspectRatio: agentAspectRatioSchema.optional(),
  visualStyle: visualStyleSchema.optional(),
  storyBrief: z.string().trim().min(2).max(20_000).optional(),
  projectName: z.string().trim().min(1).max(120).optional(),
})

export const createAgentPlanRequestSchema = z.object({
  prompt: z.string().trim().min(2).max(20_000),
  runId: z.string().uuid().optional(),
  overrides: agentPlanOverridesSchema.default({}),
})

export const agentRunStatusSchema = z.enum([
  'draft',
  'queued',
  'running',
  'pausing',
  'paused',
  'failed',
  'completed',
  'cancelled',
])
export const agentStageKeySchema = z.enum(AGENT_STAGE_KEYS)
export const agentStageStatusSchema = z.enum([
  'pending',
  'running',
  'waiting',
  'completed',
  'failed',
  'skipped',
  'paused',
])

export const agentRunStageSchema = z.object({
  key: agentStageKeySchema,
  status: agentStageStatusSchema,
  taskIds: z.array(z.string().min(1)).default([]),
  attempt: z.number().int().nonnegative().default(0),
  output: z.record(z.string(), z.unknown()).default({}),
  error: z.string().max(2_000).nullable().default(null),
  startedAt: z.string().datetime().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null),
})

export const agentEpisodeDeliverySchema = z.object({
  episodeNumber: z.number().int().positive(),
  taskId: z.string().min(1),
  title: z.string().min(1).max(200),
  durationSeconds: z.number().int().positive(),
  url: z.string().min(1).max(2_000),
  completedAt: z.string().datetime(),
})

export const agentRunSchema = z.object({
  id: z.string().uuid(),
  clientRequestId: z.string().min(1).max(128),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  originalPrompt: z.string().min(1).max(20_000),
  plan: agentPlanSchema,
  status: agentRunStatusSchema,
  pauseRequested: z.boolean(),
  currentStage: agentStageKeySchema.nullable(),
  stages: z.array(agentRunStageSchema).length(AGENT_STAGE_KEYS.length),
  deliveries: z.array(agentEpisodeDeliverySchema),
  lastError: z.string().max(2_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
})

export const confirmAgentRunRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128),
})

export type AgentContentType = z.infer<typeof agentContentTypeSchema>
export type AgentPlan = z.infer<typeof agentPlanSchema>
export type AgentPlanOverrides = z.infer<typeof agentPlanOverridesSchema>
export type CreateAgentPlanRequest = z.infer<typeof createAgentPlanRequestSchema>
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>
export type AgentStageKey = z.infer<typeof agentStageKeySchema>
export type AgentRunStage = z.infer<typeof agentRunStageSchema>
export type AgentEpisodeDelivery = z.infer<typeof agentEpisodeDeliverySchema>
export type AgentRun = z.infer<typeof agentRunSchema>
export type ConfirmAgentRunRequest = z.infer<typeof confirmAgentRunRequestSchema>
