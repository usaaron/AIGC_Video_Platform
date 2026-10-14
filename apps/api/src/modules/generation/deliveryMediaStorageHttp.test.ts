import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deliveryContractSchema,
  videoReviewVersion,
  type DeliveryVerificationSnapshot,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import type { VideoContent, VideoGenerationProvider } from '../../core/generation/videoProvider.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import { claimGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { providerPollBinding } from '../../core/jobs/providerCompletion.js'
import { prepareImageCompletion } from '../../core/jobs/imageProviderCompletion.js'
import { imageRequestFor } from '../../core/jobs/imageTaskRequest.js'
import { GenerationResultWriteback, type GeneratedOutputDescriptor } from '../../core/jobs/taskWriteback.js'
import { LocalObjectStorage } from '../../infra/objectStorage.js'
import { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { freezeDeliveryContract } from './deliveryContractFreeze.js'
import { GenerationTaskRepository } from './repository.js'
import { registerGenerationRoutes } from './routes.js'
import { GenerationService } from './service.js'
import { buildQueuedGenerationTask } from './taskCreation.js'

// A synthetic one-pixel PNG, independent of any user media or Provider.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7l8AAAAASUVORK5CYII=',
  'base64',
)
// Synthetic MP4 ftyp/mdat boxes exercise storage integrity, not video decoding.
const video = Buffer.from('000000186674797069736f6d0000020069736f6d6d703432000000086d646174', 'hex')
const checksum = (content: Buffer) => createHash('sha256').update(content).digest('hex')
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
      !basename(root).startsWith('seqora-delivery-http-')
    ) {
      throw new Error('Refusing to remove a directory outside the test temporary root')
    }
    await rm(root, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

function streamContent(content: Buffer, contentType: string): VideoContent {
  return {
    stream: Readable.from([content]),
    contentType,
    contentLength: String(content.length),
    statusCode: 200,
    acceptRanges: null,
    contentRange: null,
  }
}

async function fixture(
  options: { kind?: 'image' | 'video'; legacy?: boolean; omitMediaRequirement?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'seqora-delivery-http-'))
  const app = Fastify()
  resources.push({ app, root })
  const storage = new LocalObjectStorage(root)
  const store = new AppStore(null)
  await store.initialize()
  const kind = options.kind ?? 'image'
  const provider = {
    submit: vi.fn(),
    getStatus: vi.fn(),
    getContent: vi.fn(async () => streamContent(video, 'video/mp4')),
    getLastFrameContent: vi.fn(async () => streamContent(png, 'image/png')),
    cancel: vi.fn(),
  }
  const task = buildQueuedGenerationTask(
    {
      clientRequestId: 'delivery-media-storage-http',
      projectId: 'project-midnight-film',
      provider: kind === 'video' ? 'seedance' : 'img2',
      kind,
      label: '主媒体存储证明测试',
      estimatedCredits: 5,
    },
    principal,
    '2026-10-14T00:00:00.000Z',
  )
  const leaseToken = claimGenerationTaskLease(task, 'test-worker', 60_000)
  if (kind === 'video') {
    task.metadata.providerName = 'dora-router-seedance'
    task.metadata.providerTaskId = 'synthetic-provider-task'
  } else {
    task.metadata.providerName = 'tokenadvent-img2'
    task.metadata.providerIdempotencyKey = `generation:${task.tenantId}:${task.id}`
  }
  await store.mutate((state) => {
    state.tasks = [task]
  })
  const writeback = new GenerationResultWriteback(store, storage)
  let descriptors: GeneratedOutputDescriptor[]
  let completed: GenerationTask | null
  if (kind === 'video') {
    const videoDescriptor = await writeback.persistVideoContent(task, 'synthetic-provider-task', provider)
    const lastFrameDescriptor = await writeback.persistVideoLastFrame(
      task,
      'synthetic-provider-task',
      provider,
    )
    descriptors = [videoDescriptor, lastFrameDescriptor]
    expect(videoDescriptor.sha256).toBe(checksum(video))
    expect(lastFrameDescriptor.sha256).toBe(checksum(png))
    completed = await writeback.writeVideoPollResult({
      taskId: task.id,
      binding: providerPollBinding(task, 'dora-router-seedance'),
      leaseOwnerId: 'test-worker',
      leaseToken,
      leaseTtlMs: 60_000,
      status: { status: 'completed', progress: 100, error: null },
      videoDescriptor,
      lastFrameDescriptor,
    })
  } else {
    const binding = prepareImageCompletion(task, imageRequestFor(task, []))
    descriptors = await writeback.persistImageOutputs(
      task,
      [
        {
          view: 'single',
          contentType: 'image/png',
          content: png,
        },
      ],
      binding,
    )
    expect(descriptors[0]?.sha256).toBe(checksum(png))
    completed = await writeback.completeImageTask(task.id, 'test-worker', leaseToken, descriptors)
  }
  expect(completed?.status).toBe('completed')
  const contract = freezeDeliveryContract(
    deliveryContractSchema.parse({
      version: 'seqora.delivery.v1',
      intent: { mode: kind === 'video' ? 'shot' : 'asset', projectId: task.projectId },
      expectedArtifact: { type: options.omitMediaRequirement ? 'text' : kind, count: 1 },
      must: [
        { id: 'task-completed', statement: '任务完成', source: 'system' },
        ...(options.omitMediaRequirement
          ? []
          : [{ id: 'media-url', statement: '当前主媒体可读取', source: 'system' }]),
        ...(kind === 'video'
          ? [
              { id: 'content-review', statement: '当前视频内容已通过验收', source: 'review' },
              { id: 'continuity-ready', statement: '当前视频尾帧可读取', source: 'system' },
            ]
          : []),
      ],
    }),
    '2026-10-14T00:01:00.000Z',
  )
  await store.mutate((state) => {
    const saved = state.tasks.find((item) => item.id === task.id)!
    saved.metadata.deliveryContract = contract
    if (options.legacy) {
      saved.metadata.generatedOutputs = descriptors.map(({ sha256: _sha256, ...legacy }) => legacy)
    }
    if (kind === 'video') {
      saved.metadata.contentReview = { decision: 'approved', mediaVersion: videoReviewVersion(saved) }
    }
  })
  // The ingestion provider is a local stub; proof queries must never call it again.
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
    }
  })
  await registerGenerationRoutes(app, service)

  const initialState = store.read((state) => state)
  const writes = [
    vi.spyOn(store, 'mutate'),
    vi.spyOn(store, 'transaction'),
    vi.spyOn(store, 'mutateRuntimeCachesAsync'),
    vi.spyOn(store, 'mutateGenerationTaskRuntimeCache'),
    vi.spyOn(store, 'mutateGenerationTaskRuntimeCacheAsync'),
  ]
  const get = vi.spyOn(storage, 'get')
  const getStream = vi.spyOn(storage, 'getStream')
  const put = vi.spyOn(storage, 'put')
  const deleteObject = vi.spyOn(storage, 'delete')
  const storageKey = descriptors[0]!.storageKey
  const url = (endpoint: string) => `/generation/tasks/${task.id}/${endpoint}`
  const query = async (endpoint: string) => {
    const response = await app.inject({
      method: 'GET',
      url: url(endpoint),
      headers: { 'x-test-user': 'member' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain(JSON.stringify(root).slice(1, -1))
    const result = response.json()
    if (endpoint === 'delivery-verification') {
      // The new proof adds no storage paths; pre-existing video mediaVersion remains unchanged.
      const proofJson = JSON.stringify(mediaProof(result)?.details.storageProof)
      expect(proofJson).not.toContain(storageKey)
      expect(proofJson).not.toMatch(/storageKey|previewStorageKey|videoStorageKey/)
    }
    return result
  }
  const assertReadOnly = () => {
    expect(store.read((state) => state)).toEqual(initialState)
    for (const write of [
      ...writes,
      ...Object.values(billing),
      ...Object.values(provider),
      dispatch,
      put,
      deleteObject,
    ]) {
      expect(write).not.toHaveBeenCalled()
    }
  }
  const tailStorageKey = descriptors.find((descriptor) => descriptor.view === 'last-frame')?.storageKey
  return { app, storage, storageKey, tailStorageKey, get, getStream, put, url, query, assertReadOnly }
}

function mediaProof(snapshot: DeliveryVerificationSnapshot) {
  return snapshot.evidence.find((evidence) => evidence.kind === 'asset')
}

describe('main media storage proof HTTP boundary', () => {
  it('allows a completed image only after reading the exact bytes hashed by server writeback', async () => {
    const test = await fixture()
    const snapshot = await test.query('delivery-verification')
    expect(mediaProof(snapshot)).toMatchObject({
      status: 'passed',
      requirementIds: ['media-url'],
      details: {
        storageProof: {
          status: 'passed',
          reason: 'verified',
          contentType: 'image/png',
          expectedSize: png.length,
          actualSize: png.length,
          expectedSha256: checksum(png),
          actualSha256: checksum(png),
        },
      },
    })
    expect(snapshot.verification).toMatchObject({
      status: 'satisfied',
      satisfiedRequirementIds: ['task-completed', 'media-url'],
    })
    expect(await test.query('delivery-gate')).toMatchObject({
      allowed: true,
      status: 'allowed',
      reasonCodes: [],
    })
    expect(test.getStream).toHaveBeenCalledTimes(2)
    expect(test.getStream).toHaveBeenNthCalledWith(1, test.storageKey)
    expect(test.get).not.toHaveBeenCalled()
    test.assertReadOnly()
  })

  it('re-reads the object and blocks same-length replacement despite unchanged task metadata', async () => {
    const test = await fixture()
    expect(await test.query('delivery-gate')).toMatchObject({ allowed: true })
    const changed = Buffer.from(png)
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1
    await test.storage.put(test.storageKey, changed)
    test.put.mockClear()
    const snapshot = await test.query('delivery-verification')
    expect(mediaProof(snapshot)).toMatchObject({
      status: 'failed',
      details: {
        storageProof: {
          status: 'failed',
          reason: 'checksum-mismatch',
          expectedSize: png.length,
          actualSize: png.length,
          expectedSha256: checksum(png),
          actualSha256: checksum(changed),
        },
      },
    })
    expect(snapshot.verification).toMatchObject({ status: 'failed', failedRequirementIds: ['media-url'] })
    expect(await test.query('delivery-gate')).toMatchObject({
      allowed: false,
      status: 'blocked',
      reasonCodes: expect.arrayContaining(['MEDIA_NOT_READABLE', 'DELIVERY_REQUIREMENTS_INCOMPLETE']),
    })
    expect(test.getStream).toHaveBeenCalledTimes(3)
    test.assertReadOnly()
  })

  it('allows an approved stored Seedance video with its tail, then blocks same-length video replacement', async () => {
    const test = await fixture({ kind: 'video' })
    const snapshot = await test.query('delivery-verification')
    expect(mediaProof(snapshot)).toMatchObject({
      status: 'passed',
      details: {
        storageProof: {
          status: 'passed',
          reason: 'verified',
          contentType: 'video/mp4',
          expectedSize: video.length,
          actualSize: video.length,
          expectedSha256: checksum(video),
          actualSha256: checksum(video),
        },
      },
    })
    expect(snapshot.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'content-review', status: 'passed' }),
        expect.objectContaining({ kind: 'continuity', status: 'passed' }),
      ]),
    )
    expect(snapshot.verification).toMatchObject({
      status: 'satisfied',
      satisfiedRequirementIds: ['task-completed', 'media-url', 'content-review', 'continuity-ready'],
    })
    expect(await test.query('delivery-gate')).toMatchObject({
      allowed: true,
      status: 'allowed',
      reasonCodes: [],
    })

    const changed = Buffer.from(video)
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1
    await test.storage.put(test.storageKey, changed)
    test.put.mockClear()
    const replaced = await test.query('delivery-verification')
    expect(mediaProof(replaced)).toMatchObject({
      status: 'failed',
      details: {
        storageProof: {
          status: 'failed',
          reason: 'checksum-mismatch',
          expectedSize: video.length,
          actualSize: video.length,
          expectedSha256: checksum(video),
          actualSha256: checksum(changed),
        },
      },
    })
    expect(await test.query('delivery-gate')).toMatchObject({
      allowed: false,
      status: 'blocked',
      reasonCodes: expect.arrayContaining(['MEDIA_NOT_READABLE', 'DELIVERY_REQUIREMENTS_INCOMPLETE']),
    })
    expect(test.getStream).toHaveBeenCalledTimes(8)
    expect(test.getStream).toHaveBeenCalledWith(test.storageKey)
    expect(test.get).not.toHaveBeenCalled()
    expect(test.getStream).toHaveBeenCalledWith(test.tailStorageKey)
    test.assertReadOnly()
  })

  it('keeps historical media without an ingestion checksum pending without writing a new baseline', async () => {
    const test = await fixture({ legacy: true })
    const snapshot = await test.query('delivery-verification')
    expect(mediaProof(snapshot)).toMatchObject({
      status: 'pending',
      details: {
        storageProof: {
          status: 'pending',
          reason: 'missing-checksum',
          expectedSha256: null,
          actualSha256: checksum(png),
        },
      },
    })
    expect(snapshot.verification).toMatchObject({ pendingRequirementIds: ['media-url'] })
    expect(await test.query('delivery-gate')).toMatchObject({
      allowed: false,
      status: 'pending',
      reasonCodes: expect.arrayContaining(['MEDIA_NOT_READABLE']),
    })
    test.assertReadOnly()
  })

  it('requires media proof for an image even when the frozen contract asks only for text and task completion', async () => {
    const test = await fixture({ legacy: true, omitMediaRequirement: true })
    expect((await test.query('delivery-verification')).verification).toMatchObject({ status: 'satisfied' })
    expect(await test.query('delivery-gate')).toMatchObject({
      allowed: false,
      status: 'pending',
      reasonCodes: ['MEDIA_NOT_READABLE'],
    })
    test.assertReadOnly()
  })

  it.each(['delivery-verification', 'delivery-gate'])(
    'protects %s before object reads with authentication and tenant/user isolation',
    async (endpoint) => {
      const test = await fixture()
      expect((await test.app.inject({ method: 'GET', url: test.url(endpoint) })).statusCode).toBe(401)
      for (const user of ['other-user', 'other-tenant']) {
        const response = await test.app.inject({
          method: 'GET',
          url: test.url(endpoint),
          headers: { 'x-test-user': user },
        })
        expect(response.statusCode).toBe(404)
        expect(response.body).not.toContain(test.storageKey)
      }
      expect(test.get).not.toHaveBeenCalled()
      expect(test.getStream).not.toHaveBeenCalled()
      test.assertReadOnly()
    },
  )
})
