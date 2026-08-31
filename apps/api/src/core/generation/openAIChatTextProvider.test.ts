import { beforeEach, describe, expect, it } from 'vitest'
import { OpenAIChatTextProvider } from './openAIChatTextProvider.js'
import { usageCollector } from '../observability/usage.js'

describe('OpenAIChatTextProvider', () => {
  beforeEach(() => {
    usageCollector.resetForTests()
  })

  it('parses streamed chunks that include extra OpenAI-compatible choice fields', async () => {
    const previews: string[] = []
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
      provider.generate({
        systemPrompt: 'system',
        userPrompt: 'user',
        maxOutputTokens: 32,
        usageContext: {
          tenantId: 'tenant-1',
          organizationId: 'organization-1',
          userId: 'user-1',
          traceId: 'trace-text-usage',
        },
        onTextProgress: (text) => previews.push(text),
      }),
    ).resolves.toBe('可用')
    expect(previews).toEqual(['可', '可用'])
    expect(usageCollector.snapshot({ userId: 'user-1' })).toMatchObject({
      tpm: 3,
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    })
  })

  it('accepts array content and skips malformed streamed provider events', async () => {
    const stream = [
      'data: {not-json}',
      '',
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"剧本"}]}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"正文"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const provider = providerWithFetcher(
      async () => new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }),
    )

    await expect(provider.generate({ systemPrompt: 'system', userPrompt: 'user' })).resolves.toBe('剧本正文')
  })

  it('finishes when the upstream sends finish_reason without closing the stream', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"已完成"},"finish_reason":null}]}\n\n'),
        )
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'))
        // Deliberately leave the stream open. A compatible relay may do this.
      },
    })
    const provider = new OpenAIChatTextProvider({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'glm-5.2',
      requestTimeoutMs: 100,
      providerLabel: 'Test Provider',
      maxAttempts: 1,
      fetcher: (async () =>
        new Response(stream, { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch,
    })

    await expect(provider.generate({ systemPrompt: 'system', userPrompt: 'user' })).resolves.toBe('已完成')
  })

  it('honors a per-request timeout override while consuming a stream', async () => {
    const encoder = new TextEncoder()
    const provider = new OpenAIChatTextProvider({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'glm-5.2',
      requestTimeoutMs: 1_000,
      providerLabel: 'Test Provider',
      maxAttempts: 1,
      fetcher: (async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n'))
          },
        })
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
      }) as typeof fetch,
    })

    await expect(
      provider.generate({ systemPrompt: 'system', userPrompt: 'timeout', timeoutMs: 20 }),
    ).rejects.toMatchObject({ name: 'TextGenerationProviderError' })
  })

  it('reports response, first-token, and generation timing for a completed request', async () => {
    const timings: Array<Record<string, unknown>> = []
    const provider = providerWithFetcher(async () =>
      Response.json({ choices: [{ message: { content: '及时返回' } }] }),
    )

    await expect(
      provider.generate({
        systemPrompt: 'system',
        userPrompt: 'user',
        timingLabel: 'first-draft',
        onTextTiming: (timing) => timings.push(timing),
      }),
    ).resolves.toBe('及时返回')

    expect(timings).toHaveLength(1)
    expect(timings[0]).toMatchObject({
      label: 'first-draft',
      attempt: 1,
    })
    expect(Number(timings[0]?.responseHeadersMs)).toBeGreaterThanOrEqual(0)
    expect(Number(timings[0]?.firstTokenMs)).toBeGreaterThanOrEqual(0)
    expect(Number(timings[0]?.generationMs)).toBeGreaterThanOrEqual(0)
    expect(Number(timings[0]?.totalMs)).toBeGreaterThanOrEqual(0)
  })

  it('rejects reasoning-only responses instead of exposing internal analysis as final text', async () => {
    let calls = 0
    const timings: Array<Record<string, unknown>> = []
    const provider = providerWithFetcher(async () => {
      calls += 1
      return Response.json({ choices: [{ message: { reasoning_content: '内部推理过程' } }] })
    })

    await expect(
      provider.generate({
        systemPrompt: 'system',
        userPrompt: 'user',
        timingLabel: 'format-check',
        onTextTiming: (timing) => timings.push(timing),
      }),
    ).rejects.toMatchObject({
      name: 'TextGenerationProviderError',
      message: expect.stringContaining('格式异常'),
    })
    expect(calls).toBe(2)
    expect(timings).toHaveLength(2)
    expect(timings).toEqual([
      expect.objectContaining({ label: 'format-check', attempt: 1, outcome: 'failed' }),
      expect.objectContaining({ label: 'format-check', attempt: 2, outcome: 'failed' }),
    ])
  })

  it('retries an empty stream as a non-stream completion', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    const provider = providerWithFetcher(async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (requestBodies.length === 1) {
        return new Response('data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      return Response.json({
        choices: [{ message: { content: [{ type: 'text', text: '恢复成功' }] } }],
      })
    })

    await expect(provider.generate({ systemPrompt: 'system', userPrompt: 'user' })).resolves.toBe('恢复成功')
    expect(requestBodies.map((body) => body.stream)).toEqual([true, false])
  })

  it('falls back when an upstream rejects JSON response format', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    const provider = providerWithFetcher(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestBodies.push(body)
      if (body.response_format) return new Response('unsupported', { status: 400 })
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
    })

    await expect(
      provider.generate({ systemPrompt: 'system', userPrompt: 'user', responseFormat: 'json' }),
    ).resolves.toBe('{"ok":true}')
    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]?.response_format).toEqual({ type: 'json_object' })
    expect(requestBodies[1]?.response_format).toBeUndefined()
  })
})

function providerWithFetcher(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return new OpenAIChatTextProvider({
    baseUrl: 'https://example.com',
    apiKey: 'test-key',
    model: 'glm-5.2',
    requestTimeoutMs: 30_000,
    providerLabel: 'Test Provider',
    fetcher: fetcher as typeof fetch,
  })
}
