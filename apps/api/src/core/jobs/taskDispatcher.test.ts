import type { GenerationTask } from '@seqora/contracts'
import { VIDEO_PROMPT_VERSION } from '@seqora/prompting'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

describe('GenerationTaskRunner Seedance integration', () => {
  it('executes queued text tasks through the configured handler', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'script-background-task',
      clientRequestId: 'script-background-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'text',
      label: 'Background script',
      prompt: '',
      negativePrompt: '',
      provider: 'text',
      model: 'seqora-5.6',
      metadata: { generationStage: 'script-generate', scriptOperation: 'generate' },
      status: 'queued',
      progress: 0,
      estimatedCredits: 0,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(task))
    const textTaskHandler = vi.fn(async () => ({ script: 'Generated script', warnings: [] }))

    await new GenerationTaskRunner(store, { textTaskHandler }).tick()

    expect(textTaskHandler).toHaveBeenCalledOnce()
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'completed',
      progress: 100,
      error: null,
      metadata: {
        providerName: 'seqora-text',
        providerState: 'completed',
        textResult: { script: 'Generated script', warnings: [] },
      },
    })
  })

  it('leaves local FFmpeg composition progress under the composer ownership', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'film-compose-task',
      clientRequestId: 'film-compose-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '完整成片预览',
      prompt: '',
      negativePrompt: '',
      provider: 'local-compose',
      model: null,
      metadata: { generationStage: 'film-preview', providerState: 'composing' },
      status: 'running',
      progress: 37,
      estimatedCredits: 0,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(task))

    await new GenerationTaskRunner(store).tick()

    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'running',
      progress: 37,
      outputs: [],
    })
  })

  it('starts three independent provider submissions in one tick for a member', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => {
      state.users.find((user) => user.id === 'user-creator')!.plan = 'member'
      state.tasks.unshift(...queuedVideoTasks(3))
    })
    const { provider, releaseSubmissions } = deferredVideoProvider()
    const runner = new GenerationTaskRunner(store, {
      videoProvider: provider,
      providerPollIntervalMs: 60_000,
    })

    const tick = runner.tick()
    await vi.waitFor(() => expect(provider.submit).toHaveBeenCalledTimes(3))
    releaseSubmissions()
    await tick
    await vi.waitFor(() =>
      expect(
        store.read((state) =>
          state.tasks
            .filter((task) => task.id.startsWith('parallel-video-'))
            .every((task) => typeof task.metadata.providerTaskId === 'string'),
        ),
      ).toBe(true),
    )

    expect(
      store.read((state) =>
        state.tasks
          .filter((task) => task.id.startsWith('parallel-video-'))
          .map((task) => ({
            status: task.status,
            attempts: task.attempts,
            leaseOwnerId: task.leaseOwnerId,
            leaseToken: task.leaseToken,
            providerTaskId: task.metadata.providerTaskId,
          })),
      ),
    ).toEqual([
      {
        status: 'running',
        attempts: 1,
        leaseOwnerId: expect.any(String),
        leaseToken: expect.any(String),
        providerTaskId: 'remote-parallel-video-1',
      },
      {
        status: 'running',
        attempts: 1,
        leaseOwnerId: expect.any(String),
        leaseToken: expect.any(String),
        providerTaskId: 'remote-parallel-video-2',
      },
      {
        status: 'running',
        attempts: 1,
        leaseOwnerId: expect.any(String),
        leaseToken: expect.any(String),
        providerTaskId: 'remote-parallel-video-3',
      },
    ])
  })

  it('starts every ready independent task when demo unlimited concurrency is enabled', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => state.tasks.unshift(...queuedVideoTasks(6)))
    const { provider, releaseSubmissions } = deferredVideoProvider()
    const runner = new GenerationTaskRunner(store, {
      videoProvider: provider,
      providerPollIntervalMs: 60_000,
      demoUnlimitedConcurrency: true,
    })

    const tick = runner.tick()
    await vi.waitFor(() => expect(provider.submit).toHaveBeenCalledTimes(6))
    releaseSubmissions()
    await tick

    expect(provider.submit).toHaveBeenCalledTimes(6)
    expect(
      store.read((state) =>
        state.tasks.filter((task) => task.id.startsWith('parallel-video-')).map((task) => task.status),
      ),
    ).toEqual(Array.from({ length: 6 }, () => 'running'))
  })

  it('starts only one provider submission in one tick for a free user', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => state.tasks.unshift(...queuedVideoTasks(3)))
    const { provider, releaseSubmissions } = deferredVideoProvider()
    const runner = new GenerationTaskRunner(store, {
      videoProvider: provider,
      providerPollIntervalMs: 60_000,
    })

    const tick = runner.tick()
    await vi.waitFor(() => expect(provider.submit).toHaveBeenCalledOnce())
    releaseSubmissions()
    await tick

    expect(provider.submit).toHaveBeenCalledOnce()
    expect(
      store.read((state) =>
        state.tasks.filter((task) => task.id.startsWith('parallel-video-')).map((task) => task.status),
      ),
    ).toEqual(['running', 'queued', 'queued'])
  })

  it('uses independent image and video slots for a free user', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => {
      state.tasks.unshift(...queuedVideoTasks(2), ...queuedImageTasks(2))
    })
    const video = deferredVideoProvider()
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => [
        { view: 'single', contentType: 'image/png', content: Buffer.from('image') },
      ]),
    }
    const files = new Map<string, Buffer>()
    const objectStorage: ObjectStorage = {
      put: vi.fn(async (key, content) => files.set(key, content)),
      get: vi.fn(async (key) => files.get(key) ?? Buffer.alloc(0)),
      delete: vi.fn(async (key) => files.delete(key)),
    }
    const runner = new GenerationTaskRunner(store, {
      videoProvider: video.provider,
      imageProvider,
      objectStorage,
      providerPollIntervalMs: 60_000,
    })

    const tick = runner.tick()
    await vi.waitFor(() => {
      expect(video.provider.submit).toHaveBeenCalledOnce()
      expect(imageProvider.generate).toHaveBeenCalledOnce()
    })
    video.releaseSubmissions()
    await tick

    expect(
      store.read((state) =>
        state.tasks.filter((task) => task.id.startsWith('parallel-video-')).map((task) => task.status),
      ),
    ).toEqual(['running', 'queued'])
    expect(
      store.read((state) =>
        state.tasks.filter((task) => task.id.startsWith('parallel-image-')).map((task) => task.status),
      ),
    ).toEqual(['completed', 'queued'])
  })

  it('allows three image slots and three video slots for a member', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => {
      state.users.find((user) => user.id === 'user-creator')!.plan = 'member'
      state.tasks.unshift(...queuedVideoTasks(4), ...queuedImageTasks(4))
    })
    const video = deferredVideoProvider()
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => [
        { view: 'single', contentType: 'image/png', content: Buffer.from('image') },
      ]),
    }
    const objectStorage: ObjectStorage = {
      put: vi.fn(async () => {}),
      get: vi.fn(async () => Buffer.alloc(0)),
      delete: vi.fn(async () => {}),
    }
    const runner = new GenerationTaskRunner(store, {
      videoProvider: video.provider,
      imageProvider,
      objectStorage,
      providerPollIntervalMs: 60_000,
    })

    const tick = runner.tick()
    await vi.waitFor(() => {
      expect(video.provider.submit).toHaveBeenCalledTimes(3)
      expect(imageProvider.generate).toHaveBeenCalledTimes(3)
    })
    video.releaseSubmissions()
    await tick

    expect(video.provider.submit).toHaveBeenCalledTimes(3)
    expect(imageProvider.generate).toHaveBeenCalledTimes(3)
  })

  it('prevents a second runner from claiming a task while its lease is active', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => state.tasks.unshift(...queuedVideoTasks(1)))
    const first = deferredVideoProvider()
    const secondProvider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    const firstRunner = new GenerationTaskRunner(store, {
      videoProvider: first.provider,
      providerPollIntervalMs: 60_000,
      leaseTtlMs: 60_000,
    })

    const firstTick = firstRunner.tick()
    await vi.waitFor(() => expect(first.provider.submit).toHaveBeenCalledOnce())
    const claimed = store.read((state) => state.tasks.find((task) => task.id === 'parallel-video-1')!)

    await new GenerationTaskRunner(store, {
      videoProvider: secondProvider,
      providerPollIntervalMs: 60_000,
      leaseTtlMs: 60_000,
    }).tick()

    expect(secondProvider.submit).not.toHaveBeenCalled()
    expect(claimed).toMatchObject({
      status: 'running',
      attempts: 1,
      maxAttempts: 3,
      leaseOwnerId: expect.any(String),
      leaseToken: expect.any(String),
      leaseAcquiredAt: expect.any(String),
      leaseHeartbeatAt: expect.any(String),
      leaseExpiresAt: expect.any(String),
      metadata: { providerState: 'submitting' },
    })

    first.releaseSubmissions()
    await firstTick
  })

  it('reclaims an expired remote lease before polling provider result', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(async () => ({ status: 'completed', progress: 100, error: null })),
      getContent: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const [task] = queuedVideoTasks(1)
    const now = new Date().toISOString()
    const expired = new Date(Date.now() - 1_000).toISOString()
    await store.mutate((state) => {
      state.tasks.unshift({
        ...task!,
        status: 'running',
        progress: 50,
        attempts: 1,
        maxAttempts: 3,
        metadata: {
          ...task!.metadata,
          providerName: 'stringx-seedance',
          providerTaskId: 'remote-expired-lease',
          providerState: 'running',
          providerPolledAt: 0,
        },
        leaseOwnerId: 'old-runner',
        leaseToken: 'old-token',
        leaseAcquiredAt: expired,
        leaseHeartbeatAt: expired,
        leaseExpiresAt: expired,
        updatedAt: now,
      })
    })

    await new GenerationTaskRunner(store, {
      videoProvider: provider,
      providerPollIntervalMs: 0,
      leaseTtlMs: 60_000,
    }).tick()

    expect(provider.getStatus).toHaveBeenCalledWith('remote-expired-lease')
    expect(store.read((state) => state.tasks.find((item) => item.id === task!.id))).toMatchObject({
      status: 'completed',
      attempts: 1,
      progress: 100,
      leaseOwnerId: null,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
    })
  })

  it('fails a queued task without submitting when max attempts are exhausted', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const [task] = queuedVideoTasks(1)
    await store.mutate((state) => {
      state.tasks.unshift({
        ...task!,
        attempts: 2,
        maxAttempts: 2,
      })
    })

    await new GenerationTaskRunner(store, { videoProvider: provider }).tick()

    expect(provider.submit).not.toHaveBeenCalled()
    expect(store.read((state) => state.tasks.find((item) => item.id === task!.id))).toMatchObject({
      status: 'failed',
      progress: 100,
      attempts: 2,
      maxAttempts: 2,
      error: 'Task exceeded maximum attempts; create a new task or retry from details',
      leaseOwnerId: null,
      leaseToken: null,
    })
  })

  it('submits and completes configured video tasks through the remote provider', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(async () => ({ providerTaskId: 'remote-task-1', status: 'queued', progress: 0 })),
      getStatus: vi.fn(async () => ({ status: 'completed', progress: 100, error: null })),
      getContent: vi.fn(async () => ({
        stream: Readable.from([]),
        contentType: 'video/mp4',
        contentLength: null,
        statusCode: 200,
        acceptRanges: null,
        contentRange: null,
      })),
    }
    const store = new AppStore(null)
    await store.initialize()
    const onVideoCompleted = vi.fn(async () => {})
    const now = new Date().toISOString()
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
        duration: 3,
        aspectRatio: '9:16',
        resolution: '720p',
        images: [
          'https://assets.example/shot.jpg',
          'asset://maas-01kxxwtxkp0f1tanhkatt8q0gb',
          '/demo/local.jpg',
        ],
      },
      status: 'paused',
      progress: 0,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(task))

    const runner = new GenerationTaskRunner(store, {
      videoProvider: provider,
      providerPollIntervalMs: 0,
      onVideoCompleted,
    })
    await runner.tick()
    expect(provider.submit).not.toHaveBeenCalled()

    await store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)!
      stored.status = 'queued'
    })
    await runner.tick()

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: task.prompt,
        seconds: 4,
        ratio: '9:16',
        images: [
          { url: 'https://assets.example/shot.jpg', role: 'reference_image' },
          { url: 'asset://maas-01kxxwtxkp0f1tanhkatt8q0gb', role: 'reference_image' },
        ],
        negativePrompt: expect.any(String),
        returnLastFrame: true,
      }),
    )
    expect(provider.getStatus).toHaveBeenCalledWith('remote-task-1')
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'completed',
      progress: 100,
      resultUrl: '/api/v1/generation/tasks/local-video-task/content',
      attempts: 1,
      leaseOwnerId: null,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
      metadata: {
        providerName: 'stringx-seedance',
        providerTaskId: 'remote-task-1',
        providerState: 'completed',
      },
      outputs: [
        {
          id: 'local-video-task-video',
          url: '/api/v1/generation/tasks/local-video-task/content',
          mediaType: 'video',
        },
      ],
    })
    expect(onVideoCompleted).toHaveBeenCalledOnce()
    expect(onVideoCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, status: 'completed' }),
    )
  })

  it('stores a provider tail frame and passes it as first frame to a linked shot', async () => {
    const files = new Map<string, Buffer>()
    const provider: VideoGenerationProvider = {
      submit: vi.fn(async ({ taskId }) => ({
        providerTaskId: `remote-${taskId}`,
        status: 'queued' as const,
        progress: 0,
      })),
      getStatus: vi.fn(async () => ({
        status: 'completed' as const,
        progress: 100,
        error: null,
      })),
      getLastFrameContent: vi.fn(async () => ({
        stream: Readable.from([Buffer.from('tail-frame')]),
        contentType: 'image/jpeg',
        contentLength: '10',
        statusCode: 200,
        acceptRanges: null,
        contentRange: null,
      })),
      getContent: vi.fn(),
    }
    const objectStorage: ObjectStorage = {
      put: vi.fn(async (key, content) => files.set(key, content)),
      get: vi.fn(async (key) => files.get(key) ?? Buffer.alloc(0)),
      delete: vi.fn(async (key) => files.delete(key)),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const sourceTask: GenerationTask = {
      id: 'continuity-source',
      clientRequestId: 'continuity-source-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '镜头 01',
      prompt: '人物抬头',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: { shotId: 'shot-1', duration: 5, aspectRatio: '9:16', resolution: '720p' },
      status: 'queued',
      progress: 0,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(sourceTask))
    const runner = new GenerationTaskRunner(store, {
      videoProvider: provider,
      objectStorage,
      providerPollIntervalMs: 0,
    })

    await runner.tick()
    const sourceCompleted = store.read((state) => state.tasks.find((item) => item.id === sourceTask.id))!
    expect(sourceCompleted.outputs).toEqual(
      expect.arrayContaining([expect.objectContaining({ view: 'last-frame', mediaType: 'image' })]),
    )
    expect(
      files.get(`${sourceTask.tenantId}/${sourceTask.projectId}/generated/${sourceTask.id}-last-frame.jpg`),
    ).toEqual(Buffer.from('tail-frame'))

    const targetFrameTask: GenerationTask = {
      ...sourceTask,
      id: 'continuity-target-frame',
      clientRequestId: 'continuity-target-frame-client',
      kind: 'image',
      label: '镜头 02 分镜图',
      provider: 'img2',
      model: 'img2-default',
      metadata: {
        shotId: 'shot-2',
        generatedOutputs: [
          {
            view: 'single',
            storageKey: 'generated/continuity-target-frame.png',
            contentType: 'image/png',
            size: 12,
          },
        ],
      },
      status: 'completed',
      progress: 100,
      resultUrl: '/api/v1/generation/tasks/continuity-target-frame/outputs/single',
      outputs: [
        {
          id: 'continuity-target-frame-single',
          url: '/api/v1/generation/tasks/continuity-target-frame/outputs/single',
          mediaType: 'image',
          view: 'single',
        },
      ],
    }
    files.set('generated/continuity-target-frame.png', Buffer.from('target-frame'))
    await store.mutate((state) => state.tasks.unshift(targetFrameTask))

    const linkedTask: GenerationTask = {
      ...sourceTask,
      id: 'continuity-linked',
      clientRequestId: 'continuity-linked-client',
      label: '镜头 02',
      prompt: '人物继续向前走',
      metadata: {
        shotId: 'shot-2',
        duration: 5,
        aspectRatio: '9:16',
        resolution: '720p',
        continuityMode: 'continue',
        continuitySourceTaskId: sourceTask.id,
        storyboardImageUrl: targetFrameTask.resultUrl,
        images: [targetFrameTask.resultUrl],
        dependsOnTaskId: sourceTask.id,
      },
      status: 'queued',
      progress: 0,
      resultUrl: null,
      outputs: [],
    }
    await store.mutate((state) => state.tasks.unshift(linkedTask))
    await runner.tick()

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          {
            role: 'first_frame',
            url: `data:image/jpeg;base64,${Buffer.from('tail-frame').toString('base64')}`,
          },
          {
            role: 'last_frame',
            url: `data:image/png;base64,${Buffer.from('target-frame').toString('base64')}`,
          },
        ],
      }),
    )
  })

  it('does not submit a linked shot when the completed source has no tail frame', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const [source] = queuedVideoTasks(1)
    source.id = 'missing-tail-source'
    source.status = 'completed'
    source.progress = 100
    source.resultUrl = '/api/v1/generation/tasks/missing-tail-source/content'
    source.outputs = [
      {
        id: 'missing-tail-source-video',
        url: source.resultUrl,
        mediaType: 'video',
        view: 'single',
      },
    ]
    const linked: GenerationTask = {
      ...queuedVideoTasks(1)[0]!,
      id: 'missing-tail-linked',
      clientRequestId: 'missing-tail-linked-client',
      metadata: {
        shotId: 'shot-2',
        continuityMode: 'continue',
        continuitySourceTaskId: source.id,
        dependsOnTaskId: source.id,
        dependsOnTaskIds: [source.id],
      },
    }
    await store.mutate((state) => state.tasks.unshift(linked, source))

    await new GenerationTaskRunner(store, { videoProvider: provider }).tick()

    expect(provider.submit).not.toHaveBeenCalled()
    expect(store.read((state) => state.tasks.find((task) => task.id === linked.id))).toMatchObject({
      status: 'failed',
      error: 'Dependency source is missing a last frame; regenerate the previous shot',
    })
  })

  it('does not poll a task owned by a different video provider', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'official-running-task',
      clientRequestId: 'official-running-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '旧 Provider 镜头',
      prompt: '雨夜车站',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        providerName: 'volc-ark-seedance',
        providerTaskId: 'official-provider-task',
        providerState: 'running',
      },
      status: 'running',
      progress: 50,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(task))

    await new GenerationTaskRunner(store, {
      videoProvider: provider,
      videoProviderName: 'stringx-seedance',
      providerPollIntervalMs: 0,
    }).tick()

    expect(provider.getStatus).not.toHaveBeenCalled()
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'running',
      progress: 50,
      metadata: { providerName: 'volc-ark-seedance' },
    })
  })

  it('refunds reserved credits when a remote video submission fails', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(async () => {
        throw new Error('duration is not supported')
      }),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'failed-video-task',
      clientRequestId: 'failed-video-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '镜头 01',
      prompt: '雨夜车站',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: { duration: 3, aspectRatio: '9:16', resolution: '720p' },
      status: 'queued',
      progress: 0,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    const originalCredits = store.read(
      (state) => state.users.find((item) => item.id === task.userId)?.credits ?? 0,
    )
    await store.mutate((state) => {
      const user = state.users.find((item) => item.id === task.userId)!
      user.credits -= task.estimatedCredits
      state.ledger.unshift({
        id: `generation-${task.clientRequestId}`,
        userId: task.userId,
        tenantId: task.tenantId,
        amount: -task.estimatedCredits,
        balance: user.credits,
        type: 'generation',
        description: task.label,
        createdAt: now,
      })
      state.tasks.unshift(task)
    })

    const runner = new GenerationTaskRunner(store, { videoProvider: provider })
    await runner.tick()
    await vi.waitFor(() =>
      expect(
        store.read((state) => {
          const stored = state.tasks.find((item) => item.id === task.id)
          return stored?.status === 'failed' && typeof stored.metadata.creditsRefundedAt === 'string'
        }),
      ).toBe(true),
    )

    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'failed',
      error: 'duration is not supported',
      metadata: { creditsRefundedAt: expect.any(String) },
    })
    expect(store.read((state) => state.users.find((item) => item.id === task.userId)?.credits)).toBe(
      originalCredits,
    )
    expect(store.read((state) => state.ledger.filter((entry) => entry.id === `refund-${task.id}`))).toEqual([
      expect.objectContaining({ amount: 18, type: 'adjustment', balance: originalCredits }),
    ])
  })

  it('cancels remote video requests in the worker before refunding reserved credits', async () => {
    const cancel = vi.fn(async () => {})
    const provider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(),
      getContent: vi.fn(),
      cancel,
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'cancelled-video-task',
      clientRequestId: 'cancelled-video-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '镜头 01',
      prompt: '雨夜车站',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        providerName: 'stringx-seedance',
        providerTaskId: 'remote-cancelled-video',
        providerCancelRequestedAt: now,
      },
      status: 'cancelled',
      progress: 100,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    const originalCredits = store.read(
      (state) => state.users.find((item) => item.id === task.userId)?.credits ?? 0,
    )
    await store.mutate((state) => {
      const user = state.users.find((item) => item.id === task.userId)!
      user.credits -= task.estimatedCredits
      state.ledger.unshift({
        id: `generation-${task.clientRequestId}`,
        userId: task.userId,
        tenantId: task.tenantId,
        amount: -task.estimatedCredits,
        balance: user.credits,
        type: 'generation',
        description: task.label,
        createdAt: now,
      })
      state.tasks.unshift(task)
    })

    await new GenerationTaskRunner(store, { videoProvider: provider }).tick()

    expect(cancel).toHaveBeenCalledWith('remote-cancelled-video')
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'cancelled',
      metadata: {
        providerCancelCompletedAt: expect.any(String),
        creditsRefundedAt: expect.any(String),
      },
    })
    expect(store.read((state) => state.users.find((item) => item.id === task.userId)?.credits)).toBe(
      originalCredits,
    )
    expect(store.read((state) => state.ledger.filter((entry) => entry.id === `refund-${task.id}`))).toEqual([
      expect.objectContaining({ amount: 18, type: 'adjustment', balance: originalCredits }),
    ])
  })

  it('claims cancelled remote tasks by resource lock instead of processing the same shot twice', async () => {
    const cancel = vi.fn(async () => {})
    const provider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(),
      getContent: vi.fn(),
      cancel,
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    await store.mutate((state) => {
      state.tasks.unshift(
        cancelledRemoteVideoTask('cancelled-shot-1-a', 'shot-1', 'remote-cancelled-shot-1-a', now),
        cancelledRemoteVideoTask('cancelled-shot-1-b', 'shot-1', 'remote-cancelled-shot-1-b', now),
        cancelledRemoteVideoTask('cancelled-shot-2', 'shot-2', 'remote-cancelled-shot-2', now),
      )
    })

    await new GenerationTaskRunner(store, { videoProvider: provider }).tick()

    expect(cancel).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenNthCalledWith(1, 'remote-cancelled-shot-1-a')
    expect(cancel).toHaveBeenNthCalledWith(2, 'remote-cancelled-shot-2')
    expect(store.read((state) => state.tasks.find((item) => item.id === 'cancelled-shot-1-b'))).toMatchObject(
      {
        status: 'cancelled',
        metadata: {
          cancelResourceLockKind: 'video-shot',
          cancelResourceLockKey: 'shotId:shot-1',
          providerCancelRequestedAt: now,
        },
      },
    )
  })

  it('recovers a visible remote video that an older status parser marked as failed', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(async () => ({ status: 'running', progress: 50, error: null })),
      getContent: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'status-recovery-task',
      clientRequestId: 'status-recovery-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '状态恢复镜头',
      prompt: '雨夜车站',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        providerName: 'stringx-seedance',
        providerTaskId: 'remote-status-recovery-task',
        providerState: 'running',
      },
      status: 'failed',
      progress: 100,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: '[{"code":"invalid_value","path":["status"]}]',
    }
    await store.mutate((state) => state.tasks.unshift(task))

    await new GenerationTaskRunner(store, {
      videoProvider: provider,
      videoProviderName: 'stringx-seedance',
      providerPollIntervalMs: 0,
    }).tick()

    expect(provider.getStatus).toHaveBeenCalledWith('remote-status-recovery-task')
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'running',
      progress: 50,
      error: null,
      metadata: { statusParseRecoveredAt: expect.any(String) },
    })
  })

  it('stores generated images and updates the linked storyboard shot', async () => {
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => [
        {
          view: 'single',
          contentType: 'image/png',
          content: Buffer.from('generated-image'),
        },
      ]),
    }
    const files = new Map<string, Buffer>()
    const objectStorage: ObjectStorage = {
      put: vi.fn(async (key, content) => {
        files.set(key, content)
      }),
      get: vi.fn(async (key) => files.get(key) ?? Buffer.alloc(0)),
      delete: vi.fn(async (key) => {
        files.delete(key)
      }),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'storyboard-image-task',
      clientRequestId: 'storyboard-image-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'image',
      label: '分镜图 01',
      prompt: '雨夜车站大全景',
      negativePrompt: '',
      provider: 'img2',
      model: 'img2-default',
      metadata: { shotId: 'shot-1', aspectRatio: '9:16', references: [] },
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

    const runner = new GenerationTaskRunner(store, { imageProvider, objectStorage })
    await runner.tick()

    expect(imageProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: task.prompt, aspectRatio: '9:16', outputs: ['single'] }),
    )
    expect(objectStorage.put).toHaveBeenCalledOnce()
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'completed',
      progress: 100,
      resultUrl: '/api/v1/generation/tasks/storyboard-image-task/outputs/single',
      attempts: 1,
      leaseOwnerId: null,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
    })
    expect(store.read((state) => state.shots.find((item) => item.id === 'shot-1'))?.imageUrl).toBe(
      '/api/v1/generation/tasks/storyboard-image-task/outputs/single',
    )
  })

  it('submits a storyboard video without waiting for its optional storyboard image', async () => {
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => [
        { view: 'single', contentType: 'image/png', content: Buffer.from('storyboard-image') },
      ]),
    }
    const videoProvider: VideoGenerationProvider = {
      submit: vi.fn(async () => ({
        providerTaskId: 'dependent-video-remote',
        status: 'queued',
        progress: 0,
      })),
      getStatus: vi.fn(async () => ({ status: 'completed', progress: 100, error: null })),
      getContent: vi.fn(),
    }
    const files = new Map<string, Buffer>()
    const objectStorage: ObjectStorage = {
      put: vi.fn(async (key, content) => {
        files.set(key, content)
      }),
      get: vi.fn(async (key) => files.get(key) ?? Buffer.alloc(0)),
      delete: vi.fn(async (key) => {
        files.delete(key)
      }),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const imageTask: GenerationTask = {
      id: 'dependent-storyboard-image',
      clientRequestId: 'dependent-storyboard-image-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'image',
      label: '分镜图 01',
      prompt: '雨夜车站',
      negativePrompt: '',
      provider: 'img2',
      model: 'img2-default',
      metadata: { shotId: 'shot-1', aspectRatio: '9:16', references: [] },
      status: 'queued',
      progress: 0,
      estimatedCredits: 6,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    const videoTask: GenerationTask = {
      id: 'dependent-video',
      clientRequestId: 'dependent-video-client',
      projectId: imageTask.projectId,
      tenantId: imageTask.tenantId,
      userId: imageTask.userId,
      kind: 'video',
      label: '镜头 01',
      prompt: '镜头缓慢推进',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        shotId: 'shot-1',
        duration: 5,
        aspectRatio: '9:16',
        resolution: '720p',
        videoInputMode: 'storyboard-and-assets',
        dependsOnTaskId: imageTask.id,
        images: [`/api/v1/generation/tasks/${imageTask.id}/outputs/single`],
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
    await store.mutate((state) => state.tasks.unshift(imageTask, videoTask))

    const runner = new GenerationTaskRunner(store, {
      imageProvider,
      videoProvider,
      objectStorage,
      providerPollIntervalMs: 0,
    })
    await runner.tick()

    expect(imageProvider.generate).toHaveBeenCalledOnce()
    expect(videoProvider.submit).toHaveBeenCalledOnce()
    expect(videoProvider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('不是静止图片，不是幻灯片'),
        images: [],
        negativePrompt: expect.stringContaining('不要闪烁'),
        returnLastFrame: true,
      }),
    )
    expect(
      store.read((state) => state.tasks.find((task) => task.id === videoTask.id)?.metadata),
    ).toMatchObject({
      duration: 5,
      compiledPrompt: expect.stringContaining('禁止突然切镜、跳时、回切和蒙太奇'),
      videoPromptVersion: VIDEO_PROMPT_VERSION,
    })
    expect(store.read((state) => state.tasks.find((task) => task.id === videoTask.id)?.status)).toBe(
      'completed',
    )
    expect(store.read((state) => state.tasks.find((task) => task.id === videoTask.id))).toMatchObject({
      attempts: 1,
      leaseOwnerId: null,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
    })
  })
})

function queuedVideoTasks(count: number): GenerationTask[] {
  const now = new Date().toISOString()
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1
    return {
      id: `parallel-video-${sequence}`,
      clientRequestId: `parallel-video-client-${sequence}`,
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: `并发镜头 ${sequence}`,
      prompt: `角色执行第 ${sequence} 个独立动作`,
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        shotId: `parallel-shot-${sequence}`,
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
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
  })
}

function queuedImageTasks(count: number): GenerationTask[] {
  const now = new Date().toISOString()
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1
    return {
      id: `parallel-image-${sequence}`,
      clientRequestId: `parallel-image-client-${sequence}`,
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'image',
      label: `并发图片 ${sequence}`,
      prompt: `第 ${sequence} 张独立图片`,
      negativePrompt: '',
      provider: 'img2',
      model: 'img2-default',
      metadata: { aspectRatio: '16:9', references: [] },
      status: 'queued',
      progress: 0,
      estimatedCredits: 6,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
  })
}

function deferredVideoProvider(): {
  provider: VideoGenerationProvider
  releaseSubmissions: () => void
} {
  let releaseSubmissions!: () => void
  const submissionsReleased = new Promise<void>((resolve) => {
    releaseSubmissions = resolve
  })
  return {
    releaseSubmissions,
    provider: {
      submit: vi.fn(async ({ taskId }) => {
        await submissionsReleased
        return {
          providerTaskId: `remote-${taskId}`,
          status: 'queued' as const,
          progress: 0,
        }
      }),
      getStatus: vi.fn(async () => ({ status: 'running', progress: 10, error: null })),
      getContent: vi.fn(),
    },
  }
}

function cancelledRemoteVideoTask(
  id: string,
  shotId: string,
  providerTaskId: string,
  now: string,
): GenerationTask {
  return {
    id,
    clientRequestId: `${id}-client`,
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-creator',
    kind: 'video',
    label: id,
    prompt: 'cancelled remote video',
    negativePrompt: '',
    provider: 'seedance',
    model: 'doubao-seedance-2-0-260128',
    metadata: {
      shotId,
      cancelResourceLockKind: 'video-shot',
      cancelResourceLockKey: `shotId:${shotId}`,
      providerName: 'stringx-seedance',
      providerTaskId,
      providerCancelRequestedAt: now,
    },
    status: 'cancelled',
    progress: 100,
    estimatedCredits: 18,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
}
