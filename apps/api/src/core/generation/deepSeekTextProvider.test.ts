import { describe, expect, it } from 'vitest'
import { DeepSeekTextProvider } from './deepSeekTextProvider.js'

describe('DeepSeekTextProvider', () => {
  it('uses the StringX OpenAI-compatible chat completions endpoint', async () => {
    let capturedUrl = ''
    let capturedBody = ''
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = String(init?.body)
      return Response.json({ choices: [{ message: { content: '边城第一章概要' } }] })
    }) as typeof fetch
    const provider = new DeepSeekTextProvider({
      baseUrl: 'https://maas.stringx.top/',
      apiKey: 'test-key',
      model: 'deepseekV3',
      requestTimeoutMs: 180_000,
      fetcher,
    })

    await expect(
      provider.generate({
        systemPrompt: '整理中文小说章节摘要',
        userPrompt: '请摘要第一章',
        maxOutputTokens: 2_000,
      }),
    ).resolves.toBe('边城第一章概要')

    expect(capturedUrl).toBe('https://maas.stringx.top/api/v1/chat/completions')
    expect(JSON.parse(capturedBody)).toMatchObject({
      model: 'deepseekV3',
      max_tokens: 2_000,
      max_completion_tokens: 2_000,
      stream: true,
      messages: [
        { role: 'system', content: '整理中文小说章节摘要' },
        { role: 'user', content: '请摘要第一章' },
      ],
    })
  })

  it('allows a request-level DeepSeek model override', async () => {
    let capturedBody = ''
    const provider = new DeepSeekTextProvider({
      baseUrl: 'https://maas.stringx.top',
      apiKey: 'test-key',
      model: 'deepseekV3',
      requestTimeoutMs: 180_000,
      fetcher: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = String(init?.body)
        return Response.json({ choices: [{ message: { content: 'ok' } }] })
      }) as typeof fetch,
    })

    await provider.generate({
      systemPrompt: 'test',
      userPrompt: 'test',
      model: 'deepseek-chat',
    })

    expect(JSON.parse(capturedBody).model).toBe('deepseek-chat')
  })

  it('assembles streamed completion chunks', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"翠翠"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"与渡口"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const provider = new DeepSeekTextProvider({
      baseUrl: 'https://maas.stringx.top',
      apiKey: 'test-key',
      model: 'deepseekV3',
      requestTimeoutMs: 180_000,
      fetcher: (async () =>
        new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch,
    })

    await expect(provider.generate({ systemPrompt: '摘要', userPrompt: '边城' })).resolves.toBe('翠翠与渡口')
  })
})
