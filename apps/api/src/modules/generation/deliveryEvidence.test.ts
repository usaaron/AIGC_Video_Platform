import { describe, expect, it } from 'vitest'
import {
  deliveryEvidenceSchema,
  rigidPhysicsAuditResultSchema,
  videoReviewVersion,
  type GenerationTask,
} from '@seqora/contracts'
import { buildGenerationTaskDeliveryEvidence } from './deliveryEvidence.js'

function task(overrides: Partial<GenerationTask> = {}): GenerationTask {
  return {
    id: 'task-1',
    clientRequestId: 'request-1',
    projectId: 'project-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    kind: 'video',
    label: '镜头 1',
    prompt: 'prompt',
    negativePrompt: '',
    provider: 'seedance',
    model: null,
    tier: null,
    metadata: { providerState: 'completed', providerTaskId: 'provider-1' },
    status: 'completed',
    progress: 100,
    estimatedCredits: 18,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:01:00.000Z',
    resultUrl: '/video/task-1',
    outputs: [],
    error: null,
    ...overrides,
  }
}

function evidence(taskValue: GenerationTask, kind: string) {
  return buildGenerationTaskDeliveryEvidence(taskValue).find((item) => item.kind === kind)
}

function approvedVideo(overrides: Partial<GenerationTask> = {}) {
  const initial = task({
    ...overrides,
    metadata: {
      ...overrides.metadata,
      lastFrameStorageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
    },
  })
  return task({
    ...overrides,
    metadata: {
      ...initial.metadata,
      contentReview: {
        decision: 'approved',
        mediaVersion: videoReviewVersion(initial),
      },
    },
  })
}

function validAudit(taskValue: GenerationTask, status: 'passed' | 'failed' = 'passed') {
  return {
    status,
    checkedFrames: 10,
    cameraCuts: [],
    violations: [],
    metrics: {
      maxAnchorDrift: 0,
      maxDimensionDriftRatio: 0,
      maxMemberSpacingDriftRatio: 0,
    },
    version: 'rigid-physics-v1',
    mediaVersion: videoReviewVersion(taskValue),
    auditedAt: '2026-10-13T00:02:00.000Z',
    auditedBy: 'reviewer-1',
    evidence: {
      source: 'video-frames',
      observationCount: 10,
      completeFrameCoverage: true,
      objects: [],
    },
  }
}

function withTail(taskValue: GenerationTask): GenerationTask {
  return task({
    ...taskValue,
    metadata: {
      ...taskValue.metadata,
      lastFrameStorageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
      generatedOutputs: [
        {
          view: 'last-frame',
          storageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
          contentType: 'image/png',
          size: 128,
        },
      ],
    },
  })
}

describe('generation task delivery evidence', () => {
  it('uses a stable scoped ID and isolates tenant, project, task, time and media versions', () => {
    const original = evidence(task(), 'task')!
    expect(evidence(task(), 'task')?.evidenceId).toBe(original.evidenceId)
    for (const changed of [
      task({ tenantId: 'tenant-2' }),
      task({ projectId: 'project-2' }),
      task({ id: 'task-2' }),
      task({ updatedAt: '2026-10-13T00:03:00.000Z' }),
      task({ resultUrl: '/video/task-2' }),
    ]) {
      expect(evidence(changed, 'task')?.evidenceId).not.toBe(original.evidenceId)
    }
  })

  it('keeps queued provider receipt observed and task completion pending', () => {
    const queued = task({
      status: 'queued',
      progress: 0,
      metadata: { providerState: 'queued', providerTaskId: 'provider-1' },
      resultUrl: null,
    })
    expect(evidence(queued, 'provider')?.status).toBe('observed')
    expect(evidence(queued, 'task')?.status).toBe('pending')
  })

  it('does not call a tail image a video, and only observes a matching media candidate', () => {
    const tailOnly = task({
      resultUrl: null,
      outputs: [
        {
          id: 'tail',
          url: '/image/tail',
          mediaType: 'image',
          view: 'last-frame',
        },
      ],
    })
    expect(evidence(tailOnly, 'asset')?.status).toBe('pending')
    expect(evidence(task(), 'asset')?.status).toBe('observed')
    expect(evidence(task({ kind: 'text', resultUrl: '/text/task-1', outputs: [] }), 'asset')?.status).toBe(
      'pending',
    )
  })

  it('invalidates a review whose media version is old', () => {
    const oldReview = task({
      metadata: {
        providerState: 'completed',
        providerTaskId: 'provider-1',
        contentReview: { decision: 'approved', mediaVersion: 'old-version' },
      },
    })
    expect(evidence(oldReview, 'content-review')?.status).toBe('pending')
    expect(evidence(approvedVideo(), 'content-review')?.status).toBe('passed')
  })

  it('requires a complete current physics audit and emits audit-only evidence', () => {
    const contractOnly = task({
      metadata: {
        providerState: 'completed',
        providerTaskId: 'provider-1',
        rigidPhysicsContract: { version: 'rigid-physics-v1' },
      },
    })
    expect(evidence(contractOnly, 'physics')?.status).toBe('pending')

    const current = task()
    const audited = task({
      metadata: {
        ...current.metadata,
        rigidPhysicsAudit: validAudit(current),
      },
    })
    expect(evidence(audited, 'physics')?.status).toBe('passed')
    expect(
      evidence(
        task({
          metadata: {
            ...current.metadata,
            rigidPhysicsAudit: { status: 'passed' },
          },
        }),
        'physics',
      )?.status,
    ).toBe('pending')
    expect(
      evidence(
        task({
          metadata: {
            ...current.metadata,
            rigidPhysicsAudit: { ...validAudit(current), mediaVersion: 'old-version' },
          },
        }),
        'physics',
      )?.status,
    ).toBe('pending')
    expect(
      evidence(
        task({
          metadata: {
            ...current.metadata,
            rigidPhysicsAudit: validAudit(current, 'failed'),
          },
        }),
        'physics',
      )?.status,
    ).toBe('failed')
  })

  it('keeps continuity pending until review, physics and a valid tail candidate are present', () => {
    expect(evidence(task(), 'continuity')?.status).toBe('pending')
    const approved = approvedVideo()
    expect(evidence(withTail(approved), 'continuity')?.status).toBe('observed')

    const audited = task({
      metadata: {
        ...approved.metadata,
        rigidPhysicsContract: { version: 'rigid-physics-v1' },
      },
    })
    expect(evidence(withTail(audited), 'continuity')?.status).toBe('pending')
    const auditedWithResult = task({
      ...audited,
      metadata: { ...audited.metadata, rigidPhysicsAudit: validAudit(audited) },
    })
    expect(evidence(withTail(auditedWithResult), 'continuity')?.status).toBe('observed')
    expect(
      evidence(
        task({
          ...approved,
          metadata: {
            ...approved.metadata,
            generatedOutputs: [{ view: 'last-frame', storageKey: 'x', contentType: 'video/mp4', size: 10 }],
          },
        }),
        'continuity',
      )?.status,
    ).toBe('pending')
  })

  it('does not mutate tasks or copy arbitrary metadata into evidence', () => {
    const value = task({
      metadata: {
        providerState: 'completed',
        providerTaskId: 'provider-1',
        secretLike: 'do-not-copy',
      },
    })
    const before = JSON.stringify(value)
    const result = buildGenerationTaskDeliveryEvidence(value)
    expect(JSON.stringify(value)).toBe(before)
    expect(JSON.stringify(result)).not.toContain('do-not-copy')
    for (const item of result) expect(() => deliveryEvidenceSchema.parse(item)).not.toThrow()
    expect(() => rigidPhysicsAuditResultSchema.parse(result[0])).toThrow()
  })
})
