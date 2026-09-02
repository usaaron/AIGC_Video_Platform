import { createAssetSchema, PERMISSIONS, updateAssetSchema } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../../core/auth/authorization.js'
import type { ProjectService } from '../service.js'
import { assetParams, parseRequest, projectParams } from './support.js'

export function registerProjectAssetRoutes(app: FastifyInstance, service: ProjectService): void {
  app.post(
    '/projects/:projectId/assets',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request, reply) => {
      const { projectId } = parseRequest(projectParams, request.params)
      const asset = await service.createAsset(
        projectId,
        parseRequest(createAssetSchema, request.body),
        request.principal!,
      )
      return reply.code(201).send(asset)
    },
  )
  app.patch(
    '/projects/:projectId/assets/:assetId',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    (request) => {
      const { projectId, assetId } = parseRequest(assetParams, request.params)
      return service.updateAsset(
        projectId,
        assetId,
        parseRequest(updateAssetSchema, request.body),
        request.principal!,
      )
    },
  )
  app.delete(
    '/projects/:projectId/assets/:assetId',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request, reply) => {
      const { projectId, assetId } = parseRequest(assetParams, request.params)
      await service.deleteAsset(projectId, assetId, request.principal!)
      return reply.code(204).send()
    },
  )
}
