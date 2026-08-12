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

  it('routes the public SEQORA 5.6 alias through the configured GPT provider', async () => {
    let capturedBody = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = String(init?.body)
        return Response.json({ choices: [{ message: { content: 'available' } }] })
      }),
    )

    const config = loadConfig({
      NODE_ENV: 'test',
      TOKENADVENT_API_KEY: 'test-tokenadvent-key',
      TEXT_MODEL: 'gpt-5.6',
    })
    const provider = createTextProvider(config)

    await expect(
      provider?.generate({ systemPrompt: 'test', userPrompt: 'reply', model: 'seqora-5.6' }),
    ).resolves.toBe('available')
    expect(JSON.parse(capturedBody).model).toBe('gpt-5.6')
  })

  it('routes DeepSeek V4 Flash through its independent relay', async () => {
    let capturedUrl = ''
    let capturedBody = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedBody = String(init?.body)
        return Response.json({ choices: [{ message: { content: '可用' } }] })
      }),
    )

    const config = loadConfig({
      NODE_ENV: 'test',
      DEEPSEEK_V4_API_KEY: 'test-deepseek-v4-key',
      TEXT_MODEL: 'deepseek-v4-flash',
    })
    const provider = createTextProvider(config)

    await expect(
      provider?.generate({ systemPrompt: '测试', userPrompt: '回复可用', model: 'deepseek-v4-flash' }),
    ).resolves.toBe('可用')
    expect(textProviderName(config)).toBe('deepseek-v4-flash')
    expect(capturedUrl).toBe('https://openrouter.icu/v1/chat/completions')
    expect(JSON.parse(capturedBody).model).toBe('deepseek-v4-flash')
  })
})
