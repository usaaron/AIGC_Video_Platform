import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config.js'
import { createTextProvider, textProviderName } from './providers.js'

afterEach(() => vi.unstubAllGlobals())

describe('runtime providers', () => {
  it('routes the default GLM text model through Rehdasu', async () => {
    let capturedBody = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = String(init?.body)
        return Response.json({ choices: [{ message: { content: '可用' } }] })
      }),
    )

    const config = loadConfig({
      NODE_ENV: 'test',
      REHDASU_API_KEY: 'test-rehdasu-key',
    })
    const provider = createTextProvider(config)

    await expect(provider?.generate({ systemPrompt: '测试', userPrompt: '回复可用' })).resolves.toBe('可用')
    expect(textProviderName(config)).toBe('rehdasu')
    expect(JSON.parse(capturedBody).model).toBe('glm-5.2')
  })
})
