import { describe, expect, it } from 'vitest'
import type { Asset, GenerationTask } from '@seqora/contracts'
import { defaultAssetAttributes } from '../../infra/store.js'
import { writeCharacterAppearance } from './characterAppearanceWriteback.js'
describe('queued outfit writeback', () => {
  it('stores to the queued outfit, preserves the active look, and discards results after face replacement', () => {
    const attributes = {
      ...defaultAssetAttributes('character'),
      faceReference: { id: 'face-1', url: '/face' },
      activeAppearanceVariantId: 'standard',
      appearanceVariants: [
        { id: 'standard', name: '林晚-标准版', bodyReference: null },
        { id: 'work', name: '林晚-工作服版', bodyReference: null },
      ],
    }
    const asset = { attributes } as unknown as Asset
    const task = {
      metadata: {
        generationStage: 'body',
        attributes: { activeAppearanceVariantId: 'work', faceReference: { id: 'face-1' } },
      },
      outputs: [{ id: 'body-work', url: '/work', mediaType: 'image', view: 'single' }],
      updatedAt: new Date().toISOString(),
    } as unknown as GenerationTask
    expect(writeCharacterAppearance(asset, task)).toBe(false)
    expect(attributes.appearanceVariants[1].bodyReference).toMatchObject({ id: 'body-work' })
    expect(attributes.appearanceVariants[0].bodyReference).toBeNull()
    attributes.faceReference.id = 'new-face'
    task.outputs[0].id = 'stale-result'
    expect(writeCharacterAppearance(asset, task)).toBe(false)
    expect(attributes.appearanceVariants[1].bodyReference).toMatchObject({ id: 'body-work' })
  })
})
