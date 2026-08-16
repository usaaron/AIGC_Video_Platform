import type { GenerationTask } from '@seqora/contracts'
import { VIDEO_PROMPT_VERSION } from '@seqora/prompting'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { usageCollector } from '../observability/usage.js'
import { GenerationTaskRunner } from './taskDispatcher.js'
import type { TaskRunnerLock } from './taskRunnerLock.js'

describe('GenerationTaskRunner Seedance integration', () => {
  beforeEach(() => {
    usageCollector.resetForTests()
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
      userId: 'user-member',
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

  it('executes handled local tasks once and writes the text result', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'background-script-task',
      clientRequestId: 'background-script-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      kind: 'text',
      label: 'Background script',
      prompt: '',
      negativePrompt: '',
      provider: 'text',
      model: 'glm-5.2',
      metadata: { scriptOperation: 'suggest-assets' },
      status: 'queued',
      progress: 0,
      estimatedCredits: 1,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(task))
    const result = { summary: 'Use one character and one location', assets: [] }
    const execute = vi.fn(async () => result)
    const runner = new GenerationTaskRunner(store, {
      localTaskHandler: {
        canHandle: (candidate) => candidate.provider === 'text',
        execute,
      },
    })

    await runner.tick()
    await vi.waitFor(() =>
      expect(store.read((state) => state.tasks.find((item) => item.id === task.id)?.status)).toBe(
        'completed',
      ),
    )
    await runner.tick()

    expect(execute).toHaveBeenCalledOnce()
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'completed',
      progress: 100,
      leaseOwnerId: null,
      leaseToken: null,
      metadata: {
        textResult: result,
        localTaskCompletedAt: expect.any(String),
      },
    })
    await vi.waitFor(() =>
      expect(usageCollector.snapshot({ userId: task.userId })).toMatchObject({
        jobConcurrency: 0,
        jobCount: 1,
        jobFailedCount: 0,
        jobFailureRate: 0,
        creditsUsed: task.estimatedCredits,
      }),
    )
  })

  it('starts three independent provider submissions in one tick for a member', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => {
      state.users.find((user) => user.id === 'user-member')!.plan = 'member'
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

  it('skips worker work when the task runner lock is already held', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => state.tasks.unshift(...queuedVideoTasks(1)))
    const provider: VideoGenerationProvider = {
      submit: vi.fn(),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    const taskRunnerLock: TaskRunnerLock = {
      runExclusive: vi.fn(async () => false),
    }

    await new GenerationTaskRunner(store, { videoProvider: provider, taskRunnerLock }).tick()

    expect(taskRunnerLock.runExclusive).toHaveBeenCalledOnce()
    expect(provider.submit).not.toHaveBeenCalled()
    const stored = store.read((state) => state.tasks.find((task) => task.id === 'parallel-video-1')!)
    expect(stored.status).toBe('queued')
    expect(stored.attempts ?? 0).toBe(0)
    expect(stored.leaseOwnerId ?? null).toBeNull()
  })

  it('refreshes runtime state before running inside the task runner lock', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const calls: string[] = []
    const taskRunnerLock: TaskRunnerLock = {
      runExclusive: vi.fn(async (operation) => {
        calls.push('lock')
        await operation()
        return true
      }),
    }
    const beforeTick = vi.fn(async () => {
      calls.push('refresh')
    })

    await new GenerationTaskRunner(store, { beforeTick, taskRunnerLock }).tick()

    expect(calls).toEqual(['lock', 'refresh'])
  })

  it('keeps claiming member image work while a previous Img2 request is still pending', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => {
      state.users.find((user) => user.id === 'user-member')!.plan = 'member'
      state.tasks.unshift(imageTask('parallel-image-1', 'asset-image-1'))
    })
    const releases: Array<() => void> = []
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => {
        const index = releases.length
        await new Promise<void>((resolve) => {
          releases[index] = resolve
        })
        return [{ view: 'single', contentType: 'image/png', content: Buffer.from(`image-${index + 1}`) }]
      }),
    }
    const objectStorage = memoryObjectStorage()
    const runner = new GenerationTaskRunner(store, { imageProvider, objectStorage })

    await runner.tick()
    await vi.waitFor(() => expect(imageProvider.generate).toHaveBeenCalledOnce())

    await store.mutate((state) => {
      state.tasks.unshift(imageTask('parallel-image-2', 'asset-image-2'))
    })
    await runner.tick()

    await vi.waitFor(() => expect(imageProvider.generate).toHaveBeenCalledTimes(2))
    releases.forEach((release) => release())
    await vi.waitFor(() =>
      expect(
        store.read((state) =>
          state.tasks
            .filter((task) => task.id.startsWith('parallel-image-'))
            .map((task) => task.status)
            .sort(),
        ),
      ).toEqual(['completed', 'completed']),
    )
  })

  it('keeps the worker alive when a lease heartbeat temporarily cannot acquire the mutation lock', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = imageTask('heartbeat-lock-image', 'heartbeat-lock-asset')
    await store.mutate((state) => state.tasks.unshift(task))
    let releaseGeneration: (() => void) | null = null
    let blockMutationLock = false
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(
        () =>
          new Promise((resolve) => {
            releaseGeneration = () =>
              resolve([{ view: 'single', contentType: 'image/png', content: Buffer.from('generated-image') }])
          }),
      ),
    }
    const taskRunnerLock: TaskRunnerLock = {
      runExclusive: vi.fn(async (operation) => {
        if (blockMutationLock) return false
        await operation()
        return true
      }),
    }
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    const runner = new GenerationTaskRunner(store, {
      imageProvider,
      objectStorage: memoryObjectStorage(),
      leaseTtlMs: 3_000,
      taskMutationLockTimeoutMs: 20,
      taskRunnerLock,
    })

    await runner.tick()
    await vi.waitFor(() => expect(imageProvider.generate).toHaveBeenCalledOnce())
    blockMutationLock = true
    await vi.waitFor(
      () =>
        expect(warning).toHaveBeenCalledWith(
          expect.stringContaining(`lease heartbeat failed for ${task.id}`),
          expect.objectContaining({ code: 'SEQORA_GENERATION_TASK_BACKGROUND_FAILURE' }),
        ),
      { timeout: 1_500 },
    )

    blockMutationLock = false
    releaseGeneration!()
    await vi.waitFor(() =>
      expect(store.read((state) => state.tasks.find((item) => item.id === task.id)?.status)).toBe(
        'completed',
      ),
    )
    await runner.tick()

    expect(imageProvider.generate).toHaveBeenCalledOnce()
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'completed',
      progress: 100,
      leaseOwnerId: null,
      leaseToken: null,
    })
    warning.mockRestore()
  })

  it('keeps accepting work when the final remote-task refresh cannot acquire the mutation lock', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const firstTask = imageTask('final-refresh-image-1', 'final-refresh-asset-1')
    await store.mutate((state) => state.tasks.unshift(firstTask))
    let blockMutationLock = false
    let failCompletedTaskRefresh = true
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => [
        { view: 'single', contentType: 'image/png', content: Buffer.from('generated-image') },
      ]),
    }
    const taskRunnerLock: TaskRunnerLock = {
      runExclusive: vi.fn(async (operation) => {
        const firstCompleted = store.read(
          (state) => state.tasks.find((item) => item.id === firstTask.id)?.status === 'completed',
        )
        if (blockMutationLock || (failCompletedTaskRefresh && firstCompleted)) return false
        await operation()
        return true
      }),
    }
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    const runner = new GenerationTaskRunner(store, {
      imageProvider,
      objectStorage: memoryObjectStorage(),
      taskMutationLockTimeoutMs: 20,
      taskRunnerLock,
    })

    await runner.tick()
    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining(`final state refresh failed for ${firstTask.id}`),
        expect.objectContaining({ code: 'SEQORA_GENERATION_TASK_BACKGROUND_FAILURE' }),
      ),
    )
    expect(store.read((state) => state.tasks.find((item) => item.id === firstTask.id)?.status)).toBe(
      'completed',
    )

    blockMutationLock = false
    failCompletedTaskRefresh = false
    const secondTask = imageTask('final-refresh-image-2', 'final-refresh-asset-2')
    await store.mutate((state) => state.tasks.unshift(secondTask))
    await runner.tick()
    await vi.waitFor(() => expect(imageProvider.generate).toHaveBeenCalledTimes(2))

    expect(store.read((state) => state.tasks.find((item) => item.id === secondTask.id)?.status)).toBe(
      'completed',
    )
    warning.mockRestore()
  })

  it('passes a stable idempotency key to Img2 provider submissions', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = imageTask('idempotent-image-task', 'asset-idempotent')
    await store.mutate((state) => state.tasks.unshift(task))
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => [
        { view: 'single', contentType: 'image/png', content: Buffer.from('idempotent-image') },
      ]),
    }

    await new GenerationTaskRunner(store, {
      imageProvider,
      objectStorage: memoryObjectStorage(),
    }).tick()

    await vi.waitFor(() => expect(imageProvider.generate).toHaveBeenCalledOnce())
    expect(imageProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.id,
        idempotencyKey: `generation:${task.tenantId}:${task.id}`,
      }),
    )
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      metadata: { providerIdempotencyKey: `generation:${task.tenantId}:${task.id}` },
    })
  })

  it('loads uploaded image references from the media repository before calling Img2', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = imageTask('persisted-reference-task', 'asset-with-reference')
    task.model = 'img2-default'
    task.metadata = {
      ...task.metadata,
      generationStage: 'body',
      references: [{ url: '/api/v1/media/uploaded-face', name: 'face.png' }],
    }
    await store.mutate((state) => state.tasks.unshift(task))
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => [
        { view: 'single', contentType: 'image/png', content: Buffer.from('generated-body') },
      ]),
    }
    const files = new Map([['media/uploaded-face.png', Buffer.from('uploaded-face-content')]])
    const objectStorage: ObjectStorage = {
      put: vi.fn(async (key, content) => void files.set(key, content)),
      get: vi.fn(async (key) => files.get(key) ?? Buffer.alloc(0)),
      delete: vi.fn(async (key) => void files.delete(key)),
    }
    const mediaRepository = {
      findSourceById: vi.fn(async () => ({
        storageKey: 'media/uploaded-face.png',
        contentType: 'image/png',
      })),
    }

    await new GenerationTaskRunner(store, {
      imageProvider,
      mediaRepository,
      objectStorage,
    }).tick()

    await vi.waitFor(() => expect(imageProvider.generate).toHaveBeenCalledOnce())
    expect(mediaRepository.findSourceById).toHaveBeenCalledWith(
      'uploaded-face',
      task.projectId,
      task.tenantId,
      'image',
    )
    expect(imageProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'img2-default',
        references: [
          expect.objectContaining({
            name: 'face.png',
            contentType: 'image/png',
            content: Buffer.from('uploaded-face-content'),
          }),
        ],
      }),
    )
  })

  it('fails an image task instead of dropping a missing requested reference', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = imageTask('missing-reference-task', 'asset-with-missing-reference')
    task.metadata = {
      ...task.metadata,
      generationStage: 'body',
      references: [{ url: '/api/v1/media/missing-face', name: 'face.png' }],
    }
    await store.mutate((state) => state.tasks.unshift(task))
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(),
    }

    await new GenerationTaskRunner(store, {
      imageProvider,
      mediaRepository: { findSourceById: vi.fn(async () => null) },
      objectStorage: memoryObjectStorage(),
    }).tick()

    await vi.waitFor(() =>
      expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('参考图读取失败'),
      }),
    )
    expect(imageProvider.generate).not.toHaveBeenCalled()
  })

  it('marks a timed out Img2 submission as failed instead of leaving it submitting', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = imageTask('timeout-image-task', 'timeout-asset')
    await store.mutate((state) => state.tasks.unshift(task))
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(async () => {
        throw timeout
      }),
    }

    await new GenerationTaskRunner(store, { imageProvider, objectStorage: memoryObjectStorage() }).tick()

    await vi.waitFor(() =>
      expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
        status: 'failed',
        progress: 100,
        error: expect.stringContaining('第三方生成请求超时'),
        metadata: {
          providerName: 'tokenadvent-img2',
          providerState: 'failed',
          providerError: expect.stringContaining('第三方生成请求超时'),
          providerFailedAt: expect.any(String),
        },
        leaseOwnerId: null,
        leaseToken: null,
      }),
    )
  })

  it('retries a timed out video submission with the same idempotency key', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const [task] = queuedVideoTasks(1)
    await store.mutate((state) => state.tasks.unshift(task!))
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    const provider: VideoGenerationProvider = {
      submit: vi
        .fn()
        .mockRejectedValueOnce(timeout)
        .mockResolvedValueOnce({ providerTaskId: 'video-after-retry', status: 'queued', progress: 0 }),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    const runner = new GenerationTaskRunner(store, {
      videoProvider: provider,
      providerPollIntervalMs: 60_000,
    })

    await runner.tick()
    await vi.waitFor(() =>
      expect(store.read((state) => state.tasks.find((item) => item.id === task!.id))).toMatchObject({
        status: 'queued',
        attempts: 1,
        error: null,
        metadata: {
          providerState: 'retry_wait',
          providerSubmissionError: expect.stringContaining('第三方生成请求超时'),
          providerRetryNotBefore: expect.any(String),
        },
      }),
    )
    await store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task!.id)!
      stored.metadata = { ...stored.metadata, providerRetryNotBefore: new Date(0).toISOString() }
    })

    await runner.tick()
    await vi.waitFor(() => expect(provider.submit).toHaveBeenCalledTimes(2))
    expect(provider.submit.mock.calls.map(([request]) => request.idempotencyKey)).toEqual([
      `generation:${task!.tenantId}:${task!.id}`,
      `generation:${task!.tenantId}:${task!.id}`,
    ])
    expect(store.read((state) => state.tasks.find((item) => item.id === task!.id))).toMatchObject({
      status: 'running',
      attempts: 2,
      metadata: { providerTaskId: 'video-after-retry' },
    })
  })

  it('retries a stalled provider video once without breaking its continuity chain', async () => {
    const submit = vi.fn(async ({ taskId }) => ({
      providerTaskId: `remote-${taskId}-${submit.mock.calls.length}`,
      status: 'queued' as const,
      progress: 0,
    }))
    const cancel = vi.fn(async () => {})
    const provider: VideoGenerationProvider = {
      submit,
      getStatus: vi.fn(async () => ({ status: 'running' as const, progress: 50, error: null })),
      getContent: vi.fn(),
      cancel,
    }
    const store = new AppStore(null)
    await store.initialize()
    const [source, linked] = queuedVideoTasks(2)
    source!.id = 'stalled-source'
    source!.clientRequestId = 'stalled-source-client'
    source!.metadata = { ...source!.metadata, shotId: 'shot-1' }
    linked!.id = 'stalled-linked'
    linked!.clientRequestId = 'stalled-linked-client'
    linked!.metadata = {
      ...linked!.metadata,
      shotId: 'shot-2',
      continuityMode: 'continue',
      continuitySourceTaskId: source!.id,
      dependsOnTaskId: source!.id,
      dependsOnTaskIds: [source!.id],
    }
    await store.mutate((state) => state.tasks.unshift(source!, linked!))
    const runner = new GenerationTaskRunner(store, {
      videoProvider: provider,
      providerPollIntervalMs: 0,
      providerStallTimeoutMs: 1,
    })

    await runner.tick()
    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === source!.id)!
      task.metadata = {
        ...task.metadata,
        providerProgressChangedAt: new Date(Date.now() - 60_000).toISOString(),
        providerPolledAt: 0,
      }
    })
    await runner.tick()

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('remote-stalled-source-1'))
    expect(store.read((state) => state.tasks.find((task) => task.id === source!.id))).toMatchObject({
      status: 'queued',
      progress: 0,
      attempts: 1,
      metadata: {
        providerState: 'retry_wait',
        providerProcessingTimeoutRetries: 1,
        providerPreviousTaskIds: ['remote-stalled-source-1'],
        providerIdempotencyKey: `generation:${source!.tenantId}:${source!.id}:processing-retry:1`,
      },
    })
    expect(store.read((state) => state.tasks.find((task) => task.id === linked!.id))?.status).toBe('queued')

    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === source!.id)!
      task.metadata = { ...task.metadata, providerRetryNotBefore: new Date(0).toISOString() }
    })
    await runner.tick()
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        idempotencyKey: `generation:${source!.tenantId}:${source!.id}:processing-retry:1`,
      }),
    )

    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === source!.id)!
      task.metadata = {
        ...task.metadata,
        providerProgressChangedAt: new Date(Date.now() - 60_000).toISOString(),
        providerPolledAt: 0,
      }
    })
    await runner.tick()

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('remote-stalled-source-2'))
    expect(store.read((state) => state.tasks.find((task) => task.id === source!.id))).toMatchObject({
      status: 'failed',
      progress: 100,
      error: '上游视频生成长时间无进度，自动重试后仍未恢复；本次任务已停止并退回积分',
    })
    expect(store.read((state) => state.tasks.find((task) => task.id === linked!.id))).toMatchObject({
      status: 'failed',
      error: '依赖的上一镜任务失败、已删除或不存在，请从该镜头重新生成',
    })
  })

  it('persists a remote image failure before the runtime cache is refreshed', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = imageTask('persisted-timeout-image-task', 'persisted-timeout-asset')
    await store.mutate((state) => state.tasks.unshift(task))
    let persistedTask = structuredClone(task)
    let rejectGeneration: ((error: Error) => void) | null = null
    const imageProvider: ImageGenerationProvider = {
      generate: vi.fn(
        () =>
          new Promise((_, reject) => {
            rejectGeneration = reject
          }),
      ),
    }
    const runner = new GenerationTaskRunner(store, {
      imageProvider,
      objectStorage: memoryObjectStorage(),
      leaseTtlMs: 10,
      beforeTick: async () => {
        await store.mutate((state) => {
          const index = state.tasks.findIndex((item) => item.id === task.id)
          if (index >= 0) state.tasks[index] = structuredClone(persistedTask)
        })
      },
      afterTick: async () => {
        persistedTask = structuredClone(
          store.read((state) => state.tasks.find((item) => item.id === task.id)!),
        )
      },
    })

    await runner.tick()
    await vi.waitFor(() => expect(imageProvider.generate).toHaveBeenCalledOnce())
    expect(persistedTask.status).toBe('running')

    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    rejectGeneration!(timeout)
    await vi.waitFor(() => expect(persistedTask.status).toBe('failed'))
    await new Promise((resolve) => setTimeout(resolve, 15))
    await runner.tick()

    expect(imageProvider.generate).toHaveBeenCalledOnce()
    expect(persistedTask).toMatchObject({
      status: 'failed',
      progress: 100,
      leaseOwnerId: null,
      leaseToken: null,
    })
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
    expect(usageCollector.snapshot({ userId: task!.userId })).toMatchObject({
      jobConcurrency: 0,
      jobCount: 1,
      jobFailedCount: 0,
      jobFailureRate: 0,
      creditsUsed: task!.estimatedCredits,
    })
  })

  it('retries an interrupted remote submission with the same idempotency key after restart', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(async () => ({
        providerTaskId: 'remote-recovered-submission',
        status: 'queued',
        progress: 0,
      })),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const [task] = queuedVideoTasks(1)
    const expired = new Date(Date.now() - 1_000).toISOString()
    const idempotencyKey = `generation:${task!.tenantId}:${task!.id}`
    await store.mutate((state) => {
      state.tasks.unshift({
        ...task!,
        status: 'running',
        progress: 1,
        attempts: 1,
        maxAttempts: 3,
        metadata: {
          ...task!.metadata,
          providerName: 'stringx-seedance',
          providerState: 'submitting',
          providerIdempotencyKey: idempotencyKey,
        },
        leaseOwnerId: 'old-runner',
        leaseToken: 'old-token',
        leaseAcquiredAt: expired,
        leaseHeartbeatAt: expired,
        leaseExpiresAt: expired,
        updatedAt: expired,
      })
    })

    await new GenerationTaskRunner(store, {
      videoProvider: provider,
      providerPollIntervalMs: 60_000,
      leaseTtlMs: 60_000,
    }).tick()

    await vi.waitFor(() => expect(provider.submit).toHaveBeenCalledOnce())
    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task!.id,
        idempotencyKey,
      }),
    )
    await vi.waitFor(() =>
      expect(store.read((state) => state.tasks.find((item) => item.id === task!.id))).toMatchObject({
        status: 'running',
        attempts: 1,
        metadata: {
          providerTaskId: 'remote-recovered-submission',
          providerIdempotencyKey: idempotencyKey,
          providerSubmissionRecoveredAt: expect.any(String),
        },
      }),
    )
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
      userId: 'user-member',
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
        idempotencyKey: `generation:${task.tenantId}:${task.id}`,
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
        providerIdempotencyKey: `generation:${task.tenantId}:${task.id}`,
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
      userId: 'user-member',
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

    expect(provider.submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        images: [
          {
            role: 'first_frame',
            url: `data:image/jpeg;base64,${Buffer.from('tail-frame').toString('base64')}`,
          },
        ],
      }),
    )
  })

  it('submits the next continuity shot in the same tick that its source completes', async () => {
    const files = new Map<string, Buffer>()
    const provider: VideoGenerationProvider = {
      submit: vi.fn(async ({ taskId }) => ({
        providerTaskId: `remote-${taskId}`,
        status: 'queued' as const,
        progress: 0,
      })),
      getStatus: vi.fn(async () => ({ status: 'completed' as const, progress: 100, error: null })),
      getLastFrameContent: vi.fn(async () => ({
        stream: Readable.from([Buffer.from('source-tail-frame')]),
        contentType: 'image/jpeg',
        contentLength: '17',
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
    const [source, linked] = queuedVideoTasks(2)
    source!.id = 'same-tick-source'
    source!.clientRequestId = 'same-tick-source-client'
    source!.metadata = { ...source!.metadata, shotId: 'shot-1' }
    linked!.id = 'same-tick-linked'
    linked!.clientRequestId = 'same-tick-linked-client'
    linked!.metadata = {
      ...linked!.metadata,
      shotId: 'shot-2',
      continuityMode: 'continue',
      continuitySourceTaskId: source!.id,
      dependsOnTaskId: source!.id,
      dependsOnTaskIds: [source!.id],
    }
    await store.mutate((state) => state.tasks.unshift(source!, linked!))

    const runner = new GenerationTaskRunner(store, {
      videoProvider: provider,
      objectStorage,
      providerPollIntervalMs: 0,
    })
    await runner.tick()

    await vi.waitFor(() => expect(provider.submit).toHaveBeenCalledTimes(2))
    expect(provider.getStatus).toHaveBeenCalledTimes(1)
    expect(provider.submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskId: linked!.id,
        images: [
          {
            role: 'first_frame',
            url: `data:image/jpeg;base64,${Buffer.from('source-tail-frame').toString('base64')}`,
          },
        ],
      }),
    )
    expect(store.read((state) => state.tasks.find((task) => task.id === source!.id))).toMatchObject({
      status: 'completed',
      metadata: {
        generatedOutputs: expect.arrayContaining([expect.objectContaining({ view: 'last-frame' })]),
      },
    })
    expect(store.read((state) => state.tasks.find((task) => task.id === linked!.id))).toMatchObject({
      status: 'running',
      metadata: { providerTaskId: `remote-${linked!.id}` },
    })
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
      error: '上一镜已完成但没有可用尾帧，请重新生成上一镜后再继续',
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
      userId: 'user-member',
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
      userId: 'user-member',
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
      userId: 'user-member',
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
      userId: 'user-member',
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
      userId: 'user-member',
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
    await vi.waitFor(() =>
      expect(usageCollector.snapshot({ userId: task.userId })).toMatchObject({
        jobConcurrency: 0,
        jobCount: 1,
        jobFailedCount: 0,
        jobFailureRate: 0,
        creditsUsed: task.estimatedCredits,
      }),
    )
  })

  it('waits for a storyboard image before submitting its dependent video', async () => {
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
      userId: 'user-member',
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
    expect(videoProvider.submit).not.toHaveBeenCalled()

    await runner.tick()

    expect(videoProvider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('不是静止图片，不是幻灯片'),
        images: [
          {
            url: `data:image/png;base64,${Buffer.from('storyboard-image').toString('base64')}`,
            role: 'reference_image',
          },
        ],
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

  it('uses the prompt snapshot captured when a queued video task was created', async () => {
    const videoProvider: VideoGenerationProvider = {
      submit: vi.fn(async () => ({
        providerTaskId: 'snapshot-video-remote',
        status: 'queued',
        progress: 0,
      })),
      getStatus: vi.fn(async () => ({ status: 'completed', progress: 100, error: null })),
      getContent: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'snapshot-video',
      clientRequestId: 'snapshot-video-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      kind: 'video',
      label: '镜头 01',
      prompt: 'compiled prompt from click time',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        shotId: 'shot-1',
        duration: 5,
        aspectRatio: '9:16',
        resolution: '720p',
        sourcePromptSnapshot: '0-1秒：旧版本动作。',
        sourcePromptHash: 'captured-hash',
        compiledPrompt: 'compiled prompt from click time',
        compiledPromptHash: 'compiled-hash',
        videoPromptVersion: VIDEO_PROMPT_VERSION,
        referenceAssetIds: [],
        images: [],
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
      const shot = state.shots.find((item) => item.id === 'shot-1')
      if (shot) shot.prompt = 'newer prompt edited after task creation'
      state.tasks.unshift(task)
    })

    const runner = new GenerationTaskRunner(store, {
      videoProvider,
      providerPollIntervalMs: 0,
    })
    await runner.tick()

    expect(videoProvider.submit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'compiled prompt from click time' }),
    )
  })

  it('recompiles an outdated prompt snapshot without replacing it with a later shot edit', async () => {
    const videoProvider: VideoGenerationProvider = {
      submit: vi.fn(async () => ({
        providerTaskId: 'recompiled-video-remote',
        status: 'queued',
        progress: 0,
      })),
      getStatus: vi.fn(async () => ({ status: 'completed', progress: 100, error: null })),
      getContent: vi.fn(),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const sourcePrompt =
      '5秒，16:9，仿真人电影广告。清晨的汾河西岸滨河绿道。0-1秒建立河岸；1-4秒青年沿绿道晨跑；4-5秒保持跑者侧影与河面同框。'
    const task: GenerationTask = {
      id: 'outdated-prompt-video',
      clientRequestId: 'outdated-prompt-video-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      kind: 'video',
      label: '镜头 01',
      prompt: 'generic old compiled prompt',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        shotId: 'shot-1',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
        sourcePromptSnapshot: sourcePrompt,
        sourcePromptHash: 'captured-hash',
        compiledPrompt: 'generic old compiled prompt',
        compiledPromptHash: 'compiled-hash',
        videoPromptVersion: 'seedance-storyboard-v12',
        referenceAssetIds: [],
        images: [],
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
      const project = state.projects.find((item) => item.id === task.projectId)
      if (project) project.visualStyle = 'photorealistic'
      const shot = state.shots.find((item) => item.id === 'shot-1')
      if (shot) shot.prompt = 'later unrelated shot edit'
      state.tasks.unshift(task)
    })

    const runner = new GenerationTaskRunner(store, {
      videoProvider,
      providerPollIntervalMs: 0,
    })
    await runner.tick()

    expect(videoProvider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('清晨的汾河西岸滨河绿道'),
      }),
    )
    expect(videoProvider.submit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.not.stringContaining('later unrelated shot edit') }),
    )
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id)?.metadata)).toMatchObject({
      videoPromptVersion: VIDEO_PROMPT_VERSION,
      compiledPrompt: expect.stringContaining('青年沿绿道晨跑'),
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
      userId: 'user-member',
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

function imageTask(id: string, assetId: string): GenerationTask {
  const now = new Date().toISOString()
  return {
    id,
    clientRequestId: `${id}-client`,
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind: 'image',
    label: id,
    prompt: '正面人物头像，纯色背景',
    negativePrompt: '',
    provider: 'img2',
    model: 'gpt-image-2',
    metadata: { assetId, assetKind: 'character', generationStage: 'face', aspectRatio: '1:1' },
    status: 'queued',
    progress: 0,
    estimatedCredits: 4,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
}

function memoryObjectStorage(): ObjectStorage {
  const files = new Map<string, Buffer>()
  return {
    put: vi.fn(async (key, content) => {
      files.set(key, content)
    }),
    get: vi.fn(async (key) => files.get(key) ?? Buffer.alloc(0)),
    delete: vi.fn(async (key) => {
      files.delete(key)
    }),
  }
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
    userId: 'user-member',
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
