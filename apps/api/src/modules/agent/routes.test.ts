import type { Principal } from '@seqora/contracts'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../core/errors.js'
import { noopTaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { AgentRunRepository } from './repository.js'
import { registerAgentRoutes } from './routes.js'
import { AgentService } from './service.js'

const member: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

describe('Agent HTTP routes', () => {
  let store: AppStore
  let app: ReturnType<typeof Fastify>
  let availableCredits: number

  beforeEach(async () => {
    availableCredits = 10_000
    store = new AppStore(null)
    await store.initialize()
    const repository = new AgentRunRepository(null, store)
    const creditLedger = {
      summary: async () => ({ credits: availableCredits }),
    } as unknown as CreditLedger
    const service = new AgentService(repository, noopTaskDispatcher, creditLedger)

    app = Fastify()
    app.decorateRequest('principal', null)
    app.addHook('onRequest', async (request) => {
      const userId = request.headers['x-test-user']
      if (typeof userId !== 'string') return
      request.principal = {
        ...member,
        userId,
        roles: request.headers['x-test-role'] === 'admin' ? ['admin'] : ['member'],
      }
    })
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
      }
      throw error
    })
    await app.register(async (api) => registerAgentRoutes(api, service), { prefix: '/api/v1' })
  })

  afterEach(async () => {
    await app.close()
  })

  it('requires authentication and generation permission', async () => {
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/v1/agent/runs' })
    expect(unauthenticated.statusCode).toBe(401)

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/runs',
      headers: { 'x-test-user': 'user-admin', 'x-test-role': 'admin' },
    })
    expect(forbidden.statusCode).toBe(403)
  })

  it('keeps runs private to their creator and confirms idempotently', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/plan',
      headers: { 'x-test-user': member.userId },
      payload: { prompt: '做个30秒竖屏电影CG短片，女孩在末班地铁发现时间循环' },
    })
    expect(created.statusCode).toBe(200)
    const runId = created.json().id as string

    const hidden = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/runs/${runId}`,
      headers: { 'x-test-user': 'user-owner' },
    })
    expect(hidden.statusCode).toBe(404)

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${runId}/confirm`,
      headers: { 'x-test-user': member.userId },
      payload: { clientRequestId: 'agent-route-confirm' },
    })
    const replayed = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${runId}/confirm`,
      headers: { 'x-test-user': member.userId },
      payload: { clientRequestId: 'agent-route-confirm' },
    })
    expect(first.statusCode).toBe(200)
    expect(replayed.statusCode).toBe(200)
    expect(replayed.json().projectId).toBe(first.json().projectId)
    expect(
      store.read((state) => state.projects.filter((project) => project.id === first.json().projectId)),
    ).toHaveLength(1)
  })

  it('keeps parameter controls out of the story and blocks an unaffordable run', async () => {
    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/plan',
      headers: { 'x-test-user': member.userId },
      payload: { prompt: '女孩在末班地铁醒来' },
    })
    const runId = draft.json().id as string
    const updated = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/plan',
      headers: { 'x-test-user': member.userId },
      payload: {
        prompt: '确认制作参数',
        runId,
        overrides: {
          contentType: 'short-film',
          durationSeconds: 30,
          aspectRatio: '9:16',
          visualStyle: 'cinematic-cg',
          storyBrief: draft.json().plan.storyBrief,
        },
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().originalPrompt).toBe('女孩在末班地铁醒来')
    expect(updated.json().plan.storyBrief).not.toContain('确认制作参数')

    availableCredits = 0
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${runId}/confirm`,
      headers: { 'x-test-user': member.userId },
      payload: { clientRequestId: 'unaffordable-run' },
    })
    expect(denied.statusCode).toBe(402)
    expect(denied.json()).toMatchObject({ error: { code: 'INSUFFICIENT_CREDITS' } })
    expect(updated.json().projectId).toBeNull()
  })
})
