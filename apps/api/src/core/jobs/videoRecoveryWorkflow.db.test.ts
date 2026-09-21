import { Readable } from 'node:stream'
import type { Principal } from '@seqora/contracts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { StoreCreditLedger } from '../../modules/billing/creditLedger.js'
import { GenerationTaskRepository } from '../../modules/generation/repository.js'
import { PostgresVideoRecoveryRepository } from '../../modules/generation/recoveryRepository.js'
import { ProjectRepository } from '../../modules/projects/repository.js'
import { UserRepository } from '../../modules/users/repository.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { GenerationTaskRunner } from './taskDispatcher.js'
import { VideoResultReconciler } from './videoResultReconciler.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
let fixture: PostgresAuthFixture
beforeAll(async () => {
  fixture = await startPostgresAuthFixture()
}, 120_000)
afterAll(async () => {
  await fixture?.close()
})

describe('video timeout to automatic recovery workflow', () => {
  it('refunds a timed out remote, survives worker restart, and automatically attaches its late result without submitting or charging again', async () => {
    const database = new AccountDatabase(fixture.connectionString)
    try {
      const store = new AppStore(null)
      await store.initialize()
      const users = new UserRepository(store, database)
      await users.bootstrapFromStore()
      await new ProjectRepository(store, database).importFromStore()
      await database.query(
        "UPDATE shots SET updated_at = now() - interval '1 day', selected_video_task_id = NULL WHERE id = 'shot-1'",
      )
      const ledger = new StoreCreditLedger(store, users, false, database)
      await ledger.bootstrapFromStore()
      const initialCredits = (await ledger.billingSummary(principal)).credits
      const tasks = new GenerationTaskRepository(store, ledger, database)
      const task = await tasks.createWithCharge(
        {
          clientRequestId: 'automatic-recovery-workflow',
          projectId: 'project-midnight-film',
          kind: 'video',
          label: '超时后自动接回结果',
          prompt: '隔离测试，不调用真实模型',
          negativePrompt: '',
          provider: 'seedance',
          model: 'doubao-seedance-2-0-260128',
          estimatedCredits: 18,
          metadata: { shotId: 'shot-1', duration: 5 },
        },
        principal,
      )
      expect((await ledger.billingSummary(principal)).credits).toBe(initialCredits - 18)

      const old = new Date(Date.now() - 31 * 60_000).toISOString()
      await database.query(
        `UPDATE generation_tasks SET status='running', progress=50, attempts=1,
        metadata = metadata || $2::jsonb WHERE id=$1`,
        [
          task.id,
          JSON.stringify({
            providerName: 'dora-router-seedance',
            providerTaskId: 'already-submitted-remote',
            providerSubmittedAt: old,
            providerProgressChangedAt: old,
            providerPolledAt: 0,
          }),
        ],
      )
      await tasks.refreshRuntimeCacheFromDatabase({ activeOnly: true })

      const videoBytes = Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from('ftypisom'),
        Buffer.alloc(32),
      ])
      const tailBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)])
      const provider: VideoGenerationProvider = {
        submit: vi.fn(async () => {
          throw new Error('A known remote must never be submitted again')
        }),
        getStatus: vi.fn(async () => ({
          status: 'running',
          progress: 50,
          progressIsEstimated: true,
          error: null,
        })),
        getContent: vi.fn(async () => media(videoBytes, 'video/mp4')),
        getLastFrameContent: vi.fn(async () => media(tailBytes, 'image/jpeg')),
      }
      await runnerFor(store, tasks, ledger, provider).tick()
      const timedOut = await tasks.findById(task.id, principal)
      expect(timedOut).toMatchObject({
        status: 'failed',
        attempts: 1,
        leaseToken: null,
        metadata: {
          providerTaskId: 'already-submitted-remote',
          creditsRefundedAt: expect.any(String),
          providerReconciliationReason: 'processing_timeout',
          providerReconciliationStatus: 'pending',
          providerReconciliationNextPollAt: expect.any(String),
          providerReconciliationExpiresAt: expect.any(String),
        },
      })
      const refundedAt = timedOut!.metadata.creditsRefundedAt
      const refundedLedger = await ledger.billingSummary(principal)
      expect(refundedLedger.credits).toBe(initialCredits)
      expect(refundedLedger.entries.filter((entry) => entry.id === `refund-${task.id}`)).toHaveLength(1)
      expect(provider.getStatus).toHaveBeenCalledWith('already-submitted-remote')
      expect(provider.submit).not.toHaveBeenCalled()

      // A fresh ordinary worker excludes the refunded terminal task. The independent
      // reconciler must discover its persisted metadata and receipt from Postgres.
      const restartedStore = new AppStore(null)
      await restartedStore.initialize()
      const restartedTasks = new GenerationTaskRepository(restartedStore, ledger, database)
      await restartedTasks.refreshRuntimeCacheFromDatabase({ activeOnly: true })
      expect(restartedStore.read((state) => state.tasks.some((item) => item.id === task.id))).toBe(false)
      await runnerFor(restartedStore, restartedTasks, ledger, provider).tick()
      vi.mocked(provider.getStatus).mockResolvedValue({ status: 'completed', progress: 100, error: null })
      const files = new Map<string, Buffer>()
      const storage: ObjectStorage = {
        put: vi.fn(async (key, bytes) => {
          files.set(key, Buffer.from(bytes))
        }),
        get: vi.fn(async (key) => files.get(key) ?? Buffer.alloc(0)),
        delete: vi.fn(async () => {}),
      }
      const recoveryNow = new Date(
        Date.parse(String(timedOut!.metadata.providerReconciliationNextPollAt)) + 1_000,
      )
      const reconciler = new VideoResultReconciler(
        new PostgresVideoRecoveryRepository(database),
        provider,
        storage,
        () => recoveryNow,
      )
      await reconciler.tick()

      const recovered = await restartedTasks.findById(task.id, principal)
      expect(recovered).toMatchObject({
        status: 'completed',
        attempts: 1,
        progress: 100,
        error: null,
        resultUrl: `/api/v1/generation/tasks/${task.id}/content`,
        outputs: [
          expect.objectContaining({ mediaType: 'video' }),
          expect.objectContaining({ view: 'last-frame' }),
        ],
        metadata: {
          providerTaskId: 'already-submitted-remote',
          providerReconciliationStatus: 'completed',
          providerReconciliationHistoryOnly: false,
          creditsRefundedAt: refundedAt,
        },
      })
      const shot = await database.query('SELECT selected_video_task_id FROM shots WHERE id=$1', ['shot-1'])
      expect(shot.rows[0]?.selected_video_task_id).toBe(task.id)
      expect(files.size).toBe(2)
      expect([...files.values()]).toEqual(expect.arrayContaining([videoBytes, tailBytes]))
      expect(provider.getContent).toHaveBeenCalledWith('already-submitted-remote')
      expect(provider.getLastFrameContent).toHaveBeenCalledWith('already-submitted-remote')
      const reads = vi.mocked(provider.getStatus).mock.calls.length
      await reconciler.tick()
      expect(provider.getStatus).toHaveBeenCalledTimes(reads)
      expect(provider.submit).not.toHaveBeenCalled()
      const finalLedger = await ledger.billingSummary(principal)
      expect(finalLedger.credits).toBe(initialCredits)
      expect(finalLedger.entries).toEqual(refundedLedger.entries)
      const audits = await database.query(
        "SELECT action FROM audit_log_entries WHERE resource_id=$1 AND action='generation.remote_result_reconciled'",
        [task.id],
      )
      expect(audits.rows).toHaveLength(1)
    } finally {
      await database.close()
      // pg-pool resolves end() after sending Terminate. Drain the socket close
      // callbacks before the fixture drops its isolated database with FORCE.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }, 30_000)
})

function runnerFor(
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

function media(bytes: Buffer, contentType: string) {
  return {
    stream: Readable.from(bytes),
    contentType,
    statusCode: 200,
    contentLength: String(bytes.length),
    acceptRanges: null,
    contentRange: null,
  }
}
