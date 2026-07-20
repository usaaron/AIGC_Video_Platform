import 'dotenv/config'
import { loadConfig } from './config.js'
import { logError, logInfo } from './core/logging.js'
import { BullMqGenerationWorker } from './core/jobs/bullmqQueue.js'
import {
  createAudioProvider,
  createImageProvider,
  createRuntimeObjectStorage,
  createStateStore,
  createTaskRunner,
  createVideoProvider,
} from './runtime.js'

const config = loadConfig()
if (config.TASK_QUEUE_DRIVER !== 'bullmq') {
  throw new Error('Worker requires TASK_QUEUE_DRIVER=bullmq. API processes only create and enqueue tasks.')
}

const store = createStateStore(config)
await store.initialize()

const objectStorage = createRuntimeObjectStorage(config)
const runner = createTaskRunner(
  config,
  store,
  objectStorage,
  createVideoProvider(config),
  createImageProvider(config),
  createAudioProvider(config),
)
const queueWorker = new BullMqGenerationWorker(config.REDIS_URL, runner, {
  concurrency: config.TASK_WORKER_CONCURRENCY,
  tickIntervalMs: config.TASK_QUEUE_TICK_INTERVAL_MS,
})

await queueWorker.start()
logInfo('worker.started', {
  queue: 'bullmq',
  concurrency: config.TASK_WORKER_CONCURRENCY,
  tickIntervalMs: config.TASK_QUEUE_TICK_INTERVAL_MS,
})

const shutdown = async (signal: string) => {
  logInfo('worker.shutdown', { signal })
  runner.stop()
  await queueWorker.close()
  await store.close?.()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('uncaughtException', (error) => {
  logError('worker.uncaught_exception', { message: error.message, stack: error.stack })
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  logError('worker.unhandled_rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
  process.exit(1)
})
