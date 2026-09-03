import { createProjectSchema, PERMISSIONS, updateProjectSchema } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../../core/auth/authorization.js'
import { sessionMetadataFromRequest } from '../../../core/auth/requestMetadata.js'
import type { ProjectService } from '../service.js'
import { parseRequest, projectParams } from './support.js'
import { createHash } from 'node:crypto'

export function registerProjectCoreRoutes(app: FastifyInstance, service: ProjectService): void {
  app.get('/projects', { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) }, (request) =>
    service.list(request.principal!),
  )
  app.get(
    '/projects/:projectId/workspace/version',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    async (request, reply) => {
      const projectId = parseRequest(projectParams, request.params).projectId
      const snapshot = await service.workspaceVersion(projectId, request.principal!)
      const etag = `"${createHash('sha256').update(snapshot.version).digest('base64url')}"`
      reply.header('Cache-Control', 'private, no-cache').header('ETag', etag)
      if (request.headers['if-none-match']?.split(',').some((value) => value.trim() === etag)) {
        return reply.code(304).send()
      }
      return { version: snapshot.version }
    },
  )
  app.post(
    '/projects',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.create(parseRequest(createProjectSchema, request.body), request.principal!)),
  )
  app.get('/projects/:projectId', { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) }, (request) =>
    service.workspace(parseRequest(projectParams, request.params).projectId, request.principal!),
  )
  app.patch('/projects/:projectId', { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) }, (request) =>
    service.update(
      parseRequest(projectParams, request.params).projectId,
      parseRequest(updateProjectSchema, request.body),
      request.principal!,
    ),
  )
  app.delete(
    '/projects/:projectId',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    async (request, reply) => {
      await service.archive(
        parseRequest(projectParams, request.params).projectId,
        request.principal!,
        sessionMetadataFromRequest(request),
      )
      return reply.code(204).send()
    },
  )
  app.post(
    '/projects/:projectId/versions',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) =>
      service.saveVersion(parseRequest(projectParams, request.params).projectId, request.principal!),
  )
}
