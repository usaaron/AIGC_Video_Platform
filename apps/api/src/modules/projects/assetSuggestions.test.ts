import { describe, expect, it } from 'vitest'
import { DEFAULT_SCRIPT_DIRECTION } from '@seqora/contracts'
import { extractScriptAssetNameIndex } from './assetSuggestionExtraction.js'
import { fallbackAssetSuggestions, normalizeScriptAssetSuggestion } from './assetSuggestions.js'

describe('character asset suggestion presentation', () => {
  it('keeps each character fact once after fast extraction and normalization', () => {
    const script = [
      '资产：',
      '人物：沈烈-标准版本｜基础人物：沈烈｜版本：标准版本｜性别：男｜年龄段：青年｜年龄：28岁｜身份：前物流司机，幸存者｜体型：精瘦结实，肩背微弓｜脸型：窄长脸，颧骨突出｜发型：黑色寸头，发茬杂乱｜肤色：灰黄，额角有一道旧疤｜基础造型：深灰防水短外套，内穿黑T恤，黑色工装裤，系带军靴，腰间挂着一把短刀',
      '正文：',
      '沈烈走进仓库。',
    ].join('\n')
    const manifest = fallbackAssetSuggestions(script, DEFAULT_SCRIPT_DIRECTION, 'cinematic-cg').assets[0]!
    const normalized = normalizeScriptAssetSuggestion(
      manifest,
      extractScriptAssetNameIndex(script),
      script,
      'cinematic-cg',
    )!

    expect(normalized.description.match(/28岁/gu)).toHaveLength(1)
    expect(normalized.description.match(/前物流司机/gu)).toHaveLength(1)
    expect(normalized.description.match(/沈烈-标准版本/gu)).toHaveLength(1)
    expect(normalized.description.match(/体型：/gu)).toHaveLength(1)
    expect(normalized.description.match(/基础造型：/gu)).toHaveLength(1)
    expect(normalized.description.match(/剧本资产设定/gu)).toBeNull()
    expect(normalized.prompt.match(/28岁/gu)).toHaveLength(1)
    expect(normalized.prompt.match(/前物流司机/gu)).toHaveLength(1)
    expect(normalized.prompt.match(/沈烈-标准版本/gu)).toHaveLength(1)
    expect(normalized.prompt.match(/体型：/gu)).toHaveLength(1)
    expect(normalized.prompt.match(/基础造型：/gu)).toHaveLength(1)
  })
})
