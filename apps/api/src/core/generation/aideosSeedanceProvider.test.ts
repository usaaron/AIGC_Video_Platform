import { readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { AideosSeedanceProvider, type AideosSeedanceOptions } from './aideosSeedanceProvider.js'

const baseOptions: AideosSeedanceOptions = {
  baseUrl: 'https://aideos.example',
  apiKey: 'test-api-key',
  defaultModel: 'doubao-seedance-2-0-260128',
  requestTimeoutMs: 30_000,
  ffmpegPath: 'ffmpeg',
  lastFrameTimeoutMs: 30_000,
}

describe('AideosSeedanceProvider', () => {
  it('submits ordered references and trusted assets with quality constraints', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return Response.json({
        id: 'task-provider-1',
        task_id: 'task-provider-1',
        status: 'queued',
        progress: 0,
      })
    }) as typeof fetch
    const provider = new AideosSeedanceProvider({
      ...baseOptions,
      baseUrl: 'https://aideos.example/',
      fetcher,
    })

    const result = await provider.submit({
      taskId: 'local-task-1',
      model: 'seedance-2.0',
      prompt: '雨夜车站，镜头缓慢推进',
      negativePrompt: '不要闪烁、换脸、水印',
      seconds: 5,
      ratio: '9:16',
      resolution: '720p',
      images: [
        { url: 'data:image/jpeg;base64,dGFpbA==', role: 'first_frame' },
        { url: 'asset://maas-01kxxwtxkp0f1tanhkatt8q0gb', role: 'reference_image' },
        'https://assets.example/scene.jpg',
      ],
      generateAudio: false,
      returnLastFrame: true,
      watermark: false,
    })

    expect(capturedUrl).toBe('https://aideos.example/v1/video/generations')
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer test-api-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: 'doubao-seedance-2-0-260128',
      prompt: '雨夜车站，镜头缓慢推进\n【质量约束】不要闪烁、换脸、水印',
      images: [
        'data:image/jpeg;base64,dGFpbA==',
        'asset://maas-01kxxwtxkp0f1tanhkatt8q0gb',
        'https://assets.example/scene.jpg',
      ],
      seconds: '5',
      metadata: {
        resolution: '720p',
        ratio: '9:16',
        generate_audio: false,
        return_last_frame: true,
        watermark: false,
        camera_fixed: false,
      },
    })
    expect(result).toEqual({ providerTaskId: 'task-provider-1', status: 'queued', progress: 0 })
  })

  it('maps provider completion and failure states', async () => {
    const responses = [
      { id: 'task-1', status: 'completed', progress: 100 },
      {
        id: 'task-2',
        status: 'failed',
        progress: 100,
        error: { code: 'generation_failed', message: '上游生成失败' },
      },
    ]
    const fetcher = (async () => Response.json(responses.shift())) as typeof fetch
    const provider = new AideosSeedanceProvider({ ...baseOptions, fetcher })

    await expect(provider.getStatus('task-1')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      error: null,
    })
    await expect(provider.getStatus('task-2')).resolves.toEqual({
      status: 'failed',
      progress: 100,
      error: '上游生成失败',
    })
  })

  it('proxies byte ranges and response metadata for video playback', async () => {
    let rangeHeader: string | null = null
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      rangeHeader = new Headers(init?.headers).get('range')
      return new Response(Buffer.from('video'), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '5',
          'accept-ranges': 'bytes',
          'content-range': 'bytes 0-4/100',
        },
      })
    }) as typeof fetch
    const provider = new AideosSeedanceProvider({ ...baseOptions, fetcher })

    const content = await provider.getContent('task-1', 'bytes=0-4')

    expect(rangeHeader).toBe('bytes=0-4')
    expect(content).toMatchObject({
      contentType: 'video/mp4',
      contentLength: '5',
      statusCode: 206,
      acceptRanges: 'bytes',
      contentRange: 'bytes 0-4/100',
    })
  })

  it('downloads a completed video and extracts its last frame locally', async () => {
    const extractor = vi.fn(async (inputPath: string, outputPath: string) => {
      expect(await readFile(inputPath)).toEqual(Buffer.from('video-content'))
      await writeFile(outputPath, Buffer.from('jpeg-tail-frame'))
    })
    const fetcher = (async () =>
      new Response(Buffer.from('video-content'), {
        headers: { 'content-type': 'video/mp4' },
      })) as typeof fetch
    const provider = new AideosSeedanceProvider({
      ...baseOptions,
      fetcher,
      lastFrameExtractor: extractor,
    })

    const content = await provider.getLastFrameContent('task-1')
    const chunks: Buffer[] = []
    for await (const chunk of content.stream) chunks.push(Buffer.from(chunk))

    expect(extractor).toHaveBeenCalledOnce()
    expect(Buffer.concat(chunks)).toEqual(Buffer.from('jpeg-tail-frame'))
    expect(content).toMatchObject({
      contentType: 'image/jpeg',
      contentLength: String(Buffer.byteLength('jpeg-tail-frame')),
      statusCode: 200,
    })
  })
})
