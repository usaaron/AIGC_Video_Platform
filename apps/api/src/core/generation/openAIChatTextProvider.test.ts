import { describe, expect, it } from 'vitest'
import { OpenAIChatTextProvider } from './openAIChatTextProvider.js'

describe('OpenAIChatTextProvider', () => {
  it('parses streamed chunks that include extra OpenAI-compatible choice fields', async () => {
    const stream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"content":"可"},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"content":"用"},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')

    const provider = new OpenAIChatTextProvider({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'glm-5.2',
      requestTimeoutMs: 30_000,
      providerLabel: 'Test Provider',
      fetcher: (async () =>
        new Response(stream, { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch,
    })

    await expect(
      provider.generate({ systemPrompt: 'system', userPrompt: 'user', maxOutputTokens: 32 }),
    ).resolves.toBe('可用')
  })
})
