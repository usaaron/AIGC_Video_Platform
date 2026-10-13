import { describe, expect, it } from 'vitest'
import { characterAppearanceVariantSchema, characterTurnaroundReferenceSchema, mediaReferenceSchema } from './project.js'

const reference = { id: 'ref', name: '人物', url: '/ref.png' }

describe('asset reference view metadata', () => {
  it.each(['front', 'side', 'back'])('preserves an independent %s view', (view) => {
    expect(characterTurnaroundReferenceSchema.parse({ ...reference, view })).toEqual({ ...reference, view })
  })
  it('keeps historical face/body/view references readable without inventing an angle', () => {
    expect(mediaReferenceSchema.parse(reference)).toEqual(reference)
    expect(characterTurnaroundReferenceSchema.parse(reference)).toEqual(reference)
    expect(mediaReferenceSchema.parse({ ...reference, view: 'single' })).toEqual(reference)
  })
  it.each(['single', 'triptych', 'sheet', 'face'])('does not mark %s as an independent body view', (view) => {
    expect(characterTurnaroundReferenceSchema.safeParse({ ...reference, view }).success).toBe(false)
  })
  it('preserves views inside their owning appearance on serialization', () => {
    const variant = characterAppearanceVariantSchema.parse({ id: 'rain', name: '雨衣',
      createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
      turnaroundReferences: ['back', 'front', 'side'].map((view) => ({ ...reference, id: view, view })),
    })
    const restored = characterAppearanceVariantSchema.parse(JSON.parse(JSON.stringify(variant)))
    expect(restored.turnaroundReferences.map((item) => item.view)).toEqual(['back', 'front', 'side'])
  })
})
