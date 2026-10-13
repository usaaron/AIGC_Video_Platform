import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import {
  PERMISSIONS,
  scriptMasterImportRequestSchema,
  scriptMasterSurfaceSchema,
  type ScriptMasterSurface,
} from '@seqora/contracts'
import type { ScriptMasterImportRepository } from './importRepository.js'
import type { Principal } from '@seqora/contracts'
import type { AppConfig } from '../../config.js'
import { AppError } from '../../core/errors.js'
import { requirePermission, permissionsFor } from '../../core/auth/authorization.js'
import type { ProjectService } from '../projects/service.js'
import {
  isStandaloneProjectId,
  rejectStandaloneProjectReferences,
  STANDALONE_PROJECT_PREFIX,
} from '../projects/projectSurface.js'
import { parseRequest } from '../projects/routes/support.js'
import { z } from 'zod'
import { scriptMasterDeliveryRequestSchema } from './deliverySchema.js'
import { ScriptMasterDeliveryRepository } from './deliveryRepository.js'
import { normalizeScriptMasterProjectContext } from './projectContext.js'

const launchQuery = z.object({
  projectId: z.string().min(1).max(160).optional(),
  surface: scriptMasterSurfaceSchema.optional(),
  // `module` was used by the first host integration. Keep accepting it while
  // `surface` is the canonical protocol field shared by both applications.
  module: z.enum(['project-script', 'standalone']).optional(),
})

type ScriptMasterModule = 'project-script' | 'standalone'

function surfaceForModule(module: ScriptMasterModule): ScriptMasterSurface {
  return module === 'standalone' ? 'standalone' : 'embedded'
}

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
  surface?: ScriptMasterSurface
  module?: ScriptMasterModule
}

export async function registerScriptMasterRoutes(
  app: FastifyInstance,
  config: AppConfig,
  projectService: ProjectService,
  deliveryRepository = new ScriptMasterDeliveryRepository(),
  importRepository?: ScriptMasterImportRepository,
): Promise<void> {
  const hostScopes = new WeakMap<object, { projectId: string | null; surface: ScriptMasterSurface | null }>()
  const authorizeDelivery = async (request: {
    principal: Principal | null
    headers?: Record<string, string | undefined>
    query?: Record<string, unknown>
  }) => {
    // The delivery/import endpoints are the one intentional bridge from the
    // independent UI into the host application.  A caller that presents an
    // ordinary host principal must not be able to turn that bridge back on by
    // merely adding a standalone surface marker (and a signed embedded ticket
    // must not be paired with one either).  Keep this check at the pre-handler
    // boundary so no repository or idempotency record is touched first.
    const requestedSurface = requestSurfaceMarker(request)
    if (requestedSurface === 'standalone') {
      throw new AppError(403, 'SCRIPT_MASTER_SURFACE_DENIED', '独立剧本大师不能访问主项目交接接口')
    }
    const authorization = request.headers?.authorization ?? ''
    if (authorization.startsWith('Bearer ')) {
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
      const surface = resolveClaimsSurface(claims)
      if (requestedSurface && requestedSurface !== surface) {
        throw new AppError(403, 'SCRIPT_MASTER_SURFACE_DENIED', '启动票据范围与请求范围不一致')
      }
      hostScopes.set(request, {
        projectId: claims.projectId ?? null,
        surface,
      })
    } else if (request.principal) {
      // A browser session alone is not enough to cross the host boundary. The
      // independent app is served same-origin, so its cookies would otherwise
      // make a standalone request indistinguishable from an embedded one. Keep
      // the old cookie path only for callers that explicitly identify the host
      // surface; signed launch tickets remain the preferred protocol.
      if (requestedSurface !== 'embedded') {
        throw new AppError(
          403,
          'SCRIPT_MASTER_SURFACE_REQUIRED',
          '主项目剧本交接请求必须明确声明 embedded 范围',
        )
      }
      hostScopes.set(request, { projectId: null, surface: 'embedded' })
    } else {
      hostScopes.set(request, { projectId: null, surface: null })
    }
    if (!request.principal) {
      throw new AppError(401, 'AUTHENTICATION_REQUIRED', '剧本交接需要有效启动票据')
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
      // Fastify leaves an untyped query value on the generic request here;
      // parseRequest performs the schema validation below, while the marker
      // reader only needs the raw key/value pairs.
      const markerSurface = requestSurfaceMarker({
        headers: request.headers,
        query: request.query as Record<string, unknown>,
      })
      const { projectId, surface: querySurface, module } = parseRequest(launchQuery, request.query)
      const moduleSurface = module ? surfaceForModule(module) : undefined
      const requestedSurface = querySurface ?? markerSurface
      if (querySurface && markerSurface && querySurface !== markerSurface) {
        throw new AppError(400, 'SCRIPT_MASTER_SCOPE_CONFLICT', '剧本大师入口范围参数冲突')
      }
      if (requestedSurface && moduleSurface && requestedSurface !== moduleSurface) {
        throw new AppError(400, 'SCRIPT_MASTER_SCOPE_CONFLICT', '剧本大师入口范围参数冲突')
      }
      const surface = requestedSurface ?? moduleSurface ?? 'embedded'
      const principal = request.principal!
      const standalone = surface === 'standalone' || moduleSurface === 'standalone'
      if (standalone && projectId) {
        throw new AppError(400, 'SCRIPT_MASTER_SCOPE_CONFLICT', '独立剧本大师不能绑定主项目编号')
      }
      if (!standalone && projectId?.startsWith(STANDALONE_PROJECT_PREFIX)) {
        throw new AppError(400, 'SCRIPT_MASTER_SCOPE_CONFLICT', '主项目剧本不能使用独立剧本大师项目编号')
      }
      if (!standalone && !projectId) {
        throw new AppError(400, 'SCRIPT_MASTER_PROJECT_REQUIRED', '主项目剧本必须绑定项目')
      }
      const project = standalone ? null : await projectService.workspace(projectId!, principal)

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
        surface: standalone ? 'standalone' : 'embedded',
        module: standalone ? 'standalone' : 'project-script',
      }
      const token = signClaims(claims, config.SCRIPT_MASTER_SHARED_SECRET)
      const launchUrl = new URL(config.SCRIPT_MASTER_URL)
      if (claims.projectId) launchUrl.searchParams.set('host_project_id', claims.projectId)
      else launchUrl.searchParams.delete('host_project_id')
      launchUrl.searchParams.set('surface', standalone ? 'standalone' : 'embedded')
      launchUrl.searchParams.set('module', standalone ? 'standalone' : 'project-script')
      launchUrl.hash = `host_token=${encodeURIComponent(token)}`

      return {
        enabled: true,
        reason: null,
        surface,
        module: claims.module,
        launchUrl: launchUrl.toString(),
        expiresAt: new Date(claims.expiresAt * 1000).toISOString(),
        project: project
          ? {
              id: project.project.id,
              name: project.project.name,
              contentType: project.project.contentType,
              synopsis: project.project.synopsis,
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
      const scope = hostScopes.get(request)
      if (scope?.surface !== 'embedded') {
        throw new AppError(403, 'SCRIPT_MASTER_SURFACE_DENIED', '独立剧本大师不能写入主项目')
      }
      rejectStandaloneProjectReferences(input)
      if (scope?.projectId && scope.projectId !== input.targetProjectId) {
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
        const updateProject = (projectService as unknown as { update?: unknown }).update
        if (typeof updateProject === 'function') {
          const projectContext = normalizeScriptMasterProjectContext(
            target.project,
            input.projectContext,
            input.episodes[0]?.content,
          )
          await projectService.update(input.targetProjectId, projectContext, request.principal!)
        }
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

  app.get('/script-master/targets', { preHandler: authorizeDelivery as never }, async (request) => {
    const scope = hostScopes.get(request)
    if (scope?.surface !== 'embedded') {
      throw new AppError(403, 'SCRIPT_MASTER_SURFACE_DENIED', '独立剧本大师不能访问主项目')
    }
    const scoped = scope.projectId
    const projects = await projectService.list(request.principal!)
    return projects
      .filter(
        (project) =>
          project.ownerId === request.principal!.userId &&
          project.contentType === 'short-drama' &&
          project.status !== 'archived' &&
          (!scoped || project.id === scoped),
      )
      .map((project) => ({ id: project.id, name: project.name }))
  })
  app.post(
    '/script-master/imports/preview',
    { preHandler: authorizeDelivery as never, bodyLimit: 32 * 1024 * 1024 },
    async (request) => {
      const input = parseRequest(scriptMasterImportRequestSchema, request.body ?? {})
      const scope = hostScopes.get(request)
      if (scope?.surface !== 'embedded')
        throw new AppError(403, 'SCRIPT_MASTER_SURFACE_DENIED', '独立剧本大师不能访问主项目')
      rejectStandaloneProjectReferences(input)
      if (scope.projectId && scope.projectId !== input.targetProjectId)
        throw new AppError(403, 'PROJECT_SCOPE_DENIED', '该启动票据不能访问此项目')
      if (!importRepository) throw new AppError(503, 'IMPORT_NOT_CONFIGURED', '批量导入暂不可用')
      return importRepository.preview(input, request.principal!)
    },
  )
  app.post(
    '/script-master/imports',
    { preHandler: authorizeDelivery as never, bodyLimit: 32 * 1024 * 1024 },
    async (request, reply) => {
      const input = parseRequest(scriptMasterImportRequestSchema, request.body ?? {})
      const scope = hostScopes.get(request)
      if (scope?.surface !== 'embedded') {
        throw new AppError(403, 'SCRIPT_MASTER_SURFACE_DENIED', '独立剧本大师不能写入主项目')
      }
      rejectStandaloneProjectReferences(input)
      const scoped = scope.projectId
      if (scoped && scoped !== input.targetProjectId)
        throw new AppError(403, 'PROJECT_SCOPE_DENIED', '该启动票据不能交接到此项目')
      if (!importRepository) throw new AppError(503, 'IMPORT_NOT_CONFIGURED', '批量导入暂不可用')
      return reply.code(201).send(await importRepository.import(input, request.principal!))
    },
  )
}

function requestSurfaceMarker(request: {
  headers?: Record<string, string | string[] | undefined>
  query?: unknown
}): ScriptMasterSurface | null {
  const markers: ScriptMasterSurface[] = []
  const header = Object.entries(request.headers ?? {}).find(
    ([key]) => key.toLowerCase() === 'x-script-master-surface',
  )?.[1]
  const headerValues = Array.isArray(header) ? header : [header]
  for (const item of headerValues) {
    if (typeof item !== 'string' || !item.trim()) continue
    const normalized = item.trim().toLowerCase()
    const value = normalized === 'project-script' ? 'embedded' : normalized
    if (!scriptMasterSurfaceSchema.safeParse(value).success) {
      throw new AppError(400, 'SCRIPT_MASTER_SCOPE_INVALID', '剧本大师请求范围无效')
    }
    markers.push(value as ScriptMasterSurface)
  }
  const query =
    request.query && typeof request.query === 'object' ? (request.query as Record<string, unknown>) : {}
  for (const [key, raw] of Object.entries(query)) {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey !== 'surface' && normalizedKey !== 'module') continue
    const values = Array.isArray(raw) ? raw : [raw]
    for (const item of values) {
      if (typeof item !== 'string' || !item.trim()) continue
      const normalized = item.trim().toLowerCase()
      const value =
        normalizedKey === 'module' ? (normalized === 'project-script' ? 'embedded' : normalized) : normalized
      if (!scriptMasterSurfaceSchema.safeParse(value).success) {
        throw new AppError(400, 'SCRIPT_MASTER_SCOPE_INVALID', '剧本大师请求范围无效')
      }
      markers.push(value as ScriptMasterSurface)
    }
  }
  if (!markers.length) return null
  if (markers.some((marker) => marker !== markers[0])) {
    throw new AppError(400, 'SCRIPT_MASTER_SCOPE_CONFLICT', '剧本大师请求范围参数冲突')
  }
  return markers[0] ?? null
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
      (claims.projectId !== undefined &&
        claims.projectId !== null &&
        (typeof claims.projectId !== 'string' ||
          claims.projectId.length < 1 ||
          claims.projectId.length > 160)) ||
      (claims.module !== undefined && claims.module !== 'project-script' && claims.module !== 'standalone') ||
      (claims.surface !== undefined && !scriptMasterSurfaceSchema.safeParse(claims.surface).success) ||
      !Number.isInteger(claims.expiresAt) ||
      claims.expiresAt <= Math.floor(Date.now() / 1000)
    )
      throw new Error('claims')
    resolveClaimsSurface(claims)
    return claims
  } catch {
    throw new AppError(401, 'INVALID_SCRIPT_MASTER_TOKEN', '剧本大师启动票据无效或已过期')
  }
}

function resolveClaimsSurface(claims: ScriptMasterClaims): ScriptMasterSurface {
  const projectId = claims.projectId ?? null
  const fromSurface = claims.surface
  const fromModule = claims.module ? surfaceForModule(claims.module) : undefined
  if (fromSurface && fromModule && fromSurface !== fromModule) throw new Error('scope')
  const surface = fromSurface ?? fromModule ?? (projectId ? 'embedded' : 'standalone')
  // An independent ticket must never carry a host project binding, and an
  // explicitly embedded ticket must always name its target project.
  if (surface === 'standalone' && projectId !== null) throw new Error('scope')
  if (surface === 'embedded' && projectId !== null && isStandaloneProjectId(projectId))
    throw new Error('scope')
  if (surface === 'embedded' && projectId === null && (fromSurface || fromModule)) throw new Error('scope')
  return surface
}

export function signClaims(claims: ScriptMasterClaims, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}
