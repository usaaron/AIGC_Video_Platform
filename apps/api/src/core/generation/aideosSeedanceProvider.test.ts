import { describe, expect, it } from 'vitest'
import { AideosSeedanceProvider } from './aideosSeedanceProvider.js'

describe('AideosSeedanceProvider', () => {
  it('submits the documented Seedance request with bearer authentication', async () => {
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
      baseUrl: 'https://aideos.example/',
      apiKey: 'test-api-key',
      defaultModel: 'doubao-seedance-2-0-260128',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    const result = await provider.submit({
      taskId: 'local-task-1',
      model: 'seedance-2.0',
      prompt: '雨夜车站，镜头缓慢推进',
      negativePrompt: '不要闪烁、频闪、跳帧',
      seconds: 5,
      ratio: '9:16',
      resolution: '720p',
      images: ['https://assets.example/reference.jpg'],
      generateAudio: false,
      watermark: false,
    })

    expect(capturedUrl).toBe('https://aideos.example/v1/video/generations')
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer test-api-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: 'doubao-seedance-2-0-260128',
      prompt: '雨夜车站，镜头缓慢推进',
      negative_prompt: '不要闪烁、频闪、跳帧',
      images: ['https://assets.example/reference.jpg'],
      seconds: '5',
      metadata: {
        resolution: '720p',
        ratio: '9:16',
        generate_audio: false,
        watermark: false,
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
    const provider = new AideosSeedanceProvider({
      baseUrl: 'https://aideos.example',
      apiKey: 'test-api-key',
      defaultModel: 'doubao-seedance-2-0-260128',
      requestTimeoutMs: 30_000,
      fetcher,
    })

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
})
