import { describe, expect, it } from 'vitest'
import { mergeAppearanceVariant } from './CharacterWorkflow'

describe('CharacterWorkflow wardrobe persistence', () => {
  it('keeps authored wardrobe metadata when generated references are replaced', () => {
    const previous = {
      id: 'rain',
      name: '顾砚-雨夜行动服版本',
      description: '深灰防水短款外套',
      prompt: '哑光防水面料，橙色反光条，泥水溅到裤脚',
      continuityNote: '雨夜行动沿用同一人物身份',
      sourceAssetId: 'costume:gu:rain',
      sceneNumbers: [2, 5],
      createdAt: '2026-10-01T00:00:00.000Z',
    }

    const saved = mergeAppearanceVariant(previous, {
      bodyReference: { id: 'body-rain', url: '/body-rain.png', name: '雨夜行动服' },
      turnaroundReferences: [],
      updatedAt: '2026-10-02T00:00:00.000Z',
    })

    expect(saved).toMatchObject({
      prompt: previous.prompt,
      continuityNote: previous.continuityNote,
      sourceAssetId: previous.sourceAssetId,
      sceneNumbers: previous.sceneNumbers,
      bodyReference: { id: 'body-rain' },
    })
  })
})
