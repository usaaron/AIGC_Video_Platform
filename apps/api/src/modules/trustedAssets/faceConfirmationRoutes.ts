import { faceConfirmationRequestSchema, PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../core/auth/authorization.js'
import { assetParams, parseRequest } from '../projects/routes/support.js'
import type { FaceConfirmationService } from './faceConfirmationService.js'

export function registerFaceConfirmationRoutes(app: FastifyInstance, service: FaceConfirmationService): void {
  app.post(
    '/projects/:projectId/assets/:assetId/face-confirmation',
    {
      preHandler: [
        requirePermission(PERMISSIONS.ASSET_WRITE),
        requirePermission(PERMISSIONS.GENERATION_TASK_CREATE),
      ],
    },
    (request) => {
      const { projectId, assetId } = parseRequest(assetParams, request.params)
      return service.confirm(
        projectId,
        assetId,
        parseRequest(faceConfirmationRequestSchema, request.body),
        request.principal!,
        request.id,
      )
    },
  )
}
