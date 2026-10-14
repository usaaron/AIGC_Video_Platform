import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'
import { GenerationService } from './service.js'
import { registerGenerationRoutes } from './routes.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'

describe('rigid physics audit HTTP contract', () => {
  it('requires auth, validates the body, and never dispatches a generation task', async () => {
    const principal = { tenantId: 'tenant-seqora-demo', userId: 'user-member', roles: ['member'] as ['member'] }
    const store = new AppStore(null)
    await store.initialize()
    const task = buildQueuedGenerationTask(
      {
        clientRequestId: 'rigid-audit-http',
        projectId: 'project-midnight-film',
        provider: 'seedance',
        kind: 'video',
        label: '1-1',
        estimatedCredits: 18,
        metadata: {
          rigidPhysicsContract: { version: 'rigid-physics-v1', objects: [] },
        },
      },
      principal,
      '2026-10-11T00:00:00.000Z',
    )
    task.status = 'completed'
    task.resultUrl = '/video'
    task.metadata.generatedOutputs = [
      { view: 'single', storageKey: '1-1.mp4', contentType: 'video/mp4', size: 8 },
    ]
    await store.mutate((state) => {
      state.tasks = [task]
    })
    const dispatch = vi.fn()
    const service = new GenerationService(
      new GenerationTaskRepository(store),
      { dispatch } as unknown as TaskDispatcher,
      null,
      undefined,
      { get: vi.fn(async () => Buffer.from('video')), put: vi.fn(), delete: vi.fn() } as never,
      null,
      null,
      null,
      vi.fn(async () => ({
        frameCount: 1,
        fps: 24,
        cutFrames: [],
        meanDiffs: [],
        physics: {
          status: 'needs-evidence' as const,
          checkedFrames: 1,
          cameraCuts: [],
          violations: [{ code: 'FRAME_EVIDENCE_MISSING' as const, objectId: 'barrier', detail: '缺少底脚' }],
          metrics: { maxAnchorDrift: null, maxDimensionDriftRatio: null, maxMemberSpacingDriftRatio: null },
          evidence: [],
        },
        observationCount: 0,
        completeFrameCoverage: false,
      })),
    )
    const app = Fastify()
    app.addHook('onRequest', async (request) => {
      if (request.headers['x-test-user'] === 'member') request.principal = principal
    })
    await registerGenerationRoutes(app, service)
    const url = `/generation/tasks/${task.id}/rigid-audit`
    const input = { expectedUpdatedAt: task.updatedAt, observations: [] }
    try {
      expect((await app.inject({ method: 'POST', url, payload: input })).statusCode).toBe(401)
      expect(
        (await app.inject({ method: 'POST', url, headers: { 'x-test-user': 'member' }, payload: {} })).statusCode,
      ).toBe(400)
      const response = await app.inject({ method: 'POST', url, headers: { 'x-test-user': 'member' }, payload: input })
      expect(response.statusCode).toBe(200)
      expect(response.json().metadata.rigidPhysicsAudit).toMatchObject({ status: 'needs-evidence' })
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})
