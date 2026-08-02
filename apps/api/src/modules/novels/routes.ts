import {
  commitNovelSummaryQueueResultsRequestSchema,
  createNovelSummaryQueueRequestSchema,
  detectNovelBoundariesRequestSchema,
  generateNovelChapterAdaptationRequestSchema,
  generateNovelAssetSuggestionsRequestSchema,
  generateNovelBoundaryNotesRequestSchema,
  generateNovelChapterSummariesRequestSchema,
  generateNovelStoryBibleRequestSchema,
  importNovelRequestSchema,
  PERMISSIONS,
  previewNovelSplitRequestSchema,
  runNovelSummaryQueueBatchRequestSchema,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { NovelService } from './service.js'

const projectParams = z.object({ projectId: z.string().min(1).max(128) })
const novelParams = projectParams.extend({ documentId: z.string().min(1).max(128) })
const summaryQueueParams = novelParams.extend({ queueId: z.string().min(1).max(128) })
const summaryQueueItemParams = summaryQueueParams.extend({ itemId: z.string().min(1).max(128) })

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(result.error))
  return result.data
}

export async function registerNovelRoutes(app: FastifyInstance, service: NovelService): Promise<void> {
  app.get(
    '/projects/:projectId/novels',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    (request) => service.list(parse(projectParams, request.params).projectId, request.principal!),
  )

  app.get(
    '/projects/:projectId/novels/:documentId',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    (request) => {
      const params = parse(novelParams, request.params)
      return service.detail(params.projectId, params.documentId, request.principal!)
    },
  )

  app.post(
    '/projects/:projectId/novels/preview-split',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE),
    },
    (request) =>
      service.previewSplit(
        parse(projectParams, request.params).projectId,
        parse(previewNovelSplitRequestSchema, request.body),
        request.principal!,
      ),
  )

  app.post(
    '/projects/:projectId/novels/import',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE),
    },
    async (request, reply) => {
      const result = await service.importNovel(
        parse(projectParams, request.params).projectId,
        parse(importNovelRequestSchema, request.body),
        request.principal!,
      )
      return reply.code(201).send(result)
    },
  )

  app.get(
    '/projects/:projectId/novels/:documentId/summaries',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    (request) => {
      const params = parse(novelParams, request.params)
      return service.summaries(params.projectId, params.documentId, request.principal!)
    },
  )

  app.get(
    '/projects/:projectId/novels/:documentId/boundaries',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    (request) => {
      const params = parse(novelParams, request.params)
      return service.boundaries(params.projectId, params.documentId, request.principal!)
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/boundaries/detect',
    {
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE),
    },
    (request) => {
      const params = parse(novelParams, request.params)
      return service.detectBoundaries(
        params.projectId,
        params.documentId,
        parse(detectNovelBoundariesRequestSchema, request.body ?? {}),
        request.principal!,
      )
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/boundaries/notes/generate',
    {
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE),
    },
    (request) => {
      const params = parse(novelParams, request.params)
      const input = parse(generateNovelBoundaryNotesRequestSchema, request.body ?? {})
      return service.generateBoundaryNotes(
        params.projectId,
        params.documentId,
        input,
        input.clientRequestId ?? randomUUID(),
        request.principal!,
      )
    },
  )

  app.get(
    '/projects/:projectId/novels/:documentId/summary-queue',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    (request) => {
      const params = parse(novelParams, request.params)
      return service.summaryQueue(params.projectId, params.documentId, request.principal!)
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/summary-queue',
    {
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE),
    },
    (request) => {
      const params = parse(novelParams, request.params)
      return service.createSummaryQueue(
        params.projectId,
        params.documentId,
        parse(createNovelSummaryQueueRequestSchema, request.body ?? {}),
        request.principal!,
      )
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/summary-queue/:queueId/run-batch',
    {
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE),
    },
    (request) => {
      const params = parse(summaryQueueParams, request.params)
      const input = parse(runNovelSummaryQueueBatchRequestSchema, request.body ?? {})
      return service.runSummaryQueueBatch(
        params.projectId,
        params.documentId,
        params.queueId,
        input,
        input.clientRequestId ?? randomUUID(),
        request.principal!,
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/summary-queue/:queueId/pause',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => {
      const params = parse(summaryQueueParams, request.params)
      return service.pauseSummaryQueue(
        params.projectId,
        params.documentId,
        params.queueId,
        request.principal!,
      )
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/summary-queue/:queueId/resume',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => {
      const params = parse(summaryQueueParams, request.params)
      return service.resumeSummaryQueue(
        params.projectId,
        params.documentId,
        params.queueId,
        request.principal!,
      )
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/summary-queue/:queueId/items/:itemId/retry',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => {
      const params = parse(summaryQueueItemParams, request.params)
      return service.retrySummaryQueueItem(
        params.projectId,
        params.documentId,
        params.queueId,
        params.itemId,
        request.principal!,
      )
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/summary-queue/:queueId/items/:itemId/skip',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => {
      const params = parse(summaryQueueItemParams, request.params)
      return service.skipSummaryQueueItem(
        params.projectId,
        params.documentId,
        params.queueId,
        params.itemId,
        request.principal!,
      )
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/summary-queue/:queueId/commit-results',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => {
      const params = parse(summaryQueueParams, request.params)
      return service.commitSummaryQueueResults(
        params.projectId,
        params.documentId,
        params.queueId,
        parse(commitNovelSummaryQueueResultsRequestSchema, request.body ?? {}),
        request.principal!,
      )
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/summaries/generate',
    {
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE),
    },
    (request) => {
      const params = parse(novelParams, request.params)
      const input = parse(generateNovelChapterSummariesRequestSchema, request.body ?? {})
      return service.generateChapterSummaries(
        params.projectId,
        params.documentId,
        input,
        input.clientRequestId ?? randomUUID(),
        request.principal!,
      )
    },
  )

  app.get(
    '/projects/:projectId/novels/:documentId/story-bible',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    (request) => {
      const params = parse(novelParams, request.params)
      return service.storyBible(params.projectId, params.documentId, request.principal!)
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/story-bible/generate',
    {
      config: { rateLimit: { max: 4, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE),
    },
    (request) => {
      const params = parse(novelParams, request.params)
      const input = parse(generateNovelStoryBibleRequestSchema, request.body ?? {})
      return service.generateStoryBible(
        params.projectId,
        params.documentId,
        input,
        input.clientRequestId ?? randomUUID(),
        request.principal!,
      )
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/asset-suggestions',
    {
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_READ),
    },
    (request) => {
      const params = parse(novelParams, request.params)
      const input = parse(generateNovelAssetSuggestionsRequestSchema, request.body ?? {})
      return service.suggestAssets(
        params.projectId,
        params.documentId,
        input,
        input.clientRequestId ?? randomUUID(),
        request.principal!,
      )
    },
  )

  app.post(
    '/projects/:projectId/novels/:documentId/adapt-script',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE),
    },
    (request) => {
      const params = parse(novelParams, request.params)
      const input = parse(generateNovelChapterAdaptationRequestSchema, request.body ?? {})
      return service.generateChapterAdaptation(
        params.projectId,
        params.documentId,
        input,
        input.clientRequestId ?? randomUUID(),
        request.principal!,
      )
    },
  )
}
