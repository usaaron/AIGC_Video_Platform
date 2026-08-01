import type { AppConfig } from '../../config.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { RuntimeQueues } from '../../runtime/queues.js'

export type ReadinessStatus = 'ready' | 'disabled' | 'error' | 'missing' | 'stale' | 'unknown'

export type ComponentReadiness = {
  status: ReadinessStatus
  latencyMs: number | null
  error: string | null
}

export type RuntimeReadiness = {
  ready: boolean
  generatedAt: string
  database: ComponentReadiness
  redis: ComponentReadiness
  queue: ComponentReadiness & {
    driver: AppConfig['TASK_QUEUE_DRIVER']
    name: string
    counts: Record<string, number>
  }
  worker: ComponentReadiness & {
    heartbeat: {
      pid: number | null
      updatedAt: string | null
      ageMs: number | null
    }
  }
}

export async function readRuntimeReadiness(input: {
  config: AppConfig
  database: AccountDatabase | null
  queues: RuntimeQueues
  inlineWorkersStarted: boolean
}): Promise<RuntimeReadiness> {
  const database = await databaseReadiness(input.database)
  const queue = await queueReadiness(input)
  const redis = queue.redis
  const worker = queue.worker
  const ready =
    componentReady(database) && componentReady(redis) && componentReady(queue.queue) && componentReady(worker)

  return {
    ready,
    generatedAt: new Date().toISOString(),
    database,
    redis,
    queue: queue.queue,
    worker,
  }
}

async function databaseReadiness(database: AccountDatabase | null): Promise<ComponentReadiness> {
  if (!database) return disabled()
  const startedAt = Date.now()
  try {
    await database.query('SELECT 1')
    return { status: 'ready', latencyMs: Date.now() - startedAt, error: null }
  } catch (error) {
    return { status: 'error', latencyMs: Date.now() - startedAt, error: messageFor(error) }
  }
}

async function queueReadiness(input: {
  config: AppConfig
  queues: RuntimeQueues
  inlineWorkersStarted: boolean
}): Promise<{
  redis: ComponentReadiness
  queue: RuntimeReadiness['queue']
  worker: RuntimeReadiness['worker']
}> {
  if (input.config.TASK_QUEUE_DRIVER === 'none') {
    return {
      redis: disabled(),
      queue: queueComponent(input.config, 'disabled', {}, null),
      worker: workerComponent('disabled', null, null),
    }
  }

  if (input.config.TASK_QUEUE_DRIVER === 'inline') {
    return {
      redis: disabled(),
      queue: queueComponent(input.config, 'ready', {}, null),
      worker: workerComponent(input.inlineWorkersStarted ? 'ready' : 'missing', null, null),
    }
  }

  if (!input.queues.bullMqDispatcher) {
    return {
      redis: { status: 'unknown', latencyMs: null, error: 'BullMQ dispatcher is not initialized' },
      queue: queueComponent(input.config, 'unknown', {}, 'BullMQ dispatcher is not initialized'),
      worker: workerComponent('unknown', null, 'BullMQ dispatcher is not initialized'),
    }
  }

  const startedAt = Date.now()
  const readiness = await input.queues.bullMqDispatcher.readiness()
  const latencyMs = Date.now() - startedAt
  return {
    redis: { status: readiness.redis, latencyMs, error: readiness.error },
    queue: queueComponent(input.config, readiness.queue, readiness.counts, readiness.error, latencyMs),
    worker: workerComponent(readiness.worker, readiness.workerHeartbeat, readiness.error, latencyMs),
  }
}

function queueComponent(
  config: AppConfig,
  status: ReadinessStatus,
  counts: Record<string, number>,
  error: string | null,
  latencyMs: number | null = null,
): RuntimeReadiness['queue'] {
  return {
    status,
    latencyMs,
    error,
    driver: config.TASK_QUEUE_DRIVER,
    name: config.TASK_QUEUE_NAME,
    counts,
  }
}

function workerComponent(
  status: ReadinessStatus,
  heartbeat: RuntimeReadiness['worker']['heartbeat'] | null,
  error: string | null,
  latencyMs: number | null = null,
): RuntimeReadiness['worker'] {
  return {
    status,
    latencyMs,
    error,
    heartbeat: heartbeat ?? { pid: null, updatedAt: null, ageMs: null },
  }
}

function disabled(): ComponentReadiness {
  return { status: 'disabled', latencyMs: null, error: null }
}

function componentReady(component: ComponentReadiness): boolean {
  return component.status === 'ready' || component.status === 'disabled'
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
