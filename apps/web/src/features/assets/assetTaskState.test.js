import { describe, expect, it } from 'vitest'
import {
  activeAssetImageTask,
  assetTaskCardState,
  characterAssetStatus,
  isTrustedPortraitTaskActive,
  latestAssetImageTask,
} from './assetTaskState'

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

  it('keeps the latest failure visible only while an asset has no preview', () => {
    const asset = { id: 'character-1', kind: 'character' }
    const completed = {
      id: 'older-task',
      kind: 'image',
      status: 'completed',
      updatedAt: '2026-09-01T10:00:00.000Z',
      metadata: { assetId: asset.id },
    }
    const failed = {
      id: 'latest-task',
      kind: 'image',
      status: 'failed',
      updatedAt: '2026-09-01T10:01:00.000Z',
      metadata: { assetId: asset.id },
    }

    expect(latestAssetImageTask(asset, [completed, failed])).toBe(failed)
    expect(assetTaskCardState(failed, null)).toBe('failed')
    expect(assetTaskCardState(failed, '/existing.png')).toBeNull()
  })

  it('uses the trusted portrait as the asset card status once it is active', () => {
    expect(
      characterAssetStatus({
        attributes: { faceStatus: 'approved', trustedPortrait: { status: 'active' } },
      }),
    ).toBe('可信人像可用')
  })

  it('lets a persisted active portrait override a stale running registration task', () => {
    const task = { status: 'running' }

    expect(isTrustedPortraitTaskActive({ status: 'processing' }, task)).toBe(true)
    expect(isTrustedPortraitTaskActive({ status: 'active' }, task)).toBe(false)
  })
})
