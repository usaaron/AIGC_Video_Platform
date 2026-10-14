import { describe, expect, it } from 'vitest'
import { buildTurnaroundReferences, turnaroundPreviewOutputs } from './turnaroundReferences'
import { mergeAppearanceVariant } from './CharacterWorkflow'
import { characterAppearanceVariantSchema } from '../../../../../packages/contracts/src/project'

const image = (view) => ({ id: `rain-${view}`, url: `/${view}.png`, view, mediaType: 'image' })

describe('independent view persistence', () => {
  it('keeps explicit views with the authored appearance through save-schema-restore and reorder', () => {
    const outputs = ['back', 'front', 'side'].map(image)
    const before = structuredClone(outputs)
    const saved = characterAppearanceVariantSchema.parse(
      mergeAppearanceVariant(
        {
          id: 'rain',
          name: '雨衣',
          prompt: '左胸徽章、右肩背带',
          sceneNumbers: [3],
          continuityNote: '第四场换下',
          sourceAssetId: 'costume.lin.rain',
          createdAt: '2026-10-10T00:00:00Z',
          updatedAt: '2026-10-10T00:00:00Z',
        },
        { turnaroundReferences: buildTurnaroundReferences(outputs, '林岚') },
      ),
    )
    const restored = turnaroundPreviewOutputs([...saved.turnaroundReferences].reverse())
    expect(restored.map(({ view, url, name }) => ({ view, url, name }))).toEqual([
      { view: 'front', url: '/front.png', name: '林岚-正面' },
      { view: 'side', url: '/side.png', name: '林岚-侧面' },
      { view: 'back', url: '/back.png', name: '林岚-背面' },
    ])
    expect(saved).toMatchObject({
      id: 'rain',
      sourceAssetId: 'costume.lin.rain',
      sceneNumbers: [3],
      continuityNote: '第四场换下',
      prompt: '左胸徽章、右肩背带',
    })
    expect(outputs).toEqual(before)
  })

  it.each([
    ['front', 'front', 'back'],
    ['front', 'back'],
    ['single', 'single', 'single'],
    ['front', 'side', 'back', 'back'],
  ])('does not save incomplete, duplicate or overview sources: %j', (...views) => {
    expect(() => buildTurnaroundReferences(views.map(image), '林岚')).toThrow('独立源图')
  })

  it('rejects a view without a usable image', () => {
    expect(() =>
      buildTurnaroundReferences([image('front'), image('side'), { ...image('back'), url: '' }]),
    ).toThrow()
    expect(() =>
      buildTurnaroundReferences([image('front'), image('side'), { ...image('back'), mediaType: 'video' }]),
    ).toThrow()
  })

  it('renders old untagged references in their original positional order without rewriting them', () => {
    const references = ['front', 'side', 'back'].map((view) => ({
      id: view,
      url: `/${view}.png`,
      name: view,
    }))
    const before = structuredClone(references)
    expect(turnaroundPreviewOutputs(references).map((reference) => reference.view)).toEqual([
      'front',
      'side',
      'back',
    ])
    expect(references).toEqual(before)
    expect(turnaroundPreviewOutputs(undefined)).toEqual([])
  })

  it('does not silently label an untagged source in a partially tagged record as another known angle', () => {
    const restored = turnaroundPreviewOutputs([{ id: 'one', view: 'back' }, { id: 'two' }])
    expect(restored.find((reference) => reference.id === 'one').view).toBe('back')
    expect(restored.find((reference) => reference.id === 'two').view).toBeUndefined()
  })
})
