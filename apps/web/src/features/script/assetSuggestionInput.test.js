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
      sourceFacts: { 身份: '急诊护士', 故事作用: '救下伤员' },
      attributes: { gender: 'female', exactAge: 28 },
    })

    expect(input).toMatchObject({
      kind: 'character',
      sourceMode: 'generate',
      name: '林夏',
      promptMode: 'advanced',
      customPromptMode: 'append',
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
    expect(input.description).toContain('身份：急诊护士')
    expect(input.description).not.toContain('故事作用')
    expect(input.customPrompt).not.toContain('故事作用')
  })
})
