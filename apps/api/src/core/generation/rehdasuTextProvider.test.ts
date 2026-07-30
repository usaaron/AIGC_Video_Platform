import { describe, expect, it } from 'vitest'
import { RehdasuTextProvider } from './rehdasuTextProvider.js'

describe('RehdasuTextProvider', () => {
  it('uses an OpenAI-compatible chat completions request for GLM models', async () => {
    let capturedUrl = ''
    let capturedBody = ''
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = String(init?.body)
      return Response.json({
        choices: [{ message: { content: '可用' } }],
      })
    }) as typeof fetch

    const provider = new RehdasuTextProvider({
      baseUrl: 'https://tokenadvent.com',
      apiKey: 'test-key',
      model: 'glm-5.2',
      completionsPath: '/v1/chat/completions',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    await expect(
      provider.generate({ systemPrompt: '中文摘要', userPrompt: '边城', maxOutputTokens: 20 }),
    ).resolves.toBe('可用')
    expect(capturedUrl).toBe('https://tokenadvent.com/v1/chat/completions')
    expect(JSON.parse(capturedBody)).toMatchObject({
      model: 'glm-5.2',
      max_tokens: 256,
      messages: [
        { role: 'system', content: '中文摘要' },
        { role: 'user', content: '边城' },
      ],
    })
    expect(JSON.parse(capturedBody).max_completion_tokens).toBeUndefined()
  })
})
