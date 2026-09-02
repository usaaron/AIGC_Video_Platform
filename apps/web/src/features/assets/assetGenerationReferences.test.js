import { describe, expect, it } from 'vitest'
import { assetGenerationReferences } from './assetGenerationReferences'

const bodyReference = { id: 'body', url: '/body.png', name: '人物全身参考' }
const character = {
  id: 'character-1',
  kind: 'character',
  name: '主角',
  attributes: { type: 'character', bodyReference },
}

describe('asset generation references', () => {
  it('prepends the linked character reference for a costume', () => {
    const costume = {
      kind: 'costume',
      references: [{ id: 'fabric', url: '/fabric.png' }],
      attributes: { characterAssetId: 'character-1' },
    }

    expect(assetGenerationReferences(costume, [character])).toEqual([
      bodyReference,
      { id: 'fabric', url: '/fabric.png' },
    ])
  })

  it('does not duplicate an existing character reference', () => {
    const costume = {
      kind: 'costume',
      references: [bodyReference],
      attributes: { characterAssetId: 'character-1' },
    }

    expect(assetGenerationReferences(costume, [character])).toEqual([bodyReference])
  })
})
