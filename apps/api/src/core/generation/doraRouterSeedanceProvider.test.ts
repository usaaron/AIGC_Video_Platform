import { describe, expect, it } from 'vitest'
import { DoraRouterSeedanceProvider } from './doraRouterSeedanceProvider.js'

describe('DoraRouterSeedanceProvider', () => {
  it('submits the documented video generation request', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return Response.json({ id: 'task_dora_1', status: 'queued', progress: 0 })
    }) as typeof fetch
    const provider = new DoraRouterSeedanceProvider({
      baseUrl: 'https://www.dorarouter.com/',
      apiKey: 'test-dora-token',
      defaultModel: 'TH-doubao-seedance2.0',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    const result = await provider.submit({
      taskId: 'local-dora-task',
      idempotencyKey: 'generation:tenant-1:task-1',
      model: 'doubao-seedance-2-0-260128',
      prompt: '雨夜车站，人物缓慢转身',
      negativePrompt: '不要水印和人物漂移',
      seconds: 5,
      ratio: '9:16',
      resolution: '4k',
      images: [
        { url: 'data:image/jpeg;base64,tail', role: 'first_frame' },
        { url: 'asset://maas-character', role: 'reference_image' },
      ],
      generateAudio: true,
      returnLastFrame: true,
      watermark: false,
    })

    expect(capturedUrl).toBe('https://www.dorarouter.com/v1/video/generations')
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer test-dora-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'generation:tenant-1:task-1',
    })
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: 'TH-doubao-seedance2.0',
      content: [
        { type: 'text', text: '雨夜车站，人物缓慢转身\n【质量约束】不要水印和人物漂移' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/jpeg;base64,tail' },
          role: 'reference_image',
        },
        {
          type: 'image_url',
          image_url: { url: 'asset://maas-character' },
          role: 'reference_image',
        },
      ],
      resolution: '1080p',
      ratio: '9:16',
      duration: 5,
      generate_audio: true,
      return_last_frame: true,
      watermark: false,
    })
    expect(result).toEqual({ providerTaskId: 'task_dora_1', status: 'queued', progress: 0 })
  })

  it('maps DoraRouter task states and caches the metadata video URL', async () => {
    const calls: string[] = []
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (calls.length === 1) {
        return Response.json({ id: 'task_dora_2', status: 'in_progress', progress: 50 })
      }
      if (calls.length === 2) {
        return Response.json({
          id: 'task_dora_2',
          task_id: 'task_dora_2',
          status: 'completed',
          progress: 100,
          metadata: {
            url: 'https://storage.example/video.mp4?signature=test',
            last_frame_url: 'https://storage.example/last-frame.jpg?signature=test',
          },
        })
      }
      return new Response(calls.length === 3 ? 'video-bytes' : 'last-frame-bytes', {
        status: 200,
        headers: {
          'Content-Type': calls.length === 3 ? 'video/mp4' : 'image/jpeg',
          'Content-Length': calls.length === 3 ? '11' : '15',
        },
      })
    }) as typeof fetch
    const provider = new DoraRouterSeedanceProvider({
      baseUrl: 'https://www.dorarouter.com',
      apiKey: 'test-dora-token',
      defaultModel: 'TH-doubao-seedance2.0',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    await expect(provider.getStatus('task_dora_2')).resolves.toEqual({
      status: 'running',
      progress: 50,
      error: null,
    })
    await expect(provider.getStatus('task_dora_2')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      error: null,
      lastFrameUrl: 'https://storage.example/last-frame.jpg?signature=test',
    })

    const content = await provider.getContent('task_dora_2', 'bytes=0-10')
    const contentChunks: Uint8Array[] = []
    for await (const chunk of content.stream) contentChunks.push(chunk)
    expect(Buffer.concat(contentChunks)).toEqual(Buffer.from('video-bytes'))
    expect(content.statusCode).toBe(200)

    const lastFrame = await provider.getLastFrameContent('task_dora_2')
    const frameChunks: Uint8Array[] = []
    for await (const chunk of lastFrame.stream) frameChunks.push(chunk)
    expect(Buffer.concat(frameChunks)).toEqual(Buffer.from('last-frame-bytes'))
    expect(calls).toEqual([
      'https://www.dorarouter.com/v1/video/generations/task_dora_2',
      'https://www.dorarouter.com/v1/video/generations/task_dora_2',
      'https://storage.example/video.mp4?signature=test',
      'https://storage.example/last-frame.jpg?signature=test',
    ])
  })

  it('accepts task_id responses and surfaces provider errors', async () => {
    const fetcher = (async () =>
      Response.json({
        task_id: 'task_dora_3',
        status: 'failed',
        code: 'quota_exceeded',
        message: '额度不足',
      })) as typeof fetch
    const provider = new DoraRouterSeedanceProvider({
      baseUrl: 'https://www.dorarouter.com',
      apiKey: 'test-dora-token',
      defaultModel: 'TH-doubao-seedance2.0',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    await expect(
      provider.submit({
        taskId: 'local-dora-task',
        model: null,
        prompt: '测试',
        seconds: 5,
        ratio: '16:9',
        resolution: '480p',
        images: [],
        generateAudio: false,
      }),
    ).resolves.toMatchObject({ providerTaskId: 'task_dora_3' })
    await expect(provider.getStatus('task_dora_3')).resolves.toEqual({
      status: 'failed',
      progress: 100,
      error: '额度不足',
    })
  })

  it('extracts a last frame locally when the completed response only has an MP4 URL', async () => {
    const calls: string[] = []
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return Response.json({
        id: 'task_dora_4',
        status: 'completed',
        metadata: { url: 'https://storage.example/video-only.mp4?signature=test' },
      })
    }) as typeof fetch
    const provider = new DoraRouterSeedanceProvider({
      baseUrl: 'https://www.dorarouter.com',
      apiKey: 'test-dora-token',
      defaultModel: 'TH-doubao-seedance2.0',
      requestTimeoutMs: 30_000,
      lastFrameExtractor: async (videoUrl, extractorFetcher, timeoutMs, ffmpegPath) => {
        expect(videoUrl).toBe('https://storage.example/video-only.mp4?signature=test')
        expect(extractorFetcher).toBe(fetcher)
        expect(timeoutMs).toBe(30_000)
        expect(ffmpegPath).toBe('ffmpeg')
        return Buffer.from('local-last-frame')
      },
      fetcher,
    })

    await expect(provider.getStatus('task_dora_4')).resolves.toMatchObject({ status: 'completed' })
    const content = await provider.getLastFrameContent('task_dora_4')
    const chunks: Uint8Array[] = []
    for await (const chunk of content.stream) chunks.push(chunk)
    expect(Buffer.concat(chunks)).toEqual(Buffer.from('local-last-frame'))
    expect(content.contentType).toBe('image/jpeg')
    expect(calls).toEqual(['https://www.dorarouter.com/v1/video/generations/task_dora_4'])
  })
})
