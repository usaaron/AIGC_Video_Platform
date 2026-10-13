import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { loadConfig } from '../../config.js'
import { GenerationTaskRunner } from '../../core/jobs/taskDispatcher.js'
import { AppStore } from '../../infra/store.js'

describe('video provider availability', () => {
  it('rejects missing-provider requests before creating a task or charging credits', async () => {
    const store = new AppStore(null)
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: '', TASK_QUEUE_DRIVER: 'inline' })
    const app = await buildApp({ config, store, videoProvider: null, startWorker: false })
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: config.BOOTSTRAP_OWNER_EMAIL,
          password: config.BOOTSTRAP_OWNER_PASSWORD,
        },
      })
      expect(login.statusCode).toBe(200)
      const cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join('; ')
      const before = store.read((state) => ({ tasks: state.tasks, ledger: state.ledger, users: state.users }))
      const result = await app.inject({
        method: 'POST',
        url: '/api/v1/generation/tasks',
        headers: { cookie },
        payload: {
          projectId: 'project-midnight-film',
          clientRequestId: 'video-unconfigured',
          kind: 'video',
          provider: 'seedance',
          label: 'Missing video provider',
          prompt: 'A quiet river',
          estimatedCredits: 18,
        },
      })
      expect(result.statusCode).toBe(503)
      expect(result.json().error.code).toBe('SEEDANCE_NOT_CONFIGURED')
      expect(
        store.read((state) => ({ tasks: state.tasks, ledger: state.ledger, users: state.users })),
      ).toEqual(before)
      const health = await app.inject({ method: 'GET', url: '/api/v1/health' })
      expect(health.json().providers.seedance).toBe('unavailable')
    } finally {
      await app.close()
    }
  })

  it.each(['queued', 'running'] as const)(
    'fails a legacy %s video without producing demo media and refunds once',
    async (status) => {
      const store = new AppStore(null)
      await store.initialize()
      const now = new Date().toISOString()
      const task: GenerationTask = {
        id: 'missing-video',
        clientRequestId: 'missing-video-request',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        userId: 'user-member',
        kind: 'video',
        provider: 'seedance',
        label: 'Missing video',
        prompt: 'river',
        negativePrompt: '',
        model: null,
        metadata: {},
        status,
        progress: 0,
        estimatedCredits: 18,
        createdAt: now,
        updatedAt: now,
        resultUrl: null,
        outputs: [],
        error: null,
      }
      await store.mutate((state) => {
        state.tasks = [task]
        state.users.find((user) => user.id === task.userId)!.credits = 82
        state.ledger = [
          {
            id: 'generation-' + task.clientRequestId,
            userId: task.userId,
            tenantId: task.tenantId,
            amount: -18,
            balance: 82,
            type: 'generation',
            description: task.label,
            createdAt: now,
          },
        ]
      })
      const shotsBefore = store.read((state) => state.shots)
      const runner = new GenerationTaskRunner(store)
      await runner.tick()
      await runner.tick()
      const state = store.read((state) => state)
      expect(state.tasks[0]).toMatchObject({
        status: 'failed',
        outputs: [],
        resultUrl: null,
        leaseOwnerId: null,
      })
      expect(state.tasks[0]!.error).toContain('视频生成服务尚未配置')
      expect(state.ledger.filter((entry) => entry.id === 'refund-' + task.id)).toHaveLength(1)
      expect(state.users.find((user) => user.id === task.userId)!.credits).toBe(100)
      expect(state.shots).toEqual(shotsBefore)
    },
  )
})
