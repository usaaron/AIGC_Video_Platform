import { z } from 'zod'
import { aiJobSchema } from './aiJob.js'
import { DEFAULT_SCRIPT_MODEL, scriptAssetSuggestionsContentSchema, textModelSchema } from './project.js'

export const novelSourceFormatSchema = z.enum(['txt', 'markdown'])
export const novelSplitModeSchema = z.enum(['auto', 'heading', 'fixed'])
export const NOVEL_IMPORT_MAX_FILE_BYTES = 5_657_407
export const NOVEL_IMPORT_MAX_CONTENT_CHARS = NOVEL_IMPORT_MAX_FILE_BYTES
export const NOVEL_SPLIT_TARGET_CHAR_OPTIONS = [3_000, 6_000, 9_000] as const
export const NOVEL_SPLIT_OVERLAP_CHAR_OPTIONS = [0, 300, 500] as const

export const novelSplitOptionsSchema = z
  .object({
    mode: novelSplitModeSchema.default('auto'),
    targetChars: z.number().int().min(1_000).max(20_000).default(6_000),
    overlapChars: z.number().int().min(0).max(1_000).default(300),
  })
  .refine((value) => value.overlapChars < value.targetChars, {
    message: 'Overlap must be smaller than target chunk size',
    path: ['overlapChars'],
  })

export const importNovelRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(120),
  format: novelSourceFormatSchema.default('txt'),
  splitOptions: novelSplitOptionsSchema.optional(),
  content: z
    .string()
    .max(NOVEL_IMPORT_MAX_CONTENT_CHARS)
    .refine((value) => value.trim().length > 0, 'Novel content is required'),
})

export const previewNovelSplitRequestSchema = importNovelRequestSchema.omit({ clientRequestId: true })

export const novelDocumentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1).max(120),
  format: novelSourceFormatSchema,
  characterCount: z.number().int().min(1),
  chapterCount: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const novelChapterSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  order: z.number().int().positive(),
  title: z.string().min(1).max(120),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  sourceStartOffset: z.number().int().min(0),
  sourceEndOffset: z.number().int().min(0),
  sourceChapterTitle: z.string().min(1).max(120).nullable(),
  splitMode: novelSplitModeSchema,
  overlapBeforeChars: z.number().int().min(0).default(0),
  overlapAfterChars: z.number().int().min(0).default(0),
  crossesChapterBoundary: z.boolean().default(false),
  characterCount: z.number().int().min(1),
  preview: z.string().max(3_000),
  previewTruncated: z.boolean().default(false),
  createdAt: z.string().datetime(),
})

export const novelSplitPreviewChapterSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().positive(),
  title: z.string().min(1).max(120),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  sourceStartOffset: z.number().int().min(0),
  sourceEndOffset: z.number().int().min(0),
  sourceChapterTitle: z.string().min(1).max(120).nullable(),
  splitMode: novelSplitModeSchema,
  overlapBeforeChars: z.number().int().min(0).default(0),
  overlapAfterChars: z.number().int().min(0).default(0),
  crossesChapterBoundary: z.boolean().default(false),
  characterCount: z.number().int().min(1),
  preview: z.string().max(3_000),
  previewTruncated: z.boolean().default(false),
})

export const novelSplitPreviewResultSchema = z.object({
  previewId: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  format: novelSourceFormatSchema,
  characterCount: z.number().int().min(1),
  chapterCount: z.number().int().min(1),
  splitMode: novelSplitModeSchema,
  splitOptions: novelSplitOptionsSchema,
  coveragePassed: z.boolean(),
  warnings: z.array(z.string().min(1).max(500)).default([]),
  previewedAt: z.string().datetime(),
  chapters: z.array(novelSplitPreviewChapterSchema).min(1).max(1_000),
})

export const novelImportResultSchema = z.object({
  document: novelDocumentSchema,
  chapters: z.array(novelChapterSchema).min(1).max(1_000),
})

export const novelDetailSchema = novelImportResultSchema

export const generateNovelChapterSummariesRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  batchSize: z.number().int().min(1).max(24).default(4),
  chapterIds: z.array(z.string().min(1).max(128)).min(1).max(24).optional(),
  force: z.boolean().default(false),
})

export const novelSummaryQueueStatusSchema = z.enum([
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
])

export const novelSummaryQueueItemStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
])

export const createNovelSummaryQueueRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  batchSize: z.number().int().min(1).max(24).default(4),
  chapterIds: z.array(z.string().min(1).max(128)).min(1).max(1_000).optional(),
  force: z.boolean().default(false),
  maxAttempts: z.number().int().min(1).max(5).default(3),
})

export const novelSummaryQueueSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  status: novelSummaryQueueStatusSchema,
  batchSize: z.number().int().min(1).max(24),
  force: z.boolean(),
  totalItems: z.number().int().min(0),
  pendingCount: z.number().int().min(0),
  runningCount: z.number().int().min(0),
  completedCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const novelSummaryQueueItemResultSchema = z.object({
  summary: z.string().min(20).max(1_200),
  keyEvents: z.array(z.string().min(1).max(260)).max(8).default([]),
  characters: z.array(z.string().min(1).max(160)).max(12).default([]),
  locations: z.array(z.string().min(1).max(160)).max(12).default([]),
  timeline: z.array(z.string().min(1).max(220)).max(8).default([]),
  keyProps: z.array(z.string().min(1).max(160)).max(10).default([]),
  foreshadowing: z.array(z.string().min(1).max(220)).max(10).default([]),
  worldRules: z.array(z.string().min(1).max(220)).max(10).default([]),
  adaptationNotes: z.string().max(700).default(''),
})

export const novelSummaryQueueItemSchema = z.object({
  id: z.string().min(1),
  queueId: z.string().min(1),
  documentId: z.string().min(1),
  chapterId: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  order: z.number().int().positive(),
  title: z.string().min(1).max(120),
  status: novelSummaryQueueItemStatusSchema,
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1).max(5),
  characterCount: z.number().int().min(1),
  sourceStartOffset: z.number().int().min(0),
  sourceEndOffset: z.number().int().min(0),
  sourceChapterTitle: z.string().min(1).max(120).nullable(),
  crossesChapterBoundary: z.boolean().default(false),
  summaryId: z.string().min(1).nullable(),
  result: novelSummaryQueueItemResultSchema.nullable(),
  errorMessage: z.string().max(1_000).nullable(),
  lockedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const novelSummaryQueueResultSchema = z.object({
  document: novelDocumentSchema,
  queue: novelSummaryQueueSchema.nullable(),
  items: z.array(novelSummaryQueueItemSchema).max(1_000),
  summaryCount: z.number().int().min(0),
  missingSummaryCount: z.number().int().min(0),
})

export const runNovelSummaryQueueBatchRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  batchSize: z.number().int().min(1).max(24).optional(),
})

export const novelSummaryQueueBatchResultSchema = novelSummaryQueueResultSchema.extend({
  processedItemIds: z.array(z.string().min(1)).max(24),
  failedItemIds: z.array(z.string().min(1)).max(24),
  task: aiJobSchema.nullable().optional(),
  warnings: z.array(z.string().min(1).max(500)).default([]),
})

export const commitNovelSummaryQueueResultsRequestSchema = z.object({
  force: z.boolean().default(false),
})

export const novelChapterSummaryContentItemSchema = z.object({
  order: z.number().int().positive(),
  title: z.string().min(1).max(120),
  summary: z.string().min(20).max(1_200),
  keyEvents: z.array(z.string().min(1).max(260)).max(8).default([]),
  characters: z.array(z.string().min(1).max(160)).max(12).default([]),
  locations: z.array(z.string().min(1).max(160)).max(12).default([]),
  timeline: z.array(z.string().min(1).max(220)).max(8).default([]),
  keyProps: z.array(z.string().min(1).max(160)).max(10).default([]),
  foreshadowing: z.array(z.string().min(1).max(220)).max(10).default([]),
  worldRules: z.array(z.string().min(1).max(220)).max(10).default([]),
  adaptationNotes: z.string().max(700).default(''),
})

export const novelChapterSummariesContentSchema = z.object({
  summaries: z.array(novelChapterSummaryContentItemSchema).min(1).max(24),
  batchNotes: z.string().max(700).default(''),
})

export const novelChapterSummarySchema = novelChapterSummaryContentItemSchema.extend({
  id: z.string().min(1),
  documentId: z.string().min(1),
  chapterId: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const novelSummaryQueueCommitResultSchema = novelSummaryQueueResultSchema.extend({
  summaries: z.array(novelChapterSummarySchema).max(1_000),
  committedItemIds: z.array(z.string().min(1)).max(1_000),
  skippedItemIds: z.array(z.string().min(1)).max(1_000),
  warnings: z.array(z.string().min(1).max(500)).default([]),
})

export const novelBoundaryStatusSchema = z.enum(['pending', 'ignored', 'resolved'])
export const novelBoundarySeveritySchema = z.enum(['low', 'medium', 'high'])
export const novelBoundaryIssueSchema = z.enum([
  'sentence-fragment',
  'dialogue-fragment',
  'cross-chapter',
  'offset-gap',
])

export const detectNovelBoundariesRequestSchema = z.object({
  force: z.boolean().default(false),
  maxBoundaries: z.number().int().min(1).max(1_000).default(300),
})

export const novelBoundarySchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  previousChapterId: z.string().min(1),
  nextChapterId: z.string().min(1),
  previousOrder: z.number().int().positive(),
  nextOrder: z.number().int().positive(),
  status: novelBoundaryStatusSchema,
  severity: novelBoundarySeveritySchema,
  issues: z.array(novelBoundaryIssueSchema).min(1).max(6),
  previousTail: z.string().min(1).max(500),
  nextHead: z.string().min(1).max(500),
  note: z.string().max(1_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const novelBoundaryDetectionResultSchema = z.object({
  document: novelDocumentSchema,
  boundaries: z.array(novelBoundarySchema).max(1_000),
  detectedAt: z.string().datetime(),
  warnings: z.array(z.string().min(1).max(500)).default([]),
})

export const generateNovelBoundaryNotesRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  batchSize: z.number().int().min(1).max(24).default(8),
  boundaryIds: z.array(z.string().min(1).max(128)).min(1).max(24).optional(),
  force: z.boolean().default(false),
})

export const novelBoundaryNoteContentItemSchema = z.object({
  boundaryId: z.string().min(1).max(128),
  note: z.string().min(1).max(1_000),
})

export const novelBoundaryNotesContentSchema = z.object({
  notes: z.array(novelBoundaryNoteContentItemSchema).min(1).max(24),
  batchNotes: z.string().max(700).default(''),
})

export const novelBoundaryNotesResultSchema = z.object({
  document: novelDocumentSchema,
  boundaries: z.array(novelBoundarySchema).max(1_000),
  generatedBoundaryIds: z.array(z.string().min(1)).max(24),
  missingNoteCount: z.number().int().min(0),
  generatedAt: z.string().datetime(),
  warnings: z.array(z.string().min(1).max(500)).default([]),
})

export const novelEntitySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  storyFunction: z.string().min(1).max(500),
  visualNotes: z.string().max(500).default(''),
})

export const novelCharacterBibleSchema = novelEntitySchema.extend({
  role: z.string().min(1).max(120),
  motivation: z.string().min(1).max(500),
  arc: z.string().min(1).max(700),
})

export const novelTimelineBeatSchema = z.object({
  order: z.number().int().positive(),
  label: z.string().min(1).max(120),
  event: z.string().min(1).max(500),
})

export const novelForeshadowingBibleSchema = z.object({
  setup: z.string().min(1).max(400),
  payoff: z.string().min(1).max(400),
  status: z.enum(['open', 'paid-off', 'ambiguous']).default('open'),
})

export const novelStoryBibleContentSchema = z.object({
  title: z.string().min(1).max(120),
  logline: z.string().min(1).max(240),
  premise: z.string().min(1).max(700),
  synopsis: z.string().min(120).max(2_000),
  themes: z.array(z.string().min(1).max(160)).min(1).max(8),
  characters: z.array(novelCharacterBibleSchema).max(24),
  locations: z.array(novelEntitySchema).max(24),
  timeline: z.array(novelTimelineBeatSchema).max(40),
  keyProps: z.array(novelEntitySchema).max(24),
  foreshadowing: z.array(novelForeshadowingBibleSchema).max(30),
  worldRules: z.array(z.string().min(1).max(300)).max(30),
  adaptationStrategy: z.string().min(1).max(1_000),
  risks: z.array(z.string().min(1).max(300)).max(10).default([]),
  nextStep: z.string().min(1).max(500),
})

export const novelStoryBibleSchema = novelStoryBibleContentSchema.extend({
  id: z.string().min(1),
  documentId: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  sourceSummaryCount: z.number().int().min(1),
  chapterCount: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const novelChapterSummariesResultSchema = z.object({
  document: novelDocumentSchema,
  summaries: z.array(novelChapterSummarySchema).max(1_000),
  completed: z.boolean(),
  missingSummaryCount: z.number().int().min(0),
})

export const generateNovelChapterSummariesResultSchema = z.object({
  document: novelDocumentSchema,
  summaries: z.array(novelChapterSummarySchema).max(1_000),
  generatedSummaries: z.array(novelChapterSummarySchema).max(24),
  completed: z.boolean(),
  nextChapterOrder: z.number().int().positive().nullable(),
  generatedAt: z.string().datetime(),
  warnings: z.array(z.string().min(1).max(500)).default([]),
})

export const generateNovelStoryBibleRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  force: z.boolean().default(false),
  summaryLimit: z.number().int().min(1).max(1_000).optional(),
  model: textModelSchema.default(DEFAULT_SCRIPT_MODEL),
})

export const generateNovelAssetSuggestionsRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  maxAssets: z.number().int().min(4).max(16).default(12),
  model: textModelSchema.default(DEFAULT_SCRIPT_MODEL),
})

export const novelChapterAdaptationModeSchema = z.enum(['scene', 'opening', 'summary'])
export const novelChapterAdaptationSourcesSchema = z
  .object({
    storyBible: z.boolean().optional(),
    chapterSummaries: z.boolean().optional(),
    chapterContent: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some(Boolean), {
    message: '至少选择一种剧本生成依据',
  })

export const generateNovelChapterAdaptationRequestSchema = z.object({
  clientRequestId: z.string().min(1).max(128).optional(),
  chapterIds: z.array(z.string().min(1).max(128)).min(1).max(6),
  targetSeconds: z.number().int().min(15).max(180).default(60),
  mode: novelChapterAdaptationModeSchema.default('scene'),
  model: textModelSchema.default(DEFAULT_SCRIPT_MODEL),
  sourceOptions: novelChapterAdaptationSourcesSchema.optional(),
})

export const novelStoryBibleReadResultSchema = z.object({
  storyBible: novelStoryBibleSchema.nullable(),
  summaryCount: z.number().int().min(0),
  chapterCount: z.number().int().min(1),
  missingSummaryCount: z.number().int().min(0),
})

export const novelStoryBibleResultSchema = z.object({
  storyBible: novelStoryBibleSchema,
  missingSummaryCount: z.number().int().min(0),
  generatedAt: z.string().datetime(),
  warnings: z.array(z.string().min(1).max(500)).default([]),
})

export const novelAssetSuggestionsResultSchema = scriptAssetSuggestionsContentSchema.extend({
  generatedAt: z.string().datetime(),
  warnings: z.array(z.string().min(1).max(500)).default([]),
})

export const novelChapterAdaptationResultSchema = z.object({
  document: novelDocumentSchema,
  chapters: z.array(novelChapterSchema).min(1).max(6),
  script: z.string().trim().min(20).max(30_000),
  targetSeconds: z.number().int().min(15).max(180),
  mode: novelChapterAdaptationModeSchema,
  generatedAt: z.string().datetime(),
  warnings: z.array(z.string().min(1).max(500)).default([]),
})

export type NovelSourceFormat = z.infer<typeof novelSourceFormatSchema>
export type NovelSplitMode = z.infer<typeof novelSplitModeSchema>
export type NovelSplitOptions = z.infer<typeof novelSplitOptionsSchema>
export type ImportNovelRequest = z.infer<typeof importNovelRequestSchema>
export type PreviewNovelSplitRequest = z.infer<typeof previewNovelSplitRequestSchema>
export type NovelDocument = z.infer<typeof novelDocumentSchema>
export type NovelChapter = z.infer<typeof novelChapterSchema>
export type NovelSplitPreviewChapter = z.infer<typeof novelSplitPreviewChapterSchema>
export type NovelSplitPreviewResult = z.infer<typeof novelSplitPreviewResultSchema>
export type NovelImportResult = z.infer<typeof novelImportResultSchema>
export type NovelDetail = z.infer<typeof novelDetailSchema>
export type GenerateNovelChapterSummariesRequest = z.infer<typeof generateNovelChapterSummariesRequestSchema>
export type NovelSummaryQueueStatus = z.infer<typeof novelSummaryQueueStatusSchema>
export type NovelSummaryQueueItemStatus = z.infer<typeof novelSummaryQueueItemStatusSchema>
export type CreateNovelSummaryQueueRequest = z.infer<typeof createNovelSummaryQueueRequestSchema>
export type NovelSummaryQueue = z.infer<typeof novelSummaryQueueSchema>
export type NovelSummaryQueueItemResult = z.infer<typeof novelSummaryQueueItemResultSchema>
export type NovelSummaryQueueItem = z.infer<typeof novelSummaryQueueItemSchema>
export type NovelSummaryQueueResult = z.infer<typeof novelSummaryQueueResultSchema>
export type RunNovelSummaryQueueBatchRequest = z.infer<typeof runNovelSummaryQueueBatchRequestSchema>
export type NovelSummaryQueueBatchResult = z.infer<typeof novelSummaryQueueBatchResultSchema>
export type CommitNovelSummaryQueueResultsRequest = z.infer<
  typeof commitNovelSummaryQueueResultsRequestSchema
>
export type NovelSummaryQueueCommitResult = z.infer<typeof novelSummaryQueueCommitResultSchema>
export type NovelBoundaryStatus = z.infer<typeof novelBoundaryStatusSchema>
export type NovelBoundarySeverity = z.infer<typeof novelBoundarySeveritySchema>
export type NovelBoundaryIssue = z.infer<typeof novelBoundaryIssueSchema>
export type DetectNovelBoundariesRequest = z.infer<typeof detectNovelBoundariesRequestSchema>
export type NovelBoundary = z.infer<typeof novelBoundarySchema>
export type NovelBoundaryDetectionResult = z.infer<typeof novelBoundaryDetectionResultSchema>
export type GenerateNovelBoundaryNotesRequest = z.infer<typeof generateNovelBoundaryNotesRequestSchema>
export type NovelBoundaryNoteContentItem = z.infer<typeof novelBoundaryNoteContentItemSchema>
export type NovelBoundaryNotesResult = z.infer<typeof novelBoundaryNotesResultSchema>
export type NovelChapterSummary = z.infer<typeof novelChapterSummarySchema>
export type NovelStoryBible = z.infer<typeof novelStoryBibleSchema>
export type NovelChapterSummariesResult = z.infer<typeof novelChapterSummariesResultSchema>
export type GenerateNovelChapterSummariesResult = z.infer<typeof generateNovelChapterSummariesResultSchema>
export type GenerateNovelStoryBibleRequest = z.infer<typeof generateNovelStoryBibleRequestSchema>
export type GenerateNovelAssetSuggestionsRequest = z.infer<typeof generateNovelAssetSuggestionsRequestSchema>
export type NovelChapterAdaptationMode = z.infer<typeof novelChapterAdaptationModeSchema>
export type NovelChapterAdaptationSources = z.infer<typeof novelChapterAdaptationSourcesSchema>
export type GenerateNovelChapterAdaptationRequest = z.infer<
  typeof generateNovelChapterAdaptationRequestSchema
>
export type NovelStoryBibleReadResult = z.infer<typeof novelStoryBibleReadResultSchema>
export type NovelStoryBibleResult = z.infer<typeof novelStoryBibleResultSchema>
export type NovelAssetSuggestionsResult = z.infer<typeof novelAssetSuggestionsResultSchema>
export type NovelChapterAdaptationResult = z.infer<typeof novelChapterAdaptationResultSchema>
