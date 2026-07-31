import type { GenerationTask } from '@seqora/contracts'
import { Queue, Worker, type JobsOptions } from 'bullmq'
import { Redis } from 'ioredis'
import type { AppConfig } from '../../config.js'
import type { TaskDispatcher } from './taskDispatcher.js'
import type { GenerationTaskRunner } from './taskDispatcher.js'

type GenerationQueueJob = {
  reason: 'task-dispatch' | 'startup' | 'poll'
  taskId?: string
  tenantId?: string
}

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800, count: 5_000 },
}

export class BullMqTaskDispatcher implements TaskDispatcher {
  private readonly connection: IORedis
  private readonly queue: Queue<GenerationQueueJob>

  constructor(config: AppConfig) {
    this.connection = redisConnection(config.REDIS_URL)
    this.queue = new Queue<GenerationQueueJob>(config.TASK_QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions,
    })
  }

  async dispatch(task: GenerationTask): Promise<void> {
    try {
      await this.queue.add(
        'generation-task',
        { reason: 'task-dispatch', taskId: task.id, tenantId: task.tenantId },
        {
          jobId: `task-${safeJobIdPart(task.id)}-${safeJobIdPart(task.updatedAt)}`,
          ...defaultJobOptions,
        },
      )
    } catch (error) {
      process.emitWarning(
        `Failed to enqueue generation task ${task.id}: ${error instanceof Error ? error.message : String(error)}`,
        { code: 'SEQORA_TASK_QUEUE_ENQUEUE_FAILED' },
      )
    }
  }

  async waitUntilReady(): Promise<void> {
    await this.queue.waitUntilReady()
  }

  async close(): Promise<void> {
    await this.queue.close()
    this.connection.disconnect()
  }
}

export class BullMqGenerationWorker {
  private readonly queueConnection: IORedis
  private readonly workerConnection: IORedis
  private readonly queue: Queue<GenerationQueueJob>
  private readonly worker: Worker<GenerationQueueJob>

  constructor(
    private readonly config: AppConfig,
    private readonly runner: GenerationTaskRunner,
  ) {
    this.queueConnection = redisConnection(config.REDIS_URL)
    this.workerConnection = redisConnection(config.REDIS_URL)
    this.queue = new Queue<GenerationQueueJob>(config.TASK_QUEUE_NAME, {
      connection: this.queueConnection,
      defaultJobOptions,
    })
    this.worker = new Worker<GenerationQueueJob>(
      config.TASK_QUEUE_NAME,
      async () => {
        await this.runner.tick()
      },
      {
        connection: this.workerConnection,
        concurrency: config.TASK_QUEUE_WORKER_CONCURRENCY,
      },
    )
  }

  async start(): Promise<void> {
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
    await this.worker.close()
    await this.queue.close()
    this.workerConnection.disconnect()
    this.queueConnection.disconnect()
  }
}

export function createBullMqTaskDispatcher(config: AppConfig): BullMqTaskDispatcher {
  return new BullMqTaskDispatcher(config)
}

export function createBullMqGenerationWorker(
  config: AppConfig,
  runner: GenerationTaskRunner,
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
