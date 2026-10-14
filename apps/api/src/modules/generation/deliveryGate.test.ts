import { describe, expect, it } from 'vitest'
import {
  deliveryContractSchema,
  deliveryVerificationSchema,
  videoReviewVersion,
  type DeliveryEvidence,
  type GenerationTask,
} from '@seqora/contracts'
import { freezeDeliveryContract } from './deliveryContractFreeze.js'
import { evaluateDeliveryGate } from './deliveryGate.js'

const principal = {
  tenantId: 'tenant-1',
  userId: 'user-1',
}

function task(overrides: Partial<GenerationTask> = {}): GenerationTask {
  return {
    id: 'task-1',
    clientRequestId: 'request-1',
    projectId: 'project-1',
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: 'text',
    label: '门禁测试',
    prompt: '',
    negativePrompt: '',
    provider: 'local',
    model: null,
    metadata: {},
    status: 'completed',
    progress: 100,
    estimatedCredits: 1,
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:01:00.000Z',
    resultUrl: null,
    outputs: [],
    error: null,
    ...overrides,
  }
}

function evidence(
  taskValue: GenerationTask,
  status: DeliveryEvidence['status'] = 'passed',
): DeliveryEvidence {
  return {
    evidenceId: 'evidence-1',
    kind: 'task',
    status,
    requirementIds: ['task-completed'],
    refType: 'generation-task',
    refId: taskValue.id,
    observedAt: taskValue.updatedAt,
    scope: {
      tenantId: taskValue.tenantId,
      projectId: taskValue.projectId,
      taskId: taskValue.id,
      taskUpdatedAt: taskValue.updatedAt,
      mediaVersion: null,
    },
    details: {},
  }
}

function contract(taskValue: GenerationTask) {
  return freezeDeliveryContract(
    deliveryContractSchema.parse({
      version: 'seqora.delivery.v1',
      intent: { mode: 'response', projectId: taskValue.projectId },
      expectedArtifact: { type: 'text', count: 1 },
      must: [{ id: 'task-completed', statement: '任务必须已完成', source: 'system' }],
    }),
    '2026-10-14T00:02:00.000Z',
  )
}

function satisfiedVerification(requirementIds = ['task-completed']) {
  return deliveryVerificationSchema.parse({
    status: 'satisfied',
    satisfiedRequirementIds: requirementIds,
    pendingRequirementIds: [],
    failedRequirementIds: [],
    rationale: '已通过',
    verifiedAt: '2026-10-14T00:03:00.000Z',
  })
}

function mediaTask(kind: 'image' | 'video') {
  const current = task({
    kind,
    provider: kind === 'video' ? 'seedance' : 'image2',
    resultUrl: `/api/v1/generation/tasks/task-1/${kind === 'video' ? 'content' : 'outputs/single'}`,
  })
  if (kind === 'video') {
    current.metadata.contentReview = {
      decision: 'approved',
      mediaVersion: videoReviewVersion(current),
    }
  }
  return current
}

function mediaEvidence(current: GenerationTask, status: DeliveryEvidence['status']): DeliveryEvidence {
  return {
    ...evidence(current, status),
    evidenceId: `media-${status}`,
    kind: 'asset',
    requirementIds: ['media-url'],
    refType: 'generation-output',
  }
}

function otherPassedEvidence(current: GenerationTask): DeliveryEvidence[] {
  return [
    evidence(current),
    ...(current.kind === 'video'
      ? [
          {
            ...evidence(current),
            evidenceId: 'continuity-passed',
            kind: 'continuity' as const,
            requirementIds: ['continuity-ready'],
            refType: 'video-tail',
          },
        ]
      : []),
  ]
}

describe('formal delivery gate', () => {
  it('allows a frozen text contract with satisfied evidence', () => {
    const current = task()
    const result = evaluateDeliveryGate({
      task: current,
      contract: contract(current),
      evidence: [evidence(current)],
      verification: deliveryVerificationSchema.parse({
        status: 'satisfied',
        satisfiedRequirementIds: ['task-completed'],
        pendingRequirementIds: [],
        failedRequirementIds: [],
        rationale: '已通过',
        verifiedAt: '2026-10-14T00:03:00.000Z',
      }),
      verifiedAt: '2026-10-14T00:03:00.000Z',
    })

    expect(result).toMatchObject({ allowed: true, status: 'allowed', reasonCodes: [] })
  })

  it('blocks a failed physical audit even when the contract omits physical-review', () => {
    const current = task({
      kind: 'video',
      provider: 'seedance',
      resultUrl: '/media/task-1.mp4',
      metadata: {
        rigidPhysicsContract: { version: 'rigid-physics-v1' },
        rigidPhysicsAudit: { status: 'failed' },
      },
    })
    const result = evaluateDeliveryGate({
      task: current,
      contract: contract(current),
      evidence: [evidence(current)],
      verification: null,
      verifiedAt: '2026-10-14T00:03:00.000Z',
    })

    expect(result.allowed).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.reasonCodes).toContain('PHYSICAL_REVIEW_FAILED')
  })

  it.each(['image', 'video'] as const)(
    'requires current %s media even when a satisfied text contract omits media-url',
    (kind) => {
      const current = mediaTask(kind)
      const result = evaluateDeliveryGate({
        task: current,
        contract: contract(current),
        evidence: otherPassedEvidence(current),
        verification: satisfiedVerification(),
        verifiedAt: '2026-10-14T00:03:00.000Z',
      })

      expect(result).toMatchObject({
        allowed: false,
        status: 'pending',
        reasonCodes: ['MEDIA_NOT_READABLE'],
      })
    },
  )

  it('blocks a failed media proof even when another media proof passed and the contract is satisfied', () => {
    const current = mediaTask('image')
    const result = evaluateDeliveryGate({
      task: current,
      contract: contract(current),
      evidence: [evidence(current), mediaEvidence(current, 'passed'), mediaEvidence(current, 'failed')],
      verification: satisfiedVerification(),
      verifiedAt: '2026-10-14T00:03:00.000Z',
    })

    expect(result).toMatchObject({
      allowed: false,
      status: 'blocked',
      reasonCodes: ['MEDIA_NOT_READABLE'],
    })
  })

  it.each(['pending', 'observed'] as const)('does not allow %s media evidence', (status) => {
    const current = mediaTask('image')
    const result = evaluateDeliveryGate({
      task: current,
      contract: contract(current),
      evidence: [evidence(current), mediaEvidence(current, status)],
      verification: satisfiedVerification(),
      verifiedAt: '2026-10-14T00:03:00.000Z',
    })

    expect(result).toMatchObject({
      allowed: false,
      status: 'pending',
      reasonCodes: ['MEDIA_NOT_READABLE'],
    })
  })

  it('allows a completed image with passed media proof and a satisfied frozen image contract', () => {
    const current = mediaTask('image')
    const frozen = freezeDeliveryContract(
      deliveryContractSchema.parse({
        version: 'seqora.delivery.v1',
        intent: { mode: 'asset', projectId: current.projectId },
        expectedArtifact: { type: 'image', count: 1 },
        must: [
          { id: 'task-completed', statement: '任务必须已完成', source: 'system' },
          { id: 'media-url', statement: '当前主媒体可读取', source: 'system' },
        ],
      }),
      '2026-10-14T00:02:00.000Z',
    )
    const result = evaluateDeliveryGate({
      task: current,
      contract: frozen,
      evidence: [evidence(current), mediaEvidence(current, 'passed')],
      verification: satisfiedVerification(['task-completed', 'media-url']),
      verifiedAt: '2026-10-14T00:03:00.000Z',
    })

    expect(result).toMatchObject({ allowed: true, status: 'allowed', reasonCodes: [] })
  })

  it.each(['text', 'image'] as const)(
    'does not allow %s delivery without a contract verification result',
    (kind) => {
      const current = kind === 'image' ? mediaTask(kind) : task()
      const result = evaluateDeliveryGate({
        task: current,
        contract: contract(current),
        evidence: [evidence(current), ...(kind === 'image' ? [mediaEvidence(current, 'passed')] : [])],
        verification: null,
        verifiedAt: '2026-10-14T00:03:00.000Z',
      })

      expect(result).toMatchObject({
        allowed: false,
        status: 'pending',
        reasonCodes: ['DELIVERY_REQUIREMENTS_INCOMPLETE'],
      })
    },
  )
})
