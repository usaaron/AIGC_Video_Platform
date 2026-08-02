import type { AiJob, GenerationTask } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { QueryResult, QueryResultRow } from 'pg'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { TaskDispatcher } from './taskDispatcher.js'

export type OutboxEventType = 'generation.task.dispatch' | 'ai_job.dispatch'

export type OutboxEvent = {
  id: string
  tenantId: string
  eventType: OutboxEventType
  aggregateType: string
  aggregateId: string
  dedupeKey: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'sent' | 'failed'
  attempts: number
  maxAttempts: number
  nextAttemptAt: string
  leaseOwnerId: string | null
  leaseToken: string | null
  leaseAcquiredAt: string | null
  leaseExpiresAt: string | null
  lastError: string | null
  sentAt: string | null
  createdAt: string
  updatedAt: string
}

export type OutboxPublisher = {
  publishOutboxEvent(event: OutboxEvent): Promise<void>
}

export type OutboxEventStore = {
  claimPending(options: { ownerId: string; leaseTtlMs: number; limit: number }): Promise<OutboxEvent[]>
  markSent(event: OutboxEvent): Promise<void>
  markFailed(event: OutboxEvent, error: unknown): Promise<void>
}

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

type OutboxEventRow = QueryResultRow & {
  id: string
  tenant_id: string
  event_type: OutboxEventType
  aggregate_type: string
  aggregate_id: string
  dedupe_key: string
  payload: unknown
  status: OutboxEvent['status']
  attempts: number | string
  max_attempts: number | string
  next_attempt_at: Date | string
  lease_owner_id: string | null
  lease_token: string | null
  lease_acquired_at: Date | string | null
  lease_expires_at: Date | string | null
  last_error: string | null
  sent_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

const outboxEventColumns = `
  id,
  tenant_id,
  event_type,
  aggregate_type,
  aggregate_id,
  dedupe_key,
  payload,
  status,
  attempts,
  max_attempts,
  next_attempt_at,
  lease_owner_id,
  lease_token,
  lease_acquired_at,
  lease_expires_at,
  last_error,
  sent_at,
  created_at,
  updated_at
`

export class OutboxRepository {
  constructor(private readonly database: AccountDatabase) {}

  enqueueGenerationTaskDispatch(queryable: Queryable, task: GenerationTask): Promise<void> {
    return enqueueOutboxEvent(queryable, {
      tenantId: task.tenantId,
      eventType: 'generation.task.dispatch',
      aggregateType: 'generation_task',
      aggregateId: task.id,
      dedupeKey: `${task.id}:${task.updatedAt}`,
      payload: {
        taskId: task.id,
        tenantId: task.tenantId,
        updatedAt: task.updatedAt,
      },
    })
  }

  enqueueAiJobDispatch(queryable: Queryable, job: AiJob): Promise<void> {
    return enqueueOutboxEvent(queryable, {
      tenantId: job.tenantId,
      eventType: 'ai_job.dispatch',
      aggregateType: 'ai_job',
      aggregateId: job.id,
      dedupeKey: `${job.id}:${job.updatedAt}`,
      payload: {
        jobId: job.id,
        tenantId: job.tenantId,
        updatedAt: job.updatedAt,
      },
    })
  }

  async claimPending(options: {
    ownerId: string
    leaseTtlMs: number
    limit: number
  }): Promise<OutboxEvent[]> {
    if (options.limit <= 0) return []
    return this.database.transaction(async (client) => {
      const rows = await client.query<OutboxEventRow>(
        `
        SELECT ${outboxEventColumns}
        FROM outbox_events
        WHERE attempts < max_attempts
          AND (
            (status IN ('pending', 'failed') AND next_attempt_at <= now())
            OR (status = 'processing' AND lease_expires_at <= now())
          )
        ORDER BY created_at ASC, id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
        `,
        [options.limit],
      )
      const claimed: OutboxEvent[] = []
      const now = new Date()
      const nowIso = now.toISOString()
      const leaseExpiresAt = new Date(now.getTime() + options.leaseTtlMs).toISOString()

      for (const row of rows.rows) {
        const leaseToken = randomUUID()
        const updated = await client.query<OutboxEventRow>(
          `
          UPDATE outbox_events
          SET status = 'processing',
              attempts = attempts + 1,
              lease_owner_id = $2,
              lease_token = $3,
              lease_acquired_at = $4,
              lease_expires_at = $5,
              updated_at = $4
          WHERE id = $1
          RETURNING ${outboxEventColumns}
          `,
          [row.id, options.ownerId, leaseToken, nowIso, leaseExpiresAt],
        )
        if (updated.rows[0]) claimed.push(eventFromRow(updated.rows[0]))
      }
      return claimed
    })
  }

  async markSent(event: OutboxEvent): Promise<void> {
    await this.database.query(
      `
      UPDATE outbox_events
      SET status = 'sent',
          sent_at = $4,
          lease_owner_id = NULL,
          lease_token = NULL,
          lease_acquired_at = NULL,
          lease_expires_at = NULL,
          last_error = NULL,
          updated_at = $4
      WHERE id = $1
        AND lease_owner_id = $2
        AND lease_token = $3
      `,
      [event.id, event.leaseOwnerId, event.leaseToken, new Date().toISOString()],
    )
  }

  async markFailed(event: OutboxEvent, error: unknown): Promise<void> {
    await this.database.query(
      `
      UPDATE outbox_events
      SET status = 'failed',
          next_attempt_at = $6,
          lease_owner_id = NULL,
          lease_token = NULL,
          lease_acquired_at = NULL,
          lease_expires_at = NULL,
          last_error = $4,
          updated_at = $5
      WHERE id = $1
        AND lease_owner_id = $2
        AND lease_token = $3
      `,
      [
        event.id,
        event.leaseOwnerId,
        event.leaseToken,
        messageFor(error),
        new Date().toISOString(),
        nextAttemptAt(event).toISOString(),
      ],
    )
  }
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null
  private flushPromise: Promise<void> | null = null

  constructor(
    private readonly repository: OutboxEventStore,
    private readonly publisher: OutboxPublisher,
    private readonly options: {
      ownerId?: string
      intervalMs?: number
      leaseTtlMs?: number
      batchSize?: number
      maxBatchesPerFlush?: number
    } = {},
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.flush(), this.options.intervalMs ?? 1_000)
    this.timer.unref?.()
    void this.flush()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise
    const flushPromise = this.runFlush().then(() => undefined)
    this.flushPromise = flushPromise
    try {
      await flushPromise
    } finally {
      if (this.flushPromise === flushPromise) this.flushPromise = null
    }
  }

  private async runFlush(): Promise<void> {
    const ownerId = this.options.ownerId ?? `outbox-relay-${process.pid}-${randomUUID()}`
    const batchSize = this.options.batchSize ?? 50
    const maxBatches = this.options.maxBatchesPerFlush ?? 3
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const events = await this.repository.claimPending({
        ownerId,
        leaseTtlMs: this.options.leaseTtlMs ?? 60_000,
        limit: batchSize,
      })
      if (!events.length) return
      for (const event of events) {
        try {
          await this.publisher.publishOutboxEvent(event)
          await this.repository.markSent(event)
        } catch (error) {
          await this.repository.markFailed(event, error)
        }
      }
    }
  }
}

export class OutboxTaskDispatcher implements TaskDispatcher {
  constructor(private readonly relay: OutboxRelay) {}

  async dispatch(): Promise<void> {
    void this.relay.flush().catch((error) => {
      process.emitWarning(
        `Failed to flush outbox relay: ${error instanceof Error ? error.message : String(error)}`,
        { code: 'SEQORA_OUTBOX_RELAY_FLUSH_FAILED' },
      )
    })
  }
}

type EnqueueOutboxInput = {
  tenantId: string
  eventType: OutboxEventType
  aggregateType: string
  aggregateId: string
  dedupeKey: string
  payload: Record<string, unknown>
}

async function enqueueOutboxEvent(queryable: Queryable, input: EnqueueOutboxInput): Promise<void> {
  const now = new Date().toISOString()
  await queryable.query(
    `
    INSERT INTO outbox_events (
      id,
      tenant_id,
      event_type,
      aggregate_type,
      aggregate_id,
      dedupe_key,
      payload,
      status,
      attempts,
      max_attempts,
      next_attempt_at,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending', 0, 25, $8, $8, $8)
    ON CONFLICT (event_type, dedupe_key) DO NOTHING
    `,
    [
      randomUUID(),
      input.tenantId,
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      input.dedupeKey,
      JSON.stringify(input.payload),
      now,
    ],
  )
}

function eventFromRow(row: OutboxEventRow): OutboxEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    dedupeKey: row.dedupe_key,
    payload: jsonObject(row.payload),
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: isoString(row.next_attempt_at),
    leaseOwnerId: row.lease_owner_id,
    leaseToken: row.lease_token,
    leaseAcquiredAt: nullableIsoString(row.lease_acquired_at),
    leaseExpiresAt: nullableIsoString(row.lease_expires_at),
    lastError: row.last_error,
    sentAt: nullableIsoString(row.sent_at),
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function nullableIsoString(value: Date | string | null): string | null {
  if (value === null) return null
  return isoString(value)
}

function nextAttemptAt(event: OutboxEvent): Date {
  const attemptNumber = Math.max(1, event.attempts)
  const delayMs = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(8, attemptNumber - 1))
  return new Date(Date.now() + delayMs)
}

function messageFor(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000)
}
