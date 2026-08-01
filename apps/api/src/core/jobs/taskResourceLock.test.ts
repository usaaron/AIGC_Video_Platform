import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { cancellationResourceLockForTask, novelSummaryQueueResourceLock } from './taskResourceLock.js'

describe('taskResourceLock', () => {
  it('locks independent videos by shot id', () => {
    expect(
      cancellationResourceLockForTask(
        task({
          kind: 'video',
          metadata: { shotId: 'shot-1' },
        }),
      ),
    ).toEqual({ kind: 'video-shot', key: 'shotId:shot-1' })
  })

  it('locks continuous videos by chain root or previous shot', () => {
    expect(
      cancellationResourceLockForTask(
        task({
          kind: 'video',
          metadata: { shotId: 'shot-2', chainRoot: 'shot-1' },
        }),
      ),
    ).toEqual({ kind: 'video-chain', key: 'chainRoot:shot-1' })

    expect(
      cancellationResourceLockForTask(
        task({
          kind: 'video',
          metadata: { shotId: 'shot-3', previousShotId: 'shot-2' },
        }),
      ),
    ).toEqual({ kind: 'video-chain', key: 'previousShotId:shot-2' })
  })

  it('locks asset generations by asset id and stage', () => {
    expect(
      cancellationResourceLockForTask(
        task({
          kind: 'image',
          metadata: { assetId: 'asset-1', generationStage: 'face' },
        }),
      ),
    ).toEqual({ kind: 'character-asset-stage', key: 'assetId:asset-1|stage:face' })
  })

  it('locks novel summary queues by document and queue id', () => {
    expect(novelSummaryQueueResourceLock('novel-1', 'queue-1')).toEqual({
      kind: 'novel-summary-queue',
      key: 'documentId:novel-1|queueId:queue-1',
    })
  })
})

function task(overrides: Partial<GenerationTask>): GenerationTask {
  const now = new Date().toISOString()
  return {
    id: 'task-1',
    clientRequestId: 'task-client-1',
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind: 'video',
    label: 'Task 1',
    prompt: '',
    negativePrompt: '',
    provider: 'seedance',
    model: null,
    metadata: {},
    status: 'cancelled',
    progress: 100,
    estimatedCredits: 0,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
    ...overrides,
  }
}
