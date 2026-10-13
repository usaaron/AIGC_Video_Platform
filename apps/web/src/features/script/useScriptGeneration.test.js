import { describe, expect, it } from 'vitest'
import { createOperationLock, normalizeContentDuration, readGenerationResult } from './useScriptGeneration'

describe('script generation helpers', () => {
  const config = { minimumDuration: 10, maximumDuration: 90, defaultDuration: 30 }

  it('clamps invalid and out-of-range durations', () => {
    expect(normalizeContentDuration('', config)).toBe(30)
    expect(normalizeContentDuration(2, config)).toBe(10)
    expect(normalizeContentDuration(120, config)).toBe(90)
    expect(normalizeContentDuration('45', config)).toBe(45)
  })

  it('normalizes string and object generation responses', () => {
    expect(readGenerationResult(' 剧本 ')).toEqual({ script: ' 剧本 ', warnings: [] })
    expect(readGenerationResult({ script: '正文', warnings: ['注意'] })).toEqual({
      script: '正文',
      warnings: ['注意'],
    })
    expect(() => readGenerationResult({ script: '' })).toThrow('模型没有返回有效剧本')
  })

  it('allows only one mutation operation until the first one releases its lock', () => {
    const lock = createOperationLock()

    expect(lock.acquire()).toBe(true)
    expect(lock.acquire()).toBe(false)

    lock.release()

    expect(lock.acquire()).toBe(true)
  })
})
