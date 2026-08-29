import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config.js'
import { createImageProvider, createTextProvider, textProviderName } from './providers.js'

afterEach(() => vi.unstubAllGlobals())

describe('runtime providers', () => {
  it('routes an explicitly selected GLM text model through Rehdasu', async () => {
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
      TEXT_MODEL: 'glm-5.2',
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
      REHDASU_API_KEY: 'test-rehdasu-key',
    })
    const provider = createTextProvider(config)

    await expect(
      provider?.generate({ systemPrompt: 'test', userPrompt: 'reply', model: 'seqora-5.6' }),
    ).resolves.toBe('available')
    expect(JSON.parse(capturedBody).model).toBe('gpt-5.6-sol')
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
    expect(capturedUrl).toBe('https://hk.shanyoucloud.com/v1/chat/completions')
    expect(JSON.parse(capturedBody).model).toBe('deepseek-v4-flash')
  })

  it('routes DeepSeek V4 Pro through the same independent relay without replacing the model', async () => {
    let capturedBody = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = String(init?.body)
        return Response.json({ choices: [{ message: { content: 'Pro 可用' } }] })
      }),
    )

    const config = loadConfig({
      NODE_ENV: 'test',
      DEEPSEEK_V4_API_KEY: 'test-deepseek-v4-key',
      TEXT_MODEL: 'deepseek-v4-pro',
    })
    const provider = createTextProvider(config)

    await expect(
      provider?.generate({ systemPrompt: '测试', userPrompt: '回复可用', model: 'deepseek-v4-pro' }),
    ).resolves.toBe('Pro 可用')
    expect(textProviderName(config)).toBe('deepseek-v4-pro')
    expect(JSON.parse(capturedBody).model).toBe('deepseek-v4-pro')
  })

  it('falls back to GLM 5.2 when the DeepSeek V4 relay is unavailable', async () => {
    const requests: Array<{ url: string; model: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model: string }
        requests.push({ url: String(input), model: body.model })
        if (String(input).includes('shanyoucloud.com')) {
          return new Response('Bad gateway', { status: 502 })
        }
        return Response.json({ choices: [{ message: { content: 'GLM 回退可用' } }] })
      }),
    )

    const config = loadConfig({
      NODE_ENV: 'test',
      DEEPSEEK_V4_API_KEY: 'test-deepseek-v4-key',
      REHDASU_API_KEY: 'test-rehdasu-key',
      TEXT_MODEL: 'deepseek-v4-flash',
    })
    const provider = createTextProvider(config)

    await expect(
      provider?.generate({ systemPrompt: '测试', userPrompt: '回复可用', model: 'deepseek-v4-flash' }),
    ).resolves.toBe('GLM 回退可用')
    expect(requests.filter((request) => request.url.includes('shanyoucloud.com'))).toHaveLength(1)
    expect(requests.at(-1)).toMatchObject({ model: 'glm-5.2' })
  })

  it('falls back without retrying a timed out DeepSeek V4 request', async () => {
    const requests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input))
        if (String(input).includes('shanyoucloud.com')) {
          const timeout = new Error('The operation was aborted due to timeout')
          timeout.name = 'TimeoutError'
          throw timeout
        }
        return Response.json({ choices: [{ message: { content: 'GLM timeout fallback' } }] })
      }),
    )

    const config = loadConfig({
      NODE_ENV: 'test',
      DEEPSEEK_V4_API_KEY: 'test-deepseek-v4-key',
      REHDASU_API_KEY: 'test-rehdasu-key',
    })
    const provider = createTextProvider(config)

    await expect(
      provider?.generate({ systemPrompt: 'test', userPrompt: 'reply', model: 'deepseek-v4-flash' }),
    ).resolves.toBe('GLM timeout fallback')
    expect(requests.filter((url) => url.includes('shanyoucloud.com'))).toHaveLength(1)
    expect(requests.at(-1)).toContain('tokenadvent.com')
  })

  it('uses Seqora image2 aliases for image generation without configuring TokenAdvent text', async () => {
    let capturedUrl = ''
    let capturedAuthorization = ''
    let capturedBody = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedAuthorization = String(new Headers(init?.headers).get('Authorization'))
        capturedBody = String(init?.body)
        return Response.json({ data: [{ b64_json: 'eA==' }] })
      }),
    )

    const config = loadConfig({
      NODE_ENV: 'test',
      SEQORA_IMAGE2_BASE_URL: 'https://image2.example.com',
      SEQORA_IMAGE2_API_KEY: 'seqora-image2-token',
      SEQORA_IMAGE2_MODEL: 'seqora-image2-live',
      TOKENADVENT_API_KEY: '',
    })
    const imageProvider = createImageProvider(config)

    await expect(
      imageProvider?.generate({
        taskId: 'image2-test',
        assetId: 'image2-asset',
        aspectRatio: '1:1',
        prompt: 'A production still',
        negativePrompt: '',
        references: [],
        outputs: ['single'],
      }),
    ).resolves.toHaveLength(1)
    expect(capturedUrl).toBe('https://image2.example.com/v1/images/generations')
    expect(capturedAuthorization).toBe('Bearer seqora-image2-token')
    expect(JSON.parse(capturedBody).model).toBe('seqora-image2-live')
    expect(createTextProvider(config)).toBeNull()
  })
})
