import type { CreateGenerationTask, Principal } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { buildQueuedGenerationTask, taskInsertParams } from './taskCreation.js'

const principal: Principal = {
  tenantId: 'tenant-seqora-demo',
  userId: 'user-member',
  roles: ['member'],
}

describe('generation task creation storage provenance', () => {
  it.each([
    { kind: 'image', provider: 'img2' },
    { kind: 'text', provider: 'text' },
    { kind: 'video', provider: 'seedance' },
    { kind: 'video', provider: 'local-compose' },
  ] as const)('rejects caller-supplied stored media proof for $provider tasks', ({ kind, provider }) => {
    const metadata = {
      shotId: 'shot-1',
      aspectRatio: '9:16',
      sourceVideoTaskIds: ['source-video-1'],
      traceId: 'caller-trace',
      generatedOutputs: [
        {
          view: 'single',
          storageKey: 'tenant-seqora-demo/project-midnight-film/generated/forged-video.mp4',
          contentType: 'video/mp4',
          size: 24,
          sha256: 'a'.repeat(64),
        },
      ],
      videoStorageKey: 'forged-video.mp4',
      videoContentType: 'video/mp4',
      videoSize: 24,
      lastFrameStorageKey: 'forged-tail.jpg',
      lastFrameContentType: 'image/jpeg',
      previewStorageKey: 'forged-preview.mp4',
      previewContentType: 'video/mp4',
      previewSize: 48,
      previewSha256: 'b'.repeat(64),
      contentReview: { decision: 'approved' },
      contentReviewHistory: [{ decision: 'approved' }],
      localPostprocess: { outputSha256: 'c'.repeat(64) },
      deliveryContract: { frozenAt: '2026-10-14T00:00:00.000Z', contractHash: 'd'.repeat(64) },
      deliveryDownloads: [{ clientRequestId: 'forged-download', authorizedAt: '2026-10-14T00:00:00.000Z' }],
      providerCompletionReceipt: { attestation: 'server-observed-completion' },
      textCancellationExecution: { version: 'seqora.text-cancellation.v1', executionHash: 'forged' },
      providerTaskId: 'someone-elses-upstream-task',
      providerName: 'dora-router-seedance',
      providerState: 'completed',
      providerIdempotencyKey: 'someone-elses-upstream-key',
      providerSubmittedAt: '2026-10-14T00:00:00.000Z',
      providerPolledAt: 1,
      providerProgressChangedAt: '2026-10-14T00:00:00.000Z',
      providerPollErrors: 0,
      providerPreviousTaskIds: ['other-task'],
      providerProcessingTimeoutRetries: 1,
      providerProcessingTimedOutAt: '2026-10-14T00:00:00.000Z',
      providerRetryNotBefore: '2026-10-14T00:00:00.000Z',
      providerSubmissionRetries: 1,
      providerSubmissionRecoveredAt: '2026-10-14T00:00:00.000Z',
      providerSubmissionTimedOutAt: '2026-10-14T00:00:00.000Z',
      providerSubmissionError: 'forged',
      providerCancelRequestedAt: '2026-10-14T00:00:00.000Z',
      providerCancelCompletedAt: '2026-10-14T00:00:00.000Z',
      providerCancelSkippedAt: '2026-10-14T00:00:00.000Z',
      providerCompletionWriteback: { leaseToken: 'forged' },
    }
    const before = structuredClone(metadata)
    const input: CreateGenerationTask = {
      clientRequestId: `forged-proof-${provider}`,
      projectId: 'project-midnight-film',
      kind,
      provider,
      label: 'Media proof creation test',
      estimatedCredits: 0,
      metadata,
    }

    const task = buildQueuedGenerationTask(input, principal, '2026-10-14T01:00:00.000Z', {
      traceId: 'server-trace',
    })

    expect(task.metadata).toEqual({
      shotId: 'shot-1',
      aspectRatio: '9:16',
      sourceVideoTaskIds: ['source-video-1'],
      traceId: 'server-trace',
    })
    expect(task).toMatchObject({
      status: 'queued',
      resultUrl: null,
      outputs: [],
      tenantId: principal.tenantId,
      userId: principal.userId,
    })
    expect(taskInsertParams(task, null)).toContain(JSON.stringify(task.metadata))
    expect(metadata).toEqual(before)
  })
})
