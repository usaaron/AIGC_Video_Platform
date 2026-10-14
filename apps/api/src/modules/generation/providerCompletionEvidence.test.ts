import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { videoReviewVersion, type GenerationTask, type ProviderCompletionReceipt } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import { buildGenerationTaskDeliveryEvidence } from './deliveryEvidence.js'
import { providerCompletionEvidence } from './providerCompletionEvidence.js'
import { buildDeliveryVerificationSnapshot } from './deliveryVerification.js'
import { freezeDeliveryContract } from './deliveryContractFreeze.js'
import { evaluateDeliveryGate } from './deliveryGate.js'
import { DeliveryDownloadRepository } from './deliveryDownloadRepository.js'
import { downloadDraft, downloadPrincipal, downloadTask } from './deliveryDownload.fixture.js'

const completedAt = '2026-10-14T01:00:00.000Z'
const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f6d00', 'hex')
const sha256 = createHash('sha256').update(mp4).digest('hex')

function completedVideo() {
  const task = buildQueuedGenerationTask(
    {
      clientRequestId: 'provider-completion',
      projectId: 'project-1',
      kind: 'video',
      provider: 'seedance',
      label: '合成回执验证',
      estimatedCredits: 0,
    },
    { tenantId: 'tenant-1', userId: 'user-1', roles: ['member'] },
    '2026-10-14T00:00:00.000Z',
  )
  const media: ProviderCompletionReceipt['media'] = {
    view: 'single',
    storageKey: `tenant-1/project-1/generated/${task.id}-attempt-1-${sha256}-video.mp4`,
    contentType: 'video/mp4',
    size: mp4.length,
    sha256,
  }
  task.status = 'completed'
  task.attempts = 1
  task.updatedAt = completedAt
  task.resultUrl = `/api/v1/generation/tasks/${task.id}/content`
  task.outputs = [{ id: `${task.id}-video`, view: 'single', mediaType: 'video', url: task.resultUrl }]
  task.metadata = {
    providerName: 'dora-router-seedance',
    providerTaskId: 'provider-1',
    providerState: 'completed',
    generatedOutputs: [media],
    videoStorageKey: media.storageKey,
    videoContentType: media.contentType,
    videoSize: media.size,
  }
  const receipt: ProviderCompletionReceipt = {
    version: 'seqora.provider-completion.v1',
    attestation: 'server-observed-completion',
    tenantId: task.tenantId,
    projectId: task.projectId,
    taskId: task.id,
    provider: 'seedance',
    providerName: 'dora-router-seedance',
    providerTaskId: 'provider-1',
    attempts: 1,
    completedAt,
    mediaVersion: videoReviewVersion(task),
    media,
  }
  task.metadata.providerCompletionReceipt = receipt
  return { task, receipt }
}

function storage(bytes = mp4) {
  return {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    getStream: vi.fn(async () => ({ stream: Readable.from([bytes]), size: bytes.length })),
  }
}

function providerEvidence(task: GenerationTask) {
  return buildGenerationTaskDeliveryEvidence(task).find((item) => item.kind === 'provider')!
}

describe('provider completion delivery evidence', () => {
  it('projects scoped server completion without approving content, physics or continuity', async () => {
    const { task, receipt } = completedVideo()
    const before = structuredClone(task)
    expect(providerCompletionEvidence(task)).toEqual({ reason: 'verified', receipt })
    expect(providerEvidence(task)).toMatchObject({
      status: 'passed',
      requirementIds: ['provider-accepted', 'provider-completed'],
      details: { completion: { reason: 'verified' } },
    })
    expect(
      buildGenerationTaskDeliveryEvidence(task).find((item) => item.kind === 'content-review')?.status,
    ).toBe('pending')
    const snapshot = await buildDeliveryVerificationSnapshot(task, storage(), completedAt)
    const gate = evaluateDeliveryGate({ task, ...snapshot, verifiedAt: completedAt })
    expect(gate.allowed).toBe(false)
    expect(gate.reasonCodes).toContain('CONTENT_REVIEW_PENDING')
    expect(gate.reasonCodes).toContain('CONTINUITY_PENDING')
    expect(task).toEqual(before)
  })

  it.each(['queued', 'running', 'completed'] as const)(
    'does not upgrade a %s flag or URL without receipt',
    (state) => {
      const { task } = completedVideo()
      task.status = state
      task.metadata.providerState = state
      delete task.metadata.providerCompletionReceipt
      expect(providerEvidence(task).status).toBe('observed')
    },
  )

  it.each([
    ['tenantId', 'tenant-2'],
    ['projectId', 'project-2'],
    ['taskId', 'task-2'],
    ['providerTaskId', 'provider-2'],
    ['providerName', 'stringx-seedance'],
    ['attempts', 2],
    ['mediaVersion', 'stale-media'],
  ] as const)('does not accept a receipt for another %s', (key, value) => {
    const { task, receipt } = completedVideo()
    task.metadata.providerCompletionReceipt = { ...receipt, [key]: value }
    expect(providerCompletionEvidence(task)).toEqual({ reason: 'receipt-mismatch', receipt: null })
    expect(providerEvidence(task).status).not.toBe('passed')
  })

  it.each(['storageKey', 'contentType', 'size', 'sha256', 'duplicate', 'missing'])(
    'invalidates changed or ambiguous %s descriptors',
    (key) => {
      const { task, receipt } = completedVideo()
      const media = { ...receipt.media } as Record<string, unknown>
      if (key === 'missing') task.metadata.generatedOutputs = []
      else if (key === 'duplicate') task.metadata.generatedOutputs = [media, { ...media }]
      else {
        media[key] = key === 'size' ? mp4.length + 1 : 'changed'
        task.metadata.generatedOutputs = [media]
      }
      expect(providerEvidence(task).status).not.toBe('passed')
    },
  )

  it('rejects invalid schemas, failed states and transplanted storage namespaces', () => {
    const { task, receipt } = completedVideo()
    task.metadata.providerCompletionReceipt = { ...receipt, attestation: 'provider-signed' }
    expect(providerCompletionEvidence(task).reason).toBe('invalid-receipt')
    task.metadata.providerCompletionReceipt = receipt
    task.metadata.providerState = 'failed'
    expect(providerEvidence(task).status).toBe('failed')
    task.metadata.providerState = 'completed'
    receipt.media.storageKey = 'other-tenant/project-1/generated/other-task-video.mp4'
    task.metadata.videoStorageKey = receipt.media.storageKey
    receipt.mediaVersion = videoReviewVersion(task)
    expect(providerCompletionEvidence(task).reason).toBe('receipt-mismatch')
  })

  it('keeps the receipt valid after review and download versions advance', () => {
    const { task } = completedVideo()
    task.updatedAt = '2026-10-14T02:00:00.000Z'
    task.metadata.contentReview = { decision: 'approved', mediaVersion: videoReviewVersion(task) }
    task.metadata.deliveryDownloads = [{ clientRequestId: 'download-1' }]
    expect(providerEvidence(task).status).toBe('passed')
  })

  it.each(['provider-accepted', 'provider-completed'])(
    'requires a current receipt and actual media bytes for %s',
    async (requirementId) => {
      const { task } = completedVideo()
      task.metadata.deliveryContract = freezeDeliveryContract(
        {
          version: 'seqora.delivery.v1',
          intent: { mode: 'shot', projectId: task.projectId },
          expectedArtifact: { type: 'video', count: 1 },
          must: [{ id: requirementId, statement: '服务端完成及媒体入库证据', source: 'provider' }],
        },
        completedAt,
      )
      const verified = await buildDeliveryVerificationSnapshot(task, storage(), completedAt)
      expect(verified.verification?.status).toBe('satisfied')
      const replaced = Buffer.from(mp4)
      replaced[replaced.length - 1] = 255
      const mismatch = await buildDeliveryVerificationSnapshot(task, storage(replaced), completedAt)
      expect(mismatch.verification?.status).toBe('failed')
      expect(mismatch.evidence.find((item) => item.kind === 'provider')?.status).toBe('failed')
      const unavailable = await buildDeliveryVerificationSnapshot(task, null, completedAt)
      expect(unavailable.verification?.status).toBe('pending')
      delete task.metadata.providerCompletionReceipt
      const legacy = await buildDeliveryVerificationSnapshot(task, storage(), completedAt)
      expect(legacy.verification?.status).toBe('pending')
    },
  )

  it.each(['add', 'delete', 'replace'] as const)(
    'rejects same-timestamp receipt %s during download authorization',
    async (operation) => {
      const store = new AppStore(null)
      await store.initialize()
      const task = downloadTask()
      if (operation !== 'add') task.metadata.providerCompletionReceipt = { version: 'before' }
      const draft = downloadDraft(task)
      await store.mutate((state) => {
        state.tasks = [structuredClone(task)]
        if (operation === 'delete') delete state.tasks[0]!.metadata.providerCompletionReceipt
        else state.tasks[0]!.metadata.providerCompletionReceipt = { version: 'after' }
      })
      const repository = new DeliveryDownloadRepository(store)
      await expect(
        repository.authorize(task.id, downloadPrincipal, task.updatedAt, draft),
      ).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_STALE' })
      expect(store.read((state) => state.tasks[0]!.metadata.deliveryDownloads)).toBeUndefined()
    },
  )
})
