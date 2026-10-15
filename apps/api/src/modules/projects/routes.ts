import {
  createAssetSchema,
  createProjectCommentSchema,
  createProjectSchema,
  createProjectShareSchema,
  createShotSchema,
  PERMISSIONS,
  reviewProjectCommentSchema,
  updateAssetSchema,
  updateProjectShareSchema,
  updateProjectSchema,
  updateShotSchema,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { ProjectService } from './service.js'

const projectParams = z.object({ projectId: z.string().min(1) })
const assetParams = projectParams.extend({ assetId: z.string().min(1) })
const shotParams = projectParams.extend({ shotId: z.string().min(1) })
const shareParams = projectParams.extend({ shareId: z.string().min(1) })
const commentParams = projectParams.extend({ commentId: z.string().min(1) })

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(result.error))
  return result.data
}

export async function registerProjectRoutes(app: FastifyInstance, service: ProjectService): Promise<void> {
  app.get('/projects', { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) }, (request) =>
    service.list(request.principal!),
  )
  app.post(
    '/projects',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.create(parse(createProjectSchema, request.body), request.principal!)),
  )
  app.get('/projects/:projectId', { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) }, (request) =>
    service.workspace(parse(projectParams, request.params).projectId, request.principal!),
  )
  app.patch('/projects/:projectId', { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) }, (request) =>
    service.update(
      parse(projectParams, request.params).projectId,
      parse(updateProjectSchema, request.body),
      request.principal!,
    ),
  )
  app.post(
    '/projects/:projectId/versions',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => service.saveVersion(parse(projectParams, request.params).projectId, request.principal!),
  )

  app.post(
    '/projects/:projectId/shares',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_SHARE_MANAGE) },
    async (request, reply) => {
      const { projectId } = parse(projectParams, request.params)
      const share = await service.createShare(
        projectId,
        parse(createProjectShareSchema, request.body),
        request.principal!,
      )
      return reply.code(201).send(share)
    },
  )
  app.patch(
    '/projects/:projectId/shares/:shareId',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_SHARE_MANAGE) },
    (request) => {
      const { projectId, shareId } = parse(shareParams, request.params)
      return service.updateShare(
        projectId,
        shareId,
        parse(updateProjectShareSchema, request.body),
        request.principal!,
      )
    },
  )
  app.post(
    '/projects/:projectId/comments',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    async (request, reply) => {
      const { projectId } = parse(projectParams, request.params)
      const comment = await service.createComment(
        projectId,
        parse(createProjectCommentSchema, request.body),
        request.principal!,
      )
      return reply.code(201).send(comment)
    },
  )
  app.post(
    '/projects/:projectId/comments/:commentId/review',
    { preHandler: requirePermission(PERMISSIONS.COMMENT_APPROVE) },
    (request) => {
      const { projectId, commentId } = parse(commentParams, request.params)
      return service.reviewComment(
        projectId,
        commentId,
        parse(reviewProjectCommentSchema, request.body),
        request.principal!,
      )
    },
  )

  app.post(
    '/projects/:projectId/assets',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request, reply) => {
      const { projectId } = parse(projectParams, request.params)
      const asset = await service.createAsset(
        projectId,
        parse(createAssetSchema, request.body),
        request.principal!,
      )
      return reply.code(201).send(asset)
    },
  )
  app.patch(
    '/projects/:projectId/assets/:assetId',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    (request) => {
      const { projectId, assetId } = parse(assetParams, request.params)
      return service.updateAsset(
        projectId,
        assetId,
        parse(updateAssetSchema, request.body),
        request.principal!,
      )
    },
  )
  app.delete(
    '/projects/:projectId/assets/:assetId',
    { preHandler: requirePermission(PERMISSIONS.ASSET_WRITE) },
    async (request, reply) => {
      const { projectId, assetId } = parse(assetParams, request.params)
      await service.deleteAsset(projectId, assetId, request.principal!)
      return reply.code(204).send()
    },
  )

  app.post(
    '/projects/:projectId/shots',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    async (request, reply) => {
      const { projectId } = parse(projectParams, request.params)
      return reply
        .code(201)
        .send(await service.createShot(projectId, parse(createShotSchema, request.body), request.principal!))
    },
  )
  app.patch(
    '/projects/:projectId/shots/:shotId',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => {
      const { projectId, shotId } = parse(shotParams, request.params)
      return service.updateShot(projectId, shotId, parse(updateShotSchema, request.body), request.principal!)
    },
  )
  app.post(
    '/projects/:projectId/shots/generate',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => service.generateShots(parse(projectParams, request.params).projectId, request.principal!),
  )
}
