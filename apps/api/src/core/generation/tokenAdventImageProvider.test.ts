import { describe, expect, it } from 'vitest'
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
      aspectRatio: '1024x1536',
      quality: 'high',
      prompt: '青年女性角色大头照',
      negativePrompt: '文字水印',
      references: [],
      outputs: ['single'],
    })

    expect(capturedUrl).toBe('https://tokenadvent.example/v1/images/generations')
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: 'gpt-image-2',
      size: '1024x1536',
      quality: 'high',
      output_format: 'png',
      moderation: 'low',
      stream: true,
      partial_images: 2,
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
      quality: 'medium',
      prompt: '保持人物身份一致，生成全身图',
      negativePrompt: '',
      references: [
        {
          name: 'image-2-subject.jpg',
          contentType: 'image/jpeg',
          content: Buffer.from('face'),
          role: 'subject',
          referenceNumber: 2,
          visionDescription: 'black leather jacket with silver zippers',
        },
      ],
      outputs: ['single'],
    })

    expect(capturedUrl).toBe('https://tokenadvent.example/v1/images/edits')
    expect(capturedBody?.get('model')).toBe('gpt-image-2')
    expect(capturedBody?.get('quality')).toBe('medium')
    expect(capturedBody?.get('moderation')).toBe('low')
    expect(capturedBody?.get('stream')).toBe('true')
    expect(capturedBody?.get('partial_images')).toBe('2')
    expect(capturedBody?.get('prompt')).toContain('图 2（image-2-subject.jpg）：主体角色，只保留身份、脸部、姿态')
    expect(capturedBody?.get('prompt')).toContain('视觉描述：black leather jacket with silver zippers')
    expect(capturedBody?.get('prompt')).toContain('用户需求：保持人物身份一致，生成全身图')
    expect(capturedBody?.get('size')).toBe('1536x864')
    expect(capturedBody?.getAll('image[]')).toHaveLength(1)
  })

  it('downloads image content from a JSON URL response', async () => {
    const calls: string[] = []
    let assetAuthorization: string | null = null
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url === 'https://tokenadvent.example/v1/images/generations') {
        return Response.json({
          data: [{ url: 'https://assets.example/final.webp', mime_type: 'image/webp' }],
        })
      }
      if (url === 'https://assets.example/final.webp') {
        assetAuthorization = new Headers(init?.headers).get('Authorization')
        return new Response(Buffer.from('downloaded-webp'), {
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    const outputs = await provider.generate({
      taskId: 'task-url',
      assetId: 'asset-1',
      aspectRatio: '1:1',
      prompt: '电影剧照',
      negativePrompt: '',
      references: [],
      outputs: ['single'],
    })

    expect(calls).toEqual([
      'https://tokenadvent.example/v1/images/generations',
      'https://assets.example/final.webp',
    ])
    expect(assetAuthorization).toBeNull()
    expect(outputs[0]).toMatchObject({ contentType: 'image/webp' })
    expect(outputs[0]?.content.toString()).toBe('downloaded-webp')
  })

  it('prefers the final image from an SSE response over partial images', async () => {
    const partial = Buffer.from('partial-image').toString('base64')
    const final = Buffer.from('final-image').toString('base64')
    const stream = [
      'event: image_generation.partial_image',
      `data: {"type":"image_generation.partial_image","partial_image_b64":"${partial}"}`,
      '',
      'event: image_generation.completed',
      `data: {"type":"image_generation.completed","data":{"b64_json":"${final}","mime_type":"image/jpeg"}}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const provider = createProvider(
      (async () =>
        new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        })) as typeof fetch,
    )

    const outputs = await provider.generate({
      taskId: 'task-sse-final',
      assetId: 'asset-1',
      aspectRatio: '1:1',
      prompt: '电影剧照',
      negativePrompt: '',
      references: [],
      outputs: ['single'],
    })

    expect(outputs[0]).toMatchObject({ contentType: 'image/jpeg' })
    expect(outputs[0]?.content.toString()).toBe('final-image')
  })

  it('uses the last partial image when an SSE response has no final image', async () => {
    const first = Buffer.from('partial-one').toString('base64')
    const second = Buffer.from('partial-two').toString('base64')
    const stream = [
      `data: {"type":"image_generation.partial_image","partial_image_b64":"${first}"}`,
      '',
      `data: {"type":"image_generation.partial_image","partial_image_b64":"${second}"}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const provider = createProvider(
      (async () =>
        new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        })) as typeof fetch,
    )

    const outputs = await provider.generate({
      taskId: 'task-sse-partial',
      assetId: 'asset-1',
      aspectRatio: '1:1',
      prompt: '电影剧照',
      negativePrompt: '',
      references: [],
      outputs: ['single'],
    })

    expect(outputs[0]?.content.toString()).toBe('partial-two')
  })

  it('decodes data URL and raw Base64 JSON image fields', async () => {
    let calls = 0
    const provider = createProvider(
      (async () => {
        calls += 1
        const encoded = Buffer.from(calls === 1 ? 'data-url-image' : 'raw-base64-image').toString(
          'base64',
        )
        return calls === 1
          ? Response.json({ data: [{ image_url: `data:image/webp;base64,${encoded}` }] })
          : Response.json({ data: [{ b64_json: encoded, media_type: 'image/jpeg' }] })
      }) as typeof fetch,
    )

    const first = await provider.generate({
      taskId: 'task-data-url',
      assetId: 'asset-1',
      aspectRatio: '1:1',
      prompt: '电影剧照',
      negativePrompt: '',
      references: [],
      outputs: ['single'],
    })
    const second = await provider.generate({
      taskId: 'task-base64',
      assetId: 'asset-1',
      aspectRatio: '1:1',
      prompt: '电影剧照',
      negativePrompt: '',
      references: [],
      outputs: ['single'],
    })

    expect(first[0]).toMatchObject({ contentType: 'image/webp' })
    expect(first[0]?.content.toString()).toBe('data-url-image')
    expect(second[0]).toMatchObject({ contentType: 'image/jpeg' })
    expect(second[0]?.content.toString()).toBe('raw-base64-image')
  })

  it('limits reference images to the image2 input cap', async () => {
    let capturedBody: FormData | undefined
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as FormData
      return Response.json({ data: [{ b64_json: Buffer.from('edited').toString('base64') }] })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    await provider.generate({
      taskId: 'task-refs',
      assetId: 'asset-1',
      aspectRatio: '1:1',
      prompt: '按图号融合',
      negativePrompt: '',
      references: Array.from({ length: 6 }, (_, index) => ({
        name: `image-${index + 1}.jpg`,
        contentType: 'image/jpeg',
        content: Buffer.from(`ref-${index + 1}`),
        role: index === 0 ? 'subject' : 'style',
        referenceNumber: index + 1,
      })),
      outputs: ['single'],
    })

    expect(capturedBody?.getAll('image[]')).toHaveLength(5)
    expect(capturedBody?.get('prompt')).toContain('图 5（image-5.jpg）：仅参考风格')
    expect(capturedBody?.get('prompt')).not.toContain('图 6')
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

  it('maps the studio aspect ratios to image2 size values', async () => {
    const requests: Array<{ size: string | undefined }> = []
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      requests.push({ size: body.size })
      return Response.json({ data: [{ b64_json: Buffer.from('png').toString('base64') }] })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    for (const aspectRatio of [
      'auto',
      '1:1',
      '9:16',
      '16:9',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '2048x2048',
      '2560x1440',
      '1440x2560',
      '3840x2160',
      '2160x3840',
    ]) {
      await provider.generate({
        taskId: `task-${aspectRatio}`,
        assetId: 'asset-1',
        aspectRatio,
        prompt: 'CG角色图',
        negativePrompt: '',
        references: [],
        outputs: ['single'],
      })
    }

    expect(requests.map((request) => request.size)).toEqual([
      undefined,
      '1024x1024',
      '864x1536',
      '1536x864',
      '1024x1536',
      '1536x1024',
      '1024x1365',
      '1365x1024',
      '1024x1280',
      '1280x1024',
      '2048x2048',
      '2560x1440',
      '1440x2560',
      '3840x2160',
      '2160x3840',
    ])
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
