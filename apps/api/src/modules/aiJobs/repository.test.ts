import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { ProjectRepository } from '../projects/repository.js'
import { UserRepository } from '../users/repository.js'
import { AiJobRepository } from './repository.js'
import { AiJobRunner, type AiJobHandler } from '../../core/jobs/aiJobRunner.js'

const principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
} as const

let postgres: PostgresAuthFixture | undefined

beforeAll(async () => {
  postgres = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await postgres?.reset()
})

afterAll(async () => {
  await postgres?.close()
})

describe('AiJobRepository postgres lifecycle', { timeout: 30_000 }, () => {
  it('claims jobs with a postgres lease so another worker cannot take the same job', async () => {
    const { database, repository } = await createRepository()
    try {
      const job = await repository.createWithCharge(
        {
          clientRequestId: 'postgres-ai-job-claim',
          projectId: 'project-midnight-film',
          kind: 'novel.summaryQueueBatch',
          label: 'Novel summary queue',
          provider: 'text',
          input: { queueId: 'queue-1' },
          costCredits: 0,
        },
        principal,
        { traceId: 'trace-ai-job-claim' },
      )

      const claimed = await repository.claimReadyJobs({
        ownerId: 'worker-a',
        leaseTtlMs: 60_000,
        limit: 1,
      })
      const duplicateClaim = await repository.claimReadyJobs({
        ownerId: 'worker-b',
        leaseTtlMs: 60_000,
        limit: 1,
      })

      expect(claimed).toHaveLength(1)
      expect(claimed[0]).toMatchObject({
        id: job.id,
        status: 'running',
        attempts: 1,
        leaseOwnerId: 'worker-a',
        leaseToken: expect.any(String),
        input: { queueId: 'queue-1', traceId: 'trace-ai-job-claim' },
      })
      expect(duplicateClaim).toEqual([])

      await repository.complete(job.id, 'worker-a', claimed[0]!.leaseToken!, { ok: true })

      const persisted = await database.query<{
        status: string
        output: { ok?: boolean } | null
        lease_owner_id: string | null
      }>('SELECT status, output, lease_owner_id FROM ai_jobs WHERE id = $1', [job.id])
      expect(persisted.rows[0]).toEqual({
        status: 'completed',
        output: { ok: true },
        lease_owner_id: null,
      })
    } finally {
      await database.close()
    }
  })

  it('refunds failed postgres AI jobs without reading users from JSON Store', async () => {
    const { database, repository } = await createRepository()
    try {
      const job = await repository.createWithCharge(
        {
          clientRequestId: 'postgres-ai-job-failure',
          projectId: 'project-midnight-film',
          kind: 'novel.summaryQueueBatch',
          label: 'Novel summary queue',
          provider: 'text',
          input: { queueId: 'queue-1' },
          costCredits: 4,
        },
        principal,
        { traceId: 'trace-ai-job-failure' },
      )
      const [claimed] = await repository.claimReadyJobs({
        ownerId: 'worker-a',
        leaseTtlMs: 60_000,
        limit: 1,
      })

      await repository.fail(job.id, 'worker-a', claimed!.leaseToken!, 'provider down')

      const persisted = await database.query<{
        status: string
        refunded_at: string | null
        credits: number
        refund_count: string
      }>(
        `
        SELECT
          j.status,
          j.refunded_at::text AS refunded_at,
          b.credits,
          (
            SELECT count(*)::text
            FROM billing_ledger_entries
            WHERE id = 'refund-postgres-ai-job-failure'
          ) AS refund_count
        FROM ai_jobs j
        JOIN tenant_memberships m ON m.user_id = j.user_id AND m.tenant_id = j.tenant_id
        JOIN billing_accounts b ON b.membership_id = m.id
        WHERE j.id = $1
        `,
        [job.id],
      )
      expect(persisted.rows[0]).toMatchObject({
        status: 'failed',
        refunded_at: expect.any(String),
        credits: 286,
        refund_count: '1',
      })
    } finally {
      await database.close()
    }
  })

  it('recovers expired running postgres AI jobs after a restart and writes the result back to Postgres', async () => {
    const { database, repository } = await createRepository()
    try {
      const job = await repository.createWithCharge(
        {
          clientRequestId: 'postgres-ai-job-recovery',
          projectId: 'project-midnight-film',
          kind: 'novel.summaryQueueBatch',
          label: 'Novel summary queue',
          provider: 'text',
          input: { queueId: 'queue-1' },
          costCredits: 0,
        },
        principal,
      )
      const [claimed] = await repository.claimReadyJobs({
        ownerId: 'worker-a',
        leaseTtlMs: 60_000,
        limit: 1,
      })
      expect(claimed?.id).toBe(job.id)

      await database.query(
        `
        UPDATE ai_jobs
        SET lease_expires_at = now() - interval '1 second',
            lease_heartbeat_at = now() - interval '1 second'
        WHERE id = $1
        `,
        [job.id],
      )

      const handler: AiJobHandler = {
        canHandle: vi.fn((candidate) => candidate.kind === 'novel.summaryQueueBatch'),
        execute: vi.fn(async () => ({ output: { recovered: true } })),
      }
      const runner = new AiJobRunner(repository, { handler, leaseTtlMs: 60_000 })

      await runner.recoverInterrupted()
      await vi.waitFor(() => expect(handler.execute).toHaveBeenCalledOnce())

      await vi.waitFor(async () => {
        const persisted = await database.query<{
          status: string
          output: { recovered?: boolean } | null
          lease_owner_id: string | null
        }>('SELECT status, output, lease_owner_id FROM ai_jobs WHERE id = $1', [job.id])
        expect(persisted.rows[0]).toEqual({
          status: 'completed',
          output: { recovered: true },
          lease_owner_id: null,
        })
      })

      const recoveredStore = new AppStore(null)
      await recoveredStore.initialize()
      const recoveredRepository = new AiJobRepository(recoveredStore, null, database)
      await recoveredRepository.refreshRuntimeCacheFromDatabase()
      expect(recoveredStore.read((state) => state.aiJobs.find((item) => item.id === job.id))).toMatchObject({
        status: 'completed',
        output: { recovered: true },
        leaseOwnerId: null,
      })
    } finally {
      await database.close()
    }
  })
})

async function createRepository(): Promise<{
  database: AccountDatabase
  repository: AiJobRepository
}> {
  if (!postgres) throw new Error('Postgres fixture is not ready')
  const store = new AppStore(null)
  await store.initialize()
  const database = new AccountDatabase(postgres.connectionString)
  const users = new UserRepository(store, database)
  await users.bootstrapFromStore()
  const projects = new ProjectRepository(store, database)
  await projects.importFromStore()
  const repository = new AiJobRepository(store, null, database)
  await repository.refreshRuntimeCacheFromDatabase()
  return { database, repository }
}
