import { describe, expect, it } from 'vitest'
import { DEFAULT_SCRIPT_DIRECTION } from '@seqora/contracts'
import { createCharacterEvidenceContext, exactAgeFromText } from './characterEvidence.js'
import { extractScriptAssetManifest, extractScriptAssetNameIndex } from './assetSuggestionExtraction.js'
import { fallbackAssetSuggestions, normalizeScriptAssetSuggestion } from './assetSuggestions.js'

// Independent reference for the previous occurrence-based window selection.
// Keep this test-only: repeated delimiter searches are the CPU regression.
function previousEvidenceWindow(name: string, script: string): string {
  if (!name || !script) return ''
  const occurrences: string[] = []
  let searchFrom = 0
  while (searchFrom < script.length) {
    const index = script.indexOf(name, searchFrom)
    if (index < 0) break
    const lineStart = Math.max(
      script.lastIndexOf('\n', index),
      script.lastIndexOf('｜', index),
      script.lastIndexOf('|', index),
    )
    const ends = [
      script.indexOf('\n', index),
      script.indexOf('｜', index),
      script.indexOf('|', index),
    ].filter((boundary) => boundary >= 0)
    const line = script.slice(lineStart + 1, ends.length ? Math.min(...ends) : script.length)
    const listPart = line.split(/[、；;]/u).find((part) => part.includes(name))
    occurrences.push((listPart || line).trim())
    searchFrom = index + name.length
  }
  return (
    occurrences.find((value) =>
      /\d{1,3}\s*岁|男性|女性|男|女|老年|中年|青年|少年|少女|儿童|镖师|剑客|长老|导演|医生|将军/u.test(value),
    ) ||
    occurrences[0] ||
    ''
  )
}

describe('request-scoped character evidence', () => {
  it.each([
    '角色：林夏；陆川｜动作：林夏回头，林夏走开。\n角色：林夏，女性，28岁；陆川，男性，45岁',
    '角色：林夏、陆川|动作：陆川先到，林夏随后。\n人物：陆川，男性，三十八岁；林夏，女性，十八岁',
    '人物：林夏-标准版本｜性别：女\n人物：林夏-雨衣版本｜性别：女\n动作：林夏-雨衣版本走进车站。',
    '角色：林夏；陆川\n动作：林夏交谈；林夏说陆川是医生。\n对白：陆川：林夏刚走。',
    '林夏轻声提到陆川，陆川说林夏快来了。'.repeat(80),
    '角色：陆川\r\n女性林夏18岁；男性陆川38岁。',
    '',
  ])('retains previous evidence selection for %s', (script) => {
    const context = createCharacterEvidenceContext(script)
    for (const name of ['林夏', '陆川', '林夏-标准版本', '林夏-雨衣版本', '不存在', '']) {
      expect(context.evidenceFor(name)).toBe(previousEvidenceWindow(name, script))
    }
  })

  it('keeps semicolon-separated profiles and identical names in different requests isolated', () => {
    const context = createCharacterEvidenceContext(
      '人物：林夏女性28岁；陆川男性四十五岁｜动作：林夏看向陆川。',
    )
    expect(context.evidenceFor('林夏')).toBe('人物：林夏女性28岁')
    expect(context.evidenceFor('陆川')).toBe('陆川男性四十五岁')
    expect(context.exactAgeFor('林夏')).toBe(28)
    expect(context.exactAgeFor('陆川')).toBe(45)
    expect(createCharacterEvidenceContext('人物：林夏女性十八岁').exactAgeFor('林夏')).toBe(18)
    expect(context.exactAgeFor('林夏')).toBe(28)
  })

  it.each([
    ['28岁的林夏走进车站', 28],
    ['林夏今年18岁', 18],
    ['林夏二十八岁', 28],
    ['林夏两岁', 2],
    ['林夏一百零二岁', 102],
    ['林夏120岁', 120],
    ['林夏0岁', null],
    ['林夏没有注明年龄', null],
  ])('retains exact age parsing for %s', (script, expected) => {
    expect(createCharacterEvidenceContext(script).exactAgeFor('林夏')).toBe(expected)
    expect(exactAgeFromText(script)).toBe(expected)
  })

  it('rejects out-of-range explicit manifest ages', () => {
    expect(exactAgeFromText('121岁')).toBeNull()
    expect(exactAgeFromText('零岁')).toBeNull()
    expect(exactAgeFromText('一百二十一岁')).toBeNull()
  })

  it('retains nearby age pattern fallback when the first plain mention has no age', () => {
    const script = '林夏登场\n二十八岁的林夏走进车站。'
    const context = createCharacterEvidenceContext(script)
    expect(context.evidenceFor('林夏')).toBe('林夏登场')
    expect(context.exactAgeFor('林夏')).toBe(28)
    expect(createCharacterEvidenceContext('角色：少年十八岁').exactAgeFor('少年十八岁')).toBe(18)
  })

  it('handles long text with repeated names and no structural delimiters', () => {
    const script = '林夏28岁，陆川等待，林夏走近。'.repeat(1_000)
    const context = createCharacterEvidenceContext(script)
    expect(context.evidenceFor('林夏')).toBe(previousEvidenceWindow('林夏', script))
    expect(context.exactAgeFor('林夏')).toBe(28)
    expect(context.evidenceFor('没有出现的人物')).toBe('')
  })
})

describe('character suggestion evidence integration', () => {
  const script = [
    '资产：',
    '人物：林夏-标准版本｜基础人物：林夏｜版本：标准版本｜性别：女｜年龄：十八岁｜年龄段：少年',
    '人物：林夏-未来版本｜基础人物：林夏｜版本：未来版本｜性别：女｜年龄：三十八岁｜年龄段：中年',
    '人物：陆川｜性别：男｜年龄：28岁',
    '正文：',
    '角色：林夏-标准版本；林夏-未来版本；陆川',
    '动作：陆川提起陈叔，陈叔不在现场。',
  ].join('\n')

  it('gives identical fallback and normalized outputs with a shared context or local contexts', () => {
    const manifest = extractScriptAssetManifest(script)
    const names = extractScriptAssetNameIndex(script)
    const context = createCharacterEvidenceContext(script)
    const local = fallbackAssetSuggestions(script, DEFAULT_SCRIPT_DIRECTION, 'cinematic-cg', manifest, names)
    const shared = fallbackAssetSuggestions(
      script,
      DEFAULT_SCRIPT_DIRECTION,
      'cinematic-cg',
      manifest,
      names,
      context,
    )
    expect(shared).toEqual(local)
    expect(shared.assets.map((asset) => asset.name)).toEqual(['林夏-标准版本', '林夏-未来版本', '陆川'])
    expect(shared.assets.map((asset) => asset.attributes)).toEqual([
      expect.objectContaining({ gender: 'female', exactAge: 18, ageGroup: 'teen' }),
      expect.objectContaining({ gender: 'female', exactAge: 38, ageGroup: 'middle' }),
      expect.objectContaining({ gender: 'male', exactAge: 28, ageGroup: 'young' }),
    ])
    for (const asset of shared.assets) {
      expect(normalizeScriptAssetSuggestion(asset, names, script, 'cinematic-cg', manifest, context)).toEqual(
        normalizeScriptAssetSuggestion(asset, names, script, 'cinematic-cg', manifest),
      )
    }
  })

  it('keeps explicit manifest gender and age stronger than conflicting model or nearby text', () => {
    const manifest = extractScriptAssetManifest(script)
    const names = extractScriptAssetNameIndex(script)
    const character = fallbackAssetSuggestions(script, DEFAULT_SCRIPT_DIRECTION).assets[0]!
    if (character.kind !== 'character') throw new Error('Expected character fixture')
    const contradictory = {
      ...character,
      description: '男性，45岁，中年人',
      prompt: '男性医生，45岁',
      attributes: {
        ...character.attributes,
        gender: 'male' as const,
        exactAge: 45,
        ageGroup: 'middle' as const,
      },
    }
    const result = normalizeScriptAssetSuggestion(contradictory, names, script, 'cinematic-cg', manifest)!
    expect(result.attributes).toMatchObject({ gender: 'female', exactAge: 18, ageGroup: 'teen' })
  })

  it('retains an explicit age group when no exact age is supplied', () => {
    const source = '资产：\n人物：林夏｜性别：女｜年龄段：老年\n正文：\n角色：林夏'
    const manifest = extractScriptAssetManifest(source)
    const character = fallbackAssetSuggestions(source, DEFAULT_SCRIPT_DIRECTION).assets[0]!
    if (character.kind !== 'character') throw new Error('Expected character fixture')
    const suggestion = { ...character, description: '年轻少女', prompt: '少女在等待' }
    const result = normalizeScriptAssetSuggestion(
      suggestion,
      extractScriptAssetNameIndex(source),
      source,
      'cinematic-cg',
      manifest,
    )!
    expect(result.attributes).toMatchObject({ gender: 'female', exactAge: null, ageGroup: 'senior' })
  })
})
