import { describe, expect, it } from 'vitest'
import { activeAssetImageTask, characterAssetStatus } from './assetTaskState'

describe('asset task state', () => {
  it('does not show a trusted portrait task as image production progress', () => {
    const asset = { id: 'character-1', kind: 'character' }
    const task = {
      id: 'trusted-task',
      kind: 'text',
      status: 'running',
      progress: 8,
      metadata: { assetId: asset.id, generationStage: 'trusted-portrait' },
    }

    expect(activeAssetImageTask(asset, [task])).toBeUndefined()
  })

  it('keeps a real image task visible while it is running', () => {
    const asset = { id: 'character-1', kind: 'character' }
    const task = {
      id: 'face-task',
      kind: 'image',
      status: 'running',
      progress: 8,
      metadata: { assetId: asset.id, generationStage: 'face' },
    }

    expect(activeAssetImageTask(asset, [task])).toBe(task)
  })

  it('uses the trusted portrait as the asset card status once it is active', () => {
    expect(
      characterAssetStatus({
        attributes: { faceStatus: 'approved', trustedPortrait: { status: 'active' } },
      }),
    ).toBe('可信人像可用')
  })
})
