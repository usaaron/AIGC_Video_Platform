import { describe, expect, it } from 'vitest'
import { bindVideoAssetReferences, orderedVideoReferenceImages } from './shotReferences.js'
import { compileStoryboardVideoPrompt } from './videoPromptCompiler.js'

describe('final reference-image bindings', () => {
  it('does not describe a trusted portrait as the independently selected side view', () => {
    const [reference] = bindVideoAssetReferences(
      [
        {
          id: 'lin',
          url: '/side',
          videoUrl: 'asset://lin',
          appearanceUrl: '/side',
          role: '身份',
          appearanceRole: '侧面造型',
          view: 'side',
        },
      ],
      ['asset://lin', '/side'],
      false,
    )
    expect(reference?.imageBindings).toEqual([
      { number: 1, purpose: '身份', view: 'face' },
      { number: 2, purpose: '侧面造型' },
    ])
  })
  it.each([false, true])(
    'numbers actual retained images after duplicates and capacity, continuation=%s',
    (continuity) => {
      const references = [
        {
          id: 'lin',
          url: '/back',
          appearanceUrl: '/face',
          role: '身份与当前造型',
          appearanceRole: '面部身份',
          view: 'back',
        },
        { id: 'room', url: '/room' },
        { id: 'unavailable', url: null },
      ]
      const images = orderedVideoReferenceImages(['/back'], ['/back', '/room', '/face'], 2)
      const bound = bindVideoAssetReferences(references, images, continuity)
      expect(bound.map((item) => item.imageBindings.map((binding) => binding.number))).toEqual(
        continuity ? [[2], [3], []] : [[1], [2], []],
      )
      const prompt = compileStoryboardVideoPrompt({
        project: { aspectRatio: '16:9' },
        shot: { id: 's', prompt: '林岚背对镜头。焦点从铁棍转向林岚。', duration: 8 },
        assets: [
          { id: 'lin', name: '林岚', kind: 'character' },
          { id: 'room', name: '房间', kind: 'scene' },
          { id: 'unavailable', name: '信封', kind: 'prop' },
        ],
        references: bound,
        manualReferenceCount: 1,
        continuityMode: continuity ? 'continue' : 'independent',
      })
      expect(prompt).toContain(`图${continuity ? 2 : 1}用于身份与当前造型（背面）`)
      expect(prompt).toContain('信封”本次未附图片')
      expect(prompt).not.toContain('用于面部身份')
      expect(prompt).toContain('焦点从铁棍转向林岚')
    },
  )
  it('keeps manual numbered references ahead of every auto-selected view', () => {
    const images = orderedVideoReferenceImages(['/manual1', '/manual2'], ['/side', '/face'])
    expect(
      bindVideoAssetReferences(
        [{ id: 'a', url: '/side', appearanceUrl: '/face' }],
        images,
        true,
      )[0]?.imageBindings.map((item) => item.number),
    ).toEqual([4, 5])
  })
})
