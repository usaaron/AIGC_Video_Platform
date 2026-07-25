import { describe, expect, it } from 'vitest'
import { TokenAdventTextProvider } from './tokenAdventTextProvider.js'

describe('TokenAdventTextProvider', () => {
  it('returns chat completion text', async () => {
    let capturedBody = ''
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body)
      return Response.json({ choices: [{ message: { content: '场景：雨夜车站' } }] })
    }) as typeof fetch
    const provider = new TokenAdventTextProvider({
      baseUrl: 'https://tokenadvent.example',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      requestTimeoutMs: 180_000,
      fetcher,
    })

    await expect(
      provider.generate({
        systemPrompt: '编写中文剧本',
        userPrompt: '一个雨夜重逢的故事',
        maxOutputTokens: 6_000,
      }),
    ).resolves.toBe('场景：雨夜车站')
    expect(JSON.parse(capturedBody)).toMatchObject({
      model: 'gpt-5.4',
      max_completion_tokens: 6_000,
      stream: true,
      messages: [
        { role: 'system', content: '编写中文剧本' },
        { role: 'user', content: '一个雨夜重逢的故事' },
      ],
    })
  })

  it('assembles streamed completion chunks', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"雨夜"}}]}\n'))
        controller.enqueue(encoder.encode('\ndata: {"choices":[{"delta":{"content":"车站"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const provider = createProvider(
      async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
    )

    await expect(provider.generate({ systemPrompt: '编写中文剧本', userPrompt: '雨夜车站' })).resolves.toBe(
      '雨夜车站',
    )
  })

  it('times out an unfinished streamed completion', async () => {
    let calls = 0
    const encoder = new TextEncoder()
    const provider = new TokenAdventTextProvider({
      baseUrl: 'https://tokenadvent.example',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      requestTimeoutMs: 20,
      fetcher: (async () => {
        calls += 1
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
          },
        })
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      }) as typeof fetch,
    })

    await expect(
      provider.generate({ systemPrompt: 'test', userPrompt: 'stream timeout' }),
    ).rejects.toMatchObject({
      name: 'TextGenerationProviderError',
    })
    expect(calls).toBe(2)
  })

  it('retries a transient connection failure once', async () => {
    let calls = 0
    const provider = createProvider(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return Response.json({ choices: [{ message: { content: '连接恢复' } }] })
    })

    await expect(provider.generate({ systemPrompt: '测试', userPrompt: '重试' })).resolves.toBe('连接恢复')
    expect(calls).toBe(2)
  })

  it('returns an actionable error after repeated connection failures', async () => {
    const provider = createProvider(async () => {
      throw new TypeError('other side closed')
    })

    await expect(provider.generate({ systemPrompt: '测试', userPrompt: '失败' })).rejects.toMatchObject({
      name: 'TextGenerationProviderError',
      message: expect.stringContaining('连接中断'),
    })
  })
})

function createProvider(fetcher: typeof fetch): TokenAdventTextProvider {
  return new TokenAdventTextProvider({
    baseUrl: 'https://tokenadvent.example',
    apiKey: 'test-key',
    model: 'gpt-5.4',
    requestTimeoutMs: 180_000,
    fetcher,
  })
}
