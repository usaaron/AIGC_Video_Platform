import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'
import { GenerationService } from './service.js'
import { registerGenerationRoutes } from './routes.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'

describe('delivery contract HTTP boundary', () => {
  it('authenticates, validates and persists one frozen contract without dispatching', async () => {
    const principal = {
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      roles: ['member'] as ['member'],
    }
    const store = new AppStore(null)
    await store.initialize()
    const task = buildQueuedGenerationTask(
      {
        clientRequestId: 'delivery-contract-http',
        projectId: 'project-midnight-film',
        provider: 'seedance',
        kind: 'video',
        label: '合同 HTTP 测试',
        estimatedCredits: 18,
      },
      principal,
      '2026-10-13T00:00:00.000Z',
    )
    await store.mutate((state) => {
      state.tasks = [task]
    })
    const dispatch = vi.fn()
    const service = new GenerationService(new GenerationTaskRepository(store), {
      dispatch,
    } as unknown as TaskDispatcher)
    const app = Fastify()
    app.addHook('onRequest', async (request) => {
      if (request.headers['x-test-user'] === 'member') request.principal = principal
    })
    await registerGenerationRoutes(app, service)
    const url = `/generation/tasks/${task.id}/delivery-contract`
    const input = {
      expectedUpdatedAt: task.updatedAt,
      contract: {
        version: 'seqora.delivery.v1',
        intent: { mode: 'shot', projectId: task.projectId, shotIds: ['shot-1'] },
        expectedArtifact: { type: 'video', count: 1 },
        must: [{ id: 'media-url', statement: '视频候选可读', source: 'provider' }],
      },
    }
    try {
      expect((await app.inject({ method: 'POST', url, payload: input })).statusCode).toBe(401)
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { 'x-test-user': 'member' },
            payload: {
              ...input,
              contract: { ...input.contract, expectedArtifact: { type: 'video', count: 0 } },
            },
          })
        ).statusCode,
      ).toBe(400)
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { 'x-test-user': 'member' },
        payload: input,
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().metadata.deliveryContract).toMatchObject({
        contractHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})
