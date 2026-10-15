import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AccountDatabase } from '../../infra/postgres.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { GenerationTaskRepository } from '../generation/repository.js'
import {
  setupTextWriteGuard,
  textWritePrincipal as principal,
} from '../projects/textTaskWriteGuard.fixture.js'
import { UserRepository } from '../users/repository.js'
import { StoreCreditLedger } from './creditLedger.js'
import { preemptActiveScriptTasksInDatabase } from '../generation/scriptTaskPolicy.js'
import { textTaskCancellationMatches } from '../../core/jobs/textTaskCancellation.js'

let fixture: PostgresAuthFixture
let database: AccountDatabase
beforeAll(async () => {
  fixture = await startPostgresAuthFixture()
  database = new AccountDatabase(fixture.connectionString)
}, 120_000)
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await database?.close()
  await fixture?.close()
})

async function setup() {
  const f = await setupTextWriteGuard(database)
  const ledger = new StoreCreditLedger(f.store, new UserRepository(f.store, database), false, database)
  await ledger.bootstrapFromStore()
  const before = (await ledger.summary(principal)).credits
  const reference = `script-generate-${f.task.clientRequestId}`
  await ledger.reserve(principal, 3, reference, 'Text reservation')
  const tasks = new GenerationTaskRepository(f.store, null, database)
  const refund = () => ledger.refundReservation(principal, reference, 'Text refund', undefined, f.guard)
  return { ...f, ledger, before, reference, tasks, refund }
}

async function waitForBlockedQuery(fragment: string) {
  await expect
    .poll(
      async () => {
        const result = await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()
       AND wait_event_type = 'Lock' AND query LIKE $1`,
          [`%${fragment}%`],
        )
        return Number(result.rows[0]!.count)
      },
      { timeout: 5000, interval: 20 },
    )
    .toBeGreaterThan(0)
}

describe('PostgreSQL text task reservation refunds', () => {
  it('retains the original execution proof during automatic script preemption', async () => {
    const f = await setup()
    await database.query('UPDATE generation_tasks SET metadata = metadata || $2::jsonb WHERE id = $1', [
      f.task.id,
      JSON.stringify({ generationStage: 'script-generate' }),
    ])
    const cancelled = await database.transaction((client) =>
      preemptActiveScriptTasksInDatabase(
        client,
        {
          projectId: f.project.id,
          clientRequestId: `${f.task.clientRequestId}-replacement`,
          kind: 'text',
          provider: 'text',
          model: 'seqora-5.6',
          label: 'New script',
          estimatedCredits: 0,
          metadata: { generationStage: 'script-generate', scriptOperation: 'generate' },
        },
        principal,
      ),
    )
    expect(cancelled).toHaveLength(1)
    expect(textTaskCancellationMatches(cancelled[0]!, f.guard)).toBe(true)
    expect(cancelled[0]).toMatchObject({ status: 'cancelled', leaseToken: null })
    expect(JSON.stringify(cancelled[0]!.metadata)).not.toContain(f.guard.leaseToken)
    await f.refund()
    expect((await f.ledger.summary(principal)).credits).toBe(f.before)
  })

  it('refunds a live execution and a confirmed cancellation idempotently', async () => {
    for (const cancel of [false, true]) {
      const f = await setup()
      if (cancel) await f.tasks.deleteFromQueue(f.task.id, principal)
      await f.refund()
      await f.refund()
      expect((await f.ledger.summary(principal)).credits).toBe(f.before)
      const rows = await database.query('SELECT id FROM billing_ledger_entries WHERE id = $1', [
        `refund-${f.reference}`,
      ])
      expect(rows.rows).toHaveLength(1)
    }
  })

  it.each(['takeover', 'cancelled-successor', 'new-attempt', 'disabled'] as const)(
    'rejects %s after reading the persisted task',
    async (change) => {
      const f = await setup()
      if (change === 'takeover' || change === 'cancelled-successor') {
        await database.query('UPDATE generation_tasks SET lease_token = $2 WHERE id = $1', [
          f.task.id,
          'new-token',
        ])
      }
      if (change === 'cancelled-successor') await f.tasks.deleteFromQueue(f.task.id, principal)
      if (change === 'new-attempt')
        await database.query('UPDATE generation_tasks SET attempts = attempts + 1 WHERE id = $1', [f.task.id])
      if (change === 'disabled') await f.tasks.stopRunningWithoutRefund(f.task.id, principal)
      await expect(f.refund()).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
      expect((await f.ledger.summary(principal)).credits).toBe(f.before - 3)
    },
  )

  it('reads takeover identity after waiting on the task row lock', async () => {
    const f = await setup()
    let outcome!: Promise<unknown>
    await database.transaction(async (client) => {
      await client.query('SELECT id FROM generation_tasks WHERE id = $1 FOR UPDATE', [f.task.id])
      outcome = f.refund().then(
        () => null,
        (error: unknown) => error,
      )
      await waitForBlockedQuery('FROM generation_tasks')
      await client.query('UPDATE generation_tasks SET lease_token = $2 WHERE id = $1', [
        f.task.id,
        'replacement-token',
      ])
    })
    expect(await outcome).toMatchObject({ code: 'TASK_LEASE_LOST' })
    expect((await f.ledger.summary(principal)).credits).toBe(f.before - 3)
  })

  it('rechecks lease expiry after waiting on the billing account lock', async () => {
    const f = await setup()
    let outcome!: Promise<unknown>
    await database.transaction(async (client) => {
      await client.query('SELECT membership_id FROM billing_accounts WHERE membership_id = $1 FOR UPDATE', [
        `membership-${principal.tenantId}-${principal.userId}`,
      ])
      outcome = f.refund().then(
        () => null,
        (error: unknown) => error,
      )
      await waitForBlockedQuery('FROM billing_accounts')
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse(f.task.leaseExpiresAt!) + 1)
    })
    expect(await outcome).toMatchObject({ code: 'TASK_LEASE_LOST' })
    expect((await f.ledger.summary(principal)).credits).toBe(f.before - 3)
  })
})
