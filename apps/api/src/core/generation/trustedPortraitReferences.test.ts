import type { Asset } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { trustedPortraitAliases } from './trustedPortraitReferences.js'

function character(overrides: Record<string, unknown> = {}): Asset {
  return {
    id: 'actor',
    name: 'AI 角色',
    imageUrl: '/api/v1/media/body',
    attributes: {
      type: 'character',
      subjectType: 'human',
      portraitSource: 'ai-virtual',
      faceStatus: 'approved',
      faceReference: { id: 'face', url: '/api/v1/media/face' },
      bodyReference: { id: 'body', url: '/api/v1/media/body' },
      trustedPortrait: { assetId: 'maas-ai', groupType: 'AIGC', status: 'active', faceReferenceId: 'face' },
      ...overrides,
    },
  } as Asset
}

describe('portrait video references', () => {
  it('uses the confirmed AI face for DoraRouter, including recovered asset URIs', () => {
    const aliases = trustedPortraitAliases([character()], 'dora-router-seedance')
    expect(aliases.get('/api/v1/media/body')).toBe('/api/v1/media/face')
    expect(aliases.get('asset://maas-ai')).toBe('/api/v1/media/face')
  })

  it('preserves material URIs for providers that accept them', () => {
    expect(trustedPortraitAliases([character()], 'stringx-seedance').get('/api/v1/media/face')).toBe(
      'asset://maas-ai',
    )
  })

  it.each([
    { portraitSource: 'authorized-real' },
    { trustedPortrait: { assetId: 'maas-real', status: 'active', groupType: 'LivenessFace' } },
  ])('does not substitute a real-person resource with an unverified image', (overrides) => {
    expect(() => trustedPortraitAliases([character(overrides)], 'dora-router-seedance')).toThrow(
      '当前视频通道尚未接通真人授权资源',
    )
  })

  it.each([
    { faceStatus: 'pending' },
    { faceReference: null },
    { faceReference: { id: 'changed', url: '/api/v1/media/changed' } },
  ])('rejects absent or changed face approvals', (overrides) => {
    expect(() => trustedPortraitAliases([character(overrides)], 'dora-router-seedance')).toThrow(
      '对应的面部原图',
    )
  })

  it('does not mark a processing AI portrait as usable', () => {
    const asset = character({
      trustedPortrait: { assetId: 'maas-ai', groupType: 'AIGC', status: 'processing' },
    })
    expect(trustedPortraitAliases([asset], 'dora-router-seedance').size).toBe(0)
  })
})
