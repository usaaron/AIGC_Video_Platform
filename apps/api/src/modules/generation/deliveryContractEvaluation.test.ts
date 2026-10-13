import { describe, expect, it } from 'vitest'
import { deliveryContractSchema, deliveryEvidenceSchema } from '@seqora/contracts'
import { freezeDeliveryContract } from './deliveryContractFreeze.js'
import { evaluateDeliveryContract } from './deliveryContractEvaluation.js'

const scope = {
  tenantId: 'tenant-seqora-demo',
  projectId: 'project-midnight-film',
  taskId: 'task-delivery-1',
  taskUpdatedAt: '2026-10-13T00:00:00.000Z',
  mediaVersion: 'media-version-1',
}

const frozenContract = freezeDeliveryContract(
  deliveryContractSchema.parse({
    version: 'seqora.delivery.v1',
    intent: { mode: 'shot', projectId: scope.projectId },
    expectedArtifact: { type: 'video', count: 1 },
    must: [
      { id: 'media-url', statement: '当前视频可读', source: 'provider' },
      { id: 'content-review', statement: '内容审核通过', source: 'review' },
    ],
  }),
  '2026-10-13T00:01:00.000Z',
)

function evidence(
  requirementId: string,
  status: 'observed' | 'passed' | 'failed',
  overrides: Partial<typeof scope> = {},
) {
  const currentScope = { ...scope, ...overrides }
  return deliveryEvidenceSchema.parse({
    evidenceId: `${requirementId}-${status}`,
    kind: requirementId === 'content-review' ? 'content-review' : 'asset',
    status,
    requirementIds: [requirementId],
    refType: 'test',
    refId: currentScope.taskId,
    observedAt: currentScope.taskUpdatedAt,
    scope: currentScope,
    details: {},
  })
}

describe('delivery contract evaluation', () => {
  it('satisfies all requirements only with passed evidence in the exact scope', () => {
    const result = evaluateDeliveryContract({
      contract: frozenContract,
      evidence: [evidence('media-url', 'passed'), evidence('content-review', 'passed')],
      scope,
      verifiedAt: '2026-10-13T00:02:00.000Z',
    })
    expect(result).toMatchObject({
      status: 'satisfied',
      satisfiedRequirementIds: ['media-url', 'content-review'],
      pendingRequirementIds: [],
      failedRequirementIds: [],
    })
  })

  it('keeps observed or wrong-scope evidence pending', () => {
    const result = evaluateDeliveryContract({
      contract: frozenContract,
      evidence: [
        evidence('media-url', 'observed'),
        evidence('content-review', 'passed', { taskId: 'other-task' }),
      ],
      scope,
      verifiedAt: '2026-10-13T00:02:00.000Z',
    })
    expect(result).toMatchObject({
      status: 'pending',
      satisfiedRequirementIds: [],
      pendingRequirementIds: ['media-url', 'content-review'],
      failedRequirementIds: [],
    })
  })

  it('gives failed evidence precedence over passed evidence', () => {
    const result = evaluateDeliveryContract({
      contract: frozenContract,
      evidence: [
        evidence('media-url', 'passed'),
        evidence('media-url', 'failed'),
        evidence('content-review', 'passed'),
      ],
      scope,
      verifiedAt: '2026-10-13T00:02:00.000Z',
    })
    expect(result).toMatchObject({
      status: 'failed',
      satisfiedRequirementIds: ['content-review'],
      pendingRequirementIds: [],
      failedRequirementIds: ['media-url'],
    })
  })

  it('cannot satisfy a draft or tampered contract', () => {
    const draft = deliveryContractSchema.parse({
      ...frozenContract,
      contractHash: null,
      frozenAt: null,
    })
    const tampered = { ...frozenContract, intent: { ...frozenContract.intent, projectId: 'project-other' } }
    for (const contract of [draft, tampered]) {
      const result = evaluateDeliveryContract({
        contract,
        evidence: [evidence('media-url', 'passed'), evidence('content-review', 'passed')],
        scope,
        verifiedAt: '2026-10-13T00:02:00.000Z',
      })
      expect(result.status).toBe('pending')
      expect(result.satisfiedRequirementIds).toEqual([])
    }
  })
})
