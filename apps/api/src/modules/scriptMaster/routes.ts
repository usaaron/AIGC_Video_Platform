import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { PERMISSIONS } from '@seqora/contracts'
import type { Principal } from '@seqora/contracts'
import type { AppConfig } from '../../config.js'
import { AppError } from '../../core/errors.js'
import { requirePermission, permissionsFor } from '../../core/auth/authorization.js'
import type { ProjectService } from '../projects/service.js'
import { parseRequest } from '../projects/routes/support.js'
import { z } from 'zod'
import { scriptMasterDeliveryRequestSchema } from './deliverySchema.js'
import { ScriptMasterDeliveryRepository } from './deliveryRepository.js'

const launchQuery = z.object({
  projectId: z.string().min(1).max(160).optional(),
})

type ScriptMasterClaims = {
  version: 1
  issuer: 'seqora'
  audience: 'script-master'
  issuedAt: number
  expiresAt: number
  tokenId: string
  tenantId: string
  actorId: string
  roles: string[]
  permissions: string[]
  projectId: string | null
}

export async function registerScriptMasterRoutes(
  app: FastifyInstance,
  config: AppConfig,
  projectService: ProjectService,
  deliveryRepository = new ScriptMasterDeliveryRepository(),
): Promise<void> {
  const hostProjectIds = new WeakMap<object, string | null>()
  const authorizeDelivery = async (request: { principal: Principal | null }) => {
    if (!request.principal) {
      if (!config.SCRIPT_MASTER_SHARED_SECRET) {
        throw new AppError(503, 'SCRIPT_MASTER_NOT_CONFIGURED', '剧本大师交接服务尚未配置')
      }
      const claims = verifyClaimsFromAuthorization(
        request as { headers?: Record<string, string | undefined> },
        config.SCRIPT_MASTER_SHARED_SECRET,
      )
      request.principal = {
        userId: claims.actorId,
        tenantId: claims.tenantId,
        organizationId: claims.tenantId,
        roles: claims.roles as Principal['roles'],
      }
      hostProjectIds.set(request, claims.projectId)
    } else {
      hostProjectIds.set(request, null)
    }
    if (!permissionsFor(request.principal).has(PERMISSIONS.PROJECT_WRITE)) {
      throw new AppError(403, 'PERMISSION_DENIED', `Missing permission: ${PERMISSIONS.PROJECT_WRITE}`)
    }
  }

  app.get('/script-master/config', { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) }, async () => ({
    enabled: Boolean(config.SCRIPT_MASTER_URL && config.SCRIPT_MASTER_SHARED_SECRET),
    configured: Boolean(config.SCRIPT_MASTER_URL),
    requiresHostToken: Boolean(config.SCRIPT_MASTER_SHARED_SECRET),
    baseUrl: config.SCRIPT_MASTER_URL || null,
    launchTtlSeconds: config.SCRIPT_MASTER_LAUNCH_TTL_SECONDS,
    deliveryContract: 'script_master_delivery.v1',
    capabilities: ['long_story_planning', 'episode_planning', 'storyboard_planning', 'export'],
  }))

  app.get(
    '/script-master/launch',
    { preHandler: requirePermission(PERMISSIONS.PROJECT_READ) },
    async (request) => {
      const { projectId } = parseRequest(launchQuery, request.query)
      const principal = request.principal!
      const project = projectId ? await projectService.workspace(projectId, principal) : null

      if (!config.SCRIPT_MASTER_URL || !config.SCRIPT_MASTER_SHARED_SECRET) {
        return {
          enabled: false,
          reason: 'not_configured',
          launchUrl: null,
          expiresAt: null,
        }
      }

      const issuedAt = Math.floor(Date.now() / 1000)
      const claims: ScriptMasterClaims = {
        version: 1,
        issuer: 'seqora',
        audience: 'script-master',
        issuedAt,
        expiresAt: issuedAt + config.SCRIPT_MASTER_LAUNCH_TTL_SECONDS,
        tokenId: randomUUID(),
        tenantId: principal.organizationId ?? principal.tenantId,
        actorId: principal.userId,
        roles: [...principal.roles],
        permissions: [...permissionsFor(principal)],
        projectId: project?.project.id ?? null,
      }
      const token = signClaims(claims, config.SCRIPT_MASTER_SHARED_SECRET)
      const launchUrl = new URL(config.SCRIPT_MASTER_URL)
      if (claims.projectId) launchUrl.searchParams.set('host_project_id', claims.projectId)
      launchUrl.hash = `host_token=${encodeURIComponent(token)}`

      return {
        enabled: true,
        reason: null,
        launchUrl: launchUrl.toString(),
        expiresAt: new Date(claims.expiresAt * 1000).toISOString(),
        project: project
          ? {
              id: project.project.id,
              name: project.project.name,
              contentType: project.project.contentType,
              episodeDurationSeconds: project.project.episodeDurationSeconds,
            }
          : null,
      }
    },
  )

  app.post(
    '/script-master/deliveries',
    { preHandler: authorizeDelivery as never },
    async (request, reply) => {
      const input = parseRequest(scriptMasterDeliveryRequestSchema, request.body ?? {})
      const scopedProjectId = hostProjectIds.get(request)
      if (scopedProjectId && scopedProjectId !== input.targetProjectId) {
        throw new AppError(403, 'PROJECT_SCOPE_DENIED', '该启动票据不能交接到此项目')
      }
      const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
      const delivery = {
        tenantId: request.principal!.tenantId,
        targetProjectId: input.targetProjectId,
        sourceProjectId: input.sourceProjectId,
        sourceRevision: input.sourceRevision,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
      }
      let existing
      try {
        existing = await deliveryRepository.begin(delivery)
      } catch {
        throw new AppError(409, 'DELIVERY_IDEMPOTENCY_CONFLICT', '该幂等键已用于另一份交接数据')
      }
      if (existing?.status === 'completed') return existing
      if (existing?.status === 'in_progress') {
        return reply
          .code(409)
          .send({ error: { code: 'DELIVERY_IN_PROGRESS', message: '该交接正在处理中，请稍后查询或重试' } })
      }
      try {
        const target = await projectService.workspace(input.targetProjectId, request.principal!)
        const episodesByNumber = new Map(
          target.scriptEpisodes.map((episode) => [episode.episodeNumber, episode]),
        )
        let importedEpisodes = 0
        let updatedEpisodes = 0
        for (const episode of input.episodes) {
          const current = episodesByNumber.get(episode.episodeNumber)
          await projectService.saveScriptEpisode(
            input.targetProjectId,
            current?.id ?? null,
            episode.content,
            request.principal!,
            episode.title,
          )
          if (current) updatedEpisodes += 1
          else importedEpisodes += 1
        }
        const receipt = await deliveryRepository.complete(delivery, { importedEpisodes, updatedEpisodes })
        return reply.code(201).send(receipt)
      } catch (error) {
        await deliveryRepository.release(delivery)
        throw error
      }
    },
  )
}

function verifyClaimsFromAuthorization(
  request: { headers?: Record<string, string | undefined> },
  secret: string,
): ScriptMasterClaims {
  const authorization = request.headers?.authorization ?? ''
  if (!authorization.startsWith('Bearer ')) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '剧本大师交接需要有效启动票据')
  }
  const token = authorization.slice('Bearer '.length).trim()
  try {
    const [encodedPayload, encodedSignature] = token.split('.')
    if (!encodedPayload || !encodedSignature) throw new Error('shape')
    const supplied = Buffer.from(encodedSignature, 'base64url')
    const expected = createHmac('sha256', secret).update(encodedPayload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new Error('signature')
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as ScriptMasterClaims
    if (
      claims.version !== 1 ||
      claims.issuer !== 'seqora' ||
      claims.audience !== 'script-master' ||
      !claims.tokenId ||
      !claims.tenantId ||
      !claims.actorId ||
      !Array.isArray(claims.roles) ||
      !Number.isInteger(claims.expiresAt) ||
      claims.expiresAt <= Math.floor(Date.now() / 1000)
    )
      throw new Error('claims')
    return claims
  } catch {
    throw new AppError(401, 'INVALID_SCRIPT_MASTER_TOKEN', '剧本大师启动票据无效或已过期')
  }
}

export function signClaims(claims: ScriptMasterClaims, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}
