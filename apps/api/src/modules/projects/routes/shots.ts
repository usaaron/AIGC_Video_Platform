import {
  autoSplitShotsRequestSchema,
  createShotSchema,
  generateShotsRequestSchema,
  PERMISSIONS,
  updateShotSchema,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../../core/auth/authorization.js'
import type { ProjectService } from '../service.js'
import { parseRequest, projectParams, shotParams } from './support.js'

export function registerProjectShotRoutes(app: FastifyInstance, service: ProjectService): void {
  app.post(
    '/projects/:projectId/shots',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    async (request, reply) => {
      const { projectId } = parseRequest(projectParams, request.params)
      return reply
        .code(201)
        .send(
          await service.createShot(
            projectId,
            parseRequest(createShotSchema, request.body),
            request.principal!,
          ),
        )
    },
  )
  app.patch(
    '/projects/:projectId/shots/:shotId',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => {
      const { projectId, shotId } = parseRequest(shotParams, request.params)
      return service.updateShot(
        projectId,
        shotId,
        parseRequest(updateShotSchema, request.body),
        request.principal!,
      )
    },
  )
  app.delete(
    '/projects/:projectId/shots/:shotId',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    async (request, reply) => {
      const { projectId, shotId } = parseRequest(shotParams, request.params)
      await service.deleteShot(projectId, shotId, request.principal!)
      return reply.code(204).send()
    },
  )
  app.post(
    '/projects/:projectId/shots/generate',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) =>
      service.generateShots(
        parseRequest(projectParams, request.params).projectId,
        parseRequest(generateShotsRequestSchema, request.body ?? {}),
        request.principal!,
      ),
  )
  app.post(
    '/projects/:projectId/shots/auto-episodes',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) =>
      service.autoSplitShotEpisodes(
        parseRequest(projectParams, request.params).projectId,
        parseRequest(autoSplitShotsRequestSchema, request.body ?? {}),
        request.principal!,
      ),
  )
}
