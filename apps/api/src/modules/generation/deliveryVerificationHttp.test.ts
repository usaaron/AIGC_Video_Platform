import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { deliveryContractSchema } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import { GenerationTaskRepository } from './repository.js'
import { GenerationService } from './service.js'
import { registerGenerationRoutes } from './routes.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import { freezeDeliveryContract } from './deliveryContractFreeze.js'

describe('delivery verification HTTP boundary', () => {
  it('reads an authorized scoped snapshot without writing or dispatching', async () => {
    const principal = {
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      roles: ['member'] as ['member'],
    }
    const store = new AppStore(null)
    await store.initialize()
    const task = buildQueuedGenerationTask(
      {
        clientRequestId: 'delivery-verification-http',
        projectId: 'project-midnight-film',
        provider: 'seedance',
        kind: 'video',
        label: '验证查询测试',
        estimatedCredits: 18,
      },
      principal,
      '2026-10-13T00:00:00.000Z',
    )
    const frozen = freezeDeliveryContract(
      deliveryContractSchema.parse({
        version: 'seqora.delivery.v1',
        intent: { mode: 'shot', projectId: task.projectId },
        expectedArtifact: { type: 'video', count: 1 },
        must: [{ id: 'task-completed', statement: '任务完成', source: 'system' }],
      }),
      '2026-10-13T00:01:00.000Z',
    )
    const completed = {
      ...task,
      status: 'completed' as const,
      resultUrl: '/api/v1/generation/tasks/task-1/content',
      metadata: { ...task.metadata, deliveryContract: frozen },
      updatedAt: '2026-10-13T00:02:00.000Z',
    }
    await store.mutate((state) => {
      state.tasks = [completed]
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
    const url = `/generation/tasks/${task.id}/delivery-verification`
    try {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
      const response = await app.inject({ method: 'GET', url, headers: { 'x-test-user': 'member' } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        taskId: task.id,
        contract: { contractHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
        verification: {
          status: 'satisfied',
          satisfiedRequirementIds: ['task-completed'],
        },
      })
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})
