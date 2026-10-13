import { describe, expect, it } from 'vitest'
import { videoReviewVersion, type GenerationTask } from '@seqora/contracts'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import {
  buildVideoTailStorageEvidence,
  verifyCurrentVideoTailStorage,
} from './deliveryStorageVerification.js'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])

function task(overrides: Partial<GenerationTask> = {}): GenerationTask {
  return {
    id: 'task-1',
    clientRequestId: 'request-1',
    projectId: 'project-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    kind: 'video',
    label: '镜头 1',
    prompt: 'prompt',
    negativePrompt: '',
    provider: 'seedance',
    model: null,
    tier: null,
    metadata: {
      providerState: 'completed',
      providerTaskId: 'provider-1',
      lastFrameStorageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
      generatedOutputs: [
        {
          view: 'last-frame',
          storageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
          contentType: 'image/png',
          size: png.length,
        },
      ],
    },
    status: 'completed',
    progress: 100,
    estimatedCredits: 18,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:01:00.000Z',
    resultUrl: '/video/task-1',
    outputs: [],
    error: null,
    ...overrides,
  }
}

function approvedTask(overrides: Partial<GenerationTask> = {}): GenerationTask {
  const initial = task(overrides)
  return task({
    ...overrides,
    metadata: {
      ...initial.metadata,
      contentReview: {
        decision: 'approved',
        mediaVersion: videoReviewVersion(initial),
      },
    },
  })
}

function storageFor(content: Buffer, failure?: unknown): ObjectStorage {
  return {
    put: async () => undefined,
    get: async () => {
      if (failure) throw failure
      return content
    },
    delete: async () => undefined,
  }
}

describe('video tail object storage verification', () => {
  it('keeps missing storage, missing tails and non-completed tasks pending', async () => {
    expect((await verifyCurrentVideoTailStorage(task(), null)).reason).toBe('storage-unavailable')
    expect((await verifyCurrentVideoTailStorage(task({ metadata: {} }), storageFor(png))).reason).toBe(
      'missing-current-tail',
    )
    expect((await verifyCurrentVideoTailStorage(task({ status: 'queued' }), storageFor(png))).reason).toBe(
      'task-not-ready',
    )
  })

  it('passes a current readable PNG with the recorded size', async () => {
    const result = await verifyCurrentVideoTailStorage(task(), storageFor(png))
    expect(result).toEqual({
      status: 'passed',
      reason: 'readable',
      storageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
      expectedSize: png.length,
      actualSize: png.length,
    })
  })

  it('fails absent, empty, wrong-size and wrong-signature objects', async () => {
    const notFound = Object.assign(new Error('missing'), { code: 'ENOENT' })
    expect((await verifyCurrentVideoTailStorage(task(), storageFor(png, notFound))).reason).toBe('not-found')
    const gcsNotFound = Object.assign(new Error('missing'), { statusCode: 404 })
    expect((await verifyCurrentVideoTailStorage(task(), storageFor(png, gcsNotFound))).reason).toBe(
      'not-found',
    )
    expect((await verifyCurrentVideoTailStorage(task(), storageFor(Buffer.alloc(0)))).reason).toBe(
      'empty-object',
    )
    expect(
      (await verifyCurrentVideoTailStorage(task(), storageFor(Buffer.concat([png, Buffer.from([1])]))))
        .reason,
    ).toBe('size-mismatch')
    const invalid = Buffer.from(png)
    invalid[0] = 0
    expect((await verifyCurrentVideoTailStorage(task(), storageFor(invalid))).reason).toBe(
      'content-type-mismatch',
    )
    const unsupportedType = task({
      metadata: {
        lastFrameStorageKey: 'tenant-1/project-1/generated/task-1-last-frame.svg',
        generatedOutputs: [
          {
            view: 'last-frame',
            storageKey: 'tenant-1/project-1/generated/task-1-last-frame.svg',
            contentType: 'image/svg+xml',
            size: png.length,
          },
        ],
      },
    })
    expect((await verifyCurrentVideoTailStorage(unsupportedType, storageFor(png))).reason).toBe(
      'content-type-mismatch',
    )
  })

  it('keeps transient storage errors pending and rejects a stale descriptor', async () => {
    expect(
      (await verifyCurrentVideoTailStorage(task(), storageFor(png, new Error('temporary')))).status,
    ).toBe('pending')
    const stale = task({
      metadata: {
        lastFrameStorageKey: 'current-key',
        generatedOutputs: [
          { view: 'last-frame', storageKey: 'old-key', contentType: 'image/png', size: png.length },
        ],
      },
    })
    expect((await verifyCurrentVideoTailStorage(stale, storageFor(png))).reason).toBe('missing-current-tail')
    const crossScope = task({
      metadata: {
        lastFrameStorageKey: 'tenant-other/project-1/generated/task-1-last-frame.png',
        generatedOutputs: [
          {
            view: 'last-frame',
            storageKey: 'tenant-other/project-1/generated/task-1-last-frame.png',
            contentType: 'image/png',
            size: png.length,
          },
        ],
      },
    })
    expect((await verifyCurrentVideoTailStorage(crossScope, storageFor(png))).reason).toBe(
      'missing-current-tail',
    )
  })

  it('only upgrades continuity to passed after review gates and storage reading pass', async () => {
    const approved = approvedTask()
    const evidence = await buildVideoTailStorageEvidence(
      approved,
      storageFor(png),
      '2026-10-13T00:03:00.000Z',
    )
    expect(evidence?.status).toBe('passed')
    expect(evidence?.observedAt).toBe('2026-10-13T00:03:00.000Z')
    expect((await buildVideoTailStorageEvidence(approved, null))?.status).toBe('pending')

    const rejected = task({
      metadata: {
        lastFrameStorageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
        generatedOutputs: [
          {
            view: 'last-frame',
            storageKey: 'tenant-1/project-1/generated/task-1-last-frame.png',
            contentType: 'image/png',
            size: png.length,
          },
        ],
        contentReview: {
          decision: 'rejected',
          mediaVersion: videoReviewVersion(task()),
        },
      },
    })
    expect((await buildVideoTailStorageEvidence(rejected, storageFor(png)))?.status).toBe('failed')
  })
})
