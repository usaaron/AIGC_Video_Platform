import { describe, expect, it } from 'vitest'
import {
  assetSuggestionRevision,
  scriptGenerationTaskLabel,
  scriptSegmentTaskLabel,
} from './scriptTaskLabels'

describe('script task labels', () => {
  it.each([
    ['advertisement', '广告脚本', '延长广告脚本'],
    ['animation', '短片剧本', '续写短片'],
    ['short-drama', '生成本集', '续写下一集'],
  ])('uses content-specific labels for %s', (contentType, generation, segment) => {
    expect(scriptGenerationTaskLabel(contentType)).toBe(generation)
    expect(scriptSegmentTaskLabel(contentType)).toBe(segment)
  })
})

describe('asset suggestion revision', () => {
  it('is stable regardless of asset order', () => {
    const left = [
      { id: 'b', updatedAt: '2' },
      { id: 'a', updatedAt: '1' },
    ]
    expect(assetSuggestionRevision(left)).toBe(assetSuggestionRevision([...left].reverse()))
    expect(assetSuggestionRevision([])).toBe('none')
  })
})
