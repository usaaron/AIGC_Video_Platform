import { describe, expect, it } from 'vitest'
import { StringXSeedanceProvider } from './stringXSeedanceProvider.js'

describe('StringXSeedanceProvider', () => {
  it('uses the StringX task API and keeps MaaS asset references', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return Response.json({ id: 'task_stringx_1', status: 'queued' })
    }) as typeof fetch
    const provider = new StringXSeedanceProvider({
      baseUrl: 'https://maas.stringx.top/api/v3/',
      apiKey: 'test-stringx-token',
      defaultModel: 'doubao-seedance-2-0-260128',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    const result = await provider.submit({
      taskId: 'local-stringx-task',
      model: 'doubao-seedance-2-0-260128',
      prompt: '2D 国漫人物在雨夜站台打开一封信，镜头缓慢推进',
      negativePrompt: '不要闪烁、水印和面部漂移',
      seconds: 4,
      ratio: '9:16',
      resolution: '480p',
      images: [{ url: 'asset://maas-01kxypge98wdx00af6xxsrfhmr', role: 'reference_image' }],
      generateAudio: false,
      returnLastFrame: true,
      watermark: false,
    })

    expect(capturedUrl).toBe('https://maas.stringx.top/api/v3/contents/generations/tasks')
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer test-stringx-token',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      clientRequestId: 'local-stringx-task',
      duration: 4,
      ratio: '9:16',
      resolution: '480p',
      generate_audio: false,
      return_last_frame: true,
      content: [
        { type: 'text' },
        {
          type: 'image_url',
          image_url: { url: 'asset://maas-01kxypge98wdx00af6xxsrfhmr' },
        },
      ],
    })
    expect(result).toEqual({ providerTaskId: 'task_stringx_1', status: 'queued', progress: 0 })
  })

  it('cancels a running task through the documented StringX endpoint', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return Response.json({ id: 'task_stringx_1', status: 'cancelled' })
    }) as typeof fetch
    const provider = new StringXSeedanceProvider({
      baseUrl: 'https://maas.stringx.top/api/v3',
      apiKey: 'test-stringx-token',
      defaultModel: 'doubao-seedance-2-0-260128',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    await provider.cancel('task_stringx_1')

    expect(capturedUrl).toBe(
      'https://maas.stringx.top/api/v3/contents/generations/tasks/task_stringx_1/cancel',
    )
    expect(capturedInit).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer test-stringx-token' },
    })
  })

  it('sends a lone continuity frame as the first ordered reference', async () => {
    let capturedInit: RequestInit | undefined
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      return Response.json({ id: 'task_stringx_continuity', status: 'queued' })
    }) as typeof fetch
    const provider = new StringXSeedanceProvider({
      baseUrl: 'https://maas.stringx.top/api/v3',
      apiKey: 'test-stringx-token',
      defaultModel: 'doubao-seedance-2-0-260128',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    await provider.submit({
      taskId: 'local-continuity-task',
      model: 'doubao-seedance-2-0-260128',
      prompt: '承接上一镜头继续动作',
      seconds: 4,
      ratio: '9:16',
      resolution: '480p',
      images: [
        { url: 'data:image/jpeg;base64,tail', role: 'first_frame' },
        { url: 'asset://maas-character', role: 'reference_image' },
      ],
      generateAudio: false,
    })

    const content = JSON.parse(String(capturedInit?.body)).content
    expect(content.slice(1)).toEqual([
      {
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,tail' },
      },
      {
        type: 'image_url',
        image_url: { url: 'asset://maas-character' },
      },
    ])
  })
})
