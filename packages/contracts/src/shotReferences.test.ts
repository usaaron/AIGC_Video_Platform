import { describe, expect, it } from 'vitest'
import { createShotSchema, updateShotSchema } from './project.js'

describe('shot reference images contract', () => {
  it('preserves ordering, legacy omission and explicit clearing', () => {
    const referenceImages = [{ url: '/api/v1/media/b', name: '服装' }, { url: 'https://example.com/a.png' }]
    expect(createShotSchema.parse({ title: '镜头', referenceImages }).referenceImages).toEqual(
      referenceImages,
    )
    expect(createShotSchema.parse({ title: '镜头' }).referenceImages).toBeUndefined()
    expect(updateShotSchema.parse({ referenceImages: [] })).toEqual({ referenceImages: [] })
  })
  it('rejects duplicate, excess, transient and non-image-route references', () => {
    for (const referenceImages of [
      [{ url: '/api/v1/media/a' }, { url: '/api/v1/media/a' }],
      Array.from({ length: 10 }, (_, i) => ({ url: `/api/v1/media/${i}` })),
      [{ url: 'blob:local-image' }],
      [{ url: 'javascript:alert(1)' }],
      [{ url: '/api/v1/billing' }],
    ])
      expect(updateShotSchema.safeParse({ referenceImages }).success).toBe(false)
  })
})
