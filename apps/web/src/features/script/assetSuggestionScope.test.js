import { describe, expect, it } from 'vitest'
import { savedAssetEvidenceFingerprint, savedAssetSuggestionScope } from './assetSuggestionScope'

const episode = (id, content, extra = {}) => ({ id, content, status: 'saved', ...extra })
const settings = { contentType: 'short-drama', visualStyle: 'cinematic-cg', assetRevision: 'none' }

describe('saved asset suggestion scope', () => {
  it('refreshes automatic and manual analysis for metadata-only changes without reacting to JSONB key order', () => {
    const evidence = {
      version: 'script_asset_evidence.v1',
      contentHash: 'a'.repeat(64),
      complete: { character: true, prop: true, scene: true },
      assets: [
        { kind: 'character', name: '林夏', facts: { 外观: '灰衣', 年龄: '25岁' }, sourceSceneIds: ['one:1'] },
      ],
    }
    const baseline = {
      ...settings,
      episodes: [episode('one', '林夏走入车站。', { continuityState: { scriptAssetEvidence: evidence } })],
    }
    const revisedEvidence = structuredClone(evidence)
    revisedEvidence.assets[0].facts.外观 = '白衣'
    const revised = {
      ...baseline,
      episodes: [
        episode('one', '林夏走入车站。', { continuityState: { scriptAssetEvidence: revisedEvidence } }),
      ],
    }
    expect(savedAssetSuggestionScope(revised).autoScopeFingerprint).not.toBe(
      savedAssetSuggestionScope(baseline).autoScopeFingerprint,
    )
    expect(savedAssetEvidenceFingerprint(revised.episodes)).not.toBe(
      savedAssetEvidenceFingerprint(baseline.episodes),
    )
    const reordered = {
      ...baseline,
      episodes: [
        episode('one', '林夏走入车站。', {
          continuityState: {
            scriptAssetEvidence: {
              assets: [{ ...evidence.assets[0], facts: { 年龄: '25岁', 外观: '灰衣' } }],
              complete: { prop: true, scene: true, character: true },
              contentHash: evidence.contentHash,
              version: evidence.version,
            },
            unrelated: 'changed',
          },
        }),
      ],
    }
    expect(savedAssetSuggestionScope(reordered)).toEqual(savedAssetSuggestionScope(baseline))
    expect(savedAssetEvidenceFingerprint(reordered.episodes)).toBe(
      savedAssetEvidenceFingerprint(baseline.episodes),
    )
    expect(savedAssetEvidenceFingerprint([episode('one', '林夏走入车站。')])).toBe('')
  })

  it('ignores episode selection, order, draft edits and unrelated save metadata', () => {
    const saved = [episode('one', '人物：林夏'), episode('two', '场景：车站')]
    const first = savedAssetSuggestionScope({ ...settings, episodes: saved })
    const second = savedAssetSuggestionScope({
      ...settings,
      episodes: [
        episode('draft', '未保存正文', { status: 'draft' }),
        { ...saved[1], draftContent: '局部编辑', revision: 3, title: '新标题', updatedAt: 'later' },
        saved[0],
      ],
    })
    expect(second).toEqual(first)
    expect(saved.some((entry) => entry.content === first.autoSource)).toBe(true)
  })

  it('invalidates on saved content, membership, asset library or visual settings changes', () => {
    const baseline = { ...settings, episodes: [episode('one', '人物：林夏')] }
    const fingerprint = savedAssetSuggestionScope(baseline).autoScopeFingerprint
    for (const update of [
      { episodes: [episode('one', '人物：林夏、陆川')] },
      { episodes: [episode('one', '人物：林夏'), episode('two', '人物：林夏')] },
      { assetRevision: 'asset-one:2' },
      { visualStyle: 'anime' },
      { contentType: 'advertisement' },
      { direction: { style: 'realistic' } },
    ]) {
      expect(savedAssetSuggestionScope({ ...baseline, ...update }).autoScopeFingerprint).not.toBe(fingerprint)
    }
  })

  it('normalizes whitespace and configuration key order while ignoring unsaved-only series', () => {
    const baseline = {
      ...settings,
      episodes: [episode('one', '人物：林夏')],
      direction: { style: 'auto', focus: 'balanced' },
    }
    expect(
      savedAssetSuggestionScope({
        ...baseline,
        episodes: [episode('one', '  人物：林夏\n')],
        direction: { focus: 'balanced', style: 'auto' },
      }),
    ).toEqual(savedAssetSuggestionScope(baseline))
    expect(
      savedAssetSuggestionScope({
        ...settings,
        episodes: [episode('draft', '人物：林夏', { status: 'draft' })],
      }),
    ).toEqual({ autoSource: '', autoScopeFingerprint: '' })
    expect(savedAssetSuggestionScope({ ...settings, source: '已保存的短片' }).autoSource).toBe('已保存的短片')
  })
})
