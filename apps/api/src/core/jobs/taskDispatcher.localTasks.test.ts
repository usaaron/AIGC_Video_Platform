import type { GenerationTask, ScriptEpisode } from '@seqora/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { queuedTextTask } from '../../testing/generationTaskFixtures.js'
import { usageCollector } from '../observability/usage.js'
import { GenerationTaskRunner } from './taskDispatcher.js'
import type { TaskRunnerLock } from './taskRunnerLock.js'

describe('GenerationTaskRunner local text tasks', () => {
  beforeEach(() => {
    usageCollector.resetForTests()
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

  it('persists a throttled text preview while a local script task is running', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'streaming-script-task',
      clientRequestId: 'streaming-script-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      kind: 'text',
      label: 'Streaming script',
      prompt: '',
      negativePrompt: '',
      provider: 'text',
      model: 'deepseek-v4-flash',
      metadata: { scriptOperation: 'generate' },
      status: 'queued',
      progress: 0,
      estimatedCredits: 3,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(task))
    let finishGeneration: (() => void) | null = null
    const execute = vi.fn(
      async (
        _task: GenerationTask,
        context?: {
          onTextProgress?: (text: string) => void
          onTextTiming?: (timing: {
            label?: string
            responseHeadersMs: number | null
            firstTokenMs: number | null
            generationMs: number | null
            totalMs: number
            attempt: number
          }) => void
        },
      ) => {
        context?.onTextProgress?.(
          '场次：S01｜剧情：主角推门进入｜场景：仓库｜角色：主角｜动作：推门｜对白：谁在里面\n场次：S02｜剧情：主角抬头。',
        )
        context?.onTextTiming?.({
          label: 'first-draft',
          responseHeadersMs: 120,
          firstTokenMs: 900,
          generationMs: 2_400,
          totalMs: 3_300,
          attempt: 1,
        })
        await new Promise<void>((resolve) => {
          finishGeneration = resolve
        })
        return { script: '完整剧本' }
      },
    )
    const refreshTask = vi.fn(async () => {})
    const persistTask = vi.fn(async () => {})
    const runner = new GenerationTaskRunner(store, {
      localTaskHandler: {
        canHandle: (candidate) => candidate.provider === 'text',
        execute,
      },
      refreshTask,
      persistTask,
    })

    await runner.tick()
    await vi.waitFor(
      () =>
        expect(
          store.read((state) => state.tasks.find((item) => item.id === task.id)?.metadata.textPreview),
        ).toContain('主角推门进入'),
      { timeout: 2_000 },
    )
    expect(
      store.read((state) => state.tasks.find((item) => item.id === task.id)?.metadata.textPreviewValidation),
    ).toMatchObject({
      recognizedScenes: 2,
      checkedScenes: 1,
      structurallyCompleteScenes: 1,
      dialogueScenes: 1,
    })
    expect(persistTask).toHaveBeenCalledWith(task.id)

    finishGeneration!()
    await vi.waitFor(() =>
      expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
        status: 'completed',
        progress: 100,
        metadata: { textResult: { script: '完整剧本' } },
      }),
    )
    expect(
      store.read((state) => state.tasks.find((item) => item.id === task.id)?.metadata.textTiming),
    ).toMatchObject({
      responseHeadersMs: 120,
      firstTokenWaitMs: 780,
      generationMs: 2_400,
      providerMs: 3_300,
      extraModelCalls: 0,
      calls: [{ label: 'first-draft', attempt: 1 }],
    })
    expect(
      store.read((state) => state.tasks.find((item) => item.id === task.id)?.metadata.textPreview),
    ).toBeUndefined()
    expect(refreshTask).toHaveBeenCalledWith(task.id)
    expect(persistTask.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('completes without waiting for an in-flight preview persistence call', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = queuedTextTask('non-blocking-preview-task')
    await store.mutate((state) => state.tasks.unshift(task))
    let finishGeneration!: () => void
    const generationHold = new Promise<void>((resolve) => {
      finishGeneration = resolve
    })
    let releasePreviewPersistence!: () => void
    const previewPersistenceHold = new Promise<void>((resolve) => {
      releasePreviewPersistence = resolve
    })
    let persistCalls = 0
    const persistTask = vi.fn(async () => {
      persistCalls += 1
      if (persistCalls === 1) await previewPersistenceHold
    })
    let lockHeld = false
    const taskRunnerLock: TaskRunnerLock = {
      runExclusive: vi.fn(async (operation) => {
        if (lockHeld) return false
        lockHeld = true
        try {
          await operation()
          return true
        } finally {
          lockHeld = false
        }
      }),
    }
    const runner = new GenerationTaskRunner(store, {
      persistTask,
      taskRunnerLock,
      taskMutationLockTimeoutMs: 50,
      localTaskHandler: {
        canHandle: (candidate) => candidate.id === task.id,
        execute: async (_task, context) => {
          context?.onTextProgress?.('场次：S01｜剧情：主角进入大厅。')
          await generationHold
          return { script: '完整剧本' }
        },
      },
    })

    await runner.tick()
    await vi.waitFor(() => expect(persistTask).toHaveBeenCalledTimes(1), { timeout: 2_000 })
    finishGeneration()

    await vi.waitFor(() =>
      expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
        status: 'completed',
        metadata: { textResult: { script: '完整剧本' } },
      }),
    )
    expect(persistTask).toHaveBeenCalledTimes(2)
    expect(taskRunnerLock.runExclusive).toHaveBeenCalledTimes(2)
    releasePreviewPersistence()
  })

  it('retries final text writeback without rerunning a successful provider call', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = queuedTextTask('retry-final-writeback-task')
    await store.mutate((state) => state.tasks.unshift(task))
    let allowFinalWriteback = false
    const taskRunnerLock: TaskRunnerLock = {
      runExclusive: vi.fn(async (operation) => {
        const status = store.read((state) => state.tasks.find((item) => item.id === task.id)?.status)
        if (status !== 'queued' && !allowFinalWriteback) return false
        await operation()
        return true
      }),
    }
    const execute = vi.fn(async () => ({ script: '已完成的模型结果' }))
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    const runner = new GenerationTaskRunner(store, {
      taskRunnerLock,
      taskMutationLockTimeoutMs: 20,
      persistTask: async () => {},
      localTaskHandler: {
        canHandle: (candidate) => candidate.id === task.id,
        execute,
      },
    })

    await runner.tick()
    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining(`final writeback retry 1 failed for ${task.id}`),
        expect.objectContaining({ code: 'SEQORA_GENERATION_TASK_BACKGROUND_FAILURE' }),
      ),
    )
    allowFinalWriteback = true

    await vi.waitFor(
      () =>
        expect(store.read((state) => state.tasks.find((item) => item.id === task.id)?.status)).toBe(
          'completed',
        ),
      { timeout: 1_000 },
    )
    expect(execute).toHaveBeenCalledOnce()
    warning.mockRestore()
  })

  it('keeps text timing diagnostics when a streamed local task fails', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'failed-streaming-script-task',
      clientRequestId: 'failed-streaming-script-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      kind: 'text',
      label: 'Failed streaming script',
      prompt: '',
      negativePrompt: '',
      provider: 'text',
      model: 'deepseek-v4-flash',
      metadata: { scriptOperation: 'generate' },
      status: 'queued',
      progress: 0,
      estimatedCredits: 3,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(task))
    const runner = new GenerationTaskRunner(store, {
      localTaskHandler: {
        canHandle: (candidate) => candidate.provider === 'text',
        execute: async (_task, context) => {
          context?.onTextProgress?.(
            '场次：S01｜剧情：主角进入仓库。｜场景：仓库。｜角色：主角。｜动作：推门。',
            'scene-completion',
          )
          context?.onTextTiming?.({
            label: 'scene-completion',
            outcome: 'failed',
            responseHeadersMs: 100,
            firstTokenMs: null,
            generationMs: null,
            totalMs: 2_100,
            attempt: 1,
          })
          throw new Error('provider format failed')
        },
      },
      refreshTask: async () => {},
      persistTask: async () => {},
    })

    await runner.tick()
    await vi.waitFor(() =>
      expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
        status: 'failed',
        metadata: {
          textPreviewStage: 'scene-completion',
          textTiming: {
            providerMs: 2_100,
            calls: [{ label: 'scene-completion', outcome: 'failed', attempt: 1 }],
          },
        },
      }),
    )
  })

  it('recovers a stale script task from a draft written before worker interruption', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const startedAt = new Date(Date.now() - 10 * 60_000).toISOString()
    const now = new Date().toISOString()
    const draft: ScriptEpisode = {
      id: 'recovered-script-episode',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      episodeNumber: 1,
      title: '第 1 集',
      content: '',
      draftContent: '场次：S01｜剧情：恢复后的草稿。',
      status: 'draft',
      summary: '',
      continuityState: {},
      revision: 1,
      lastEditedBy: 'user-member',
      createdAt: startedAt,
      updatedAt: now,
    }
    const task: GenerationTask = {
      id: 'stale-script-task',
      clientRequestId: 'stale-script-client',
      projectId: draft.projectId,
      tenantId: draft.tenantId,
      userId: 'user-member',
      kind: 'text',
      label: '续写下一集',
      prompt: '',
      negativePrompt: '',
      provider: 'text',
      model: 'deepseek-v4-flash',
      metadata: {
        generationStage: 'script-generate',
        scriptOperation: 'generate',
        mode: 'segment',
        localTaskStartedAt: startedAt,
        textPreview: '场次：S01｜剧情：恢复后的草稿。',
      },
      status: 'running',
      progress: 36,
      estimatedCredits: 3,
      createdAt: startedAt,
      updatedAt: startedAt,
      resultUrl: null,
      outputs: [],
      error: null,
      leaseOwnerId: 'stopped-worker',
      leaseToken: 'stale-lease',
      leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    }
    await store.mutate((state) => {
      state.scriptEpisodes.push(draft)
      state.tasks.unshift(task)
    })
    const execute = vi.fn(async () => {
      throw new Error('should not call provider during recovery')
    })
    const runner = new GenerationTaskRunner(store, {
      localTaskHandler: {
        canHandle: (candidate) => candidate.provider === 'text',
        execute,
      },
    })

    await runner.tick()

    expect(execute).not.toHaveBeenCalled()
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'completed',
      progress: 100,
      metadata: {
        localTaskRecoveredAt: expect.any(String),
        textResult: { script: draft.draftContent, episode: draft, mode: 'segment' },
      },
    })
    expect(
      store.read((state) => state.tasks.find((item) => item.id === task.id)?.metadata.textPreview),
    ).toBeUndefined()
  })
})
