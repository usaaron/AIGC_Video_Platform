import { describe, expect, it } from 'vitest'
import {
  extractScriptAssetManifest,
  extractScriptAssetNameIndex,
  namesFromManifestOrFields,
  SCRIPT_ASSET_NAME_FIELDS,
  type ScriptAssetKind,
} from './assetSuggestionExtraction.js'
import { ScriptAssetSourceIndexCache } from './scriptAssetSourceIndex.js'

const scope = { tenantId: 'organization-a', projectId: 'project-a' }
const episode = (id: string, name: string) => ({
  id,
  content: `角色：${name}\n场景：车站\n动作：人物走入车站。`,
})

describe('bounded per-source script asset parsing', () => {
  it('reuses unchanged episodes and reparses only a changed source', () => {
    const cache = new ScriptAssetSourceIndexCache()
    const first = episode('episode-1', '张宁')
    const second = episode('episode-2', '林雨')
    expect(cache.analyze(scope, [first, second]).stats).toMatchObject({ hits: 0, misses: 2, entries: 2 })
    expect(cache.analyze(scope, [first, second]).stats).toMatchObject({ hits: 2, misses: 0, entries: 2 })
    const changed = cache.analyze(scope, [first, episode('episode-2', '沈烈')])
    expect(changed.stats).toMatchObject({ hits: 1, misses: 1, entries: 2 })
    expect(changed.names.character).toEqual(['张宁', '沈烈'])
    expect(cache.analyze(scope, [first, episode('episode-2', '沈烈')]).stats.misses).toBe(0)
  })

  it('aggregates only current sources, including after deletion and reordering', () => {
    const cache = new ScriptAssetSourceIndexCache()
    const first = episode('episode-1', '张宁')
    const second = episode('episode-2', '林雨')
    cache.analyze(scope, [first, second])
    expect(cache.analyze(scope, [second, first]).names.character).toEqual(['林雨', '张宁'])
    expect(cache.analyze(scope, [second]).names.character).toEqual(['林雨'])
    const empty = cache.analyze(scope, [])
    expect(Object.values(empty.manifest).flat()).toEqual([])
    expect(Object.values(empty.names).flat()).toEqual([])
  })

  it('isolates organizations, projects and source identities even with identical text', () => {
    const cache = new ScriptAssetSourceIndexCache()
    const source = episode('episode-1', '张宁')
    expect(cache.analyze(scope, [source]).stats.misses).toBe(1)
    expect(cache.analyze({ ...scope, tenantId: 'organization-b' }, [source]).stats.misses).toBe(1)
    expect(cache.analyze({ ...scope, projectId: 'project-b' }, [source]).stats.misses).toBe(1)
    expect(cache.analyze(scope, [{ ...source, id: 'episode-2' }]).stats.misses).toBe(1)
    expect(cache.analyze(scope, [source]).stats.hits).toBe(1)
  })

  it('uses access order for entry eviction and never keeps obsolete content versions', () => {
    const cache = new ScriptAssetSourceIndexCache({ maxEntries: 2 })
    const first = episode('episode-1', '张宁')
    const second = episode('episode-2', '林雨')
    cache.analyze(scope, [first, second])
    cache.analyze(scope, [first])
    cache.analyze(scope, [episode('episode-3', '沈烈')])
    expect(cache.analyze(scope, [first, second]).stats).toMatchObject({ hits: 1, misses: 1, entries: 2 })
    for (let index = 0; index < 10; index++) {
      expect(cache.analyze(scope, [episode('episode-2', `林雨${index}`)]).stats.entries).toBe(2)
    }
  })

  it('enforces its byte budget while serving oversized entries without retaining them', () => {
    const cache = new ScriptAssetSourceIndexCache({ maxBytes: 2_000 })
    const small = episode('episode-1', '张宁')
    const large = {
      id: 'episode-2',
      content: `资产：\n人物：林雨｜外观：${'蓝色长外套'.repeat(1000)}\n正文：\n她经过车站。`,
    }
    const smallStats = cache.analyze(scope, [small]).stats
    expect(smallStats.entries).toBe(1)
    const oversized = cache.analyze(scope, [large])
    expect(oversized.names.character).toEqual(['林雨'])
    expect(oversized.stats.entries).toBe(1)
    expect(oversized.stats.bytes).toBe(smallStats.bytes)
    expect(cache.analyze(scope, [small]).stats.hits).toBe(1)
    expect(cache.analyze(scope, [large]).stats.misses).toBe(1)
    expect(oversized.stats.bytes).toBeLessThanOrEqual(2_000)
  })

  it('evicts for total bytes as well as entry count, and supports disabling retention', () => {
    const sample = episode('episode-1', '张宁')
    const bytes = new ScriptAssetSourceIndexCache().analyze(scope, [sample]).stats.bytes
    const cache = new ScriptAssetSourceIndexCache({ maxEntries: 10, maxBytes: bytes + 100 })
    const result = cache.analyze(scope, [sample, episode('episode-2', '林雨')])
    expect(result.names.character).toEqual(['张宁', '林雨'])
    expect(result.stats.entries).toBe(1)
    expect(result.stats.bytes).toBeLessThanOrEqual(bytes + 100)
    for (const options of [{ maxEntries: 0 }, { maxBytes: 0 }]) {
      const uncached = new ScriptAssetSourceIndexCache(options)
      uncached.analyze(scope, [sample])
      expect(uncached.analyze(scope, [sample]).stats).toEqual({ hits: 0, misses: 1, entries: 0, bytes: 0 })
    }
  })

  it('retains parsed facts only, not arbitrarily long narrative text', () => {
    const cache = new ScriptAssetSourceIndexCache({ maxBytes: 2_000 })
    const source = { id: 'episode-1', content: `正文：\n${'林雨回忆起父亲的一封信。'.repeat(20_000)}` }
    const first = cache.analyze(scope, [source])
    expect(first.stats.entries).toBe(1)
    expect(first.names.character).toEqual([])
    expect(cache.analyze(scope, [source]).stats.hits).toBe(1)
  })

  it('rejects invalid limits', () => {
    for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new ScriptAssetSourceIndexCache({ maxEntries: limit })).toThrow(RangeError)
      expect(() => new ScriptAssetSourceIndexCache({ maxBytes: limit })).toThrow(RangeError)
    }
  })
})

describe('source aggregation matches established extraction semantics', () => {
  it('ends a trailing field at its episode boundary instead of absorbing the next episode heading', () => {
    const result = new ScriptAssetSourceIndexCache().analyze(scope, [
      { id: 'episode-1', content: '角色：沈烈' },
      { id: 'episode-2', content: '第2集\n正文：\n场景：车站\n动作：列车驶离。' },
    ])
    expect(result.names.character).toEqual(['沈烈'])
    expect(result.names.scene).toEqual(['车站'])
  })

  it('does not extend an unclosed asset manifest into a later episode body', () => {
    const result = new ScriptAssetSourceIndexCache().analyze(scope, [
      { id: 'episode-1', content: '资产：\n人物：沈烈｜外观：灰衣' },
      { id: 'episode-2', content: '场景：书店\n动作：两人进门。' },
    ])
    expect(result.manifest.scene).toEqual([])
    expect(result.names.scene).toContain('书店')
    expect(result.manifest.character[0]?.facts).toEqual({ 外观: '灰衣' })
  })

  const sources = [
    {
      id: 'episode-1',
      content:
        '资产：\n人物：沈烈｜版本：标准版本｜性别：男｜外观：灰衣\n道具：铜钥匙｜材质：铜\n正文：\n场次：1｜角色：沈烈、林雨｜场景：老车站候车大厅｜动作：林雨提及父亲。',
    },
    {
      id: 'episode-2',
      content:
        '资产：\n人物：沈烈-标准版本｜外观：灰色磨损防水外衣｜性别：女\n人物：沈烈｜版本：少年版本｜外观：白色校服\n道具：铜钥匙｜材质：黄铜铸造\n正文：\n场次：2｜角色：沈烈-少年版本、陈诚｜场景：老车站｜道具：旧地图｜动作：两人出站。',
    },
  ]

  it('matches full-source manifests, longest facts and global character variant deduplication', () => {
    const cache = new ScriptAssetSourceIndexCache()
    const combined = sources.map((source) => source.content).join('\n\n')
    const result = cache.analyze(scope, sources)
    expect(result.manifest).toEqual(extractScriptAssetManifest(combined))
    expect(result.manifest.character[0]?.facts).toMatchObject({ 性别: '男', 外观: '灰色磨损防水外衣' })
    expect(result.names.character).toEqual(['沈烈-标准版本', '沈烈-少年版本', '林雨', '陈诚'])
    for (const kind of Object.keys(SCRIPT_ASSET_NAME_FIELDS) as ScriptAssetKind[]) {
      expect(result.names[kind]).toEqual(
        namesFromManifestOrFields(
          combined,
          result.manifest,
          kind,
          SCRIPT_ASSET_NAME_FIELDS[kind],
          [],
          Number.POSITIVE_INFINITY,
        ),
      )
    }
    expect(extractScriptAssetNameIndex(combined, result)).toEqual(extractScriptAssetNameIndex(combined))
    // Removing the source of a longer fact must reveal the earlier short fact.
    expect(cache.analyze(scope, sources.slice(0, 1)).manifest.character[0]?.facts['外观']).toBe('灰衣')
  })

  it('does not allow returned aggregates or names to poison future cache hits', () => {
    const cache = new ScriptAssetSourceIndexCache()
    const result = cache.analyze(scope, sources)
    const expected = structuredClone(result)
    result.manifest.character[0]!.facts['外观'] = '污染'
    result.manifest.character[0]!.name = '伪造人物'
    result.manifest.prop.length = 0
    result.fieldNames.character.push('虚构人物')
    result.names.character[0] = '虚构人物'
    const repeated = cache.analyze(scope, sources)
    expect(repeated.manifest).toEqual(expected.manifest)
    expect(repeated.fieldNames).toEqual(expected.fieldNames)
    expect(repeated.names).toEqual(expected.names)
    expect(repeated.stats.hits).toBe(2)
  })

  it('keeps all names for fallback, while normalization retains its existing display limits', () => {
    const content = '道具：' + Array.from({ length: 2_010 }, (_, index) => `铜钥匙${index}`).join('、')
    const result = new ScriptAssetSourceIndexCache().analyze(scope, [{ id: 'episode-1', content }])
    expect(result.names.prop).toHaveLength(2_010)
    expect(result.names.prop.at(-1)).toBe('铜钥匙2009')
    expect(extractScriptAssetNameIndex(content, result).prop).toHaveLength(10)
    expect(extractScriptAssetNameIndex(content, result)).toEqual(extractScriptAssetNameIndex(content))
  })

  it('preserves global scene-prefix dedup order instead of prematurely folding each episode', () => {
    const input = [
      { id: 'a', content: '场景：北区车站候车大厅\n动作：登车。' },
      { id: 'b', content: '场景：北区车站\n动作：进站。\n场景：北区车站侧门\n动作：出站。' },
    ]
    const combined = input.map((source) => source.content).join('\n\n')
    const result = new ScriptAssetSourceIndexCache().analyze(scope, input)
    expect(result.names.scene).toEqual(extractScriptAssetNameIndex(combined).scene)
  })

  it('does not turn narrative mentions into character assets', () => {
    const source = {
      id: 'a',
      content: '场次：1｜角色：林雨｜场景：旧宅｜动作：林雨翻看父亲的照片，怀念母亲。',
    }
    const result = new ScriptAssetSourceIndexCache().analyze(scope, [source])
    expect(result.names.character).toEqual(['林雨'])
    expect(result.names.prop).toEqual([])
  })
})
