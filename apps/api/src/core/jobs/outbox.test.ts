import { describe, expect, it, vi } from 'vitest'
import { OutboxRelay, OutboxTaskDispatcher, type OutboxEvent, type OutboxPublisher } from './outbox.js'

describe('OutboxRelay', () => {
  it('publishes claimed events and marks them sent', async () => {
    const event = eventFixture('event-sent')
    const repository = fakeRepository([event])
    const publisher: OutboxPublisher = {
      publishOutboxEvent: vi.fn(async () => {}),
    }
    const relay = new OutboxRelay(repository, publisher, { ownerId: 'relay-test' })

    await relay.flush()

    expect(publisher.publishOutboxEvent).toHaveBeenCalledWith(event)
    expect(repository.sent).toEqual(['event-sent'])
    expect(repository.failed).toEqual([])
  })

  it('marks failed publishes and retries them on the next flush', async () => {
    const event = eventFixture('event-retry')
    const repository = fakeRepository([event], [eventFixture('event-retry')])
    const publisher: OutboxPublisher = {
      publishOutboxEvent: vi
        .fn()
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValueOnce(undefined),
    }
    const relay = new OutboxRelay(repository, publisher, { ownerId: 'relay-test' })

    await relay.flush()
    await relay.flush()

    expect(publisher.publishOutboxEvent).toHaveBeenCalledTimes(2)
    expect(repository.failed).toEqual(['event-retry'])
    expect(repository.sent).toEqual(['event-retry'])
  })
})

describe('OutboxTaskDispatcher', () => {
  it('nudges the relay without requiring a task payload', async () => {
    const relay = { flush: vi.fn(async () => {}) } as unknown as OutboxRelay

    await new OutboxTaskDispatcher(relay).dispatch()

    await vi.waitFor(() => expect(relay.flush).toHaveBeenCalled())
  })
})

function fakeRepository(...batches: OutboxEvent[][]) {
  return {
    sent: [] as string[],
    failed: [] as string[],
    async claimPending() {
      return batches.shift() ?? []
    },
    async markSent(event: OutboxEvent) {
      this.sent.push(event.id)
    },
    async markFailed(event: OutboxEvent) {
      this.failed.push(event.id)
    },
  }
}

function eventFixture(id: string): OutboxEvent {
  const now = new Date().toISOString()
  return {
    id,
    tenantId: 'tenant-seqora-demo',
    eventType: 'generation.task.dispatch',
    aggregateType: 'generation_task',
    aggregateId: 'task-1',
    dedupeKey: 'task-1:created',
    payload: { taskId: 'task-1' },
    status: 'processing',
    attempts: 1,
    maxAttempts: 25,
    nextAttemptAt: now,
    leaseOwnerId: 'relay-test',
    leaseToken: 'lease-token',
    leaseAcquiredAt: now,
    leaseExpiresAt: now,
    lastError: null,
    sentAt: null,
    createdAt: now,
    updatedAt: now,
  }
}
