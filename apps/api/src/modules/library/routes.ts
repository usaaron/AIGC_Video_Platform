import {
  createAssetLibraryItemSchema,
  createAssetLibraryItemVersionSchema,
  importAssetLibraryItemSchema,
  listAssetLibraryItemsQuerySchema,
  PERMISSIONS,
  saveProjectAssetToLibrarySchema,
  updateAssetLibraryItemSchema,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { AssetLibraryService } from './service.js'

const itemParams = z.object({ itemId: z.string().min(1).max(128) })
const versionParams = z.object({
  itemId: z.string().min(1).max(128),
  version: z.coerce.number().int().positive().max(100_000),
})
const projectParams = z.object({ projectId: z.string().min(1).max(128) })
const projectAssetParams = z.object({
  projectId: z.string().min(1).max(128),
  assetId: z.string().min(1).max(128),
})

export async function registerLibraryRoutes(
  app: FastifyInstance,
  service: AssetLibraryService,
): Promise<void> {
  app.get(
    '/library/items',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_READ) },
    async (request) => {
      const query = listAssetLibraryItemsQuerySchema.safeParse(request.query)
      if (!query.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(query.error))
      return service.list(query.data, request.principal!)
    },
  )

  app.post(
    '/library/items',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_WRITE) },
    async (request, reply) => {
      const parsed = createAssetLibraryItemSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return reply.code(201).send(await service.create(parsed.data, request.principal!))
    },
  )

  app.get(
    '/library/stats',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_READ) },
    async (request) => service.stats(request.principal!),
  )

  app.get(
    '/library/duplicates',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_READ) },
    async (request) => service.duplicates(request.principal!),
  )

  app.post(
    '/library/dedupe',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_WRITE) },
    async (request) => service.dedupe(request.principal!),
  )

  app.get(
    '/library/items/:itemId',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_READ) },
    async (request) => {
      const params = itemParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      return service.get(params.data.itemId, request.principal!)
    },
  )

  app.get(
    '/library/items/:itemId/versions',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_READ) },
    async (request) => {
      const params = itemParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      return service.listVersions(params.data.itemId, request.principal!)
    },
  )

  app.post(
    '/library/items/:itemId/versions',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_WRITE) },
    async (request, reply) => {
      const params = itemParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const parsed = createAssetLibraryItemVersionSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return reply.code(201).send(await service.addVersion(params.data.itemId, parsed.data, request.principal!))
    },
  )

  app.get(
    '/library/items/:itemId/versions/:version/download',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_READ) },
    async (request, reply) => {
      const params = versionParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const content = await service.readVersionContent(
        params.data.itemId,
        params.data.version,
        request.principal!,
      )
      return reply
        .header('Cache-Control', 'private, max-age=60')
        .header('Content-Disposition', contentDisposition(content.fileName))
        .type(content.contentType)
        .send(content.content)
    },
  )

  app.patch(
    '/library/items/:itemId',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_WRITE) },
    async (request) => {
      const params = itemParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const parsed = updateAssetLibraryItemSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return service.update(params.data.itemId, parsed.data, request.principal!)
    },
  )

  app.delete(
    '/library/items/:itemId',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_WRITE) },
    async (request, reply) => {
      const params = itemParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      await service.delete(params.data.itemId, request.principal!)
      return reply.code(204).send()
    },
  )

  app.post(
    '/library/items/:itemId/restore',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_WRITE) },
    async (request) => {
      const params = itemParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      return service.restore(params.data.itemId, request.principal!)
    },
  )

  app.delete(
    '/library/items/:itemId/permanent',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_WRITE) },
    async (request, reply) => {
      const params = itemParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      await service.permanentDelete(params.data.itemId, request.principal!)
      return reply.code(204).send()
    },
  )

  app.get(
    '/library/items/:itemId/download',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_READ) },
    async (request, reply) => {
      const params = itemParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const content = await service.readContent(params.data.itemId, request.principal!, false)
      return reply
        .header('Cache-Control', 'private, max-age=60')
        .header('Content-Disposition', contentDisposition(content.fileName))
        .type(content.contentType)
        .send(content.content)
    },
  )

  app.get(
    '/library/items/:itemId/preview',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_READ) },
    async (request, reply) => {
      const params = itemParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const content = await service.readContent(params.data.itemId, request.principal!, true)
      return reply.header('Cache-Control', 'private, max-age=300').type(content.contentType).send(content.content)
    },
  )

  app.get(
    '/library/items/:itemId/package',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_READ) },
    async (request, reply) => {
      const params = itemParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const content = await service.readPackage(params.data.itemId, request.principal!)
      return reply
        .header('Cache-Control', 'private, max-age=60')
        .header('Content-Disposition', contentDisposition(content.fileName))
        .type(content.contentType)
        .send(content.content)
    },
  )

  app.get(
    '/projects/:projectId/library/items',
    { preHandler: requirePermission(PERMISSIONS.ASSET_LIBRARY_READ) },
    async (request) => {
      const params = projectParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const query = listAssetLibraryItemsQuerySchema.safeParse(request.query)
      if (!query.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(query.error))
      return service.list({ ...query.data, sourceProjectId: params.data.projectId }, request.principal!)
    },
  )

  app.post(
    '/projects/:projectId/library/import',
    {
      preHandler: [
        requirePermission(PERMISSIONS.ASSET_LIBRARY_READ),
        requirePermission(PERMISSIONS.PROJECT_WRITE),
      ],
    },
    async (request, reply) => {
      const params = projectParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const parsed = importAssetLibraryItemSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return reply.code(201).send(await service.importToProject(params.data.projectId, parsed.data, request.principal!))
    },
  )

  app.post(
    '/projects/:projectId/assets/:assetId/save-to-library',
    {
      preHandler: [
        requirePermission(PERMISSIONS.ASSET_LIBRARY_WRITE),
        requirePermission(PERMISSIONS.ASSET_WRITE),
      ],
    },
    async (request, reply) => {
      const params = projectAssetParams.safeParse(request.params)
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(params.error))
      const parsed = saveProjectAssetToLibrarySchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      return reply
        .code(201)
        .send(
          await service.saveProjectAsset(
            params.data.projectId,
            params.data.assetId,
            parsed.data,
            request.principal!,
          ),
        )
    },
  )
}

function contentDisposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
}
