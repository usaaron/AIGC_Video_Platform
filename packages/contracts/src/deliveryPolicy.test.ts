import { describe, expect, it } from 'vitest'
import { deliveryContractSchema, deliveryRequirementSchema } from './delivery.js'
import {
  DELIVERY_PROVIDER_COMPLETION_REQUIREMENT,
  deliveryContractRequiresProviderCompletion,
} from './deliveryPolicy.js'

describe('new delivery contract provider policy', () => {
  it.each([
    [{ kind: 'video', provider: 'seedance' }, true],
    [{ kind: 'image', provider: 'seedance' }, false],
    [{ kind: 'image', provider: 'img2' }, false],
    [{ kind: 'video', provider: 'local-compose' }, false],
    [{ kind: 'video' }, false],
    [{ provider: 'seedance' }, false],
    [{}, false],
  ])('derives policy from task kind and provider only: %j', (task, required) => {
    expect(deliveryContractRequiresProviderCompletion(task)).toBe(required)
  })

  it('exports one immutable default requirement understood by the contract schema', () => {
    expect(Object.isFrozen(DELIVERY_PROVIDER_COMPLETION_REQUIREMENT)).toBe(true)
    expect(deliveryRequirementSchema.parse(DELIVERY_PROVIDER_COMPLETION_REQUIREMENT)).toEqual({
      id: 'provider-completed',
      source: 'provider',
      statement: '必须具备服务端观察 Provider 完成并完整保存当前主视频的可信回执',
    })
  })

  it('keeps historical frozen contracts structurally valid without adding new requirements', () => {
    const frozen = {
      version: 'seqora.delivery.v1',
      contractHash: 'a'.repeat(64),
      frozenAt: '2026-10-13T00:00:00.000Z',
      intent: { mode: 'shot', projectId: 'project-1', episodeId: null, shotIds: [] },
      expectedArtifact: { type: 'video', count: 1 },
      must: [{ id: 'media-url', source: 'provider', statement: '旧合同的媒体可读要求' }],
    }
    expect(deliveryContractSchema.parse(frozen)).toEqual(frozen)
  })
})
