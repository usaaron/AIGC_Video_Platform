import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAssetPreviewUrl, portraitPreviewUrl, warmAssetPreviewCache } from './assetPreview'

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

  it('uses a completed task output while workspace writeback is refreshing', () => {
    const asset = { id: 'asset-1', kind: 'scene', imageUrl: null, references: [] }
    const task = {
      id: 'task-1',
      kind: 'image',
      status: 'completed',
      updatedAt: '2026-09-01T10:00:00.000Z',
      metadata: { assetId: asset.id },
      outputs: [{ mediaType: 'image', url: '/api/v1/generation/tasks/task-1/outputs/single' }],
    }

    expect(getAssetPreviewUrl(asset, [task])).toBe('/api/v1/generation/tasks/task-1/outputs/single')
  })

  it('uses an active trusted portrait when character previews are absent', () => {
    expect(
      getAssetPreviewUrl({
        kind: 'character',
        imageUrl: null,
        references: [],
        attributes: { trustedPortrait: { status: 'active', assetId: 'portrait-1' } },
      }),
    ).toBe('/api/v1/trusted-assets/portraits/portrait-1/preview')
  })

  it('uses the authenticated portrait proxy instead of expired upstream or asset scheme URLs', () => {
    for (const previewUrl of ['asset://portrait-1', 'https://upstream.example.test/expired.png']) {
      const portrait = { status: 'active', assetId: 'portrait-1', previewUrl }
      expect(portraitPreviewUrl(portrait)).toBe('/api/v1/trusted-assets/portraits/portrait-1/preview')
      expect(getAssetPreviewUrl({ kind: 'character', attributes: { trustedPortrait: portrait } })).toBe(
        '/api/v1/trusted-assets/portraits/portrait-1/preview',
      )
    }
    expect(portraitPreviewUrl({ status: 'active', previewUrl: 'asset://portrait-1' })).toBeNull()
    expect(portraitPreviewUrl({ status: 'processing', assetId: 'portrait-1' })).toBeNull()
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
