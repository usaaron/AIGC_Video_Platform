import { describe, expect, it } from 'vitest'
import { restoreScriptAssetSuggestionsCache, saveScriptAssetSuggestionsCache } from './assetSuggestionCache'

const direction = {
  style: 'auto',
  composition: 'auto',
  lighting: 'auto',
  camera: 'auto',
  focus: 'balanced',
}

const result = {
  generatedAt: '2026-07-27T00:00:00.000Z',
  summary: '核心资产建议',
  warnings: [],
  assets: [
    {
      kind: 'character',
      name: '翠翠',
      description: '渡口少女',
      prompt: '十三岁湘西少女，朴素衣着',
      negativePrompt: '',
      reason: '主角，需要保持一致',
      priority: 1,
      attributes: { type: 'character' },
    },
  ],
}

describe('script asset suggestion cache', () => {
  it('restores cached suggestions for the same script, direction, and model', () => {
    const storage = memoryStorage()

    saveScriptAssetSuggestionsCache(
      'project-1',
      '第一章：渡口少女',
      direction,
      'gpt-5.6',
      result,
      new Set(['character:翠翠']),
      storage,
    )

    const restored = restoreScriptAssetSuggestionsCache('project-1', '第一章：渡口少女', storage)

    expect(restored?.result).toEqual(result)
    expect(restored?.model).toBe('gpt-5.6')
    expect(restored?.direction).toEqual(direction)
    expect(restored?.createdKeys.has('character:翠翠')).toBe(true)
  })

  it('restores the source draft that produced the cached suggestions', () => {
    const storage = memoryStorage()

    saveScriptAssetSuggestionsCache('project-1', '未保存的新剧本', direction, 'gpt-5.6', result, [], storage)

    const restored = restoreScriptAssetSuggestionsCache('project-1', '已保存的旧剧本', storage)

    expect(restored?.sourceScript).toBe('未保存的新剧本')
    expect(restored?.result).toEqual(result)
  })

  it('does not restore suggestions when the cached source and signature do not match', () => {
    const storage = memoryStorage()

    saveScriptAssetSuggestionsCache('project-1', '旧剧本', direction, 'gpt-5.6', result, [], storage)

    storage.setItem(
      'seqora:script-asset-suggestions:project-1',
      storage.getItem('seqora:script-asset-suggestions:project-1').replace('旧剧本', '新剧本'),
    )

    expect(restoreScriptAssetSuggestionsCache('project-1', '旧剧本', storage)).toBeNull()
  })

  it('ignores broken cache entries', () => {
    const storage = memoryStorage()
    storage.setItem('seqora:script-asset-suggestions:project-1', '{')

    expect(restoreScriptAssetSuggestionsCache('project-1', '剧本', storage)).toBeNull()
  })

  it('treats cache writes as best-effort', () => {
    const storage = {
      setItem() {
        throw new Error('quota exceeded')
      },
      getItem() {
        return null
      },
    }

    expect(() =>
      saveScriptAssetSuggestionsCache('project-1', '剧本', direction, 'gpt-5.6', result, [], storage),
    ).not.toThrow()
  })
})

function memoryStorage() {
  const records = new Map()
  return {
    getItem(key) {
      return records.has(key) ? records.get(key) : null
    },
    setItem(key, value) {
      records.set(key, String(value))
    },
    removeItem(key) {
      records.delete(key)
    },
  }
}
