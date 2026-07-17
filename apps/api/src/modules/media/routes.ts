import { PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { MediaService } from './service.js'

const projectParams = z.object({ projectId: z.string().min(1).max(128) })
const mediaParams = z.object({ mediaId: z.string().uuid() })

export async function registerMediaRoutes(
  app: FastifyInstance,
  service: MediaService,
  maxUploadBytes: number,
): Promise<void> {
  app.post(
    '/projects/:projectId/media',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request, reply) => {
      const params = projectParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const file = await request.file({ limits: { files: 1, fileSize: maxUploadBytes } })
      if (!file) throw new AppError(400, 'FILE_REQUIRED', '请选择需要上传的文件')
      const content = await file.toBuffer()
      const media = await service.upload(
        params.data.projectId,
        file.filename,
        file.mimetype,
        content,
        request.principal!,
      )
      return reply.code(201).send(media)
    },
  )

  app.get(
    '/media/:mediaId',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    async (request, reply) => {
      const params = mediaParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const { media, content } = await service.read(params.data.mediaId, request.principal!)
      return reply
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .type(media.contentType)
        .send(content)
    },
  )
}
