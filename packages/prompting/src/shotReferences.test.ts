import { describe, expect, it } from 'vitest'
import { compileStoryboardVideoPrompt } from './videoPromptCompiler.js'
import { orderedVideoReferenceImages, shotReferenceImages, validateShotReferences } from './shotReferences.js'

describe('numbered shot references', () => {
  it('migrates a legacy manual image but respects clearing and generated covers', () => {
    expect(shotReferenceImages({ imageUrl: '/api/v1/media/old' })).toHaveLength(1)
    expect(shotReferenceImages({ imageUrl: '/api/v1/media/old', referenceImages: [] })).toEqual([])
    expect(shotReferenceImages({ imageUrl: '/api/v1/generation/tasks/cover/outputs/single' })).toEqual([])
    expect(
      shotReferenceImages({ imageUrl: 'https://example.com/generated.png', selectedImageTaskId: 'cover' }),
    ).toEqual([])
  })
  it('retains explicit images before optional asset images and refuses overflow', () => {
    expect(orderedVideoReferenceImages(['b', 'a'], ['a', 'c', 'd'], 3)).toEqual(['b', 'a', 'c'])
    expect(() => orderedVideoReferenceImages(['a', 'b'], [], 1)).toThrow('最多使用 1 张')
    expect(() => validateShotReferences('【图0】', 2)).toThrow('没有对应')
    expect(() => validateShotReferences('【图3】', 2)).toThrow('没有对应')
    expect(() => validateShotReferences('【图9】', 9, true)).toThrow('尾帧')
  })
  it.each(['independent', 'continue'] as const)(
    'maps %s without losing unstructured image instructions',
    (continuityMode) => {
      const prompt = '场景：舞台｜动作：转身｜使用【图1】的人物和【图2】的服装。'
      const result = compileStoryboardVideoPrompt({
        project: { aspectRatio: '16:9' },
        shot: { id: 's', prompt },
        continuityMode,
        manualReferenceCount: 2,
      })
      expect(result).toContain(
        continuityMode === 'continue'
          ? '使用【图2】的人物和【图3】的服装。'
          : '使用【图1】的人物和【图2】的服装。',
      )
      expect(prompt).toContain('【图1】')
    },
  )
})
