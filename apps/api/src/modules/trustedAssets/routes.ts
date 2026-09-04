import { PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { TrustedAssetService } from './service.js'

const assetParamsSchema = z.object({
  projectId: z.string().min(1).max(128),
  assetId: z.string().min(1).max(128),
})
const sourceParamsSchema = z.object({ token: z.string().min(10).max(4_000) })
const portraitPreviewParamsSchema = z.object({ assetId: z.string().min(1).max(128) })
const bindSchema = z.object({ providerAssetId: z.string().trim().min(1).max(128) })
const validationSessionParamsSchema = z.object({ sessionId: z.string().uuid() })
const listPortraitsQuerySchema = z.object({
  groupType: z.enum(['AIGC', 'LivenessFace']).default('LivenessFace'),
})

export async function registerTrustedAssetRoutes(
  app: FastifyInstance,
  service: TrustedAssetService,
): Promise<void> {
  app.get('/trusted-assets/configuration', async () => service.configuration())

  app.get(
    '/trusted-assets/portraits',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request) => {
      const query = parse(listPortraitsQuerySchema, request.query)
      return service.listPortraits(query.groupType, request.principal!)
    },
  )

  app.get('/trusted-assets/source/:token', async (request, reply) => {
    const params = parse(sourceParamsSchema, request.params)
    const source = await service.readPublicSource(params.token)
    return reply.header('Cache-Control', 'private, no-store').type(source.contentType).send(source.content)
  })

  app.get(
    '/trusted-assets/portraits/:assetId/preview',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request, reply) => {
      const params = parse(portraitPreviewParamsSchema, request.params)
      const preview = await service.preview(params.assetId, request.principal!)
      return reply
        .header('Cache-Control', 'private, max-age=300')
        .type(preview.contentType)
        .send(preview.content)
    },
  )

  app.post(
    '/projects/:projectId/assets/:assetId/trusted-portrait/validation-session',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request, reply) => {
      const params = parse(assetParamsSchema, request.params)
      return reply
        .code(201)
        .send(await service.createValidationSession(params.projectId, params.assetId, request.principal!))
    },
  )

  app.get(
    '/projects/:projectId/assets/:assetId/trusted-portrait/validation-session/latest',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request) => {
      const params = parse(assetParamsSchema, request.params)
      return service.latestValidationSession(params.projectId, params.assetId, request.principal!)
    },
  )

  app.get(
    '/trusted-assets/validation-sessions/:sessionId',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request) => {
      const params = parse(validationSessionParamsSchema, request.params)
      return service.refreshValidationSession(params.sessionId, request.principal!)
    },
  )

  app.post(
    '/projects/:projectId/assets/:assetId/trusted-portrait/register',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request) => {
      const params = parse(assetParamsSchema, request.params)
      return service.registerVirtual(params.projectId, params.assetId, request.principal!)
    },
  )

  app.post(
    '/projects/:projectId/assets/:assetId/trusted-portrait/bind',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request) => {
      const params = parse(assetParamsSchema, request.params)
      const input = parse(bindSchema, request.body)
      return service.bind(params.projectId, params.assetId, input.providerAssetId, request.principal!)
    },
  )

  app.post(
    '/projects/:projectId/assets/:assetId/trusted-portrait/refresh',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request) => {
      const params = parse(assetParamsSchema, request.params)
      return service.refresh(params.projectId, params.assetId, request.principal!)
    },
  )

  app.post(
    '/projects/:projectId/trusted-portraits/refresh-processing',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request) => {
      const params = parse(z.object({ projectId: z.string().min(1).max(128) }), request.params)
      return service.refreshProcessing(params.projectId, request.principal!)
    },
  )
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(result.error))
  return result.data
}
