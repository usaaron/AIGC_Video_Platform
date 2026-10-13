import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildScriptAssetEvidence } from './assetSuggestionProvider.js'
import type {
  ScriptAssetKind,
  ScriptAssetManifest,
  ScriptAssetNameIndex,
} from './assetSuggestionExtraction.js'
import * as assetSuggestions from './assetSuggestions.js'

const kinds: ScriptAssetKind[] = ['character', 'scene', 'prop', 'costume', 'brand']
const emptyNames = (): ScriptAssetNameIndex => ({
  character: [],
  scene: [],
  prop: [],
  costume: [],
  brand: [],
})
const emptyManifest = (): ScriptAssetManifest => ({
  character: [],
  scene: [],
  prop: [],
  costume: [],
  brand: [],
})

afterEach(() => vi.restoreAllMocks())

describe('prepared asset evidence', () => {
  it('includes delivered visual facts for plain screenplay text without re-extracting fields', () => {
    const extract = vi.spyOn(assetSuggestions, 'extractAssetNames')
    const names = { ...emptyNames(), character: ['林夏'], scene: ['车站'] }
    const manifest = emptyManifest()
    manifest.character.push({
      kind: 'character',
      name: '林夏',
      details: '',
      facts: { 性别: '女性', 服装: '蓝色棉布衬衫，黑色长裤' },
    })
    manifest.scene.push({
      kind: 'scene',
      name: '车站',
      details: '',
      facts: { 空间布局: '入口在左侧，木椅在右侧' },
    })
    const result = buildScriptAssetEvidence('INT. 车站 - DAY\n林夏靠在木椅旁，抬头望向入口。', {
      names,
      manifest,
    })
    expect(extract).not.toHaveBeenCalled()
    expect(result.candidateCount).toBe(2)
    expect(result.text).toContain('蓝色棉布衬衫，黑色长裤')
    expect(result.text).toContain('入口在左侧，木椅在右侧')
    expect(result.text).toContain('核心候选上下文')
    expect(result.text).toContain('分布式场次采样')
  })

  it('filters narrative-only manifest facts before applying visual field limits', () => {
    const manifest = emptyManifest()
    manifest.character.push({
      kind: 'character',
      name: '林夏',
      details: '此未过滤details不得进入',
      facts: {
        故事作用: '推动复仇计划',
        剧情目的: '完成偷窃',
        本场目标: '夺取信封',
        服装: '灰色粗呢外套',
        年龄: '25岁',
      },
    })
    const result = buildScriptAssetEvidence('林夏等待。', {
      names: { ...emptyNames(), character: ['林夏'] },
      manifest,
    })
    expect(result.text).toContain('灰色粗呢外套')
    expect(result.text).toContain('25岁')
    expect(result.text).not.toMatch(/推动复仇计划|完成偷窃|夺取信封|此未过滤details不得进入/)
  })

  it.each([
    ['character', 24],
    ['scene', 24],
    ['prop', 32],
    ['costume', 20],
    ['brand', 12],
  ] as const)('keeps the previous %s candidate limit and frequency ranking', (kind, limit) => {
    const names = emptyNames()
    names[kind] = Array.from({ length: limit + 1 }, (_, index) => `候选${String(index).padStart(3, '0')}号`)
    const manifest = emptyManifest()
    manifest[kind] = names[kind].map((name) => ({
      kind,
      name,
      details: '',
      facts: { 配色: `唯一外观-${name}` },
    }))
    const lastAllowed = names[kind][limit - 1]!
    const overflow = names[kind][limit]!
    const result = buildScriptAssetEvidence(`${lastAllowed}。${overflow}。${overflow}。`, { names, manifest })
    expect(result.candidateCount).toBe(12)
    expect(result.text).toContain(`唯一外观-${lastAllowed}`)
    expect(result.text).not.toContain(`唯一外观-${overflow}`)
  })

  it('bounds visual facts, candidate count and overall text even for oversized prepared inputs', () => {
    const names = emptyNames()
    const manifest = emptyManifest()
    for (const kind of kinds) {
      names[kind] = Array.from({ length: 40 }, (_, index) => `${kind}-${index}-${'名称'.repeat(100)}`)
      manifest[kind] = names[kind].map((name) => ({
        kind,
        name,
        details: '不可直接使用'.repeat(2_000),
        facts: Object.fromEntries(
          Array.from({ length: 30 }, (_, index) => [`配色${index}`, `${'蓝色'.repeat(1_000)}末尾标记`]),
        ),
      }))
    }
    const result = buildScriptAssetEvidence('没有旧格式字段的正文。'.repeat(2_000), { names, manifest })
    expect(result.candidateCount).toBe(12)
    expect(result.text.length).toBeLessThanOrEqual(12_000)
    expect(result.text).not.toContain('末尾标记')
    expect(result.text).not.toContain('不可直接使用')
  })

  it('preserves the legacy path when prepared sources are omitted', () => {
    const extract = vi.spyOn(assetSuggestions, 'extractAssetNames')
    const result = buildScriptAssetEvidence(
      '场次：S01｜角色：林夏｜场景：车站｜道具：旧雨伞\n动作：林夏走进车站。',
    )
    expect(extract).toHaveBeenCalledTimes(5)
    expect(result.text).toContain('人物候选：林夏')
    expect(result.text).toContain('场景候选：车站')
    expect(result.text).toContain('物品候选：旧雨伞')
    expect(result.text).not.toContain('已确认的可复用外观')
    expect(result.candidateCount).toBe(3)
  })
})
