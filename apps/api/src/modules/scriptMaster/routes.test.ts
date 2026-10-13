import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../../config.js'
import { AppError } from '../../core/errors.js'
import type { Principal } from '@seqora/contracts'
import { registerScriptMasterRoutes } from './routes.js'

const member: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

const testApps: Array<ReturnType<typeof Fastify>> = []

describe('Script Master host routes', () => {
  afterEach(async () => {
    await Promise.all(testApps.splice(0).map((app) => app.close()))
  })

  it('fails closed when the independent service is not configured', async () => {
    const app = await buildTestApp(loadConfig({ NODE_ENV: 'test' }))
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/script-master/config',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ enabled: false, configured: false })
  })

  it('issues a scoped fragment token only after checking the project', async () => {
    const projectService = {
      workspace: async (projectId: string, principal: Principal) => {
        expect(projectId).toBe('project-1')
        expect(principal.userId).toBe(member.userId)
        return {
          project: {
            id: projectId,
            name: '夜航项目',
            contentType: 'short-drama',
            episodeDurationSeconds: 60,
          },
        }
      },
    }
    const app = await buildTestApp(
      loadConfig({
        NODE_ENV: 'test',
        SCRIPT_MASTER_URL: 'http://127.0.0.1:3000',
        SCRIPT_MASTER_SHARED_SECRET: 'script-master-test-secret',
      }),
      projectService,
    )
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/script-master/launch?projectId=project-1',
    })

    expect(response.statusCode).toBe(200)
    const result = response.json()
    const launchUrl = new URL(result.launchUrl)
    expect(result).toMatchObject({
      enabled: true,
      project: { id: 'project-1', name: '夜航项目' },
    })
    expect(launchUrl.searchParams.get('host_project_id')).toBe('project-1')
    expect(launchUrl.searchParams.get('surface')).toBe('embedded')
    expect(launchUrl.searchParams.get('module')).toBe('project-script')
    expect(launchUrl.hash).toMatch(/^#host_token=[^.]+\.[^.]+$/)
    expect(result.surface).toBe('embedded')
  })

  it('rejects cross-surface launch requests before issuing a ticket', async () => {
    const projectService = {
      workspace: async () => ({ project: { id: 'project-1', contentType: 'short-drama' } }),
    }
    const app = await buildTestApp(
      loadConfig({
        NODE_ENV: 'test',
        SCRIPT_MASTER_URL: 'http://127.0.0.1:3000',
        SCRIPT_MASTER_SHARED_SECRET: 'script-master-test-secret',
      }),
      projectService,
    )
    for (const url of [
      '/api/v1/script-master/launch?surface=standalone&projectId=project-1',
      '/api/v1/script-master/launch?Surface=standalone&projectId=project-1',
      '/api/v1/script-master/launch?surface=embedded',
    ]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode).toBe(400)
    }
  })

  it('opens the standalone homepage without binding a main project', async () => {
    const projectService = {
      workspace: async () => ({ project: { id: 'project-1', contentType: 'short-drama' } }),
    }
    const app = await buildTestApp(
      loadConfig({
        NODE_ENV: 'test',
        SCRIPT_MASTER_URL: 'http://127.0.0.1:3000',
        SCRIPT_MASTER_SHARED_SECRET: 'script-master-test-secret',
      }),
      projectService,
    )
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/script-master/launch?surface=standalone&module=standalone',
    })

    expect(response.statusCode).toBe(200)
    const result = response.json()
    const launchUrl = new URL(result.launchUrl)
    expect(result).toMatchObject({
      enabled: true,
      surface: 'standalone',
      module: 'standalone',
      project: null,
    })
    expect(launchUrl.searchParams.get('host_project_id')).toBeNull()
    expect(launchUrl.searchParams.get('surface')).toBe('standalone')
    expect(launchUrl.searchParams.get('module')).toBe('standalone')
    expect(launchUrl.hash).toMatch(/^#host_token=[^.]+\.[^.]+$/)
  })

  it('accepts the legacy module alias but rejects conflicting scope aliases', async () => {
    const projectService = {
      workspace: async (projectId: string) => ({ project: { id: projectId, contentType: 'short-drama' } }),
    }
    const app = await buildTestApp(
      loadConfig({
        NODE_ENV: 'test',
        SCRIPT_MASTER_URL: 'http://127.0.0.1:3000',
        SCRIPT_MASTER_SHARED_SECRET: 'script-master-test-secret',
      }),
      projectService,
    )
    const legacy = await app.inject({
      method: 'GET',
      url: '/api/v1/script-master/launch?projectId=project-1&module=project-script',
    })
    expect(legacy.statusCode).toBe(200)
    expect(legacy.json().surface).toBe('embedded')
    const conflict = await app.inject({
      method: 'GET',
      url: '/api/v1/script-master/launch?surface=embedded&module=standalone',
    })
    expect(conflict.statusCode).toBe(400)
  })

  it('imports episodes and returns the same receipt for a repeated delivery', async () => {
    const saved: Array<{ episodeId: string | null; content: string; title?: string }> = []
    const projectService = {
      workspace: async () => ({
        project: { id: 'target-project', contentType: 'short-drama' },
        scriptEpisodes: [],
      }),
      saveScriptEpisode: async (
        _projectId: string,
        episodeId: string | null,
        content: string,
        _principal: Principal,
        title?: string,
      ) => {
        saved.push({ episodeId, content, ...(title !== undefined ? { title } : {}) })
        return { id: episodeId ?? 'episode-1' }
      },
    }
    const app = await buildTestApp(loadConfig({ NODE_ENV: 'test' }), projectService)
    const body = {
      targetProjectId: 'target-project',
      sourceProjectId: 'source-project',
      sourceRevision: 4,
      idempotencyKey: 'delivery-key-001',
      episodes: [
        {
          sourceEpisodeId: 'source-episode-1',
          episodeNumber: 1,
          title: '第一集',
          content: '夜。人物走进房间。',
        },
      ],
    }

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/script-master/deliveries',
      headers: { 'x-script-master-surface': 'embedded' },
      payload: body,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/script-master/deliveries',
      headers: { 'x-script-master-surface': 'embedded' },
      payload: body,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ importedEpisodes: 1, updatedEpisodes: 0, status: 'completed' })
    expect(second.json()).toEqual(first.json())
    expect(saved).toHaveLength(1)
  })

  it('rejects a standalone surface marker even on the legacy principal path', async () => {
    const saved: unknown[] = []
    const projectService = {
      workspace: async () => ({
        project: { id: 'target-project', contentType: 'short-drama' },
        scriptEpisodes: [],
      }),
      saveScriptEpisode: async (...args: unknown[]) => {
        saved.push(args)
        return { id: 'episode-1' }
      },
    }
    const app = await buildTestApp(loadConfig({ NODE_ENV: 'test' }), projectService)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/script-master/deliveries',
      headers: { 'x-script-master-surface': 'standalone' },
      payload: {
        targetProjectId: 'target-project',
        sourceProjectId: 'source-project',
        sourceRevision: 1,
        idempotencyKey: 'standalone-delivery-key',
        episodes: [],
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: '独立剧本大师不能访问主项目交接接口' })
    expect(saved).toHaveLength(0)
  })

  it('rejects a cookie-only legacy delivery without an explicit embedded marker', async () => {
    const saved: unknown[] = []
    const listed: unknown[] = []
    const projectService = {
      workspace: async () => ({
        project: { id: 'target-project', contentType: 'short-drama' },
        scriptEpisodes: [],
      }),
      list: async (...args: unknown[]) => {
        listed.push(args)
        return []
      },
      saveScriptEpisode: async (...args: unknown[]) => {
        saved.push(args)
        return { id: 'episode-1' }
      },
    }
    const app = await buildTestApp(loadConfig({ NODE_ENV: 'test' }), projectService)
    const payload = {
      targetProjectId: 'target-project',
      sourceProjectId: 'source-project',
      sourceRevision: 1,
      idempotencyKey: 'cookie-only-delivery-key',
      episodes: [],
    }
    for (const [method, url, requestPayload] of [
      ['GET', '/api/v1/script-master/targets', undefined],
      ['POST', '/api/v1/script-master/imports', payload],
      ['POST', '/api/v1/script-master/imports/preview', payload],
      ['POST', '/api/v1/script-master/deliveries', payload],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        ...(requestPayload ? { payload: requestPayload } : {}),
      })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ error: '主项目剧本交接请求必须明确声明 embedded 范围' })
    }
    expect(saved).toHaveLength(0)
    expect(listed).toHaveLength(0)
  })

  it('rejects reuse of an idempotency key for another payload', async () => {
    const projectService = {
      workspace: async () => ({
        project: { id: 'target-project', contentType: 'short-drama' },
        scriptEpisodes: [],
      }),
      saveScriptEpisode: async () => ({ id: 'episode-1' }),
    }
    const app = await buildTestApp(loadConfig({ NODE_ENV: 'test' }), projectService)
    const base = {
      targetProjectId: 'target-project',
      sourceProjectId: 'source-project',
      sourceRevision: 4,
      idempotencyKey: 'delivery-key-002',
      episodes: [
        { sourceEpisodeId: 'source-episode-1', episodeNumber: 1, title: '第一集', content: '内容一' },
      ],
    }
    await app.inject({
      method: 'POST',
      url: '/api/v1/script-master/deliveries',
      headers: { 'x-script-master-surface': 'embedded' },
      payload: base,
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/script-master/deliveries',
      headers: { 'x-script-master-surface': 'embedded' },
      payload: { ...base, episodes: [{ ...base.episodes[0], content: '内容二' }] },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: '该幂等键已用于另一份交接数据' })
  })
})

async function buildTestApp(
  config: ReturnType<typeof loadConfig>,
  projectService: { workspace: (projectId: string, principal: Principal) => Promise<unknown> } & Record<
    string,
    unknown
  > = {
    workspace: async () => ({ project: { id: 'unused' } }),
  },
) {
  const app = Fastify()
  testApps.push(app)
  app.decorateRequest('principal', null)
  app.addHook('onRequest', async (request) => {
    request.principal = member
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: error.message })
    throw error
  })
  await app.register(async (api) => registerScriptMasterRoutes(api, config, projectService as never), {
    prefix: '/api/v1',
  })
  return app
}
