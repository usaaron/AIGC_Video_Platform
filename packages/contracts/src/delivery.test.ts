import { describe, expect, it } from 'vitest'
import {
  deliveryContractFreezeRequestSchema,
  deliveryContractSchema,
  deliveryEvidenceSchema,
} from './delivery.js'

const scope = {
  tenantId: 'tenant-1',
  projectId: 'project-1',
  taskId: 'task-1',
  taskUpdatedAt: '2026-10-13T00:01:00.000Z',
  mediaVersion: 'media-version-1',
}

const evidence = (input: Record<string, unknown> = {}) =>
  deliveryEvidenceSchema.parse({
    evidenceId: 'evidence-1',
    kind: 'provider',
    status: 'observed',
    requirementIds: ['provider-accepted'],
    refType: 'provider-task',
    refId: 'task-1',
    observedAt: '2026-10-13T00:01:00.000Z',
    scope,
    ...input,
  })

describe('delivery contracts and evidence', () => {
  it('allows a draft contract but requires a hash and timestamp together when frozen', () => {
    expect(
      deliveryContractSchema.parse({
        version: 'seqora.delivery.v1',
        intent: { mode: 'shot', projectId: 'project-1', shotIds: ['shot-1'] },
        expectedArtifact: { type: 'video', count: 1 },
        must: [{ id: 'media-url', statement: '存在视频地址', source: 'provider' }],
      }).contractHash,
    ).toBeNull()

    expect(() =>
      deliveryContractSchema.parse({
        version: 'seqora.delivery.v1',
        contractHash: 'a'.repeat(64),
        intent: { mode: 'shot', projectId: 'project-1' },
        expectedArtifact: { type: 'video', count: 1 },
        must: [{ id: 'media-url', statement: '存在视频地址', source: 'provider' }],
      }),
    ).toThrow()

    expect(() =>
      deliveryContractSchema.parse({
        version: 'seqora.delivery.v1',
        frozenAt: '2026-10-13T00:00:00.000Z',
        intent: { mode: 'shot', projectId: 'project-1' },
        expectedArtifact: { type: 'video', count: 1 },
        must: [{ id: 'media-url', statement: '存在视频地址', source: 'provider' }],
      }),
    ).toThrow()
  })

  it('rejects duplicate requirement IDs', () => {
    expect(() =>
      deliveryContractSchema.parse({
        version: 'seqora.delivery.v1',
        intent: { mode: 'shot', projectId: 'project-1' },
        expectedArtifact: { type: 'video', count: 1 },
        must: [
          { id: 'same', statement: '第一条', source: 'user' },
          { id: 'same', statement: '第二条', source: 'review' },
        ],
      }),
    ).toThrow()
  })

  it('requires scoped evidence and preserves the scope', () => {
    expect(evidence().scope).toEqual(scope)
    const withoutScope = { ...evidence(), scope: undefined }
    expect(() => deliveryEvidenceSchema.parse(withoutScope)).toThrow()
    expect(() =>
      deliveryEvidenceSchema.parse({
        ...evidence(),
        scope: { ...scope, taskUpdatedAt: 'not-a-date' },
      }),
    ).toThrow()
  })

  it('validates the task-level freeze request with an optimistic timestamp', () => {
    const request = deliveryContractFreezeRequestSchema.parse({
      expectedUpdatedAt: scope.taskUpdatedAt,
      contract: {
        version: 'seqora.delivery.v1',
        intent: { mode: 'shot', projectId: scope.projectId },
        expectedArtifact: { type: 'video', count: 1 },
        must: [{ id: 'media-url', statement: '视频候选可读', source: 'provider' }],
      },
    })
    expect(request.contract.contractHash).toBeNull()
    expect(() =>
      deliveryContractFreezeRequestSchema.parse({
        ...request,
        expectedUpdatedAt: 'invalid',
      }),
    ).toThrow()
  })
})
