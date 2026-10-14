import { videoReviewVersion, type GenerationTask } from '@seqora/contracts'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  VideoContent,
  VideoGenerationProvider,
  VideoGenerationStatus,
} from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore } from '../../infra/store.js'
import { providerPollBinding } from './providerCompletion.js'
import { claimGenerationTaskLease } from './taskLease.js'
import { ProviderPoller, TaskRefundService, TaskWritebackService } from './taskRunnerComponents.js'

const video = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
const completed: VideoGenerationStatus = { status: 'completed', progress: 100, error: null }
afterEach(() => vi.useRealTimers())

describe('remote provider completion poll', () => {
  it.each(['AbortError', 'TimeoutError'])('retains the established %s response', async (name) => {
    const f = await fixture()
    const error = new Error('provider request stopped')
    error.name = name
    vi.mocked(f.provider.getStatus).mockRejectedValueOnce(error)
    expect(await f.poller.requestRemoteVideoPoll(f.task)).toMatchObject({
      kind: 'error',
      error: expect.stringContaining('超时'),
    })
    expect(f.provider.getContent).not.toHaveBeenCalled()
  })

  it('binds fresh completion media to the immutable task snapshot captured before the request', async () => {
    const f = await fixture()
    const status = deferred<VideoGenerationStatus>()
    vi.mocked(f.provider.getStatus).mockReturnValueOnce(status.promise)
    const source = structuredClone(f.task)
    const pending = f.poller.requestRemoteVideoPoll(source)
    source.metadata.providerTaskId = 'changed-remote-task'
    source.metadata.providerName = 'volc-ark-seedance'
    source.attempts = 9
    source.leaseToken = 'changed-lease'
    status.resolve(completed)
    const outcome = await pending
    expect(outcome.binding).toEqual(providerPollBinding(f.task, 'stringx-seedance'))
    expect(f.provider.getContent).toHaveBeenCalledExactlyOnceWith('provider-task')
    const result = await f.poller.applyRemoteVideoPoll(source, outcome)
    expect(result.completedTask?.metadata.providerCompletionReceipt).toMatchObject({
      providerTaskId: 'provider-task',
      providerName: 'stringx-seedance',
      attempts: 1,
      attestation: 'server-observed-completion',
      mediaVersion: videoReviewVersion(result.completedTask!),
    })
    expect(f.storage.put).toHaveBeenCalledTimes(1)
  })

  it.each(['providerTaskId', 'providerName', 'attempts', 'lease', 'tenantId', 'projectId'] as const)(
    'discards a completed outcome after the current %s changes',
    async (field) => {
      const f = await fixture()
      const outcome = await f.poller.requestRemoteVideoPoll(f.task)
      await f.store.mutate((state) => {
        const current = state.tasks.find((task) => task.id === f.task.id)!
        if (field === 'providerTaskId') current.metadata.providerTaskId = 'replacement-remote-task'
        else if (field === 'providerName') current.metadata.providerName = 'volc-ark-seedance'
        else if (field === 'attempts') current.attempts = 2
        else if (field === 'lease') claimGenerationTaskLease(current, 'other-worker', 60_000)
        else current[field] = `changed-${field}`
      })
      expect(await f.poller.applyRemoteVideoPoll(f.task, outcome)).toEqual({
        completedTask: null,
        stalledProviderTaskId: null,
      })
      expect(f.current().status).toBe('running')
      expect(f.current().metadata.providerCompletionReceipt).toBeUndefined()
    },
  )

  it('keeps existing cached media unverified without fetching it again', async () => {
    const f = await fixture()
    const cached = {
      view: 'single',
      storageKey: 'existing-video.mp4',
      contentType: 'video/mp4',
      size: video.length,
      sha256: 'a'.repeat(64),
    }
    await f.store.mutate((state) => {
      const current = state.tasks.find((task) => task.id === f.task.id)!
      current.metadata.generatedOutputs = [cached]
      current.metadata.providerCompletionReceipt = { stale: true }
    })
    const source = f.current()
    const outcome = await f.poller.requestRemoteVideoPoll(source)
    const result = await f.poller.applyRemoteVideoPoll(source, outcome)
    expect(f.provider.getContent).not.toHaveBeenCalled()
    expect(f.storage.put).not.toHaveBeenCalled()
    expect(result.completedTask?.metadata.generatedOutputs).toEqual([cached])
    expect(result.completedTask?.metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('reports invalid completed media without issuing a receipt or storing the response', async () => {
    const f = await fixture()
    vi.mocked(f.provider.getContent).mockResolvedValueOnce(content(Buffer.from('<html>error</html>')))
    const outcome = await f.poller.requestRemoteVideoPoll(f.task)
    expect(outcome).toMatchObject({
      kind: 'status',
      videoDescriptor: null,
      videoCacheError: expect.stringContaining('MP4 signature'),
    })
    const result = await f.poller.applyRemoteVideoPoll(f.task, outcome)
    expect(result.completedTask?.metadata.providerCompletionReceipt).toBeUndefined()
    expect(f.storage.put).not.toHaveBeenCalled()
  })

  it('does not attest an upstream completed response carrying an error', async () => {
    const f = await fixture()
    vi.mocked(f.provider.getStatus).mockResolvedValueOnce({ ...completed, error: 'upstream integrity error' })
    const result = await f.poller.applyRemoteVideoPoll(f.task, await f.poller.requestRemoteVideoPoll(f.task))
    expect(result.completedTask?.metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('bounds a hung storage write and never attaches its late descriptor', async () => {
    const f = await fixture()
    const put = deferred<void>()
    vi.mocked(f.storage.put).mockReturnValueOnce(put.promise)
    vi.useFakeTimers()
    const pending = f.poller.requestRemoteVideoPoll(f.task)
    await vi.advanceTimersByTimeAsync(30_000)
    const outcome = await pending
    expect(outcome).toMatchObject({
      kind: 'status',
      videoDescriptor: null,
      videoCacheError: expect.stringContaining('超时'),
    })
    expect(f.storage.put).toHaveBeenCalledTimes(1)
    const result = await f.poller.applyRemoteVideoPoll(f.task, outcome)
    expect(result.completedTask?.metadata.providerCompletionReceipt).toBeUndefined()
    put.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.current().metadata.generatedOutputs).toBeUndefined()
    expect(f.current().metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('bounds a hung tail request while retaining only the freshly stored main-video receipt', async () => {
    const f = await fixture()
    const tail = deferred<VideoContent>()
    f.provider.getLastFrameContent = vi.fn(() => tail.promise)
    vi.useFakeTimers()
    const pending = f.poller.requestRemoteVideoPoll(f.task)
    await vi.advanceTimersByTimeAsync(30_000)
    const outcome = await pending
    expect(outcome).toMatchObject({
      kind: 'status',
      lastFrameDescriptor: null,
      lastFrameError: expect.stringContaining('超时'),
    })
    const result = await f.poller.applyRemoteVideoPoll(f.task, outcome)
    expect(result.completedTask?.metadata.providerCompletionReceipt).toMatchObject({
      media: { view: 'single' },
    })
    expect(result.completedTask?.outputs).toHaveLength(1)
    tail.resolve(content(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg'))
    await vi.advanceTimersByTimeAsync(0)
    expect(f.current().outputs).toHaveLength(1)
  })

  it('bounds status polling and never ingests a completion received after its deadline', async () => {
    const f = await fixture()
    const status = deferred<VideoGenerationStatus>()
    vi.mocked(f.provider.getStatus).mockReturnValueOnce(status.promise)
    vi.useFakeTimers()
    const pending = f.poller.requestRemoteVideoPoll(f.task)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await pending).toMatchObject({ kind: 'error', error: expect.stringContaining('超时') })
    status.resolve(completed)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.provider.getContent).not.toHaveBeenCalled()
    expect(f.storage.put).not.toHaveBeenCalled()
  })
})

describe('provider completion receipt lifecycle', () => {
  it.each(['submission', 'submission retry', 'poll error', 'stalled processing', 'failure', 'poll claim'])(
    'clears old receipts during %s',
    async (operation) => {
      const f = await fixture()
      await f.store.mutate((state) => {
        state.tasks.find((task) => task.id === f.task.id)!.metadata.providerCompletionReceipt = {
          stale: true,
        }
      })
      const binding = providerPollBinding(f.task, 'stringx-seedance')
      if (operation === 'submission')
        await f.writeback.writeVideoSubmission(f.task, f.leaseToken, {
          providerTaskId: 'replacement',
          status: 'running',
          progress: 1,
        })
      else if (operation === 'submission retry')
        await f.writeback.retryTimedOutVideoSubmission(f.task.id, f.leaseToken, 'timeout')
      else if (operation === 'poll error')
        await f.writeback.markProviderPollError(f.task.id, f.leaseToken, 1, binding)
      else if (operation === 'stalled processing')
        await f.writeback.handleStalledVideoProcessing(f.task.id, f.leaseToken, 'provider-task', binding)
      else if (operation === 'failure') await f.writeback.failTask(f.task.id, 'failure', f.leaseToken)
      else await f.poller.claimRemoteVideoPolls(1)
      expect(f.current().metadata.providerCompletionReceipt).toBeUndefined()
    },
  )

  it.each(['poll error', 'stalled processing', 'failure'])(
    'checks the poll binding inside the %s mutation',
    async (operation) => {
      const f = await fixture()
      const binding = providerPollBinding(f.task, 'stringx-seedance')
      await f.store.mutate((state) => {
        state.tasks.find((task) => task.id === f.task.id)!.metadata.providerTaskId = 'replacement-remote-task'
      })
      const before = structuredClone(f.current())
      if (operation === 'poll error')
        await f.writeback.markProviderPollError(f.task.id, f.leaseToken, 1, binding)
      else if (operation === 'stalled processing')
        expect(
          await f.writeback.handleStalledVideoProcessing(f.task.id, f.leaseToken, 'provider-task', binding),
        ).toBeNull()
      else await f.writeback.failTask(f.task.id, 'old error', f.leaseToken, undefined, binding)
      expect(f.current()).toEqual(before)
    },
  )
})

async function fixture() {
  const store = new AppStore(null)
  await store.initialize()
  const now = new Date().toISOString()
  const task: GenerationTask = {
    id: 'provider-poll-task',
    clientRequestId: 'provider-poll-request',
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind: 'video',
    label: 'Provider poll test',
    prompt: '',
    negativePrompt: '',
    provider: 'seedance',
    model: null,
    metadata: { providerName: 'stringx-seedance', providerTaskId: 'provider-task' },
    status: 'running',
    progress: 1,
    estimatedCredits: 0,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
  const leaseToken = claimGenerationTaskLease(task, 'test-worker', 60_000)
  await store.mutate((state) => {
    state.tasks.unshift(structuredClone(task))
  })
  const storage: ObjectStorage = {
    put: vi.fn(async () => {}),
    get: vi.fn(async () => video),
    delete: vi.fn(async () => {}),
  }
  const provider: VideoGenerationProvider = {
    submit: vi.fn(async () => ({ providerTaskId: 'provider-task', status: 'running' as const, progress: 1 })),
    getStatus: vi.fn(async () => completed),
    getContent: vi.fn(async () => content(video)),
  }
  const writeback = new TaskWritebackService(
    store,
    storage,
    'test-worker',
    60_000,
    new TaskRefundService(store),
  )
  const poller = new ProviderPoller(store, {
    videoProvider: provider,
    videoProviderName: 'stringx-seedance',
    providerPollIntervalMs: 0,
    providerStallTimeoutMs: 60_000,
    providerStatusTimeoutMs: 1_000,
    leaseOwnerId: 'test-worker',
    leaseTtlMs: 60_000,
    objectStorage: storage,
    writeback,
    onVideoCompleted: null,
  })
  return {
    store,
    task,
    leaseToken,
    storage,
    provider,
    writeback,
    poller,
    current: () => store.read((state) => state.tasks.find((item) => item.id === task.id)!),
  }
}

function content(bytes: Buffer, contentType = 'video/mp4'): VideoContent {
  return {
    stream: Readable.from([bytes]),
    contentType,
    contentLength: String(bytes.length),
    statusCode: 200,
    contentRange: null,
    acceptRanges: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
