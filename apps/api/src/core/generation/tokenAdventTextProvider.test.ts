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

  it('forwards a selected relay model instead of using the configured default', async () => {
    let capturedBody = ''
    let capturedAuthorization = ''
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body)
      capturedAuthorization = new Headers(init?.headers).get('authorization') || ''
      return Response.json({ choices: [{ message: { content: 'model selected' } }] })
    }) as typeof fetch
    const provider = new TokenAdventTextProvider({
      baseUrl: 'https://tokenadvent.example',
      apiKey: 'gpt-key',
      alternateApiKey: 'alternate-key',
      alternateModels: ['kimi-k3', 'glm-5.2', 'glm-5.2-fast'],
      model: 'gpt-5.6-terra',
      requestTimeoutMs: 180_000,
      fetcher,
    })

    await expect(
      provider.generate({ systemPrompt: 'test', userPrompt: 'test', model: 'glm-5.2-fast' }),
    ).resolves.toBe('model selected')
    expect(JSON.parse(capturedBody)).toMatchObject({ model: 'glm-5.2-fast' })
    expect(capturedAuthorization).toBe('Bearer alternate-key')
  })

  it('requests JSON output and retries without JSON mode when a relay rejects it', async () => {
    const capturedBodies: Array<Record<string, unknown>> = []
    const provider = createProvider((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (capturedBodies.length === 1) {
        return Response.json({ error: { message: 'response_format unsupported' } }, { status: 400 })
      }
      return Response.json({ choices: [{ message: { content: '{"summary":"ok","assets":[]}' } }] })
    }) as typeof fetch)

    await expect(
      provider.generate({ systemPrompt: 'test', userPrompt: 'test', responseFormat: 'json' }),
    ).resolves.toBe('{"summary":"ok","assets":[]}')
    expect(capturedBodies).toHaveLength(2)
    expect(capturedBodies[0]).toMatchObject({ response_format: { type: 'json_object' } })
    expect(capturedBodies[1]).not.toHaveProperty('response_format')
  })

  it('accepts GLM-style text part arrays in non-stream responses', async () => {
    const provider = createProvider(async () =>
      Response.json({
        choices: [{ message: { content: [{ type: 'text', text: 'GLM 文本结果' }] } }],
      }),
    )

    await expect(provider.generate({ systemPrompt: 'test', userPrompt: 'test' })).resolves.toBe(
      'GLM 文本结果',
    )
  })

  it('accepts result-wrapped responses from compatible relays', async () => {
    const provider = createProvider(async () =>
      Response.json({ result: { choices: [{ message: { content: '嵌套文本结果' } }] } }),
    )

    await expect(provider.generate({ systemPrompt: 'test', userPrompt: 'test' })).resolves.toBe(
      '嵌套文本结果',
    )
  })

  it('accepts result-wrapped chunks in streamed responses', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"result":{"choices":[{"delta":{"content":"嵌套"}}]}}\n\n'))
        controller.enqueue(encoder.encode('data: {"result":{"choices":[{"delta":{"content":"流"}}]}}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const provider = createProvider(
      async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
    )

    await expect(provider.generate({ systemPrompt: 'test', userPrompt: 'test' })).resolves.toBe('嵌套流')
  })

  it('accepts streamed message content fields from compatible relays', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"message":{"content":"GLM "}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"message":{"content":"流式结果"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const provider = createProvider(
      async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
    )

    await expect(provider.generate({ systemPrompt: 'test', userPrompt: 'test' })).resolves.toBe(
      'GLM 流式结果',
    )
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
