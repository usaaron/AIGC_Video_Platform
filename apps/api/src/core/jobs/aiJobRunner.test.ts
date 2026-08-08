import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { AiJobRepository } from '../../modules/aiJobs/repository.js'
import { usageCollector } from '../observability/usage.js'
import { AiJobRunner, type AiJobHandler } from './aiJobRunner.js'

const principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
} as const

describe('AiJobRunner', () => {
  beforeEach(() => {
    usageCollector.resetForTests()
  })

  it('executes queued AI jobs through the configured handler', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new AiJobRepository(store)
    const job = await repository.createWithCharge(
      {
        clientRequestId: 'ai-job-success',
        projectId: 'project-midnight-film',
        kind: 'novel.summaryQueueBatch',
        label: '小说摘要队列',
        provider: 'text',
        input: { queueId: 'queue-1' },
        costCredits: 4,
      },
      principal,
    )
    const handler: AiJobHandler = {
      canHandle: vi.fn((candidate) => candidate.kind === 'novel.summaryQueueBatch'),
      execute: vi.fn(async () => ({
        output: {
          processedItemIds: ['summary-item-1'],
        },
      })),
    }

    await new AiJobRunner(repository, { handler }).tick()

    await vi.waitFor(() =>
      expect(store.read((state) => state.aiJobs.find((item) => item.id === job.id)?.status)).toBe(
        'completed',
      ),
    )
    expect(handler.execute).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }))
    expect(store.read((state) => state.aiJobs.find((item) => item.id === job.id))).toMatchObject({
      status: 'completed',
      attempts: 1,
      output: {
        processedItemIds: ['summary-item-1'],
      },
      leaseOwnerId: null,
      leaseToken: null,
      error: null,
    })
    await vi.waitFor(() =>
      expect(usageCollector.snapshot({ userId: principal.userId })).toMatchObject({
        jobConcurrency: 0,
        jobCount: 1,
        jobFailedCount: 0,
        jobFailureRate: 0,
        creditsUsed: 4,
      }),
    )
  })

  it('refunds reserved credits when an AI job fails', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new AiJobRepository(store)
    const originalCredits = store.read(
      (state) => state.users.find((item) => item.id === principal.userId)?.credits ?? 0,
    )
    const job = await repository.createWithCharge(
      {
        clientRequestId: 'ai-job-failure',
        projectId: 'project-midnight-film',
        kind: 'novel.summaryQueueBatch',
        label: '小说摘要队列',
        provider: 'text',
        input: { queueId: 'queue-1' },
        costCredits: 4,
      },
      principal,
    )
    const handler: AiJobHandler = {
      canHandle: vi.fn((candidate) => candidate.kind === 'novel.summaryQueueBatch'),
      execute: vi.fn(async () => {
        throw new Error('provider down')
      }),
    }

    await new AiJobRunner(repository, { handler }).tick()

    await vi.waitFor(() =>
      expect(
        store.read((state) => {
          const stored = state.aiJobs.find((item) => item.id === job.id)
          return stored?.status === 'failed' && typeof stored.refundedAt === 'string'
        }),
      ).toBe(true),
    )
    expect(store.read((state) => state.aiJobs.find((item) => item.id === job.id))).toMatchObject({
      status: 'failed',
      error: 'provider down',
      attempts: 1,
      refundedAt: expect.any(String),
      leaseOwnerId: null,
      leaseToken: null,
    })
    expect(store.read((state) => state.users.find((item) => item.id === principal.userId)?.credits)).toBe(
      originalCredits,
    )
    expect(
      store.read((state) => state.ledger.filter((entry) => entry.id === 'refund-ai-job-failure')),
    ).toEqual([expect.objectContaining({ amount: 4, type: 'adjustment', balance: originalCredits })])
    expect(usageCollector.snapshot({ userId: principal.userId })).toMatchObject({
      jobConcurrency: 0,
      jobCount: 1,
      jobFailedCount: 1,
      jobFailureRate: 1,
      creditsUsed: 0,
    })
  })
})
