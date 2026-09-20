import { describe, expect, it } from 'vitest'
import { scriptAssetEvidenceSchema } from './scriptAssetEvidence.js'
import { scriptMasterImportRequestSchema } from './scriptMaster.js'

function evidence() {
  return {
    version: 'script_asset_evidence.v1',
    contentHash: 'a'.repeat(64),
    complete: { character: true, scene: false, prop: true },
    assets: [{ kind: 'character', name: ' 林夏 ', facts: { 外观: ' 蓝衣 ' }, sourceSceneIds: [' S01 '] }],
  }
}

describe('episode asset evidence contract', () => {
  it('supports bounded optional ordered formal scene headings without changing legacy v1', () => {
    const scenes = [{ sourceSceneId: 'episode-1:7', heading: 'INT. 档案室 - 夜' }]
    expect(scriptAssetEvidenceSchema.parse({ ...evidence(), scenes }).scenes).toEqual(scenes)
    expect(scriptAssetEvidenceSchema.parse(evidence())).not.toHaveProperty('scenes')
    for (const invalid of [
      [],
      Array.from({ length: 51 }, () => scenes[0]),
      [{ sourceSceneId: ' ', heading: 'INT. 档案室 - 夜' }],
      [{ sourceSceneId: 'episode-1:7', heading: 'INT. 档案室\n角色：父亲' }],
      [{ sourceSceneId: 'episode-1:7', heading: '室'.repeat(501) }],
    ]) {
      expect(scriptAssetEvidenceSchema.safeParse({ ...evidence(), scenes: invalid }).success).toBe(false)
    }
  })
  it('accepts explicit partial coverage and trims names, facts and scene identifiers', () => {
    expect(scriptAssetEvidenceSchema.parse(evidence())).toMatchObject({
      complete: { character: true, scene: false, prop: true },
      assets: [{ kind: 'character', name: '林夏', facts: { 外观: '蓝衣' }, sourceSceneIds: ['S01'] }],
    })
    expect(scriptAssetEvidenceSchema.safeParse({ ...evidence(), assets: [] }).success).toBe(true)
  })

  it('requires the version, SHA-256 hash and explicit coverage flags', () => {
    for (const override of [
      { version: 'script_asset_evidence.v2' },
      { contentHash: 'not-a-hash' },
      { contentHash: 'A'.repeat(64) },
      { complete: { character: true, scene: true } },
    ])
      expect(scriptAssetEvidenceSchema.safeParse({ ...evidence(), ...override }).success).toBe(false)
  })

  it('rejects duplicate normalized names in one kind but allows the same name in different kinds', () => {
    const first = evidence().assets[0]!
    expect(
      scriptAssetEvidenceSchema.safeParse({ ...evidence(), assets: [first, { ...first, name: '林夏' }] })
        .success,
    ).toBe(false)
    expect(
      scriptAssetEvidenceSchema.safeParse({ ...evidence(), assets: [first, { ...first, kind: 'scene' }] })
        .success,
    ).toBe(true)
  })

  it('bounds every asset field and accepts only the three supported kinds', () => {
    for (const override of [
      { kind: 'costume' },
      { name: ' ' },
      { name: '甲'.repeat(121) },
      { facts: { ' ': '蓝衣' } },
      { facts: { ['键'.repeat(41)]: '蓝衣' } },
      { facts: { 外观: ' ' } },
      { facts: { 外观: '衣'.repeat(2_001) } },
      { facts: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`设定${index}`, '蓝衣'])) },
      { sourceSceneIds: [' '] },
      { sourceSceneIds: ['场'.repeat(161)] },
      { sourceSceneIds: Array.from({ length: 501 }, (_, index) => `S${index}`) },
    ])
      expect(
        scriptAssetEvidenceSchema.safeParse({
          ...evidence(),
          assets: [{ ...evidence().assets[0], ...override }],
        }).success,
      ).toBe(false)
  })

  it('bounds entry count and the total serialized UTF-8 byte size', () => {
    const simple = { kind: 'prop', facts: {}, sourceSceneIds: [] }
    expect(
      scriptAssetEvidenceSchema.safeParse({
        ...evidence(),
        assets: Array.from({ length: 2_001 }, (_, index) => ({ ...simple, name: `道具${index}` })),
      }).success,
    ).toBe(false)
    const facts = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`设定${index}`, '衣'.repeat(100)]),
    )
    const assets = Array.from({ length: 100 }, (_, index) => ({ ...simple, name: `道具${index}`, facts }))
    // Each entry is legal, but Chinese UTF-8 content makes the aggregate exceed 500 KB.
    expect(JSON.stringify(assets).length).toBeLessThan(500_000)
    expect(scriptAssetEvidenceSchema.safeParse({ ...evidence(), assets }).success).toBe(false)
    expect(scriptAssetEvidenceSchema.safeParse({ ...evidence(), assets: assets.slice(0, 10) }).success).toBe(
      true,
    )
  })

  it('preserves legacy deliveries and retains evidence on new deliveries', () => {
    const episode = { sourceEpisodeId: 'episode-1', episodeNumber: 1, title: '第一集', content: '正文' }
    const request = {
      contractVersion: 'script_master_delivery.v2',
      targetProjectId: 'target',
      sourceProjectId: 'source',
      sourceRevision: 1,
      idempotencyKey: 'evidence-import-1',
      episodes: [episode],
    }
    expect(scriptMasterImportRequestSchema.parse(request).episodes[0]).not.toHaveProperty('assetEvidence')
    expect(
      scriptMasterImportRequestSchema.parse({
        ...request,
        episodes: [{ ...episode, assetEvidence: evidence() }],
      }).episodes[0]!.assetEvidence,
    ).toEqual(scriptAssetEvidenceSchema.parse(evidence()))
  })
})
