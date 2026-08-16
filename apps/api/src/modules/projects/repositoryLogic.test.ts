import type { Asset } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { defaultAssetAttributes } from '../../infra/store.js'
import { mergeAssetAttributes } from './repository.js'

function characterAsset(status: 'processing' | 'active', checkedAt: string): Asset {
  return {
    id: 'character-1',
    projectId: 'project-1',
    tenantId: 'tenant-1',
    kind: 'character',
    sourceMode: 'generate',
    name: '林夏',
    description: '',
    prompt: '',
    promptMode: 'standard',
    customPromptMode: 'append',
    customPrompt: '',
    negativePrompt: '',
    references: [],
    attributes: {
      ...defaultAssetAttributes('character'),
      faceStatus: 'approved',
      trustedPortrait: {
        assetId: 'maas-active',
        groupId: 'group-1',
        groupType: 'AIGC',
        name: '林夏-面部基准',
        status,
        previewUrl: null,
        errorCode: null,
        errorMessage: null,
        checkedAt,
      },
    },
    imageUrl: null,
    status: 'draft',
    createdAt: checkedAt,
    updatedAt: checkedAt,
  }
}

describe('mergeAssetAttributes', () => {
  it('does not regress an active trusted portrait with stale editor attributes', () => {
    const current = characterAsset('active', '2026-08-13T00:10:00.000Z')
    const stale = characterAsset('processing', '2026-08-13T00:00:00.000Z').attributes

    expect(mergeAssetAttributes(current, stale)).toMatchObject({
      trustedPortrait: { assetId: 'maas-active', status: 'active' },
    })
  })

  it('accepts a newer active trusted portrait while preserving other character edits', () => {
    const current = characterAsset('processing', '2026-08-13T00:00:00.000Z')
    const incoming = characterAsset('active', '2026-08-13T00:10:00.000Z').attributes
    incoming.hairColor = 'black'

    expect(mergeAssetAttributes(current, incoming)).toMatchObject({
      hairColor: 'black',
      trustedPortrait: { status: 'active' },
    })
  })
})
