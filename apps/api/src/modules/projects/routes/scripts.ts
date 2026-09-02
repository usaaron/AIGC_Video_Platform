import {
  enrichScriptRequestSchema,
  generateScriptAssetSuggestionsRequestSchema,
  generateScriptRequestSchema,
  PERMISSIONS,
  reviewScriptRequestSchema,
  saveScriptEpisodeRequestSchema,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { requirePermission } from '../../../core/auth/authorization.js'
import type { ProjectService } from '../service.js'
import { episodeParams, parseRequest, projectParams } from './support.js'

export function registerProjectScriptRoutes(app: FastifyInstance, service: ProjectService): void {
  app.post(
    '/projects/:projectId/script/asset-suggestions',
    {
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
      preHandler: requirePermission(PERMISSIONS.PROJECT_READ),
    },
    (request) => {
      const input = parseRequest(generateScriptAssetSuggestionsRequestSchema, request.body ?? {})
      return service.suggestScriptAssets(
        parseRequest(projectParams, request.params).projectId,
        input.script,
        input.direction,
        request.principal!,
        undefined,
        undefined,
        input.strategy,
      )
    },
  )
  app.post(
    '/projects/:projectId/script/generate',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => {
      const input = parseRequest(generateScriptRequestSchema, request.body ?? {})
      return service.generateScript(
        parseRequest(projectParams, request.params).projectId,
        input.draft,
        input.direction,
        input.mode,
        input.segment,
        input.productionMode,
        input.episodeMinutes,
        input.clientRequestId ?? randomUUID(),
        request.principal!,
        input.model,
        input.revisionNote,
        'direct',
        input.episodeDurationSeconds,
        undefined,
        undefined,
        input.episodeId,
      )
    },
  )
  app.post(
    '/projects/:projectId/script/review',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    (request) => {
      const input = parseRequest(reviewScriptRequestSchema, request.body ?? {})
      return service.reviewScript(
        parseRequest(projectParams, request.params).projectId,
        input.script,
        input.direction,
        input.clientRequestId ?? randomUUID(),
        request.principal!,
        input.model,
      )
    },
  )
  app.post(
    '/projects/:projectId/script/enrich',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => {
      const input = parseRequest(enrichScriptRequestSchema, request.body ?? {})
      return service.enrichScript(
        parseRequest(projectParams, request.params).projectId,
        input.script,
        input.direction,
        input.productionMode,
        input.episodeMinutes,
        input.clientRequestId ?? randomUUID(),
        request.principal!,
        input.model,
        input.revisionNote,
        'direct',
        input.episodeDurationSeconds,
        undefined,
        undefined,
        input.episodeId,
      )
    },
  )
  app.post(
    '/projects/:projectId/script/episodes/save',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    (request) => {
      const input = parseRequest(saveScriptEpisodeRequestSchema, request.body ?? {})
      return service.saveScriptEpisode(
        parseRequest(projectParams, request.params).projectId,
        input.episodeId ?? null,
        input.content,
        request.principal!,
        input.title,
      )
    },
  )
  app.delete(
    '/projects/:projectId/script/episodes/:episodeId',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    async (request, reply) => {
      const { projectId, episodeId } = parseRequest(episodeParams, request.params)
      await service.deleteLastScriptEpisode(projectId, episodeId, request.principal!)
      return reply.code(204).send()
    },
  )
  app.delete(
    '/projects/:projectId/script/episodes',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_WRITE) },
    async (request, reply) => {
      await service.clearScriptEpisodes(
        parseRequest(projectParams, request.params).projectId,
        request.principal!,
      )
      return reply.code(204).send()
    },
  )
}
