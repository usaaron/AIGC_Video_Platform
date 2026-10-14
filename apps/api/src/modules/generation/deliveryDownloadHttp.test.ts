import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deliveryContractSchema,
  deliveryDownloadReceiptSchema,
  videoReviewVersion,
  type DeliveryArtifactType,
  type DeliveryDownloadRequest,
  type DeliveryMode,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import type { VideoContent, VideoGenerationProvider } from '../../core/generation/videoProvider.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import { claimGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { providerPollBinding } from '../../core/jobs/providerCompletion.js'
import { GenerationResultWriteback, type GeneratedOutputDescriptor } from '../../core/jobs/taskWriteback.js'
import { LocalObjectStorage } from '../../infra/objectStorage.js'
import { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { freezeDeliveryContract } from './deliveryContractFreeze.js'
import { GenerationTaskRepository } from './repository.js'
import { registerGenerationRoutes } from './routes.js'
import { GenerationService } from './service.js'
import { buildQueuedGenerationTask } from './taskCreation.js'

// Synthetic media exercises byte integrity without user files or remote Providers.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7l8AAAAASUVORK5CYII=',
  'base64',
)
const video = Buffer.from('000000186674797069736f6d0000020069736f6d6d703432000000086d646174', 'hex')
const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const principal: Principal = {
  tenantId: 'tenant-seqora-demo',
  userId: 'user-member',
  roles: ['member'],
}
const resources: Array<{ app: FastifyInstance; root: string }> = []

afterEach(async () => {
  for (const { app, root } of resources.splice(0)) {
    await app.close()
    const temporaryPath = relative(resolve(tmpdir()), resolve(root))
    if (
      !temporaryPath ||
      temporaryPath.startsWith('..') ||
      isAbsolute(temporaryPath) ||
      !basename(root).startsWith('seqora-delivery-download-http-')
    )
      throw new Error('Refusing to remove a directory outside the test temporary root')
    await rm(root, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

function streamContent(bytes: Buffer, contentType: string): VideoContent {
  return {
    stream: Readable.from([bytes]),
    contentType,
    contentLength: String(bytes.length),
    statusCode: 200,
    acceptRanges: null,
    contentRange: null,
  }
}

async function fixture(
  options: {
    kind?: 'image' | 'video'
    legacy?: boolean
    expectedType?: DeliveryArtifactType
    count?: number
    shotIds?: string[]
    episodeId?: string
    mode?: DeliveryMode
    providerRequirement?: 'provider-accepted' | 'provider-completed'
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'seqora-delivery-download-http-'))
  const app = Fastify()
  resources.push({ app, root })
  const storage = new LocalObjectStorage(root)
  const store = new AppStore(null)
  await store.initialize()
  const kind = options.kind ?? 'image'
  const provider = {
    submit: vi.fn(),
    getStatus: vi.fn(),
    cancel: vi.fn(),
    getContent: vi.fn(async () => streamContent(video, 'video/mp4')),
    getLastFrameContent: vi.fn(async () => streamContent(png, 'image/png')),
  }
  const task = buildQueuedGenerationTask(
    {
      clientRequestId: 'delivery-download-fixture',
      projectId: 'project-midnight-film',
      provider: kind === 'video' ? 'seedance' : 'image2',
      kind,
      label: '正式单任务下载测试',
      estimatedCredits: 5,
      metadata: kind === 'video' ? { shotId: 'shot-download' } : {},
    },
    principal,
    '2026-10-14T00:00:00.000Z',
  )
  const leaseToken = claimGenerationTaskLease(task, 'download-test-worker', 60_000)
  if (kind === 'video') {
    task.metadata.providerName = 'dora-router-seedance'
    task.metadata.providerTaskId = 'synthetic-provider-task'
  }
  await store.mutate((state) => {
    state.tasks = [task]
  })
  const writeback = new GenerationResultWriteback(store, storage)
  let descriptors: GeneratedOutputDescriptor[]
  let completed: GenerationTask | null
  if (kind === 'video') {
    const main = await writeback.persistVideoContent(task, 'synthetic-provider-task', provider)
    const tail = await writeback.persistVideoLastFrame(task, 'synthetic-provider-task', provider)
    descriptors = [main, tail]
    completed = await writeback.writeVideoPollResult({
      taskId: task.id,
      binding: providerPollBinding(task, 'dora-router-seedance'),
      leaseOwnerId: 'download-test-worker',
      leaseToken,
      leaseTtlMs: 60_000,
      status: { status: 'completed', progress: 100, error: null },
      videoDescriptor: main,
      lastFrameDescriptor: tail,
    })
  } else {
    descriptors = await writeback.persistImageOutputs(task, [
      {
        view: 'single',
        contentType: 'image/png',
        content: png,
      },
    ])
    completed = await writeback.completeImageTask(task.id, 'download-test-worker', leaseToken, descriptors)
  }
  expect(completed?.status).toBe('completed')
  const contract = freezeDeliveryContract(
    deliveryContractSchema.parse({
      version: 'seqora.delivery.v1',
      intent: {
        mode: options.mode ?? (kind === 'video' ? 'shot' : 'asset'),
        projectId: task.projectId,
        episodeId: options.episodeId ?? null,
        shotIds: options.shotIds ?? (kind === 'video' ? ['shot-download'] : []),
      },
      expectedArtifact: { type: options.expectedType ?? kind, count: options.count ?? 1 },
      must: [
        { id: 'task-completed', statement: '任务完成', source: 'system' },
        { id: 'media-url', statement: '当前主媒体可读取', source: 'system' },
        ...(options.providerRequirement
          ? [{ id: options.providerRequirement, statement: '服务端已观察完成并保存媒体', source: 'provider' }]
          : []),
        ...(kind === 'video'
          ? [
              { id: 'content-review', statement: '当前视频内容验收通过', source: 'review' },
              { id: 'continuity-ready', statement: '当前视频尾帧可读取', source: 'system' },
            ]
          : []),
      ],
    }),
    '2026-10-14T00:01:00.000Z',
  )
  await store.mutate((state) => {
    const current = state.tasks.find((item) => item.id === task.id)!
    current.metadata.deliveryContract = contract
    if (options.legacy) {
      current.metadata.generatedOutputs = descriptors.map(({ sha256: _sha256, ...legacy }) => legacy)
    }
    if (kind === 'video') {
      current.metadata.contentReview = { decision: 'approved', mediaVersion: videoReviewVersion(current) }
    }
  })
  for (const method of Object.values(provider)) method.mockClear()
  const billing = {
    reserveCredits: vi.fn(),
    reserve: vi.fn(),
    reserveCreditsInState: vi.fn(),
    reserveInState: vi.fn(),
    refundCredits: vi.fn(),
    refundReservation: vi.fn(),
    refundCreditsInState: vi.fn(),
    refundReservationInState: vi.fn(),
    refundGeneration: vi.fn(),
    refundGenerationInState: vi.fn(),
  }
  const dispatch = vi.fn()
  const repository = new GenerationTaskRepository(store, billing as unknown as CreditLedger)
  const service = new GenerationService(
    repository,
    { dispatch } as unknown as TaskDispatcher,
    provider as VideoGenerationProvider,
    'stringx-seedance',
    storage,
  )
  app.addHook('onRequest', async (request) => {
    switch (request.headers['x-test-user']) {
      case 'member':
        request.principal = principal
        break
      case 'other-user':
        request.principal = { ...principal, userId: 'other-user' }
        break
      case 'other-tenant':
        request.principal = { ...principal, tenantId: 'other-tenant' }
        break
      case 'no-permission':
        request.principal = { ...principal, roles: [] }
        break
    }
  })
  await registerGenerationRoutes(app, service)
  const currentTask = () => store.read((state) => state.tasks.find((item) => item.id === task.id)!)
  const request: DeliveryDownloadRequest = {
    expectedUpdatedAt: currentTask().updatedAt,
    contractHash: contract.contractHash!,
    clientRequestId: 'download-request-1',
  }
  const url = `/generation/tasks/${task.id}/delivery-download`
  const post = (payload: unknown = request, user = 'member') =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as object,
      headers: user ? { 'x-test-user': user } : {},
    })
  const get = vi.spyOn(storage, 'get')
  const getStream = vi.spyOn(storage, 'getStream')
  const put = vi.spyOn(storage, 'put')
  const deleteObject = vi.spyOn(storage, 'delete')
  const noProviderOrBilling = () => {
    for (const method of [...Object.values(provider), ...Object.values(billing), dispatch]) {
      expect(method).not.toHaveBeenCalled()
    }
    expect(deleteObject).not.toHaveBeenCalled()
  }
  const denied = async (payload: unknown = request, status = 409, user = 'member') => {
    const before = store.read((state) => state)
    const response = await post(payload, user)
    expect(response.statusCode, response.body).toBe(status)
    expect(response.headers['x-delivery-receipt-id']).toBeUndefined()
    expect(response.headers['content-disposition']).toBeUndefined()
    expect(store.read((state) => state)).toEqual(before)
    noProviderOrBilling()
    return response
  }
  return {
    app,
    store,
    storage,
    root,
    repository,
    currentTask,
    request,
    post,
    denied,
    noProviderOrBilling,
    get,
    getStream,
    put,
    storageKey: descriptors[0]!.storageKey,
    tailStorageKey: descriptors.find((item) => item.view === 'last-frame')?.storageKey,
  }
}

describe('formal single-task delivery download HTTP boundary', () => {
  it.each(['provider-accepted', 'provider-completed'] as const)(
    'enforces the frozen %s requirement for newly completed videos',
    async (providerRequirement) => {
      const test = await fixture({ kind: 'video', providerRequirement })
      const original = test.currentTask().metadata.providerCompletionReceipt
      expect(original).toMatchObject({ attestation: 'server-observed-completion' })
      await test.store.mutate((state) => {
        delete state.tasks[0]!.metadata.providerCompletionReceipt
      })
      await test.denied()
      await test.store.mutate((state) => {
        state.tasks[0]!.metadata.providerCompletionReceipt = {
          ...(original as Record<string, unknown>),
          attempts: 999,
        }
      })
      await test.denied()
      await test.store.mutate((state) => {
        state.tasks[0]!.metadata.providerCompletionReceipt = original
      })
      const response = await test.post()
      expect(response.statusCode, response.body).toBe(200)
      expect(response.rawPayload).toEqual(video)
      const receipts = test.currentTask().metadata.deliveryDownloads as unknown[]
      const receipt = deliveryDownloadReceiptSchema.parse(receipts[0])
      expect(receipt.snapshot.evidence.find((item) => item.kind === 'provider')).toMatchObject({
        status: 'passed',
        details: { completion: { reason: 'verified' } },
      })
      test.noProviderOrBilling()
    },
  )

  it.each(['image', 'video'] as const)(
    'returns verified %s bytes and persists a scoped evidence receipt',
    async (kind) => {
      const test = await fixture({ kind })
      const before = test.currentTask()
      const response = await test.post()
      const bytes = kind === 'image' ? png : video
      expect(response.statusCode, response.body).toBe(200)
      expect(response.rawPayload).toEqual(bytes)
      expect(response.headers['content-type']).toBe(kind === 'image' ? 'image/png' : 'video/mp4')
      expect(response.headers['content-disposition']).toMatch(/^attachment;/)
      expect(response.headers['cache-control']).toMatch(/private.*no-store/)
      expect(response.headers['x-delivery-sha256']).toBe(checksum(bytes))
      expect(response.headers['x-delivery-receipt-id']).toMatch(/^[a-f0-9-]{36}$/)
      const receipts = test.currentTask().metadata.deliveryDownloads as unknown[]
      expect(receipts).toHaveLength(1)
      const receipt = deliveryDownloadReceiptSchema.parse(receipts[0])
      expect(receipt).toMatchObject({
        id: response.headers['x-delivery-receipt-id'],
        taskId: before.id,
        tenantId: principal.tenantId,
        projectId: before.projectId,
        actorUserId: principal.userId,
        sourceTaskUpdatedAt: before.updatedAt,
        recordedTaskUpdatedAt: test.currentTask().updatedAt,
        contractHash: test.request.contractHash,
        clientRequestId: test.request.clientRequestId,
        size: bytes.length,
        sha256: checksum(bytes),
        gate: { allowed: true, status: 'allowed' },
        snapshot: { taskId: before.id, verification: { status: 'satisfied' } },
      })
      expect(receipt.snapshot.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'asset',
            status: 'passed',
            details: expect.objectContaining({
              storageProof: expect.objectContaining({ actualSha256: checksum(bytes), reason: 'verified' }),
            }),
          }),
        ]),
      )
      expect(test.currentTask().updatedAt).not.toBe(before.updatedAt)
      expect(test.getStream).toHaveBeenCalledTimes(kind === 'video' ? 2 : 1)
      expect(test.getStream).toHaveBeenCalledWith(test.storageKey)
      if (kind === 'video') expect(test.getStream).toHaveBeenCalledWith(test.tailStorageKey)
      expect(test.put).not.toHaveBeenCalled()
      test.noProviderOrBilling()
    },
  )

  it('authenticates and enforces create permission before any object I/O', async () => {
    const test = await fixture()
    await test.denied(test.request, 401, '')
    await test.denied(test.request, 403, 'no-permission')
    expect(test.get).not.toHaveBeenCalled()
    expect(test.getStream).not.toHaveBeenCalled()
    expect(test.put).not.toHaveBeenCalled()
  })

  it.each(['other-user', 'other-tenant'])('conceals tasks from %s before object I/O', async (user) => {
    const test = await fixture()
    const response = await test.denied(test.request, 404, user)
    expect(response.body).not.toContain(test.storageKey)
    expect(test.get).not.toHaveBeenCalled()
    expect(test.getStream).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { expectedUpdatedAt: 'not-a-time', contractHash: 'f'.repeat(64), clientRequestId: 'request' },
    { expectedUpdatedAt: '2026-10-14T00:00:00.000Z', contractHash: 'bad', clientRequestId: 'request' },
    { expectedUpdatedAt: '2026-10-14T00:00:00.000Z', contractHash: 'f'.repeat(64), clientRequestId: ' ' },
  ])('rejects malformed download request %# without reads or writes', async (payload) => {
    const test = await fixture()
    await test.denied(payload, 400)
    expect(test.getStream).not.toHaveBeenCalled()
    expect(test.get).not.toHaveBeenCalled()
  })

  it('rejects unexpected fields instead of accepting caller-supplied evidence', async () => {
    const test = await fixture()
    await test.denied({ ...test.request, gate: { allowed: true } }, 400)
    expect(test.getStream).not.toHaveBeenCalled()
  })

  it.each(['missing', 'forged', 'stale'] as const)('blocks a %s contract or task version', async (mode) => {
    const test = await fixture()
    await test.store.mutate((state) => {
      const current = state.tasks[0]!
      if (mode === 'missing') delete current.metadata.deliveryContract
      if (mode === 'forged') {
        current.metadata.deliveryContract = {
          ...(current.metadata.deliveryContract as object),
          contractHash: '0'.repeat(64),
        }
      }
      if (mode === 'stale') current.updatedAt = new Date(Date.parse(current.updatedAt) + 1).toISOString()
    })
    await test.denied()
  })

  it('rejects a request for a different frozen contract hash', async () => {
    const test = await fixture()
    await test.denied({ ...test.request, contractHash: 'e'.repeat(64) })
  })

  it('blocks historical media without an ingestion checksum', async () => {
    const test = await fixture({ legacy: true })
    await test.denied()
    expect(test.currentTask().metadata.deliveryDownloads).toBeUndefined()
  })

  it('requires an ingestion checksum for the current video tail as well as the main video', async () => {
    const test = await fixture({ kind: 'video' })
    await test.store.mutate((state) => {
      const current = state.tasks[0]!
      current.metadata.generatedOutputs = (
        current.metadata.generatedOutputs as GeneratedOutputDescriptor[]
      ).map((descriptor) => {
        if (descriptor.view !== 'last-frame') return descriptor
        const { sha256: _sha256, ...legacy } = descriptor
        return legacy
      })
      current.metadata.contentReview = { decision: 'approved', mediaVersion: videoReviewVersion(current) }
    })
    await test.denied()
    expect(test.currentTask().metadata.deliveryDownloads).toBeUndefined()
  })

  it('blocks a same-length replacement with an unchanged task version', async () => {
    const test = await fixture()
    const changed = Buffer.from(png)
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1
    await test.storage.put(test.storageKey, changed)
    await test.denied()
    expect(test.getStream).toHaveBeenCalledTimes(1)
  })

  it('blocks a same-length replacement of the accepted video tail', async () => {
    const test = await fixture({ kind: 'video' })
    const changed = Buffer.from(png)
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1
    await test.storage.put(test.tailStorageKey!, changed)
    await test.denied()
    expect(test.getStream).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])(
    'rechecks revoked review after reading (updated timestamp: %s)',
    async (updateTimestamp) => {
      const test = await fixture({ kind: 'video' })
      test.getStream.mockImplementationOnce(async (key, range) => {
        const object = await LocalObjectStorage.prototype.getStream.call(test.storage, key, range)
        await test.store.mutate((state) => {
          const current = state.tasks[0]!
          current.metadata.contentReview = { decision: 'pending', mediaVersion: videoReviewVersion(current) }
          if (updateTimestamp) current.updatedAt = new Date(Date.parse(current.updatedAt) + 1).toISOString()
        })
        return object
      })
      const response = await test.post()
      expect(response.statusCode, response.body).toBe(409)
      expect(response.headers['x-delivery-receipt-id']).toBeUndefined()
      expect(test.currentTask().metadata.deliveryDownloads).toBeUndefined()
      test.noProviderOrBilling()
    },
  )

  it('returns the already-verified buffer when the storage object changes during authorization', async () => {
    const test = await fixture()
    const authorize = test.repository.deliveryDownloads.authorize.bind(test.repository.deliveryDownloads)
    const changed = Buffer.from(png)
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1
    vi.spyOn(test.repository.deliveryDownloads, 'authorize').mockImplementationOnce(async (...args) => {
      await test.storage.put(test.storageKey, changed)
      return authorize(...args)
    })
    const response = await test.post()
    expect(response.statusCode, response.body).toBe(200)
    expect(response.rawPayload).toEqual(png)
    expect(response.headers['x-delivery-sha256']).toBe(checksum(png))
    expect(test.getStream).toHaveBeenCalledTimes(1)
    test.noProviderOrBilling()
  })

  it('reuses one receipt for a retry and reads the current object again', async () => {
    const test = await fixture()
    const first = await test.post()
    expect(first.statusCode, first.body).toBe(200)
    const afterFirst = test.currentTask()
    const second = await test.post()
    expect(second.statusCode, second.body).toBe(200)
    expect(second.rawPayload).toEqual(png)
    expect(second.headers['x-delivery-receipt-id']).toBe(first.headers['x-delivery-receipt-id'])
    expect(test.currentTask()).toEqual(afterFirst)
    expect(test.currentTask().metadata.deliveryDownloads).toHaveLength(1)
    expect(test.getStream).toHaveBeenCalledTimes(2)
    test.noProviderOrBilling()
  })

  it('does not let an idempotent retry bypass fresh media verification', async () => {
    const test = await fixture()
    expect((await test.post()).statusCode).toBe(200)
    const changed = Buffer.from(png)
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1
    await test.storage.put(test.storageKey, changed)
    await test.denied()
    expect(test.currentTask().metadata.deliveryDownloads).toHaveLength(1)
    expect(test.getStream).toHaveBeenCalledTimes(2)
  })

  it('authorizes concurrent retries once while verifying bytes for both requests', async () => {
    const test = await fixture()
    const [first, second] = await Promise.all([test.post(), test.post()])
    expect(first.statusCode, first.body).toBe(200)
    expect(second.statusCode, second.body).toBe(200)
    expect(first.headers['x-delivery-receipt-id']).toBe(second.headers['x-delivery-receipt-id'])
    expect(first.rawPayload).toEqual(png)
    expect(second.rawPayload).toEqual(png)
    expect(test.currentTask().metadata.deliveryDownloads).toHaveLength(1)
    expect(test.getStream).toHaveBeenCalledTimes(2)
    test.noProviderOrBilling()
  })

  it('requires a fresh task version for a new request key', async () => {
    const test = await fixture()
    expect((await test.post()).statusCode).toBe(200)
    await test.denied({ ...test.request, clientRequestId: 'download-request-2' })
    expect(test.getStream).toHaveBeenCalledTimes(1)
    const response = await test.post({
      ...test.request,
      expectedUpdatedAt: test.currentTask().updatedAt,
      clientRequestId: 'download-request-2',
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(test.currentTask().metadata.deliveryDownloads).toHaveLength(2)
    await test.denied()
    test.noProviderOrBilling()
  })

  it('accepts a historical response contract only for an unscoped single video', async () => {
    const test = await fixture({ kind: 'video', mode: 'response', shotIds: [] })
    await test.store.mutate((state) => {
      delete state.tasks[0]!.metadata.shotId
    })
    const response = await test.post()
    expect(response.statusCode, response.body).toBe(200)
    expect(response.rawPayload).toEqual(video)
    const receipts = test.currentTask().metadata.deliveryDownloads as unknown[]
    expect(receipts).toHaveLength(1)
    expect(deliveryDownloadReceiptSchema.parse(receipts[0]).snapshot.contract?.intent).toMatchObject({
      mode: 'response',
      episodeId: null,
      shotIds: [],
    })
    test.noProviderOrBilling()
  })

  it.each([
    { expectedType: 'text' as const },
    { expectedType: 'episode' as const },
    { count: 2 },
    { shotIds: ['another-shot'] },
    { shotIds: [] },
    { episodeId: 'another-episode' },
    { mode: 'episode' as const },
    { mode: 'response' as const },
  ])('blocks a contract outside the single media scope %#', async (options) => {
    const test = await fixture({ kind: 'video', ...options })
    await test.denied()
  })

  it('blocks a failed physical audit even if the contract omits physical-review', async () => {
    const test = await fixture({ kind: 'video' })
    await test.store.mutate((state) => {
      const current = state.tasks[0]!
      current.metadata.rigidPhysicsContract = { version: 'rigid-physics-v1' }
      current.metadata.rigidPhysicsAudit = { status: 'failed' }
    })
    await test.denied()
    expect(test.currentTask().metadata.deliveryDownloads).toBeUndefined()
  })

  it.each(['missing', 'unavailable'] as const)(
    'does not use a Provider fallback for %s storage',
    async (mode) => {
      const test = await fixture()
      const error = Object.assign(new Error('synthetic storage failure'), {
        code: mode === 'missing' ? 'ENOENT' : 'EIO',
      })
      test.getStream.mockRejectedValueOnce(error)
      await test.denied()
      expect(test.currentTask().metadata.deliveryDownloads).toBeUndefined()
    },
  )
})
