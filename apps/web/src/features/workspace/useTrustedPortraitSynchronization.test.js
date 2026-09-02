import { describe, expect, it } from 'vitest'
import { processingTrustedPortraitRevision } from './useTrustedPortraitSynchronization'

describe('processing trusted portrait revision', () => {
  it('tracks only processing character assets in stable order', () => {
    const assets = [
      {
        id: 'b',
        attributes: { type: 'character', trustedPortrait: { status: 'processing', assetId: 'face-b' } },
      },
      { id: 'scene', attributes: { type: 'scene', trustedPortrait: { status: 'processing' } } },
      {
        id: 'a',
        attributes: { type: 'character', trustedPortrait: { status: 'ready', assetId: 'face-a' } },
      },
      {
        id: 'c',
        attributes: { type: 'character', trustedPortrait: { status: 'processing', assetId: 'face-c' } },
      },
    ]

    expect(processingTrustedPortraitRevision(assets)).toBe('b:face-b|c:face-c')
  })
})
