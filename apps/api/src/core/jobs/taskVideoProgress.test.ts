import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../../modules/billing/creditLedger.js'
import { DoraRouterSeedanceProvider } from '../generation/doraRouterSeedanceProvider.js'
import type { VideoGenerationProvider, VideoGenerationStatus } from '../generation/videoProvider.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

const minute = 60_000

describe('remote video progress and processing deadline', () => {
  it('keeps polling the same Dora task past six minutes of estimated progress and saves its eventual result', async () => {
    let completed = false
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ id: 'dora-original', status: 'queued' })
      return Response.json(
        completed
          ? {
              id: 'dora-original',
              status: 'succeeded',
              content: { video_url: 'https://media.example/video.mp4' },
            }
          : { id: 'dora-original', status: 'running' },
      )
    })
    const provider = new DoraRouterSeedanceProvider({
      baseUrl: 'https://www.dorarouter.com',
      apiKey: 'test-dora-token',
      defaultModel: 'TH-doubao-seedance2.0',
      requestTimeoutMs: 30_000,
      fetcher,
    })
    const submit = vi.spyOn(provider, 'submit')
    const { runner, store, task, refundGeneration } = await setup(provider)

    for (const elapsedMinutes of [7, 12, 25]) {
      await ageRemoteTask(store, task.id, elapsedMinutes * minute)
      await runner.tick()
      await vi.waitFor(() =>
        expect(readTask(store, task.id)).toMatchObject({
          status: 'running',
          progress: 50,
          metadata: { providerTaskId: 'dora-original', providerProgressIsEstimated: true },
        }),
      )
    }
    expect(submit).toHaveBeenCalledOnce()
    expect(refundGeneration).not.toHaveBeenCalled()

    completed = true
    await runner.tick()
    await vi.waitFor(() =>
      expect(readTask(store, task.id)).toMatchObject({
        status: 'completed',
        progress: 100,
        resultUrl: `/api/v1/generation/tasks/${task.id}/content`,
        outputs: [expect.objectContaining({ mediaType: 'video' })],
        metadata: { providerTaskId: 'dora-original', providerProgressIsEstimated: false },
      }),
    )
    expect(submit).toHaveBeenCalledOnce()
    expect(refundGeneration).not.toHaveBeenCalled()
    expect(
      fetcher.mock.calls
        .filter(([, init]) => init?.method !== 'POST')
        .every(([url]) => String(url).endsWith('/dora-original')),
    ).toBe(true)
  })

  it('does not resubmit measured but unchanged progress when the provider cannot cancel', async () => {
    const provider = stubProvider({ status: 'running', progress: 50, error: null })
    const { runner, store, task, refundGeneration } = await setup(provider)
    await ageRemoteTask(store, task.id, 7 * minute)

    await runner.tick()

    await vi.waitFor(() =>
      expect(readTask(store, task.id)).toMatchObject({
        status: 'running',
        progress: 50,
        metadata: { providerTaskId: 'remote-original' },
      }),
    )
    expect(provider.submit).toHaveBeenCalledOnce()
    expect(refundGeneration).not.toHaveBeenCalled()
  })

  it('does not cancel estimated progress even when cancellation is supported', async () => {
    const cancel = vi.fn(async () => {})
    const provider = {
      ...stubProvider({ status: 'running', progress: 50, progressIsEstimated: true, error: null }),
      cancel,
    }
    const { runner, store, task, refundGeneration } = await setup(provider)
    await ageRemoteTask(store, task.id, 7 * minute)

    await runner.tick()

    await vi.waitFor(() =>
      expect(readTask(store, task.id)).toMatchObject({
        status: 'running',
        progress: 50,
        metadata: { providerTaskId: 'remote-original', providerProgressIsEstimated: true },
      }),
    )
    expect(cancel).not.toHaveBeenCalled()
    expect(provider.submit).toHaveBeenCalledOnce()
    expect(refundGeneration).not.toHaveBeenCalled()
  })

  it('stops waiting after thirty minutes, retains every remote ID, and refunds only once without resubmitting', async () => {
    const provider = stubProvider({ status: 'running', progress: 50, progressIsEstimated: true, error: null })
    const { runner, store, task, refundGeneration } = await setup(provider)
    await ageRemoteTask(store, task.id, 31 * minute)
    await store.mutate((state) => {
      state.tasks.find((item) => item.id === task.id)!.metadata.providerPreviousTaskIds = ['remote-older']
    })

    await runner.tick()
    await vi.waitFor(() =>
      expect(readTask(store, task.id)).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('超过等待时限'),
        leaseToken: null,
        metadata: {
          providerTaskId: 'remote-original',
          providerPreviousTaskIds: ['remote-older'],
          creditsRefundedAt: expect.any(String),
        },
      }),
    )
    const pollsAtFailure = vi.mocked(provider.getStatus).mock.calls.length
    await runner.tick()

    expect(provider.submit).toHaveBeenCalledOnce()
    expect(pollsAtFailure).toBeGreaterThan(0)
    expect(provider.getStatus).toHaveBeenCalledTimes(pollsAtFailure)
    expect(refundGeneration).toHaveBeenCalledOnce()
    expect(readTask(store, task.id)?.metadata.providerProcessingTimeoutRetries).toBeUndefined()
  })

  it('accepts a completed response even when the processing deadline has elapsed', async () => {
    const provider = stubProvider({ status: 'completed', progress: 100, error: null })
    const { runner, store, task, refundGeneration } = await setup(provider)
    await ageRemoteTask(store, task.id, 31 * minute)

    await runner.tick()

    await vi.waitFor(() =>
      expect(readTask(store, task.id)).toMatchObject({
        status: 'completed',
        resultUrl: `/api/v1/generation/tasks/${task.id}/content`,
        metadata: { providerTaskId: 'remote-original' },
      }),
    )
    expect(provider.submit).toHaveBeenCalledOnce()
    expect(refundGeneration).not.toHaveBeenCalled()
  })

  it('cannot fail or refund a timed out task after another worker takes its lease', async () => {
    const provider = stubProvider({ status: 'running', progress: 50, progressIsEstimated: true, error: null })
    const { runner, store, task, refundGeneration } = await setup(provider)
    await ageRemoteTask(store, task.id, 31 * minute)
    vi.mocked(provider.getStatus).mockImplementationOnce(async () => {
      await store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)!
        stored.leaseOwnerId = 'another-worker'
        stored.leaseToken = 'replacement-lease'
      })
      return { status: 'running', progress: 50, progressIsEstimated: true, error: null }
    })

    await runner.tick()

    expect(readTask(store, task.id)).toMatchObject({
      status: 'running',
      leaseOwnerId: 'another-worker',
      leaseToken: 'replacement-lease',
      metadata: { providerTaskId: 'remote-original' },
    })
    expect(refundGeneration).not.toHaveBeenCalled()
    expect(provider.submit).toHaveBeenCalledOnce()
  })
})

function stubProvider(status: VideoGenerationStatus): VideoGenerationProvider {
  return {
    submit: vi.fn(async () => ({ providerTaskId: 'remote-original', status: 'queued', progress: 0 })),
    getStatus: vi.fn(async () => status),
    getContent: vi.fn(),
  }
}

async function setup(videoProvider: VideoGenerationProvider) {
  const store = new AppStore(null)
  await store.initialize()
  const now = new Date().toISOString()
  const task: GenerationTask = {
    id: 'video-progress-task',
    clientRequestId: 'video-progress-client',
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind: 'video',
    label: '远端进度回归',
    prompt: '雨夜街道，人物转身',
    negativePrompt: '',
    provider: 'seedance',
    model: 'doubao-seedance-2-0-260128',
    metadata: { shotId: 'progress-regression-shot', duration: 5, aspectRatio: '16:9', resolution: '720p' },
    status: 'queued',
    progress: 0,
    estimatedCredits: 18,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
  await store.mutate((state) => state.tasks.unshift(task))
  const refundGeneration = vi.fn(async () => {})
  const runner = new GenerationTaskRunner(store, {
    videoProvider,
    videoProviderName: 'dora-router-seedance',
    providerPollIntervalMs: 0,
    creditLedger: { refundGeneration } as unknown as CreditLedger,
  })
  await runner.tick()
  await vi.waitFor(() =>
    expect(readTask(store, task.id)?.metadata.providerTaskId).toEqual(expect.any(String)),
  )
  return { runner, store, task, refundGeneration }
}

async function ageRemoteTask(store: AppStore, taskId: string, elapsedMs: number) {
  await store.mutate((state) => {
    const task = state.tasks.find((item) => item.id === taskId)!
    const previous = new Date(Date.now() - elapsedMs).toISOString()
    task.progress = 50
    task.metadata = {
      ...task.metadata,
      providerSubmittedAt: previous,
      providerProgressChangedAt: previous,
      providerPolledAt: 0,
    }
  })
}

function readTask(store: AppStore, taskId: string) {
  return store.read((state) => state.tasks.find((item) => item.id === taskId))
}
