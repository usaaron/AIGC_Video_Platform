import { describe, expect, it } from 'vitest'
import { VolcArkSeedanceProvider } from './volcArkSeedanceProvider.js'

describe('VolcArkSeedanceProvider', () => {
  it('submits the official Ark content generation request', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return Response.json({ id: 'cgt-test-1' })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    const result = await provider.submit({
      taskId: 'local-task-1',
      model: 'doubao-seedance-2-0-260128',
      prompt: '雨夜车站，镜头跟随人物前进',
      negativePrompt: '不要水印',
      seconds: 7,
      ratio: '9:16',
      resolution: '1080p',
      images: ['data:image/png;base64,dGVzdA==', 'https://assets.example/scene.jpg'],
      generateAudio: false,
      watermark: false,
      returnLastFrame: true,
    })

    expect(capturedUrl).toBe('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks')
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer test-api-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: 'doubao-seedance-2-0-260128',
      content: [
        { type: 'text', text: '雨夜车站，镜头跟随人物前进\n【质量约束】不要水印' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,dGVzdA==' },
          role: 'reference_image',
        },
        {
          type: 'image_url',
          image_url: { url: 'https://assets.example/scene.jpg' },
          role: 'reference_image',
        },
      ],
      generate_audio: false,
      clientRequestId: 'local-task-1',
      resolution: '1080p',
      ratio: '9:16',
      duration: 7,
      watermark: false,
      return_last_frame: true,
      camera_fixed: false,
    })
    expect(result).toEqual({ providerTaskId: 'cgt-test-1', status: 'queued', progress: 0 })
  })

  it('maps Seedance tiers to configured provider models', async () => {
    let capturedInit: RequestInit | undefined
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      return Response.json({ id: 'cgt-tier-test' })
    }) as typeof fetch
    const provider = new VolcArkSeedanceProvider({
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/',
      apiKey: 'test-api-key',
      defaultModel: 'seedance-default',
      defaultTier: 'fast',
      tierModels: {
        mini: 'seedance-mini-model',
        fast: 'seedance-fast-model',
        pro: 'seedance-pro-model',
      },
      requestTimeoutMs: 30_000,
      fetcher,
    })

    await provider.submit({
      taskId: 'tier-task',
      model: null,
      tier: 'pro',
      prompt: 'test prompt',
      seconds: 5,
      ratio: '16:9',
      resolution: '720p',
      images: [],
      generateAudio: false,
    })

    expect(JSON.parse(String(capturedInit?.body)).model).toBe('seedance-pro-model')
  })

  it('supports text-only video generation without a storyboard image', async () => {
    let capturedInit: RequestInit | undefined
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      return Response.json({ id: 'cgt-text-only' })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    await provider.submit({
      taskId: 'local-text-only',
      model: 'doubao-seedance-2-0-260128',
      prompt: '雨夜车站空镜，镜头缓慢向前推进',
      seconds: 5,
      ratio: '9:16',
      resolution: '720p',
      images: [],
      generateAudio: false,
      returnLastFrame: true,
    })

    expect(JSON.parse(String(capturedInit?.body)).content).toEqual([
      { type: 'text', text: '雨夜车站空镜，镜头缓慢向前推进' },
    ])
    expect(JSON.parse(String(capturedInit?.body)).return_last_frame).toBe(true)
  })

  it('maps Ark states and keeps the signed video URL', async () => {
    const responses = [
      { id: 'task-queued', status: 'queued', content: null, error: null },
      { id: 'task-pending', status: 'pending', content: null, error: null },
      { id: 'task-processing', status: 'processing', content: null, error: null },
      { id: 'task-running', status: 'running', content: null, error: null },
      {
        id: 'task-succeeded',
        status: 'succeeded',
        content: { video_url: 'https://storage.example/video.mp4?signature=test' },
        error: null,
      },
      {
        id: 'task-expired',
        status: 'expired',
        content: null,
        error: { code: 'TaskExpired', message: '任务超过有效时间' },
      },
    ]
    const fetcher = (async () => Response.json(responses.shift())) as typeof fetch
    const provider = createProvider(fetcher)

    await expect(provider.getStatus('task-queued')).resolves.toEqual({
      status: 'running',
      progress: 5,
      error: null,
    })
    await expect(provider.getStatus('task-pending')).resolves.toEqual({
      status: 'running',
      progress: 5,
      error: null,
    })
    await expect(provider.getStatus('task-processing')).resolves.toEqual({
      status: 'running',
      progress: 50,
      error: null,
    })
    await expect(provider.getStatus('task-running')).resolves.toEqual({
      status: 'running',
      progress: 50,
      error: null,
    })
    await expect(provider.getStatus('task-succeeded')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      error: null,
    })
    await expect(provider.getStatus('task-expired')).resolves.toEqual({
      status: 'failed',
      progress: 100,
      error: '任务超过有效时间',
    })
  })

  it('supports first-frame roles and persists a returned last-frame image', async () => {
    const calls: string[] = []
    let capturedInit: RequestInit | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input))
      capturedInit = init
      if (calls.length === 1) return Response.json({ id: 'task-continuity' })
      if (calls.length === 2) {
        return Response.json({
          id: 'task-continuity',
          status: 'succeeded',
          content: {
            video_url: 'https://storage.example/video.mp4?signature=test',
            last_frame_url: 'https://storage.example/last-frame.jpg?signature=test',
          },
          error: null,
        })
      }
      return new Response('last-frame-bytes', {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    await provider.submit({
      taskId: 'continuity-task',
      model: 'doubao-seedance-2-0-260128',
      prompt: '承接上一镜头',
      negativePrompt: '不要水印',
      seconds: 5,
      ratio: '9:16',
      resolution: '720p',
      images: [{ url: 'data:image/jpeg;base64,tail', role: 'first_frame' }],
      generateAudio: false,
      returnLastFrame: true,
    })
    expect(JSON.parse(String(capturedInit?.body)).content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,tail' },
      role: 'first_frame',
    })

    const status = await provider.getStatus('task-continuity')
    expect(status).toMatchObject({
      status: 'completed',
      lastFrameUrl: 'https://storage.example/last-frame.jpg?signature=test',
    })
    const content = await provider.getLastFrameContent!('task-continuity')
    const chunks: Uint8Array[] = []
    for await (const chunk of content.stream) chunks.push(chunk)
    expect(Buffer.concat(chunks)).toEqual(Buffer.from('last-frame-bytes'))
    expect(calls).toEqual([
      'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
      'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task-continuity',
      'https://storage.example/last-frame.jpg?signature=test',
    ])
  })

  it('forwards byte ranges to the signed URL without leaking the API key', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (calls.length === 1) {
        return Response.json({
          id: 'task-video',
          status: 'succeeded',
          content: { video_url: 'https://storage.example/video.mp4?signature=test' },
          error: null,
        })
      }
      return new Response('video-bytes', {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '11',
          'Accept-Ranges': 'bytes',
          'Content-Range': 'bytes 0-10/100',
        },
      })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    const content = await provider.getContent('task-video', 'bytes=0-10')

    expect(calls[0]).toMatchObject({
      url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task-video',
      init: { headers: { Authorization: 'Bearer test-api-key' } },
    })
    expect(calls[1]).toMatchObject({
      url: 'https://storage.example/video.mp4?signature=test',
      init: { headers: { Range: 'bytes=0-10' } },
    })
    expect(calls[1]?.init?.headers).not.toHaveProperty('Authorization')
    expect(content).toMatchObject({
      statusCode: 206,
      contentType: 'video/mp4',
      contentLength: '11',
      acceptRanges: 'bytes',
      contentRange: 'bytes 0-10/100',
    })
  })
})

function createProvider(fetcher: typeof fetch) {
  return new VolcArkSeedanceProvider({
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/',
    apiKey: 'test-api-key',
    defaultModel: 'doubao-seedance-2-0-260128',
    requestTimeoutMs: 30_000,
    fetcher,
  })
}
