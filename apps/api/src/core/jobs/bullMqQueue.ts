import { Queue, Worker, type JobsOptions } from 'bullmq'
import { Redis } from 'ioredis'
import type { AppConfig } from '../../config.js'
import { observabilityMetrics } from '../observability/metrics.js'
import type { OutboxEvent, OutboxPublisher } from './outbox.js'
import type { TaskDispatcher } from './taskDispatcher.js'

type GenerationQueueJob = {
  reason: 'task-dispatch' | 'startup' | 'poll' | 'outbox-event'
  taskId?: string
  tenantId?: string
  outboxEventId?: string
  eventType?: OutboxEvent['eventType']
  aggregateId?: string
}

export interface TaskQueueRunner {
  tick(): Promise<void>
}

export type BullMqReadiness = {
  redis: 'ready' | 'error'
  queue: 'ready' | 'error'
  worker: 'ready' | 'missing' | 'stale' | 'unknown'
  counts: Record<string, number>
  workerHeartbeat: {
    pid: number | null
    updatedAt: string | null
    ageMs: number | null
  }
  error: string | null
}

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800, count: 5_000 },
}

export class BullMqTaskDispatcher implements TaskDispatcher, OutboxPublisher {
  private readonly connection: IORedis
  private readonly queue: Queue<GenerationQueueJob>

  constructor(private readonly config: AppConfig) {
    this.connection = redisConnection(config.REDIS_URL)
    this.queue = new Queue<GenerationQueueJob>(config.TASK_QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions,
    })
  }

  async dispatch(task: { id: string; tenantId: string; updatedAt: string }): Promise<void> {
    try {
      await this.addQueueTrigger(
        'generation-task',
        { reason: 'task-dispatch', taskId: task.id, tenantId: task.tenantId },
        `task-${safeJobIdPart(task.id)}-${safeJobIdPart(task.updatedAt)}`,
      )
    } catch (error) {
      process.emitWarning(
        `Failed to enqueue generation task ${task.id}: ${error instanceof Error ? error.message : String(error)}`,
        { code: 'SEQORA_TASK_QUEUE_ENQUEUE_FAILED' },
      )
    }
  }

  async publishOutboxEvent(event: OutboxEvent): Promise<void> {
    await this.addQueueTrigger(
      event.eventType === 'ai_job.dispatch' ? 'ai-job-dispatch' : 'generation-task-dispatch',
      {
        reason: 'outbox-event',
        tenantId: event.tenantId,
        outboxEventId: event.id,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
      },
      `outbox-${safeJobIdPart(event.id)}`,
    )
  }

  async waitUntilReady(): Promise<void> {
    await this.queue.waitUntilReady()
  }

  async readiness(): Promise<BullMqReadiness> {
    try {
      await this.connection.ping()
      const counts = await this.queue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed')
      const heartbeat = parseWorkerHeartbeat(
        await this.connection.get(workerHeartbeatKey(this.config.TASK_QUEUE_NAME)),
      )
      return {
        redis: 'ready',
        queue: 'ready',
        worker: workerStatus(heartbeat),
        counts,
        workerHeartbeat: {
          pid: heartbeat?.pid ?? null,
          updatedAt: heartbeat?.updatedAt ?? null,
          ageMs: heartbeat ? Date.now() - Date.parse(heartbeat.updatedAt) : null,
        },
        error: null,
      }
    } catch (error) {
      return {
        redis: 'error',
        queue: 'error',
        worker: 'unknown',
        counts: {},
        workerHeartbeat: { pid: null, updatedAt: null, ageMs: null },
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async close(): Promise<void> {
    await this.queue.close()
    this.connection.disconnect()
  }

  private async addQueueTrigger(name: string, data: GenerationQueueJob, jobId: string): Promise<void> {
    await this.queue.add(name, data, {
      jobId,
      ...defaultJobOptions,
    })
    observabilityMetrics.recordQueuePublished({ reason: data.reason, tenantId: data.tenantId ?? null })
  }
}

export class BullMqGenerationWorker {
  private readonly queueConnection: IORedis
  private readonly workerConnection: IORedis
  private readonly queue: Queue<GenerationQueueJob>
  private readonly worker: Worker<GenerationQueueJob>
  private heartbeatTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly config: AppConfig,
    private readonly runner: TaskQueueRunner,
  ) {
    this.queueConnection = redisConnection(config.REDIS_URL)
    this.workerConnection = redisConnection(config.REDIS_URL)
    this.queue = new Queue<GenerationQueueJob>(config.TASK_QUEUE_NAME, {
      connection: this.queueConnection,
      defaultJobOptions,
    })
    this.worker = new Worker<GenerationQueueJob>(
      config.TASK_QUEUE_NAME,
      async (job) => {
        const startedAt = Date.now()
        const waitMs = Math.max(0, startedAt - job.timestamp)
        try {
          await this.runner.tick()
          observabilityMetrics.recordQueueJob({
            name: job.name,
            reason: job.data.reason,
            waitMs,
            executionMs: Date.now() - startedAt,
            ok: true,
          })
        } catch (error) {
          observabilityMetrics.recordQueueJob({
            name: job.name,
            reason: job.data.reason,
            waitMs,
            executionMs: Date.now() - startedAt,
            ok: false,
            error,
          })
          throw error
        }
      },
      {
        connection: this.workerConnection,
        concurrency: config.TASK_QUEUE_WORKER_CONCURRENCY,
      },
    )
  }

  async start(): Promise<void> {
    await this.writeHeartbeat()
    this.heartbeatTimer = setInterval(() => void this.writeHeartbeat(), 10_000)
    this.heartbeatTimer.unref?.()
    await this.queue.add(
      'generation-task-startup',
      { reason: 'startup' },
      {
        jobId: `startup-${process.pid}`,
        ...defaultJobOptions,
      },
    )
    await this.queue.add(
      'generation-task-poll',
      { reason: 'poll' },
      {
        jobId: 'generation-task-poll',
        repeat: { every: this.config.TASK_QUEUE_POLL_INTERVAL_MS },
        ...defaultJobOptions,
      },
    )
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    await this.worker.close()
    await this.queue.close()
    this.workerConnection.disconnect()
    this.queueConnection.disconnect()
  }

  private async writeHeartbeat(): Promise<void> {
    await this.queueConnection
      .set(
        workerHeartbeatKey(this.config.TASK_QUEUE_NAME),
        JSON.stringify({
          pid: process.pid,
          queueName: this.config.TASK_QUEUE_NAME,
          updatedAt: new Date().toISOString(),
        }),
        'PX',
        45_000,
      )
      .catch(() => {})
  }
}

export function createBullMqTaskDispatcher(config: AppConfig): BullMqTaskDispatcher {
  return new BullMqTaskDispatcher(config)
}

export function createBullMqGenerationWorker(
  config: AppConfig,
  runner: TaskQueueRunner,
): BullMqGenerationWorker {
  return new BullMqGenerationWorker(config, runner)
}

type IORedis = Redis

function redisConnection(redisUrl: string): IORedis {
  return new Redis(redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
  })
}

function safeJobIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 160)
}

function workerHeartbeatKey(queueName: string): string {
  return `seqora:queue:${safeJobIdPart(queueName)}:worker-heartbeat`
}

function parseWorkerHeartbeat(value: string | null): { pid: number; updatedAt: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { pid?: unknown; updatedAt?: unknown }
    if (typeof parsed.pid !== 'number' || typeof parsed.updatedAt !== 'string') return null
    if (!Number.isFinite(Date.parse(parsed.updatedAt))) return null
    return { pid: parsed.pid, updatedAt: parsed.updatedAt }
  } catch {
    return null
  }
}

function workerStatus(heartbeat: { updatedAt: string } | null): BullMqReadiness['worker'] {
  if (!heartbeat) return 'missing'
  return Date.now() - Date.parse(heartbeat.updatedAt) <= 30_000 ? 'ready' : 'stale'
}
