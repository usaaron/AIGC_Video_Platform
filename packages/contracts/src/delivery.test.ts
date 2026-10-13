import { describe, expect, it } from 'vitest'
import {
  deliveryContractSchema,
  deliveryEvidenceSchema,
  evaluateDeliveryVerification,
} from './delivery.js'

const contract = deliveryContractSchema.parse({
  version: 'seqora.delivery.v1',
  intent: { mode: 'shot', projectId: 'project-1', shotIds: ['shot-1'] },
  expectedArtifact: { type: 'video', count: 1 },
  must: [
    { id: 'media-url', statement: '存在真实视频地址', source: 'provider' },
    { id: 'review', statement: '内容验收通过', source: 'review' },
  ],
})

const evidence = (input: Partial<ReturnType<typeof deliveryEvidenceSchema.parse>>) =>
  deliveryEvidenceSchema.parse({
    evidenceId: 'evidence-1',
    kind: 'provider',
    status: 'passed',
    requirementIds: ['media-url'],
    refType: 'generation-task',
    refId: 'task-1',
    observedAt: '2026-10-13T00:00:00.000Z',
    ...input,
  })

describe('delivery contract verification', () => {
  it('does not treat a provider result as complete content review', () => {
    const result = evaluateDeliveryVerification(contract, [evidence()])
    expect(result.status).toBe('partial')
    expect(result.satisfiedRequirementIds).toEqual(['media-url'])
    expect(result.pendingRequirementIds).toEqual(['review'])
  })

  it('fails when any requirement has failed evidence', () => {
    const result = evaluateDeliveryVerification(contract, [
      evidence(),
      evidence({
        evidenceId: 'evidence-2',
        kind: 'content-review',
        status: 'failed',
        requirementIds: ['review'],
        refType: 'video-review',
        refId: 'review-1',
      }),
    ])
    expect(result.status).toBe('failed')
    expect(result.failedRequirementIds).toEqual(['review'])
  })

  it('requires passed evidence for every requirement before satisfaction', () => {
    const result = evaluateDeliveryVerification(contract, [
      evidence(),
      evidence({
        evidenceId: 'evidence-2',
        kind: 'content-review',
        requirementIds: ['review'],
        refType: 'video-review',
        refId: 'review-1',
      }),
    ])
    expect(result.status).toBe('satisfied')
  })
})
