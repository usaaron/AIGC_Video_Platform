import { imageCompletionMediaVersion, type GenerationTask } from '@seqora/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageGenerationOutput } from '../generation/imageProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore } from '../../infra/store.js'
import { findProviderCompletionContext } from './providerCompletionContext.js'
import { prepareImageCompletion, persistProviderImages } from './imageProviderCompletion.js'
import { imageRequestFor } from './imageTaskRequest.js'
import { claimGenerationTaskLease } from './taskLease.js'
import { GenerationResultWriteback } from './taskWriteback.js'

const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex')
const output = (view: ImageGenerationOutput['view'] = 'single', extra = ''): ImageGenerationOutput => ({
  view,
  contentType: 'image/png',
  content: Buffer.concat([png, Buffer.from(extra)]),
})
afterEach(() => vi.useRealTimers())

async function fixture(turnaround = false) {
  const store = new AppStore(null)
  await store.initialize()
  const now = new Date().toISOString()
  const task: GenerationTask = {
    id: 'image-proof-task',
    clientRequestId: 'image-proof-client',
    tenantId: 'tenant-seqora-demo',
    projectId: 'project-midnight-film',
    userId: 'user-member',
    kind: 'image',
    provider: 'img2',
    model: 'img2-default',
    label: 'Image receipt test',
    prompt: 'Image',
    negativePrompt: '',
    metadata: { providerName: 'tokenadvent-img2', providerIdempotencyKey: 'request-1', turnaround },
    status: 'running',
    progress: 1,
    estimatedCredits: 1,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
  const leaseToken = claimGenerationTaskLease(task, 'worker-image', 60_000)
  await store.mutate((state) => {
    state.tasks.unshift(task)
  })
  const files = new Map<string, Buffer>()
  const storage: ObjectStorage = {
    put: vi.fn(async (key, buffer) => {
      files.set(key, Buffer.from(buffer))
    }),
    get: vi.fn(async (key) => files.get(key) ?? Buffer.alloc(0)),
    delete: vi.fn(async (key) => {
      files.delete(key)
    }),
  }
  const request = imageRequestFor(task, [])
  const binding = prepareImageCompletion(task, request)
  const writeback = new GenerationResultWriteback(store, storage)
  const current = () => store.read((state) => state.tasks.find((item) => item.id === task.id)!)
  const complete = (descriptors: Awaited<ReturnType<typeof persistProviderImages>>) =>
    writeback.completeImageTask(task.id, 'worker-image', leaseToken, descriptors)
  return { store, task, binding, request, storage, files, writeback, current, complete, leaseToken }
}

describe('trusted image provider completion', () => {
  it('attests the ordered complete image set and retains the source lease privately', async () => {
    const f = await fixture(true)
    const descriptors = await f.writeback.persistImageOutputs(
      f.task,
      [output('back'), output('front'), output('side')],
      f.binding,
    )
    const completed = await f.complete(descriptors)
    expect(completed).toMatchObject({ status: 'completed', error: null, leaseToken: null })
    expect(completed?.metadata.providerCompletionReceipt).toEqual({
      version: 'seqora.provider-image-completion.v1',
      attestation: 'server-observed-completion',
      taskId: f.task.id,
      tenantId: f.task.tenantId,
      projectId: f.task.projectId,
      provider: 'img2',
      providerName: 'tokenadvent-img2',
      requestId: 'request-1',
      attempts: 1,
      completedAt: completed!.updatedAt,
      mediaVersion: imageCompletionMediaVersion(completed!),
      outputs: descriptors,
    })
    expect(descriptors.map((descriptor) => descriptor.view)).toEqual(['front', 'side', 'back'])
    expect(findProviderCompletionContext(completed!)).toMatchObject({
      leaseOwnerId: 'worker-image',
      leaseToken: f.leaseToken,
    })
    expect(JSON.stringify(completed?.metadata.providerCompletionReceipt)).not.toContain(f.leaseToken)
    expect(await f.complete(descriptors)).toBeNull()
  })

  it.each(['copied-array', 'copied-descriptor', 'mutated-descriptor', 'empty'] as const)(
    'does not complete or attest %s descriptors',
    async (mode) => {
      const f = await fixture()
      const descriptors = await f.writeback.persistImageOutputs(f.task, [output()], f.binding)
      let candidate = descriptors
      if (mode === 'copied-array') candidate = [...descriptors]
      if (mode === 'copied-descriptor') descriptors[0] = { ...descriptors[0]! }
      if (mode === 'mutated-descriptor') descriptors[0]!.sha256 = 'f'.repeat(64)
      if (mode === 'empty') candidate = []
      expect(await f.complete(candidate)).toBeNull()
      expect(f.current()).toMatchObject({ status: 'running', resultUrl: null, outputs: [] })
      expect(f.current().metadata.providerCompletionReceipt).toBeUndefined()
    },
  )

  it.each([
    'attempts',
    'requestId',
    'turnaround',
    'providerName',
    'tenantId',
    'projectId',
    'lease',
    'cancelled',
    'failed',
  ] as const)('rejects late image completion after %s changes and preserves current facts', async (field) => {
    const f = await fixture()
    const descriptors = await f.writeback.persistImageOutputs(f.task, [output()], f.binding)
    await f.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === f.task.id)!
      if (field === 'attempts') task.attempts = 2
      else if (field === 'requestId') task.metadata.providerIdempotencyKey = 'request-2'
      else if (field === 'turnaround') task.metadata.turnaround = true
      else if (field === 'providerName') task.metadata.providerName = 'other-provider'
      else if (field === 'lease') claimGenerationTaskLease(task, 'new-worker', 60_000)
      else if (field === 'cancelled' || field === 'failed') task.status = field
      else task[field] = `new-${field}`
      task.metadata.providerCompletionReceipt = { current: true }
    })
    const before = structuredClone(f.current())
    expect(await f.complete(descriptors)).toBeNull()
    expect(f.current()).toEqual(before)
  })

  it.each([
    ['empty', []],
    ['missing', [output('front'), output('side')]],
    ['duplicate', [output('front'), output('side'), output('side')]],
    ['extra', [output('front'), output('side'), output('back'), output('detail')]],
    ['wrong view', [output('front'), output('side'), output('single')]],
    ['wrong MIME', [output('front'), output('side'), { ...output('back'), contentType: 'video/mp4' }]],
    [
      'wrong signature',
      [output('front'), output('side'), { ...output('back'), content: Buffer.from('not an image') }],
    ],
    ['empty bytes', [output('front'), output('side'), { ...output('back'), content: Buffer.alloc(0) }]],
  ] as const)('rejects %s batch before any put', async (_name, outputs) => {
    const f = await fixture(true)
    await expect(f.writeback.persistImageOutputs(f.task, [...outputs], f.binding)).rejects.toThrow()
    expect(f.storage.put).not.toHaveBeenCalled()
    expect(f.current().status).toBe('running')
  })

  it('rejects copied request provenance and freezes captured identity', async () => {
    const f = await fixture()
    expect(Object.isFrozen(f.binding)).toBe(true)
    expect(Object.isFrozen(f.binding.views)).toBe(true)
    expect(Object.isFrozen(f.request)).toBe(true)
    expect(Object.isFrozen(f.request.outputs)).toBe(true)
    await expect(persistProviderImages(f.task, [output()], f.storage, { ...f.binding })).rejects.toThrow(
      'stale',
    )
    expect(f.storage.put).not.toHaveBeenCalled()
  })

  it('requires configured storage and never returns a successful empty batch', async () => {
    const f = await fixture()
    await expect(
      new GenerationResultWriteback(f.store, null).persistImageOutputs(f.task, [output()], f.binding),
    ).rejects.toThrow('Image storage is not configured')
    expect(f.current().status).toBe('running')
  })

  it.each([
    'taskId',
    'tenantId',
    'projectId',
    'empty request',
    'long request',
    'empty views',
    'duplicate views',
  ] as const)('rejects unsafe prepared %s before storage', async (mode) => {
    const f = await fixture()
    const task = structuredClone(f.task)
    if (mode === 'taskId') task.id = '../task'
    if (mode === 'tenantId') task.tenantId = 'tenant/other'
    if (mode === 'projectId') task.projectId = '..'
    if (mode === 'empty request') task.metadata.providerIdempotencyKey = ''
    if (mode === 'long request') task.metadata.providerIdempotencyKey = 'x'.repeat(501)
    const request = imageRequestFor(task, [])
    if (mode === 'empty views') request.outputs = []
    if (mode === 'duplicate views') request.outputs = ['single', 'single']
    expect(() => prepareImageCompletion(task, request)).toThrow()
    expect(f.storage.put).not.toHaveBeenCalled()
  })

  it('does not issue evidence when the prepared task changes while put is pending', async () => {
    const f = await fixture()
    let release!: () => void
    vi.mocked(f.storage.put).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const pending = f.writeback.persistImageOutputs(f.task, [output()], f.binding)
    f.task.attempts = 2
    release()
    await expect(pending).rejects.toThrow('stale')
    expect(f.current().metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('keeps prior attempt objects unchanged when new attempts store different bytes', async () => {
    const f = await fixture()
    const first = await f.writeback.persistImageOutputs(f.task, [output()], f.binding)
    const retry = structuredClone(f.task)
    claimGenerationTaskLease(retry, 'worker-image', 60_000)
    const nextBinding = prepareImageCompletion(retry, imageRequestFor(retry, []))
    const second = await f.writeback.persistImageOutputs(retry, [output('single', 'retry')], nextBinding)
    expect(first[0]!.storageKey).not.toBe(second[0]!.storageKey)
    expect(f.files.get(first[0]!.storageKey)).toEqual(output().content)
    expect(first[0]!.storageKey).toContain('-attempt-1-')
    expect(second[0]!.storageKey).toContain('-attempt-2-')
  })

  it('copies every output before awaiting the first put to resist Provider buffer mutation', async () => {
    const f = await fixture(true)
    const outputs = [output('front', '1'), output('side', '2'), output('back', '3')]
    const originals = outputs.map((item) => Buffer.from(item.content))
    vi.mocked(f.storage.put).mockImplementation(async (key, buffer) => {
      outputs.forEach((item) => item.content.fill(0))
      f.files.set(key, Buffer.from(buffer))
    })
    const descriptors = await f.writeback.persistImageOutputs(f.task, outputs, f.binding)
    expect(descriptors.map((item) => f.files.get(item.storageKey))).toEqual(originals)
    expect((await f.complete(descriptors))?.status).toBe('completed')
  })

  it.each([
    ['image/png', png, 'png'],
    ['image/jpeg', Buffer.from('ffd8ffe000112233', 'hex'), 'jpg'],
    ['image/gif', Buffer.from('GIF89a000000'), 'gif'],
    ['image/webp', Buffer.from('RIFF0000WEBP0000'), 'webp'],
  ])('accepts %s with a matching signature and extension', async (contentType, content, extension) => {
    const f = await fixture()
    const descriptors = await f.writeback.persistImageOutputs(
      f.task,
      [{ view: 'single', contentType: String(contentType), content: content as Buffer }],
      f.binding,
    )
    expect(descriptors[0]!.storageKey.endsWith(`-single.${extension}`)).toBe(true)
    expect((await f.complete(descriptors))?.status).toBe('completed')
  })

  it('rejects an oversized image before copying or storing', async () => {
    const f = await fixture()
    const content = Buffer.alloc(100 * 1024 * 1024 + 1)
    png.copy(content)
    await expect(
      f.writeback.persistImageOutputs(f.task, [{ ...output(), content }], f.binding),
    ).rejects.toThrow('100 MiB')
    expect(f.storage.put).not.toHaveBeenCalled()
  })

  it('caps total batch size at 100 MiB before storing any view', async () => {
    const f = await fixture(true)
    const content = Buffer.alloc(34 * 1024 * 1024)
    png.copy(content)
    await expect(
      f.writeback.persistImageOutputs(
        f.task,
        ['front', 'side', 'back'].map((view) => ({
          view,
          contentType: 'image/png',
          content,
        })) as ImageGenerationOutput[],
        f.binding,
      ),
    ).rejects.toThrow('100 MiB')
    expect(f.storage.put).not.toHaveBeenCalled()
  })

  it('does not attest partial storage success', async () => {
    const f = await fixture(true)
    vi.mocked(f.storage.put).mockResolvedValueOnce().mockRejectedValueOnce(new Error('storage failed'))
    await expect(
      f.writeback.persistImageOutputs(f.task, [output('front'), output('side'), output('back')], f.binding),
    ).rejects.toThrow('storage failed')
    expect(f.storage.put).toHaveBeenCalledTimes(2)
    expect(f.current().metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('times out the whole storage batch and ignores a late put without writing remaining views', async () => {
    const f = await fixture(true)
    vi.useFakeTimers()
    let release!: () => void
    vi.mocked(f.storage.put).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const pending = f.writeback.persistImageOutputs(
      f.task,
      [output('front'), output('side'), output('back')],
      f.binding,
    )
    const rejected = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(f.storage.put).toHaveBeenCalledTimes(1)
    expect(f.current().metadata.providerCompletionReceipt).toBeUndefined()
  })
})
