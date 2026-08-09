import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAssetPreviewUrl, warmAssetPreviewCache } from './assetPreview'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('asset preview selection', () => {
  it('uses the full-body image as a character card cover once it exists', () => {
    expect(
      getAssetPreviewUrl({
        kind: 'character',
        imageUrl: '/full-body.png',
        references: [{ url: '/imported.png' }],
        attributes: { faceReference: { url: '/approved-face.png' } },
      }),
    ).toBe('/full-body.png')
  })

  it('prefers an approved body reference over the older face reference', () => {
    expect(
      getAssetPreviewUrl({
        kind: 'character',
        imageUrl: '/old-cover.png',
        references: [],
        attributes: {
          faceReference: { url: '/approved-face.png' },
          bodyReference: { url: '/approved-body.png' },
        },
      }),
    ).toBe('/approved-body.png')
  })

  it('falls back to the current image and imported reference', () => {
    expect(getAssetPreviewUrl({ kind: 'scene', imageUrl: '/scene.png', references: [] })).toBe('/scene.png')
    expect(getAssetPreviewUrl({ kind: 'prop', imageUrl: null, references: [{ url: '/prop.png' }] })).toBe(
      '/prop.png',
    )
    expect(getAssetPreviewUrl({ kind: 'audio', imageUrl: '/ignored.png' })).toBeNull()
  })

  it('keeps one decoded image object per stable preview URL', () => {
    let imageCount = 0
    class FakeImage {
      constructor() {
        imageCount += 1
      }

      set src(_value) {
        this.onload?.()
      }
    }
    vi.stubGlobal('window', { Image: FakeImage })
    const assets = [{ kind: 'character', imageUrl: '/cache-character-1.png', attributes: {} }]

    warmAssetPreviewCache(assets)
    warmAssetPreviewCache(assets)

    expect(imageCount).toBe(1)
  })
})
