import { describe, expect, it } from 'vitest'
import {
  deliveryContractSchema,
  deliveryVerificationSchema,
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

function evidence(taskValue: GenerationTask, status: DeliveryEvidence['status'] = 'passed'): DeliveryEvidence {
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
})
