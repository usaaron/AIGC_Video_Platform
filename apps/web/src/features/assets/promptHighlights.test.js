import { describe, expect, it } from 'vitest'
import { adjustPromptHighlights, mergePromptHighlights } from './promptHighlights'

describe('template text highlight edits', () => {
  const ranges = [{ start: 2, end: 6 }]
  it('moves the color with text inserted before a template', () => {
    expect(adjustPromptHighlights('前文模板内容结束', '新增前文模板内容结束', ranges)).toEqual([
      { start: 4, end: 8 },
    ])
  })
  it('inherits color for typing within a template and preserves the rest', () => {
    expect(adjustPromptHighlights('前文模板内容结束', '前文模板新内容结束', ranges)).toEqual([
      { start: 2, end: 7 },
    ])
    expect(adjustPromptHighlights('前文模板内容结束', '前文模板结束', ranges)).toEqual([{ start: 2, end: 4 }])
  })
  it('removes highlights when the template or whole prompt is deleted', () => {
    expect(adjustPromptHighlights('前文模板内容结束', '前文结束', ranges)).toEqual([])
    expect(adjustPromptHighlights('前文模板内容结束', '', ranges)).toEqual([])
  })
  it('does not color an asset or script inserted inside a template', () => {
    expect(
      adjustPromptHighlights('前文模板内容结束', '前文模板人物内容结束', ranges, { start: 4, end: 4 }),
    ).toEqual([
      { start: 2, end: 4 },
      { start: 6, end: 8 },
    ])
  })
  it('replaces a selected section without coloring unrelated replacement text', () => {
    expect(adjustPromptHighlights('前文模板内容结束', '前文新词结束', ranges, { start: 2, end: 6 })).toEqual(
      [],
    )
  })
  it('merges adjacent inserted templates without mutating previous state', () => {
    expect(mergePromptHighlights([...ranges, { start: 6, end: 9 }])).toEqual([{ start: 2, end: 9 }])
    expect(ranges).toEqual([{ start: 2, end: 6 }])
  })
})
