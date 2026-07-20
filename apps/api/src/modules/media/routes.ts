import { PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { MediaService } from './service.js'
import { verifySignedMediaAccess } from './signedUrl.js'

const projectParams = z.object({ projectId: z.string().min(1).max(128) })
const mediaParams = z.object({ mediaId: z.string().uuid() })
const signedMediaQuery = z.object({
  expires: z.coerce.number().int().positive(),
  signature: z.string().min(32).max(256),
})

export async function registerMediaRoutes(
  app: FastifyInstance,
  service: MediaService,
  maxUploadBytes: number,
  authSecret: string,
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

  app.get('/media/:mediaId/signed', async (request, reply) => {
    const params = mediaParams.safeParse(request.params)
    const query = signedMediaQuery.safeParse(request.query)
    if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
    if (!query.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(query.error))
    if (!verifySignedMediaAccess(params.data.mediaId, query.data.expires, query.data.signature, authSecret)) {
      throw new AppError(403, 'SIGNED_MEDIA_URL_INVALID', '媒体签名已过期或无效')
    }

    const { media, content } = await service.readSigned(params.data.mediaId)
    return reply.header('Cache-Control', 'private, no-store').type(media.contentType).send(content)
  })
}
