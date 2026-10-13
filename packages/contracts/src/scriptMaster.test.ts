import { describe, expect, it } from 'vitest'
import { scriptMasterImportRequestSchema, scriptMasterSurfaceSchema } from './scriptMaster.js'

const base = {
  contractVersion: 'script_master_delivery.v2',
  targetProjectId: 'target',
  sourceProjectId: 'source',
  sourceRevision: 1,
  idempotencyKey: 'import-test-key',
}
describe('Script Master v2 import contract', () => {
  it('restricts trusted module scope to embedded or standalone', () => {
    expect(scriptMasterSurfaceSchema.parse('embedded')).toBe('embedded')
    expect(scriptMasterSurfaceSchema.parse('standalone')).toBe('standalone')
    expect(scriptMasterSurfaceSchema.safeParse('main').success).toBe(false)
  })

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
  it('accepts optional project context without making legacy handoffs invalid', () => {
    const parsed = scriptMasterImportRequestSchema.parse({
      ...base,
      projectContext: {
        title: '外星人攻打白宫',
        synopsis: '白宫遭到外星袭击后，守护者必须在封锁中找出回应方式。',
        episodeDurationSeconds: 90,
      },
      episodes: [{ sourceEpisodeId: 'ep', episodeNumber: 1, title: '封锁', content: '白宫上空出现异象。' }],
    })
    expect(parsed.projectContext).toEqual({
      title: '外星人攻打白宫',
      synopsis: '白宫遭到外星袭击后，守护者必须在封锁中找出回应方式。',
      episodeDurationSeconds: 90,
    })
    expect(
      scriptMasterImportRequestSchema.parse({
        ...base,
        assets: [{ sourceAssetId: 'asset', kind: 'scene', name: '白宫' }],
      }),
    ).not.toHaveProperty('projectContext')
  })
  it('preserves stable character and wardrobe references in asset delivery', () => {
    const parsed = scriptMasterImportRequestSchema.parse({
      ...base,
      assets: [
        {
          sourceAssetId: 'costume:maya:rain',
          kind: 'costume',
          name: '雨夜防护服',
          description: '同一人物的雨夜造型，包含材质、颜色、湿度和连续性细节。',
          prompt: 'Detailed waterproof coat, reflective trim, wet fabric, preserve the same face and body.',
          characterRef: 'character.maya',
          characterAssetId: 'character:maya',
          appearanceVariantId: 'appearance.maya.rain',
          appearanceVariantName: '雨夜防护服',
          continuityNote: '从第1场开始保持湿润状态。',
          sceneNumbers: [1, 2],
        },
      ],
    })
    expect(parsed.assets[0]).toMatchObject({
      characterRef: 'character.maya',
      characterAssetId: 'character:maya',
      appearanceVariantId: 'appearance.maya.rain',
      appearanceVariantName: '雨夜防护服',
      sceneNumbers: [1, 2],
    })
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
