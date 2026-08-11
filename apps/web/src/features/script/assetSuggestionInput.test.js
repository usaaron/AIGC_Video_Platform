import { describe, expect, it } from 'vitest'
import { suggestionToAssetInput } from './assetSuggestionInput'

describe('suggestionToAssetInput', () => {
  it('creates a complete pending asset input from a script suggestion', () => {
    const input = suggestionToAssetInput({
      kind: 'character',
      name: ' 林夏 ',
      description: '年轻导演',
      prompt: ' 短发，正面头像 ',
      negativePrompt: '手部',
      attributes: { gender: 'female', exactAge: 28 },
    })

    expect(input).toMatchObject({
      kind: 'character',
      sourceMode: 'generate',
      name: '林夏',
      promptMode: 'advanced',
      customPromptMode: 'replace',
      customPrompt: '短发，正面头像',
      references: [],
      imageUrl: null,
      attributes: {
        type: 'character',
        gender: 'female',
        exactAge: 28,
        faceStatus: 'pending',
      },
    })
  })
})
