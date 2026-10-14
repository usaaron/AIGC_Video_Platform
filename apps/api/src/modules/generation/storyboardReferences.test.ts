import { describe, expect, it } from 'vitest'
import type { Asset, Shot } from '@seqora/contracts'
import { storyboardReferences } from './storyboardReferences.js'

const actor = {
  id: 'lin',
  name: '林岚',
  kind: 'character',
  imageUrl: '/old',
  attributes: {
    type: 'character',
    faceReference: { url: '/face' },
    bodyReference: { url: '/wrong' },
    activeAppearanceVariantId: 'rain',
    appearanceVariants: [
      {
        id: 'rain',
        name: '雨衣',
        description: '灰衣',
        prompt: '左胸徽章',
        bodyReference: { url: '/rain' },
        turnaroundReferences: ['back', 'front', 'side'].map((view) => ({ view, url: `/${view}` })),
      },
    ],
  },
} as unknown as Asset
const shot = { title: '林岚背影', prompt: '林岚背对镜头。', referenceImages: [] } as unknown as Shot

describe('server authoritative view selection', () => {
  it('rebuilds selected view and exact image roles from stored shot/assets without mutations', () => {
    const before = structuredClone(actor)
    const result = storyboardReferences(shot, [actor], ['lin'], false)
    expect(result.images).toEqual(['/back', '/face'])
    expect(result.references[0]).toMatchObject({
      appearance: { description: '灰衣\n左胸徽章' },
      imageBindings: [
        { number: 1, view: 'back' },
        { number: 2, purpose: '面部身份' },
      ],
    })
    expect(actor).toEqual(before)
  })
  it('reserves tail and manual numbering while omitting capacity-dropped images from bindings', () => {
    const references = Array.from({ length: 8 }, (_, i) => ({ url: `/manual${i}` }))
    const result = storyboardReferences(
      { ...shot, referenceImages: references, prompt: '林岚背对镜头，参考【图8】。' },
      [actor],
      ['lin'],
      true,
    )
    expect(result.images).toEqual(references.map((item) => item.url))
    expect(result.references[0]?.imageBindings).toEqual([])
  })
  it('rejects unknown asset IDs and missing manual tokens before generation', () => {
    expect(() => storyboardReferences(shot, [actor], ['foreign'], false)).toThrow('不存在')
    expect(() => storyboardReferences({ ...shot, prompt: '【图2】' }, [actor], ['lin'], false)).toThrow(
      '没有对应参考图',
    )
  })
})
