import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'
import { GenerationService, type RigidAuditRunner } from './service.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'

const principal = { tenantId: 'tenant-seqora-demo', userId: 'user-member', roles: ['member'] as ['member'] }

describe('rigid physics audit service', () => {
  it('reads one completed video, persists the conservative audit, and creates no task', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = buildQueuedGenerationTask(
      {
        clientRequestId: 'rigid-audit',
        projectId: 'project-midnight-film',
        provider: 'seedance',
        kind: 'video',
        label: '1-1',
        estimatedCredits: 18,
        prompt: '固定隔离栏底板以螺栓固定于混凝土地面，单一连续镜头',
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
    const runner = vi.fn<RigidAuditRunner>(async () => ({
      frameCount: 121,
      fps: 24,
      cutFrames: [70],
      meanDiffs: [{ frame: 70, meanDiff: 0.16 }],
      physics: {
        status: 'failed',
        checkedFrames: 121,
        cameraCuts: [70],
        violations: [{ code: 'CAMERA_CUT_FORBIDDEN', frame: 70, detail: '检测到硬切' }],
        metrics: { maxAnchorDrift: null, maxDimensionDriftRatio: null, maxMemberSpacingDriftRatio: null },
        evidence: [],
      },
      observationCount: 0,
      completeFrameCoverage: false,
    }))
    const storage = {
      get: vi.fn(async () => Buffer.from('video-bytes')),
      put: vi.fn(),
      delete: vi.fn(),
    }
    const repository = new GenerationTaskRepository(store)
    const service = new GenerationService(
      repository,
      { dispatch: vi.fn() } as unknown as TaskDispatcher,
      null,
      undefined,
      storage as never,
      null,
      null,
      null,
      runner,
    )

    const expectedUpdatedAt = task.updatedAt
    const audited = await service.auditRigidPhysics(
      task.id,
      { expectedUpdatedAt, observations: [] },
      principal,
    )
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.any(String), video: expect.any(Buffer) }),
    )
    expect(storage.get).toHaveBeenCalledWith('1-1.mp4')
    expect(audited.metadata.rigidPhysicsAudit).toMatchObject({
      status: 'failed',
      checkedFrames: 121,
      mediaVersion: expect.any(String),
      evidence: { source: 'video-frames', completeFrameCoverage: false },
    })
    expect(store.read((state) => state.tasks)).toHaveLength(1)
    expect(audited.updatedAt).not.toBe(expectedUpdatedAt)
    await expect(
      service.auditRigidPhysics(task.id, { expectedUpdatedAt, observations: [] }, principal),
    ).rejects.toMatchObject({ code: 'RIGID_AUDIT_STALE' })
  })

  it('rejects non-completed or non-physical tasks before reading media', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = buildQueuedGenerationTask(
      {
        clientRequestId: 'queued-audit',
        projectId: 'p',
        provider: 'seedance',
        kind: 'video',
        label: 'queued',
        estimatedCredits: 18,
      },
      principal,
      '2026-10-11T00:00:00.000Z',
    )
    await store.mutate((state) => {
      state.tasks = [task]
    })
    const runner = vi.fn()
    const service = new GenerationService(
      new GenerationTaskRepository(store),
      { dispatch: vi.fn() } as unknown as TaskDispatcher,
      null,
      undefined,
      { get: vi.fn(), put: vi.fn(), delete: vi.fn() } as never,
      null,
      null,
      runner as never,
    )
    await expect(
      service.auditRigidPhysics(task.id, { expectedUpdatedAt: task.updatedAt, observations: [] }, principal),
    ).rejects.toMatchObject({ code: 'RIGID_AUDIT_NOT_REVIEWABLE' })
    expect(runner).not.toHaveBeenCalled()
  })
})
