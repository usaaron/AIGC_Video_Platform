import { describe, expect, it } from 'vitest'
import type { ImageGenerationRequest } from './imageProvider.js'
import { AideosImageProvider } from './aideosImageProvider.js'

describe('AideosImageProvider', () => {
  it('submits image requests with bearer authentication and mapped asset metadata', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return Response.json({
        id: 'image-provider-task-1',
        status: 'queued',
        progress: 0,
      })
    }) as typeof fetch
    const provider = new AideosImageProvider({
      baseUrl: 'https://aideos.example/',
      apiKey: 'test-api-key',
      defaultModel: 'img2-test-model',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    const result = await provider.submit({
      taskId: 'local-image-task-1',
      assetId: 'asset-lin',
      model: 'img2-default',
      aspectRatio: '16:9',
      prompt: '角色三视图源图',
      negativePrompt: '低质量，模糊',
      referenceUrls: [
        'https://assets.example/face.jpg',
        'https://assets.example/body.jpg',
        'https://assets.example/reference.jpg',
      ],
      faceReferenceUrl: 'https://assets.example/face.jpg',
      bodyReferenceUrl: 'https://assets.example/body.jpg',
      attributes: { type: 'character', visualStyle: 'cinematic-cg' } as ImageGenerationRequest['attributes'],
      outputs: ['front', 'side', 'back'],
    })

    expect(capturedUrl).toBe('https://aideos.example/v1/image/generations')
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer test-api-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: 'img2-test-model',
      prompt: '角色三视图源图',
      negative_prompt: '低质量，模糊',
      aspect_ratio: '16:9',
      n: 3,
      images: [
        'https://assets.example/face.jpg',
        'https://assets.example/body.jpg',
        'https://assets.example/reference.jpg',
      ],
      reference_images: [
        { role: 'face', url: 'https://assets.example/face.jpg' },
        { role: 'body', url: 'https://assets.example/body.jpg' },
        { role: 'reference', url: 'https://assets.example/reference.jpg' },
      ],
      face_reference_url: 'https://assets.example/face.jpg',
      body_reference_url: 'https://assets.example/body.jpg',
      metadata: {
        task_id: 'local-image-task-1',
        asset_id: 'asset-lin',
        aspect_ratio: '16:9',
        output_views: ['front', 'side', 'back'],
        face_reference_url: 'https://assets.example/face.jpg',
        body_reference_url: 'https://assets.example/body.jpg',
        attributes: { type: 'character', visualStyle: 'cinematic-cg' },
      },
    })
    expect(result).toEqual({
      providerTaskId: 'image-provider-task-1',
      status: 'queued',
      progress: 1,
      outputs: [],
    })
  })

  it('maps immediate image URLs into completed outputs', async () => {
    const provider = new AideosImageProvider({
      baseUrl: 'https://aideos.example',
      apiKey: 'test-api-key',
      defaultModel: 'img2-test-model',
      requestTimeoutMs: 30_000,
      fetcher: (async () =>
        Response.json({
          id: 'sync-image-task',
          status: 'completed',
          data: [
            { url: 'https://assets.example/front.png' },
            { image_url: 'https://assets.example/side.png' },
          ],
        })) as typeof fetch,
    })

    const result = await provider.submit({
      taskId: 'local-image-task-2',
      assetId: 'asset-lin',
      model: null,
      aspectRatio: '16:9',
      prompt: '角色三视图源图',
      negativePrompt: '',
      referenceUrls: [],
      faceReferenceUrl: null,
      bodyReferenceUrl: null,
      attributes: null,
      outputs: ['front', 'side', 'back'],
    })

    expect(result).toMatchObject({
      providerTaskId: 'sync-image-task',
      status: 'completed',
      progress: 100,
      outputs: [
        { url: 'https://assets.example/front.png', mediaType: 'image', view: 'front' },
        { url: 'https://assets.example/side.png', mediaType: 'image', view: 'side' },
      ],
    })
    const cachedStatus = await provider.getStatus('sync-image-task')
    expect(cachedStatus).toMatchObject({
      status: 'completed',
      progress: 100,
      error: null,
    })
    expect(cachedStatus.outputs).toHaveLength(2)
    expect(cachedStatus.outputs[0]).toMatchObject({ url: 'https://assets.example/front.png' })
  })

  it('keeps requested front side back views for async turnaround outputs', async () => {
    const responses = [
      {
        id: 'async-turnaround-task',
        status: 'queued',
        progress: 0,
      },
      {
        id: 'async-turnaround-task',
        status: 'completed',
        progress: 100,
        outputs: [
          { url: 'https://assets.example/front.png' },
          { url: 'https://assets.example/side.png' },
          { url: 'https://assets.example/back.png' },
        ],
      },
    ]
    const provider = new AideosImageProvider({
      baseUrl: 'https://aideos.example',
      apiKey: 'test-api-key',
      defaultModel: 'img2-test-model',
      requestTimeoutMs: 30_000,
      fetcher: (async () => Response.json(responses.shift())) as typeof fetch,
    })

    await provider.submit({
      taskId: 'local-turnaround-task',
      assetId: 'asset-lin',
      model: null,
      aspectRatio: '16:9',
      prompt: '角色三视图源图',
      negativePrompt: '',
      referenceUrls: [],
      faceReferenceUrl: null,
      bodyReferenceUrl: null,
      attributes: null,
      outputs: ['front', 'side', 'back'],
    })

    await expect(provider.getStatus('async-turnaround-task')).resolves.toMatchObject({
      status: 'completed',
      progress: 100,
      outputs: [
        { url: 'https://assets.example/front.png', mediaType: 'image', view: 'front' },
        { url: 'https://assets.example/side.png', mediaType: 'image', view: 'side' },
        { url: 'https://assets.example/back.png', mediaType: 'image', view: 'back' },
      ],
      error: null,
    })
  })

  it('maps async completion and failure states', async () => {
    const responses = [
      {
        id: 'task-1',
        status: 'completed',
        progress: 100,
        outputs: [{ id: 'output-1', url: 'https://assets.example/generated.png', view: 'detail' }],
      },
      {
        id: 'task-2',
        status: 'failed',
        progress: 100,
        error: { code: 'generation_failed', message: '上游图片生成失败' },
      },
    ]
    const fetcher = (async () => Response.json(responses.shift())) as typeof fetch
    const provider = new AideosImageProvider({
      baseUrl: 'https://aideos.example',
      apiKey: 'test-api-key',
      defaultModel: 'img2-test-model',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    await expect(provider.getStatus('task-1')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      outputs: [
        {
          id: 'output-1',
          url: 'https://assets.example/generated.png',
          mediaType: 'image',
          view: 'detail',
        },
      ],
      error: null,
    })
    await expect(provider.getStatus('task-2')).resolves.toEqual({
      status: 'failed',
      progress: 100,
      outputs: [],
      error: '上游图片生成失败',
    })
  })
})
