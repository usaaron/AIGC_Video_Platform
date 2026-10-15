import type { GenerationTask } from '@seqora/contracts'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore } from '../../infra/store.js'
import { ProviderHttpError } from '../generation/providerHttp.js'
import { GeneratedAssetWriter } from './generatedAssetWriter.js'
import { MediaReferenceResolver } from './mediaReferenceResolver.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

const MEDIA_URL_PATTERN = /^\/api\/v1\/media\/[0-9a-f-]{36}$/
const SIGNED_REFERENCE_URL_PATTERN = /^https:\/\/api\.example\.com\/api\/v1\/media\/[0-9a-f-]{36}\/signed\?/

describe('GenerationTaskRunner Seedance integration', () => {
  it('keeps retryable submission failures in submission retry instead of failing the task', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(async () => {
        throw new ProviderHttpError('Aideos Seedance', 'http', 'Too Many Requests', 429)
      }),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'retry-submit-task',
      clientRequestId: 'client-retry-submit-task',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: 'retry submit',
      prompt: 'retry submit',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {},
      status: 'queued',
      progress: 0,
      estimatedCredits: 6,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(task))

    const runner = new GenerationTaskRunner(store, provider, null, 0)
    await runner.dispatch(task)

    expect(provider.submit).toHaveBeenCalledTimes(1)
    const stored = await store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(stored).toMatchObject({
      status: 'running',
      progress: 1,
      error: null,
      metadata: expect.objectContaining({
        providerState: 'submission_retrying',
        submissionRetryCount: 1,
        submissionRetryAt: expect.any(Number),
      }),
    })
  })

  it('retries post-processing without re-submitting the provider task', async () => {
    const provider: ImageGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'retry-postprocess-task',
      clientRequestId: 'client-retry-postprocess-task',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'image',
      label: 'retry postprocess',
      prompt: 'retry postprocess',
      negativePrompt: '',
      provider: 'img2',
      model: 'img2-default',
      metadata: {
        assetId: 'asset-lin',
        assetKind: 'character',
        generationStage: 'face',
        providerName: 'aideos-img2',
        providerState: 'completed',
        providerTaskId: 'remote-image-task-1',
        postProcessState: 'retrying',
        postProcessRetryAt: Date.now() - 1_000,
        postProcessRetryCount: 1,
        postProcessRemoteOutputs: [
          {
            id: 'remote-image-output-1',
            url: 'https://assets.example/generated-face.png',
            mediaType: 'image',
            view: 'single',
          },
        ],
      },
      status: 'running',
      progress: 99,
      estimatedCredits: 6,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => {
      const asset = state.assets.find((item) => item.id === 'asset-lin')
      if (asset && asset.attributes.type === 'character') {
        asset.status = 'draft'
        asset.imageUrl = null
      }
      state.tasks.unshift(task)
    })

    const { writer, fetcher } = createGeneratedAssetWriter()
    const runner = new GenerationTaskRunner(store, null, provider, 0, writer)
    await runner.dispatch(task)

    expect(provider.submit).not.toHaveBeenCalled()
    expect(provider.getStatus).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const stored = await store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(stored).toMatchObject({
      status: 'completed',
      progress: 100,
      metadata: expect.objectContaining({
        providerState: 'completed',
      }),
    })
  })

  it('submits and completes configured video tasks through the remote provider', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(async () => ({ providerTaskId: 'remote-task-1', status: 'queued', progress: 0 })),
      getStatus: vi.fn(async () => ({ status: 'completed', progress: 100, error: null })),
      getContent: vi.fn(async () => ({
        stream: Readable.from([Buffer.from('video-content')]),
        contentType: 'video/mp4',
        contentLength: null,
      })),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const platformReferenceId = '22222222-2222-4222-8222-222222222222'
    const sourceVideoReferenceId = '33333333-3333-4333-8333-333333333333'
    const lipSyncAudioReferenceId = '44444444-4444-4444-8444-444444444444'
    const task: GenerationTask = {
      id: 'local-video-task',
      clientRequestId: 'client-video-task',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '镜头 01',
      prompt: '列车穿过雨幕，镜头平稳跟随',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        videoMode: 'lip-sync',
        duration: 5,
        aspectRatio: '9:16',
        resolution: '720p',
        images: [
          'https://assets.example/shot.jpg',
          `/api/v1/media/${platformReferenceId}`,
          '/demo/local.jpg',
        ],
        sourceImageUrls: [`/api/v1/media/${platformReferenceId}`],
        sourceVideoUrl: `/api/v1/media/${sourceVideoReferenceId}`,
        lipSyncAudioUrl: `/api/v1/media/${lipSyncAudioReferenceId}`,
      },
      status: 'queued',
      progress: 0,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => {
      state.media.push({
        id: platformReferenceId,
        projectId: task.projectId,
        tenantId: task.tenantId,
        kind: 'image',
        name: 'shot.jpg',
        contentType: 'image/jpeg',
        size: 12,
        storageKey: `${task.tenantId}/${task.projectId}/shot.jpg`,
        createdAt: now,
      })
      state.media.push({
        id: sourceVideoReferenceId,
        projectId: task.projectId,
        tenantId: task.tenantId,
        kind: 'video',
        name: 'source.mp4',
        contentType: 'video/mp4',
        size: 120,
        storageKey: `${task.tenantId}/${task.projectId}/source.mp4`,
        createdAt: now,
      })
      state.media.push({
        id: lipSyncAudioReferenceId,
        projectId: task.projectId,
        tenantId: task.tenantId,
        kind: 'audio',
        name: 'voice.wav',
        contentType: 'audio/wav',
        size: 48,
        storageKey: `${task.tenantId}/${task.projectId}/voice.wav`,
        createdAt: now,
      })
      state.tasks.unshift(task)
    })

    const { writer, objects } = createGeneratedAssetWriter()
    const resolver = new MediaReferenceResolver(
      store,
      'https://api.example.com',
      'test-secret-with-at-least-32-characters',
    )
    const runner = new GenerationTaskRunner(store, provider, null, 0, writer, resolver)
    await runner.dispatch(task)

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'lip-sync',
        prompt: task.prompt,
        seconds: 5,
        ratio: '9:16',
        images: ['https://assets.example/shot.jpg', expect.stringMatching(SIGNED_REFERENCE_URL_PATTERN)],
        sourceImageUrls: [expect.stringMatching(SIGNED_REFERENCE_URL_PATTERN)],
        sourceVideoUrl: expect.stringMatching(SIGNED_REFERENCE_URL_PATTERN),
        lipSyncAudioUrl: expect.stringMatching(SIGNED_REFERENCE_URL_PATTERN),
      }),
    )
    expect(provider.getStatus).toHaveBeenCalledWith('remote-task-1')
    expect(provider.getContent).toHaveBeenCalledWith('remote-task-1')
    const stored = await store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(stored).toMatchObject({
      status: 'completed',
      progress: 100,
      resultUrl: expect.stringMatching(MEDIA_URL_PATTERN),
      metadata: { providerTaskId: 'remote-task-1', providerState: 'completed' },
      outputs: [
        {
          id: expect.any(String),
          url: expect.stringMatching(MEDIA_URL_PATTERN),
          mediaType: 'video',
        },
      ],
    })
    const media = await store.read((state) => state.media.find((item) => item.kind === 'video'))
    expect(media).toMatchObject({
      projectId: task.projectId,
      tenantId: task.tenantId,
      contentType: 'video/mp4',
    })
    expect(objects.get(media!.storageKey)).toEqual(Buffer.from('video-content'))
  })

  it('finalizes provider cancellation requests in the worker layer', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(),
      getContent: vi.fn(),
      cancel: vi.fn(async () => undefined),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'remote-cancel-task',
      clientRequestId: 'client-remote-cancel-task',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '取消中的镜头',
      prompt: '雨夜车站',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        providerName: 'aideos-seedance',
        providerState: 'cancelling',
        providerTaskId: 'remote-task-to-cancel',
        cancelRequestedAt: now,
      },
      status: 'running',
      progress: 42,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: 'Cancellation requested',
    }
    await store.mutate((state) => state.tasks.unshift(task))

    const runner = new GenerationTaskRunner(store, provider, null, 0)
    await runner.dispatch(task)

    expect(provider.cancel).toHaveBeenCalledWith('remote-task-to-cancel')
    expect(provider.getStatus).not.toHaveBeenCalled()
    const stored = await store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(stored).toMatchObject({
      status: 'cancelled',
      progress: 100,
      error: 'Task cancelled by user',
      metadata: {
        providerState: 'cancelled',
        providerTaskId: 'remote-task-to-cancel',
      },
    })
  })

  it('submits and completes configured image tasks through the remote provider', async () => {
    const provider: ImageGenerationProvider = {
      submit: vi.fn(async () => ({
        providerTaskId: 'remote-image-task-1',
        status: 'queued',
        progress: 1,
        outputs: [],
      })),
      getStatus: vi.fn(async () => ({
        status: 'completed',
        progress: 100,
        error: null,
        outputs: [
          {
            id: 'remote-image-output-1',
            url: 'https://assets.example/generated-front.png',
            mediaType: 'image',
            view: 'front',
          },
          {
            id: 'remote-image-output-2',
            url: 'https://assets.example/generated-side.png',
            mediaType: 'image',
            view: 'side',
          },
          {
            id: 'remote-image-output-3',
            url: 'https://assets.example/generated-back.png',
            mediaType: 'image',
            view: 'back',
          },
        ],
      })),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const platformReferenceId = '11111111-1111-4111-8111-111111111111'
    const task: GenerationTask = {
      id: 'local-image-task',
      clientRequestId: 'client-image-task',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'image',
      label: '角色三视图',
      prompt: '人物三视图源图，正面侧面背面',
      negativePrompt: '低质量，模糊',
      provider: 'img2',
      model: 'img2-default',
      metadata: {
        assetId: 'asset-lin',
        assetKind: 'character',
        generationStage: 'turnaround',
        aspectRatio: '16:9',
        references: [
          { id: 'face-ref', url: 'https://assets.example/face.jpg', name: 'face.jpg' },
          { id: 'body-ref', url: 'https://assets.example/body.jpg', name: 'body.jpg' },
          { id: platformReferenceId, url: `/api/v1/media/${platformReferenceId}`, name: 'local.jpg' },
        ],
        attributes: {
          type: 'character',
          faceReference: { id: 'face-ref', url: 'https://assets.example/face.jpg', name: 'face.jpg' },
          bodyReference: { id: 'body-ref', url: 'https://assets.example/body.jpg', name: 'body.jpg' },
        },
        turnaround: true,
      },
      status: 'queued',
      progress: 0,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => {
      state.media.push({
        id: platformReferenceId,
        projectId: task.projectId,
        tenantId: task.tenantId,
        kind: 'image',
        name: 'local.jpg',
        contentType: 'image/jpeg',
        size: 12,
        storageKey: `${task.tenantId}/${task.projectId}/local.jpg`,
        createdAt: now,
      })
      state.tasks.unshift(task)
    })

    const { writer, fetcher, objects } = createGeneratedAssetWriter()
    const resolver = new MediaReferenceResolver(
      store,
      'https://api.example.com',
      'test-secret-with-at-least-32-characters',
    )
    const runner = new GenerationTaskRunner(store, null, provider, 0, writer, resolver)
    await runner.dispatch(task)

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.id,
        assetId: 'asset-lin',
        aspectRatio: '16:9',
        prompt: task.prompt,
        negativePrompt: task.negativePrompt,
        referenceUrls: [
          'https://assets.example/face.jpg',
          'https://assets.example/body.jpg',
          expect.stringMatching(SIGNED_REFERENCE_URL_PATTERN),
        ],
        faceReferenceUrl: 'https://assets.example/face.jpg',
        bodyReferenceUrl: 'https://assets.example/body.jpg',
        outputs: ['front', 'side', 'back'],
      }),
    )
    expect(provider.getStatus).toHaveBeenCalledWith('remote-image-task-1')
    const stored = await store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(stored).toMatchObject({
      status: 'completed',
      progress: 100,
      resultUrl: expect.stringMatching(MEDIA_URL_PATTERN),
      metadata: { providerTaskId: 'remote-image-task-1', providerState: 'completed' },
    })
    expect(stored?.outputs).toHaveLength(3)
    expect(stored?.outputs[0]).toMatchObject({
      id: expect.any(String),
      url: expect.stringMatching(MEDIA_URL_PATTERN),
      mediaType: 'image',
      view: 'front',
    })
    expect(stored?.outputs.map((output) => output.view)).toEqual(['front', 'side', 'back'])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(objects.size).toBe(3)

    const asset = await store.read((state) => state.assets.find((item) => item.id === 'asset-lin'))
    expect(asset).toMatchObject({
      imageUrl: expect.stringMatching(MEDIA_URL_PATTERN),
      status: 'confirmed',
      attributes: {
        type: 'character',
        turnaround: true,
        turnaroundReferences: [
          {
            id: expect.any(String),
            url: expect.stringMatching(MEDIA_URL_PATTERN),
            mediaType: 'image',
            view: 'front',
          },
          {
            id: expect.any(String),
            url: expect.stringMatching(MEDIA_URL_PATTERN),
            mediaType: 'image',
            view: 'side',
          },
          {
            id: expect.any(String),
            url: expect.stringMatching(MEDIA_URL_PATTERN),
            mediaType: 'image',
            view: 'back',
          },
        ],
      },
    })
  })

  it('writes immediate face image outputs back to the linked character asset', async () => {
    const provider: ImageGenerationProvider = {
      submit: vi.fn(async () => ({
        providerTaskId: 'remote-face-task-1',
        status: 'completed',
        progress: 100,
        outputs: [
          {
            id: 'remote-face-output-1',
            url: 'https://assets.example/generated-face.png',
            mediaType: 'image',
            view: 'single',
          },
        ],
      })),
      getStatus: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'local-face-task',
      clientRequestId: 'client-face-task',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'image',
      label: 'face reference',
      prompt: 'face portrait',
      negativePrompt: '',
      provider: 'img2',
      model: 'img2-default',
      metadata: {
        assetId: 'asset-lin',
        assetKind: 'character',
        generationStage: 'face',
        aspectRatio: '1:1',
      },
      status: 'queued',
      progress: 0,
      estimatedCredits: 4,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => {
      const asset = state.assets.find((item) => item.id === 'asset-lin')
      if (asset && asset.attributes.type === 'character') {
        asset.status = 'draft'
        asset.imageUrl = null
        asset.attributes.bodyStatus = 'approved'
        asset.attributes.bodyReference = {
          id: 'stale-body',
          url: 'https://assets.example/stale-body.png',
          name: 'stale-body',
        }
        asset.attributes.turnaround = true
      }
      state.tasks.unshift(task)
    })

    const { writer, fetcher, objects } = createGeneratedAssetWriter('image/jpeg')
    const runner = new GenerationTaskRunner(store, null, provider, 0, writer)
    await runner.dispatch(task)

    expect(provider.getStatus).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledWith(
      'https://assets.example/generated-face.png',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(objects.size).toBe(1)
    const stored = await store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(stored).toMatchObject({
      status: 'completed',
      progress: 100,
      resultUrl: expect.stringMatching(MEDIA_URL_PATTERN),
      outputs: [
        {
          id: expect.any(String),
          url: expect.stringMatching(MEDIA_URL_PATTERN),
          mediaType: 'image',
          view: 'single',
        },
      ],
    })

    const asset = await store.read((state) => state.assets.find((item) => item.id === 'asset-lin'))
    expect(asset).toMatchObject({
      imageUrl: expect.stringMatching(MEDIA_URL_PATTERN),
      status: 'confirmed',
      attributes: {
        type: 'character',
        faceStatus: 'approved',
        faceReference: {
          id: expect.any(String),
          url: expect.stringMatching(MEDIA_URL_PATTERN),
          name: expect.stringContaining('face'),
        },
        bodyStatus: 'pending',
        bodyReference: null,
        turnaround: false,
        turnaroundReferences: [],
      },
    })
  })

  it('writes local image outputs back to the linked asset', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'local-scene-task',
      clientRequestId: 'client-scene-task',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'image',
      label: 'scene image',
      prompt: 'scene concept',
      negativePrompt: '',
      provider: 'local',
      model: null,
      metadata: {
        assetId: 'asset-station',
        assetKind: 'scene',
        aspectRatio: '16:9',
      },
      status: 'running',
      progress: 96,
      estimatedCredits: 6,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => {
      const asset = state.assets.find((item) => item.id === 'asset-station')
      if (asset) {
        asset.status = 'draft'
        asset.imageUrl = null
      }
      state.tasks.unshift(task)
    })

    const runner = new GenerationTaskRunner(store, null, null, 0)
    await runner.dispatch(task)

    const stored = await store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(stored).toMatchObject({
      status: 'completed',
      progress: 100,
    })
    expect(stored?.outputs).toHaveLength(1)
    expect(stored?.resultUrl).toBe(stored?.outputs[0]?.url)
    const asset = await store.read((state) => state.assets.find((item) => item.id === 'asset-station'))
    expect(asset).toMatchObject({
      imageUrl: stored?.outputs[0]?.url,
      status: 'confirmed',
    })
  })

  it('rejects remote generated assets that exceed the configured download limit', async () => {
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'oversized-image-task',
      clientRequestId: 'oversized-image-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'image',
      label: 'oversized image',
      prompt: 'image',
      negativePrompt: '',
      provider: 'img2',
      model: null,
      metadata: {},
      status: 'running',
      progress: 50,
      estimatedCredits: 6,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    const { storage, objects } = createMemoryStorage()
    const fetcher = vi.fn(async () => {
      return new Response(Buffer.from('too-large'), {
        headers: { 'content-type': 'image/png', 'content-length': '9' },
      })
    }) as unknown as typeof fetch
    const writer = new GeneratedAssetWriter(storage, fetcher, 4)

    await expect(
      writer.writeRemoteOutputs(task, [
        { id: 'remote-output', url: 'https://assets.example/large.png', mediaType: 'image', view: 'single' },
      ]),
    ).rejects.toThrow('Remote generated asset exceeds 4 bytes')
    expect(objects.size).toBe(0)
  })
})

function createMemoryStorage() {
  const objects = new Map<string, Buffer>()
  const storage: ObjectStorage = {
    put: vi.fn(async (key, content) => {
      objects.set(key, content)
    }),
    get: vi.fn(async (key) => {
      const content = objects.get(key)
      if (!content) throw new Error('missing object')
      return content
    }),
    delete: vi.fn(async (key) => {
      objects.delete(key)
    }),
  }
  return { storage, objects }
}

function createGeneratedAssetWriter(contentType = 'image/png') {
  const { storage, objects } = createMemoryStorage()
  const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    return new Response(Buffer.from(String(input)), { headers: { 'content-type': contentType } })
  }) as unknown as typeof fetch
  return { writer: new GeneratedAssetWriter(storage, fetcher), fetcher, objects }
}
