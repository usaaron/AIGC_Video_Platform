import { describe, expect, it } from 'vitest'
import { scriptMasterImportRequestSchema } from './scriptMaster.js'

const base = {
  contractVersion: 'script_master_delivery.v2',
  targetProjectId: 'target',
  sourceProjectId: 'source',
  sourceRevision: 1,
  idempotencyKey: 'import-test-key',
}
describe('Script Master v2 import contract', () => {
  it('requires an explicit scripts-only request for preserving production history', () => {
    const episode = { sourceEpisodeId: 'ep', episodeNumber: 1, title: '第一集', content: '正文' }
    const input = { ...base, storyboardRevision: 'preserve-history', episodes: [episode] }
    expect(scriptMasterImportRequestSchema.parse(input).storyboardRevision).toBe('preserve-history')
    expect(
      scriptMasterImportRequestSchema.safeParse({ ...input, episodes: [{ ...episode, shots: [] }] }).success,
    ).toBe(false)
    expect(
      scriptMasterImportRequestSchema.safeParse({
        ...input,
        assets: [{ sourceAssetId: 'a', kind: 'character', name: '林岚' }],
      }).success,
    ).toBe(false)
    expect(
      scriptMasterImportRequestSchema.safeParse({ ...input, storyboardRevision: 'overwrite' }).success,
    ).toBe(false)
  })
  it('requires selected content and accepts asset-only deliveries', () => {
    expect(scriptMasterImportRequestSchema.safeParse(base).success).toBe(false)
    expect(
      scriptMasterImportRequestSchema.safeParse({
        ...base,
        assets: [{ sourceAssetId: 'lin', kind: 'character', name: '林岚' }],
      }).success,
    ).toBe(true)
  })
  it('rejects duplicate episodes, unsupported durations and client-supplied media fields', () => {
    const episode = {
      sourceEpisodeId: 'ep',
      episodeNumber: 1,
      title: '第一集',
      content: '正文',
      shots: [{ sourceShotId: 's', title: '第一镜', framing: '中景', duration: 60, prompt: '镜头' }],
    }
    expect(scriptMasterImportRequestSchema.safeParse({ ...base, episodes: [episode] }).success).toBe(false)
    episode.shots[0]!.duration = 5
    expect(scriptMasterImportRequestSchema.safeParse({ ...base, episodes: [episode, episode] }).success).toBe(
      false,
    )
    const parsed = scriptMasterImportRequestSchema.parse({
      ...base,
      assets: [
        {
          sourceAssetId: 'lin',
          kind: 'character',
          name: '林岚',
          imageUrl: '/untrusted.png',
          status: 'confirmed',
          attributes: { faceStatus: 'approved' },
        },
      ],
    })
    expect(parsed.assets[0]).not.toHaveProperty('imageUrl')
    expect(parsed.assets[0]).not.toHaveProperty('attributes')
  })
})
