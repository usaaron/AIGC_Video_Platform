import { describe, expect, it } from 'vitest'
import { previewCatchupStep } from './useScriptTaskPreview'

describe('script preview catch-up', () => {
  it('reveals small updates one character at a time', () => {
    expect(previewCatchupStep('场', '场次一')).toBe('场次')
  })

  it('catches up faster when a large chunk arrives', () => {
    const target = '字'.repeat(1_300)
    expect(previewCatchupStep('', target)).toHaveLength(6)
    expect(previewCatchupStep('字'.repeat(900), target)).toHaveLength(901)
  })
})
