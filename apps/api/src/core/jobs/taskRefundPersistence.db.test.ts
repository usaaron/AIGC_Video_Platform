import type { Principal } from '@seqora/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { StoreCreditLedger } from '../../modules/billing/creditLedger.js'
import { GenerationTaskRepository } from '../../modules/generation/repository.js'
import { ProjectRepository } from '../../modules/projects/repository.js'
import { UserRepository } from '../../modules/users/repository.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { GenerationTaskRunner } from './taskDispatcher.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
let fixture: PostgresAuthFixture
beforeAll(async () => {
  fixture = await startPostgresAuthFixture()
}, 120_000)
beforeEach(async () => {
  await fixture.reset()
})
afterAll(async () => {
  await fixture.close()
})

describe('Postgres video refund persistence', () => {
  it.each(['periodic', 'upstream-failed'] as const)(
    'persists %s refunds across a new worker without a second ledger entry',
    async (mode) => {
      const database = new AccountDatabase(fixture.connectionString)
      try {
        const store = new AppStore(null)
        await store.initialize()
        const users = new UserRepository(store, database)
        await users.bootstrapFromStore()
        await new ProjectRepository(store, database).importFromStore()
        const ledger = new StoreCreditLedger(store, users, false, database)
        await ledger.bootstrapFromStore()
        const tasks = new GenerationTaskRepository(store, ledger, database)
        const initial = await ledger.billingSummary(principal)
        const task = await tasks.createWithCharge(
          {
            clientRequestId: `refund-${mode}`,
            projectId: 'project-midnight-film',
            kind: 'video',
            label: '退款持久性回归',
            prompt: '测试假provider',
            negativePrompt: '',
            provider: 'seedance',
            model: null,
            estimatedCredits: 18,
            metadata: { duration: 5, aspectRatio: '16:9', resolution: '720p' },
          },
          principal,
        )
        if (mode === 'periodic') {
          await database.query(
            "UPDATE generation_tasks SET status='failed', progress=100, error='上游失败', updated_at=now() WHERE id=$1",
            [task.id],
          )
        }
        await tasks.refreshRuntimeCacheFromDatabase({ activeOnly: true })
        const provider: VideoGenerationProvider = {
          submit: vi.fn(async () => ({
            providerTaskId: 'remote-refund-test',
            status: 'queued',
            progress: 0,
          })),
          getStatus: vi.fn(async () => ({
            status: 'failed',
            progress: 100,
            error: '上游视频生成失败',
            failureCode: 'UPSTREAM_FAILED',
            providerStatus: 'failed',
          })),
          getContent: vi.fn(),
        }
        const runner = makeRunner(store, tasks, ledger, provider)
        await runner.tick()
        if (mode === 'upstream-failed') {
          await vi.waitFor(() => expect(provider.submit).toHaveBeenCalledOnce())
          await runner.tick()
        }
        await vi.waitFor(async () => {
          const row = await database.query<{ status: string; metadata: Record<string, unknown> }>(
            'SELECT status,metadata FROM generation_tasks WHERE id=$1',
            [task.id],
          )
          expect(row.rows[0]).toMatchObject({
            status: 'failed',
            metadata: { creditsRefundedAt: expect.any(String) },
          })
        })
        expect((await ledger.billingSummary(principal)).credits).toBe(initial.credits)

        const restartedStore = new AppStore(null)
        await restartedStore.initialize()
        const restartedTasks = new GenerationTaskRepository(restartedStore, ledger, database)
        await restartedTasks.refreshRuntimeCacheFromDatabase({ activeOnly: true })
        expect(restartedStore.read((state) => state.tasks.some((item) => item.id === task.id))).toBe(false)
        await makeRunner(restartedStore, restartedTasks, ledger, provider).tick()
        const summary = await ledger.billingSummary(principal)
        expect(summary.credits).toBe(initial.credits)
        expect(summary.entries.filter((entry) => entry.id === `refund-${task.id}`)).toHaveLength(1)
      } finally {
        await database.close()
      }
    },
  )
})

function makeRunner(
  store: AppStore,
  tasks: GenerationTaskRepository,
  creditLedger: StoreCreditLedger,
  videoProvider: VideoGenerationProvider,
) {
  return new GenerationTaskRunner(store, {
    videoProvider,
    videoProviderName: 'dora-router-seedance',
    providerPollIntervalMs: 0,
    creditLedger,
    persistTickTasks: (ids) => tasks.flushRuntimeTasksToDatabase(ids).then(() => {}),
    persistTask: (id) => tasks.flushRuntimeTaskToDatabase(id).then(() => {}),
    refreshTask: (id) => tasks.refreshRuntimeTaskFromDatabase(id).then(() => {}),
  })
}
