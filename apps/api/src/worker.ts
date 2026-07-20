import 'dotenv/config'
import { loadConfig } from './config.js'
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
const queueWorker =
  config.TASK_QUEUE_DRIVER === 'bullmq'
    ? new BullMqGenerationWorker(config.REDIS_URL, runner, {
        concurrency: config.TASK_WORKER_CONCURRENCY,
        tickIntervalMs: config.TASK_QUEUE_TICK_INTERVAL_MS,
      })
    : null

if (queueWorker) {
  await queueWorker.start()
  process.stdout.write('Seqora worker started with BullMQ\n')
} else {
  runner.start()
  process.stdout.write('Seqora worker started with inline polling\n')
}

const shutdown = async (signal: string) => {
  process.stdout.write(`Seqora worker shutting down: ${signal}\n`)
  runner.stop()
  await queueWorker?.close()
  await store.close?.()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
