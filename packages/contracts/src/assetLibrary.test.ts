import { describe, expect, it } from 'vitest'
import {
  createAssetLibraryItemSchema,
  createAssetLibraryItemVersionSchema,
  listAssetLibraryItemsQuerySchema,
  saveProjectAssetToLibrarySchema,
} from './assetLibrary.js'

describe('library templates and categories', () => {
  it('accepts personal text templates while keeping script and image sources distinct', () => {
    const input = {
      sourceType: 'prompt-template',
      kind: 'prompt-template',
      title: '人物肖像',
      content: ' 自然光，正面半身像 ',
    }
    expect(createAssetLibraryItemSchema.parse(input)).toMatchObject({ content: '自然光，正面半身像' })
    expect(createAssetLibraryItemVersionSchema.safeParse(input).success).toBe(true)
    for (const content of [' ', '字'.repeat(20_001)])
      expect(createAssetLibraryItemSchema.safeParse({ ...input, content }).success).toBe(false)
    expect(
      createAssetLibraryItemSchema.safeParse({ ...input, sourceType: 'text', kind: 'script' }).success,
    ).toBe(false)
    expect(
      saveProjectAssetToLibrarySchema.safeParse({ title: '人物', kind: 'prompt-template' }).success,
    ).toBe(false)
    expect(listAssetLibraryItemsQuerySchema.parse({ category: 'prop', page: '2' })).toMatchObject({
      category: 'prop',
      page: 2,
    })
    expect(listAssetLibraryItemsQuerySchema.safeParse({ category: 'invalid' }).success).toBe(false)
  })
})
