import { describe, expect, it, vi } from 'vitest'
import { TokenAdventImageProvider } from './tokenAdventImageProvider.js'

describe('TokenAdventImageProvider', () => {
  it('generates images with the documented JSON endpoint and mapped size', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return Response.json({ data: [{ b64_json: Buffer.from('png-content').toString('base64') }] })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    const outputs = await provider.generate({
      taskId: 'task-1',
      idempotencyKey: 'generation:tenant-1:task-1',
      assetId: 'asset-1',
      aspectRatio: '9:16',
      prompt: '青年女性角色大头照',
      negativePrompt: '文字水印',
      references: [],
      outputs: ['single'],
    })

    expect(capturedUrl).toBe('https://tokenadvent.example/v1/images/generations')
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: 'gpt-image-2',
      size: '1024x1536',
      quality: 'low',
      output_format: 'png',
    })
    expect(capturedInit?.headers).toMatchObject({
      'Idempotency-Key': 'generation:tenant-1:task-1:single',
    })
    expect(outputs[0]).toMatchObject({ view: 'single', contentType: 'image/png' })
    expect(outputs[0]?.content.toString()).toBe('png-content')
  })

  it('uses multipart image edits when references are present', async () => {
    let capturedUrl = ''
    let capturedBody: FormData | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = init?.body as FormData
      return Response.json({ data: [{ b64_json: Buffer.from('edited').toString('base64') }] })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    await provider.generate({
      taskId: 'task-2',
      assetId: 'asset-1',
      aspectRatio: '16:9',
      prompt: '保持人物身份一致，生成全身图',
      negativePrompt: '',
      references: [{ name: 'face.png', contentType: 'image/png', content: Buffer.from('face') }],
      outputs: ['single'],
    })

    expect(capturedUrl).toBe('https://tokenadvent.example/v1/images/edits')
    expect(capturedBody?.get('model')).toBe('gpt-image-2')
    expect(capturedBody?.get('size')).toBe('1536x1024')
    expect(capturedBody?.getAll('image[]')).toHaveLength(1)
    expect(String(capturedBody?.get('prompt'))).toContain('参考图一是唯一主体与身份基准')
  })

  it('does not silently route an unconfigured image model through Img2', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const provider = createProvider(fetcher)

    await expect(
      provider.generate({
        taskId: 'task-unconfigured-model',
        assetId: 'asset-1',
        model: 'hunyuan-image',
        aspectRatio: '1:1',
        prompt: '人物图',
        negativePrompt: '',
        references: [],
        outputs: ['single'],
      }),
    ).rejects.toThrow('图片模型 hunyuan-image 的 Provider 尚未配置')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('retries one transient network failure', async () => {
    let attempts = 0
    const fetcher = (async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('fetch failed')
      return Response.json({ data: [{ b64_json: Buffer.from('recovered').toString('base64') }] })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    const outputs = await provider.generate({
      taskId: 'task-retry',
      assetId: 'asset-1',
      aspectRatio: '1:1',
      prompt: 'CG角色图',
      negativePrompt: '',
      references: [],
      outputs: ['single'],
    })

    expect(attempts).toBe(2)
    expect(outputs[0]?.content.toString()).toBe('recovered')
  })

  it('does not retry a client validation error', async () => {
    let attempts = 0
    const fetcher = (async () => {
      attempts += 1
      return Response.json({ error: { message: 'invalid prompt' } }, { status: 400 })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    await expect(
      provider.generate({
        taskId: 'task-invalid',
        assetId: 'asset-1',
        aspectRatio: '1:1',
        prompt: 'CG角色图',
        negativePrompt: '',
        references: [],
        outputs: ['single'],
      }),
    ).rejects.toThrow('invalid prompt')
    expect(attempts).toBe(1)
  })

  it('summarizes upstream 524 HTML timeouts without repeating a stuck image request', async () => {
    let attempts = 0
    const fetcher = (async () => {
      attempts += 1
      return new Response(
        '<html><head><title>tokenadvent.com | 524: A timeout occurred</title></head></html>',
        {
          status: 524,
        },
      )
    }) as typeof fetch
    const provider = createProvider(fetcher)

    await expect(
      provider.generate({
        taskId: 'task-timeout',
        assetId: 'asset-1',
        aspectRatio: '1:1',
        prompt: 'CG角色图',
        negativePrompt: '',
        references: [],
        outputs: ['single'],
      }),
    ).rejects.toThrow('上游图片服务超时（524）')
    expect(attempts).toBe(1)
  })

  it('enforces a total response timeout without retrying the same image request', async () => {
    let attempts = 0
    const fetcher = (async () => {
      attempts += 1
      return new Promise<Response>(() => undefined)
    }) as typeof fetch
    const provider = new TokenAdventImageProvider({
      baseUrl: 'https://tokenadvent.example/',
      apiKey: 'test-key',
      model: 'gpt-image-2',
      quality: 'low',
      requestTimeoutMs: 20,
      fetcher,
    })

    await expect(
      provider.generate({
        taskId: 'task-hard-timeout',
        assetId: 'asset-1',
        aspectRatio: '1:1',
        prompt: 'CG角色图',
        negativePrompt: '',
        references: [],
        outputs: ['single'],
      }),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(attempts).toBe(1)
  })
})

function createProvider(fetcher: typeof fetch) {
  return new TokenAdventImageProvider({
    baseUrl: 'https://tokenadvent.example/',
    apiKey: 'test-key',
    model: 'gpt-image-2',
    quality: 'low',
    requestTimeoutMs: 180_000,
    fetcher,
  })
}
