import type { GenerationTask } from '@seqora/contracts'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { Redis } from 'ioredis'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../../config.js'
import {
  createBullMqGenerationWorker,
  createBullMqTaskDispatcher,
  type TaskQueueRunner,
} from './bullMqQueue.js'

const execFileAsync = promisify(execFile)
const redisImage = 'redis:7-alpine'
const redisContainers = new Set<string>()

afterAll(async () => {
  await Promise.all([...redisContainers].map((name) => execFileAsync('docker', ['rm', '-f', name])))
})

describe('BullMQ task queue', { timeout: 60_000 }, () => {
  it('dispatches generation task triggers through Redis to the worker', async () => {
    const redisUrl = await redisUrlForTest()
    const queueName = `seqora-generation-test-${randomUUID()}`
    const config = loadConfig({
      NODE_ENV: 'test',
      TASK_QUEUE_DRIVER: 'bullmq',
      TASK_QUEUE_NAME: queueName,
      TASK_QUEUE_WORKER_CONCURRENCY: '1',
      TASK_QUEUE_POLL_INTERVAL_MS: '60000',
      REDIS_URL: redisUrl,
    })
    const tick = vi.fn(async () => {})
    const worker = createBullMqGenerationWorker(config, { tick } as unknown as TaskQueueRunner)
    const dispatcher = createBullMqTaskDispatcher(config)

    try {
      await dispatcher.dispatch(taskFixture())
      await waitFor(() => tick.mock.calls.length > 0)
      expect(tick).toHaveBeenCalled()
    } finally {
      await dispatcher.close()
      await worker.close()
    }
  })
})

async function redisUrlForTest(): Promise<string> {
  const configuredRedisUrl = process.env.TEST_REDIS_URL?.trim()
  if (configuredRedisUrl) {
    await waitForRedis(configuredRedisUrl)
    return configuredRedisUrl
  }
  return startRedisFixture()
}

async function startRedisFixture(): Promise<string> {
  const containerName = `seqora-redis-${process.pid}-${randomUUID()}`
  redisContainers.add(containerName)
  await execFileAsync('docker', ['run', '--rm', '-d', '--name', containerName, '-P', redisImage])
  const { stdout } = await execFileAsync('docker', ['port', containerName, '6379/tcp'])
  const port = parsePublishedPort(stdout)
  const redisUrl = `redis://127.0.0.1:${port}`
  await waitForRedis(redisUrl)
  return redisUrl
}

async function waitForRedis(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        await redis.ping()
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    throw new Error('Redis test fixture did not become ready')
  } finally {
    redis.disconnect()
  }
}

function parsePublishedPort(output: string): string {
  const match = output.match(/:(\d+)\s*$/m)
  if (!match?.[1]) throw new Error(`Could not parse Redis published port: ${output}`)
  return match[1]
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for BullMQ job')
}

function taskFixture(): GenerationTask {
  const now = new Date().toISOString()
  return {
    id: `task-${randomUUID()}`,
    clientRequestId: 'bullmq-dispatch-test',
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind: 'image',
    label: 'BullMQ dispatch test',
    prompt: '',
    negativePrompt: '',
    provider: 'img2',
    model: null,
    tier: null,
    metadata: {},
    status: 'queued',
    progress: 0,
    estimatedCredits: 1,
    attempts: 0,
    maxAttempts: 3,
    leaseOwnerId: null,
    leaseToken: null,
    leaseAcquiredAt: null,
    leaseHeartbeatAt: null,
    leaseExpiresAt: null,
    resultUrl: null,
    outputs: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  }
}
