import { describe, expect, it } from 'vitest'
import { freezeDeliveryContract, canonicalDeliveryContractPayload } from './deliveryContractFreeze.js'

const draft = {
  version: 'seqora.delivery.v1',
  intent: { mode: 'shot', projectId: 'project-1', shotIds: ['shot-1'] },
  expectedArtifact: { type: 'video', count: 1 },
  must: [
    { id: 'media-url', statement: '存在当前视频候选', source: 'provider' },
    { id: 'content-review', statement: '内容审核通过', source: 'review' },
  ],
}

const frozenAt = '2026-10-13T08:00:00.000Z'

describe('delivery contract freeze', () => {
  it('freezes a draft with a deterministic SHA-256 hash', () => {
    const first = freezeDeliveryContract(draft, frozenAt)
    const second = freezeDeliveryContract(
      {
        expectedArtifact: draft.expectedArtifact,
        must: draft.must,
        intent: draft.intent,
        version: draft.version,
      },
      frozenAt,
    )
    expect(first.frozenAt).toBe(frozenAt)
    expect(first.contractHash).toMatch(/^[a-f0-9]{64}$/)
    expect(second.contractHash).toBe(first.contractHash)
    expect(canonicalDeliveryContractPayload(draft, frozenAt)).toContain(frozenAt)
  })

  it('changes the hash when the frozen meaning changes', () => {
    const original = freezeDeliveryContract(draft, frozenAt)
    const changed = freezeDeliveryContract(
      {
        ...draft,
        must: [...draft.must, { id: 'physics', statement: '物理审计通过', source: 'review' }],
      },
      frozenAt,
    )
    const changedTime = freezeDeliveryContract(draft, '2026-10-13T08:00:01.000Z')
    expect(changed.contractHash).not.toBe(original.contractHash)
    expect(changedTime.contractHash).not.toBe(original.contractHash)
  })

  it('rejects already frozen contracts and invalid timestamps', () => {
    const frozen = freezeDeliveryContract(draft, frozenAt)
    expect(() => freezeDeliveryContract(frozen, frozenAt)).toThrow('尚未冻结')
    expect(() => freezeDeliveryContract(draft, 'not-a-date')).toThrow()
    expect(() =>
      freezeDeliveryContract(
        {
          ...draft,
          must: [
            { ...draft.must[0], id: 'same' },
            { ...draft.must[1], id: 'same' },
          ],
        },
        frozenAt,
      ),
    ).toThrow()
  })

  it('does not mutate the draft', () => {
    const original = structuredClone(draft)
    freezeDeliveryContract(draft, frozenAt)
    expect(draft).toEqual(original)
  })
})
