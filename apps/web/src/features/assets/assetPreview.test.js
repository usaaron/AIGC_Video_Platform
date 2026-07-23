import { describe, expect, it } from 'vitest'
import { getAssetPreviewUrl } from './assetPreview'

describe('asset preview selection', () => {
  it('keeps the confirmed face as a character card cover', () => {
    expect(
      getAssetPreviewUrl({
        kind: 'character',
        imageUrl: '/full-body.png',
        references: [{ url: '/imported.png' }],
        attributes: { faceReference: { url: '/approved-face.png' } },
      }),
    ).toBe('/approved-face.png')
  })

  it('falls back to the current image and imported reference', () => {
    expect(getAssetPreviewUrl({ kind: 'scene', imageUrl: '/scene.png', references: [] })).toBe('/scene.png')
    expect(getAssetPreviewUrl({ kind: 'prop', imageUrl: null, references: [{ url: '/prop.png' }] })).toBe(
      '/prop.png',
    )
    expect(getAssetPreviewUrl({ kind: 'audio', imageUrl: '/ignored.png' })).toBeNull()
  })
})
