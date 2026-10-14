import { createHash } from 'node:crypto'
import {
  createGenerationTaskSchema,
  deliveryContractFreezeRequestSchema,
  deliveryDownloadRequestSchema,
  rigidPhysicsAuditRequestSchema,
  reviewVideoSchema,
  PERMISSIONS,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import { rejectStandaloneProjectReferences } from '../projects/projectSurface.js'
import type { GenerationService } from './service.js'
import { trackDeliveryResponse } from './deliveryDownloadResponse.js'

const projectParamsSchema = z.object({ projectId: z.string().min(1).max(128) })
const filmPreviewBodySchema = z.object({
  mode: z.enum(['full', 'partial']).default('full'),
  force: z.boolean().default(false),
  episodeNumber: z.number().int().positive().nullable().default(null),
})
const taskParamsSchema = z.object({ taskId: z.string().min(1).max(128) })
const taskContentQuerySchema = z.object({
  download: z.enum(['1', 'true']).optional(),
  filename: z.string().min(1).max(180).optional(),
})
const outputParamsSchema = taskParamsSchema.extend({
  view: z.enum(['single', 'front', 'side', 'back', 'detail', 'last-frame']),
})

export async function registerGenerationRoutes(
  app: FastifyInstance,
  service: GenerationService,
): Promise<void> {
  app.post(
    '/generation/tasks/:taskId/delivery-download',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request, reply) => {
      const params = taskParamsSchema.safeParse(request.params)
      const body = deliveryDownloadRequestSchema.safeParse(request.body)
      if (!params.success || !body.success) throw new AppError(400, 'VALIDATION_ERROR', '正式下载参数无效')
      const controller = new AbortController()
      const cancel = () => controller.abort()
      request.raw.once('aborted', cancel)
      reply.raw.once('close', cancel)
      try {
        const download = await service.prepareDeliveryDownload(
          params.data.taskId,
          body.data,
          request.principal!,
          controller.signal,
        )
        const release = trackDeliveryResponse(reply.raw, () => {
          request.raw.removeListener('aborted', cancel)
          reply.raw.removeListener('close', cancel)
          download.release()
        })
        if (controller.signal.aborted) {
          release()
          throw new AppError(499, 'DELIVERY_DOWNLOAD_ABORTED', '下载请求已取消')
        }
        try {
          return reply
            .header('Cache-Control', 'private, no-store')
            .header(
              'Content-Disposition',
              `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
            )
            .header('X-Delivery-Receipt-Id', download.receipt.id)
            .header('X-Delivery-Sha256', download.receipt.sha256)
            .header('Content-Length', download.content.length)
            .type(download.receipt.contentType)
            .send(download.content)
        } catch (error) {
          release()
          throw error
        }
      } catch (error) {
        request.raw.removeListener('aborted', cancel)
        reply.raw.removeListener('close', cancel)
        throw error
      }
    },
  )
  app.post(
    '/generation/tasks/:taskId/content-review',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request) => {
      const params = taskParamsSchema.safeParse(request.params)
      const body = reviewVideoSchema.safeParse(request.body)
      if (!params.success || !body.success)
        throw new AppError(400, 'VALIDATION_ERROR', '验收参数无效；标记问题时须填写原因')
      return service.reviewVideo(params.data.taskId, body.data, request.principal!)
    },
  )
  app.post(
    '/generation/tasks/:taskId/delivery-contract',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request) => {
      const params = taskParamsSchema.safeParse(request.params)
      const body = deliveryContractFreezeRequestSchema.safeParse(request.body)
      if (!params.success || !body.success) throw new AppError(400, 'VALIDATION_ERROR', '交付合同参数无效')
      return service.freezeDeliveryContract(params.data.taskId, body.data, request.principal!)
    },
  )
  app.get(
    '/generation/tasks/:taskId/delivery-verification',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request, reply) => {
      const params = taskParamsSchema.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', '任务参数无效')
      const controller = new AbortController()
      const cancel = () => controller.abort()
      request.raw.once('aborted', cancel)
      reply.raw.once('close', cancel)
      try {
        reply.header('Cache-Control', 'private, no-store')
        return await service.deliveryVerification(params.data.taskId, request.principal!, controller.signal)
      } finally {
        request.raw.removeListener('aborted', cancel)
        reply.raw.removeListener('close', cancel)
      }
    },
  )
  app.get(
    '/generation/tasks/:taskId/delivery-gate',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request, reply) => {
      const params = taskParamsSchema.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', '任务参数无效')
      const controller = new AbortController()
      const cancel = () => controller.abort()
      request.raw.once('aborted', cancel)
      reply.raw.once('close', cancel)
      try {
        reply.header('Cache-Control', 'private, no-store')
        return await service.deliveryGate(params.data.taskId, request.principal!, controller.signal)
      } finally {
        request.raw.removeListener('aborted', cancel)
        reply.raw.removeListener('close', cancel)
      }
    },
  )
  app.post(
    '/generation/tasks/:taskId/rigid-audit',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request) => {
      const params = taskParamsSchema.safeParse(request.params)
      const body = rigidPhysicsAuditRequestSchema.safeParse(request.body)
      if (!params.success || !body.success) throw new AppError(400, 'VALIDATION_ERROR', '物理验收参数无效')
      return service.auditRigidPhysics(params.data.taskId, body.data, request.principal!)
    },
  )
  app.post(
    '/generation/tasks',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request, reply) => {
      const parsed = createGenerationTaskSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      rejectStandaloneProjectReferences(parsed.data)

      const task = await service.createTask(parsed.data, request.principal!, request.id)
      return reply.code(202).send(task)
    },
  )

  app.get(
    '/generation/tasks/recent',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    (request) => service.listRecentTasks(request.principal!),
  )

  app.get(
    '/projects/:projectId/generation/tasks',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request) => {
      const parsed = projectParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return service.listProjectTasks(parsed.data.projectId, request.principal!)
    },
  )

  app.get(
    '/projects/:projectId/generation/tasks/poll',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request, reply) => {
      const parsed = projectParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const version = await service.pollingVersion(parsed.data.projectId, request.principal!)
      const etag = taskPollingEtag(version)
      reply.header('Cache-Control', 'private, no-cache').header('ETag', etag)
      const ifNoneMatch = request.headers['if-none-match']
      if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((value) => value.trim() === etag)) {
        return reply.code(304).send()
      }
      return service.listProjectTaskPolling(parsed.data.projectId, request.principal!)
    },
  )

  app.post(
    '/projects/:projectId/film-preview',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request, reply) => {
      const parsed = projectParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const body = filmPreviewBodySchema.safeParse(request.body ?? {})
      if (!body.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(body.error))
      return reply
        .code(202)
        .send(
          await service.createFilmPreview(
            parsed.data.projectId,
            request.principal!,
            body.data.mode,
            body.data.force,
            body.data.episodeNumber,
            request.id,
          ),
        )
    },
  )

  app.post(
    '/generation/tasks/:taskId/pause',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return service.pauseTask(parsed.data.taskId, request.principal!)
    },
  )

  app.post(
    '/generation/tasks/:taskId/stop',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return service.stopRunningTask(parsed.data.taskId, request.principal!)
    },
  )

  app.post(
    '/generation/tasks/:taskId/resume',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return service.resumeTask(parsed.data.taskId, request.principal!, request.id)
    },
  )

  app.delete(
    '/generation/tasks/:taskId',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request, reply) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      await service.deleteTask(parsed.data.taskId, request.principal!)
      return reply.code(204).send()
    },
  )

  app.get(
    '/generation/tasks/:taskId/content',
    {
      config: { rateLimit: false },
      preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ),
    },
    async (request, reply) => {
      const parsed = taskParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const query = taskContentQuerySchema.safeParse(request.query ?? {})
      if (!query.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(query.error))
      const range = typeof request.headers.range === 'string' ? request.headers.range : undefined
      const downloadFileName = query.data.download ? safeDownloadFileName(query.data.filename) : undefined
      const content = await service.getVideoContent(
        parsed.data.taskId,
        request.principal!,
        range,
        downloadFileName,
      )
      if ('redirectUrl' in content) {
        return reply.header('Cache-Control', 'private, max-age=300').redirect(content.redirectUrl, 307)
      }
      // Task IDs are immutable media versions; let the browser reuse the bytes while
      // still keeping the response private to the signed-in user.
      reply.header('Cache-Control', 'private, max-age=86400, immutable').type(content.contentType)
      if (content.contentLength) reply.header('Content-Length', content.contentLength)
      if (content.acceptRanges) reply.header('Accept-Ranges', content.acceptRanges)
      if (content.contentRange) reply.header('Content-Range', content.contentRange)
      if (downloadFileName) {
        reply.header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(downloadFileName)}`,
        )
      }
      return reply.code(content.statusCode).send(content.stream)
    },
  )

  app.get(
    '/generation/tasks/:taskId/outputs/:view',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_READ) },
    async (request, reply) => {
      const parsed = outputParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const output = await service.getImageOutput(parsed.data.taskId, parsed.data.view, request.principal!)
      return reply
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .type(output.contentType)
        .send(output.content)
    },
  )

  app.delete(
    '/projects/:projectId/generation/tasks/completed',
    { preHandler: requirePermission(PERMISSIONS.GENERATION_TASK_CREATE) },
    async (request) => {
      const parsed = projectParamsSchema.safeParse(request.params)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return { cleared: await service.clearCompleted(parsed.data.projectId, request.principal!) }
    },
  )
}

function taskPollingEtag(version: string): string {
  return `"${createHash('sha256').update(version).digest('base64url')}"`
}

function safeDownloadFileName(value?: string): string {
  const normalized = String(value || '序幕TV成片.mp4')
    .replace(/[\r\n<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  return /\.mp4$/i.test(normalized) ? normalized : `${normalized || '序幕TV成片'}.mp4`
}
