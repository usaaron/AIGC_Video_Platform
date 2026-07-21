import type { GenerationTask } from '@seqora/contracts'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { logError, logInfo } from '../logging.js'
import type { TaskDispatcher } from './taskDispatcher.js'
import type { GenerationTaskRunner } from './taskDispatcher.js'

const GENERATION_QUEUE_NAME = 'seqora:generation'
const TICK_JOB_ID = 'generation-tick'

type GenerationQueueJob = {
  reason: 'task-created' | 'tick'
  taskId: string | null
}

type BullMqWorkerOptions = {
  concurrency: number
  tickIntervalMs: number
}

export class BullMqTaskDispatcher implements TaskDispatcher {
  private readonly connection: Redis
  private readonly queue: Queue<GenerationQueueJob>

  constructor(redisUrl: string) {
    this.connection = createRedisConnection(redisUrl)
    this.queue = createGenerationQueue(this.connection)
  }

  async dispatch(task: GenerationTask): Promise<void> {
    await this.queue.add(
      'generation-task',
      { reason: 'task-created', taskId: task.id },
      {
        jobId: `generation-task-${task.id}-${task.updatedAt}`,
        removeOnComplete: true,
        removeOnFail: 1_000,
      },
    )
    logInfo('generation_task.enqueued', {
      taskId: task.id,
      status: task.status,
      projectId: task.projectId,
      tenantId: task.tenantId,
    })
  }

  async ping(): Promise<void> {
    await this.connection.ping()
  }

  async close(): Promise<void> {
    await this.queue.close()
    await this.connection.quit()
  }
}

export class BullMqGenerationWorker {
  private readonly queueConnection: Redis
  private readonly workerConnection: Redis
  private readonly queue: Queue<GenerationQueueJob>
  private worker: Worker<GenerationQueueJob> | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    redisUrl: string,
    private readonly runner: GenerationTaskRunner,
    private readonly options: BullMqWorkerOptions,
  ) {
    this.queueConnection = createRedisConnection(redisUrl)
    this.workerConnection = createRedisConnection(redisUrl)
    this.queue = createGenerationQueue(this.queueConnection)
  }

  async start(): Promise<void> {
    if (this.worker) return

    this.worker = new Worker<GenerationQueueJob>(
      GENERATION_QUEUE_NAME,
      async (job) => {
        logInfo('generation_job.started', {
          jobId: job.id,
          reason: job.data.reason,
          taskId: job.data.taskId,
        })
        await this.runner.tick()
      },
      {
        connection: this.workerConnection,
        concurrency: this.options.concurrency,
      },
    )
    this.worker.on('completed', (job) => {
      logInfo('generation_job.completed', {
        jobId: job.id,
        reason: job.data.reason,
        taskId: job.data.taskId,
      })
    })
    this.worker.on('failed', (job, error) => {
      logError('generation_job.failed', {
        jobId: job?.id,
        reason: job?.data.reason,
        taskId: job?.data.taskId,
        message: error.message,
        stack: error.stack,
      })
    })
    this.worker.on('error', (error) => {
      logError('generation_worker.error', { message: error.message, stack: error.stack })
    })
    this.timer = setInterval(() => void this.enqueueTick(), this.options.tickIntervalMs)
    await this.enqueueTick()
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.worker?.close()
    this.worker = null
    await this.queue.close()
    await this.queueConnection.quit()
    await this.workerConnection.quit()
  }

  private async enqueueTick(): Promise<void> {
    await this.queue.add(
      'generation-tick',
      { reason: 'tick', taskId: null },
      { jobId: TICK_JOB_ID, removeOnComplete: true, removeOnFail: true },
    )
  }
}

function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null })
}

function createGenerationQueue(connection: Redis): Queue<GenerationQueueJob> {
  return new Queue<GenerationQueueJob>(GENERATION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: true,
      removeOnFail: 1_000,
    },
  })
}
