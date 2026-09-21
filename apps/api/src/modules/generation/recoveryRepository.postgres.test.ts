import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Principal } from '@seqora/contracts'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { UserRepository } from '../users/repository.js'
import { ProjectRepository } from '../projects/repository.js'
import { GenerationTaskRepository } from './repository.js'
import { PostgresVideoRecoveryRepository } from './recoveryRepository.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
let fixture: PostgresAuthFixture
let db: AccountDatabase
let store: AppStore
let tasks: GenerationTaskRepository
let recovery: PostgresVideoRecoveryRepository
let taskId: string
const now = new Date('2026-09-21T05:00:00.000Z')
const descriptors = [
  { view: 'single' as const, storageKey: 'recovered-video.mp4', contentType: 'video/mp4', size: 1000 },
  { view: 'last-frame' as const, storageKey: 'recovered-tail.jpg', contentType: 'image/jpeg', size: 500 },
]

beforeAll(async () => {
  fixture = await startPostgresAuthFixture()
}, 120_000)
beforeEach(async () => {
  await fixture.reset()
  db = new AccountDatabase(fixture.connectionString)
  store = new AppStore(null)
  await store.initialize()
  await new UserRepository(store, db).bootstrapFromStore()
  await new ProjectRepository(store, db).importFromStore()
  tasks = new GenerationTaskRepository(store, null, db)
  recovery = new PostgresVideoRecoveryRepository(db)
  const task = await tasks.create(
    {
      clientRequestId: 'recovery-request',
      projectId: 'project-midnight-film',
      kind: 'video',
      label: 'recoverable video',
      prompt: '',
      negativePrompt: '',
      provider: 'seedance',
      model: 'seedance',
      estimatedCredits: 18,
      metadata: { shotId: 'shot-1' },
    },
    principal,
  )
  taskId = task.id
  const metadata = {
    shotId: 'shot-1',
    providerName: 'dora-router-seedance',
    providerTaskId: 'existing-remote',
    creditsRefundedAt: '2026-09-21T04:00:00.000Z',
    providerReconciliationStatus: 'pending',
    providerReconciliationReason: 'processing_timeout',
    providerReconciliationNextPollAt: '2026-09-21T04:01:00.000Z',
    providerReconciliationExpiresAt: '2026-09-22T04:00:00.000Z',
  }
  await db.query(
    `UPDATE generation_tasks SET status = 'failed', progress = 100, metadata = $2::jsonb,
    created_at = '2026-09-21T03:00:00Z', updated_at = '2026-09-21T04:00:00Z' WHERE id = $1`,
    [taskId, JSON.stringify(metadata)],
  )
  await db.query(
    `UPDATE shots SET updated_at = '2026-09-21T02:00:00Z', selected_video_task_id = NULL WHERE id = 'shot-1'`,
  )
  await db.query(
    `INSERT INTO billing_ledger_entries
    (id, tenant_id, user_id, membership_id, reference_id, related_entry_id, entry_type, amount, balance, description)
    SELECT $1, $2, $3, id, $1, NULL, 'generation', -18, 100, 'test debit'
    FROM tenant_memberships WHERE tenant_id = $2 AND user_id = $3`,
    ['generation-recovery-request', principal.tenantId, principal.userId],
  )
  await db.query(
    `INSERT INTO billing_ledger_entries
    (id, tenant_id, user_id, membership_id, reference_id, related_entry_id, entry_type, amount, balance, description)
    SELECT $1, $2, $3, id, $1, 'generation-recovery-request', 'adjustment', 18, 118, 'test refund'
    FROM tenant_memberships WHERE tenant_id = $2 AND user_id = $3`,
    [`refund-${taskId}`, principal.tenantId, principal.userId],
  )
})
afterEach(async () => {
  await db?.close()
})
afterAll(async () => {
  await fixture?.close()
})

async function row() {
  return (
    await db.query(`SELECT status, metadata, outputs, result_url FROM generation_tasks WHERE id = $1`, [
      taskId,
    ])
  ).rows[0]!
}
async function shotSelection() {
  return (await db.query(`SELECT selected_video_task_id FROM shots WHERE id = 'shot-1'`)).rows[0]!
    .selected_video_task_id
}

describe('Postgres failed video reconciliation', () => {
  it('persists completed video/tail and audit while leaving the refund ledger byte-for-byte unchanged', async () => {
    const before = (await db.query('SELECT * FROM billing_ledger_entries ORDER BY id')).rows
    const [claim] = await recovery.claimDue(now, 2)
    expect(claim).toBeDefined()
    expect(await recovery.complete(claim!, descriptors, new Date(now.getTime() + 1000))).toBe(true)
    expect(await row()).toMatchObject({
      status: 'completed',
      outputs: [
        expect.objectContaining({ mediaType: 'video', view: 'single' }),
        expect.objectContaining({ mediaType: 'image', view: 'last-frame' }),
      ],
      metadata: { providerReconciliationStatus: 'completed', creditsRefundedAt: '2026-09-21T04:00:00.000Z' },
    })
    expect(await shotSelection()).toBe(taskId)
    expect((await db.query('SELECT * FROM billing_ledger_entries ORDER BY id')).rows).toEqual(before)
    expect(
      (await db.query(`SELECT action FROM audit_log_entries WHERE resource_id = $1`, [taskId])).rows,
    ).toContainEqual({ action: 'generation.remote_result_reconciled' })
    expect(await recovery.complete(claim!, descriptors, now)).toBe(false)
    expect(await recovery.claimDue(new Date(now.getTime() + 600_000), 2)).toEqual([])
  })

  it('claims each remote once across concurrent workers and resumes after a crashed claim expires', async () => {
    const other = new PostgresVideoRecoveryRepository(db)
    const [first, second] = await Promise.all([recovery.claimDue(now, 2), other.claimDue(now, 2)])
    expect(first.length + second.length).toBe(1)
    expect(await other.claimDue(new Date(now.getTime() + 60_000), 2)).toEqual([])
    const reclaimed = await other.claimDue(new Date(now.getTime() + 360_000), 2)
    expect(reclaimed).toHaveLength(1)
    const old = [...first, ...second][0]!
    expect(await recovery.complete(old, descriptors, new Date(now.getTime() + 361_000))).toBe(false)
    expect(await recovery.complete(reclaimed[0]!, descriptors, new Date(now.getTime() + 361_000))).toBe(true)
  })

  it.each(['selection', 'edit', 'new-task'])(
    'recovers into history without overwriting a newer %s',
    async (change) => {
      const [claim] = await recovery.claimDue(now, 2)
      if (change === 'selection')
        await db.query(`UPDATE shots SET selected_video_task_id = 'user-choice' WHERE id = 'shot-1'`)
      if (change === 'edit') await db.query(`UPDATE shots SET updated_at = $1 WHERE id = 'shot-1'`, [now])
      if (change === 'new-task')
        await tasks.create(
          {
            clientRequestId: 'newer-request',
            projectId: 'project-midnight-film',
            kind: 'video',
            label: 'newer',
            prompt: '',
            negativePrompt: '',
            provider: 'seedance',
            model: 'seedance',
            estimatedCredits: 0,
            metadata: { shotId: 'shot-1' },
          },
          principal,
        )
      expect(await recovery.complete(claim!, descriptors, new Date(now.getTime() + 1000))).toBe(true)
      expect(await shotSelection()).toBe(change === 'selection' ? 'user-choice' : null)
      expect((await row()).metadata.providerReconciliationHistoryOnly).toBe(true)
      const plan = await tasks.filmPreviewPlan('project-midnight-film', principal)
      expect(plan?.sources.find((item) => item.shot.id === 'shot-1')?.task).toBeUndefined()
    },
  )

  it.each(['cancelled', 'hidden', 'remote-change', 'version-change'])(
    'rejects writeback after %s while downloading',
    async (change) => {
      const [claim] = await recovery.claimDue(now, 2)
      if (change === 'cancelled')
        await db.query(`UPDATE generation_tasks SET status = 'cancelled' WHERE id = $1`, [taskId])
      if (change === 'hidden')
        await db.query(
          `UPDATE generation_tasks SET metadata = metadata || '{"queueHiddenAt":"2026-09-21T05:00:00Z"}' WHERE id = $1`,
          [taskId],
        )
      if (change === 'remote-change')
        await db.query(
          `UPDATE generation_tasks SET metadata = metadata || '{"providerTaskId":"other"}' WHERE id = $1`,
          [taskId],
        )
      if (change === 'version-change')
        await db.query(`UPDATE generation_tasks SET updated_at = '2026-09-21T05:00:01Z' WHERE id = $1`, [
          taskId,
        ])
      expect(await recovery.complete(claim!, descriptors, new Date(now.getTime() + 2000))).toBe(false)
      expect((await row()).outputs).toEqual([])
      expect(await shotSelection()).toBeNull()
    },
  )

  it('requires the refund marker before claiming and actual receipt before completing', async () => {
    await db.query(`UPDATE generation_tasks SET metadata = metadata - 'creditsRefundedAt' WHERE id = $1`, [
      taskId,
    ])
    expect(await recovery.claimDue(now, 2)).toEqual([])
    await db.query(
      `UPDATE generation_tasks SET metadata = metadata || '{"creditsRefundedAt":"2026-09-21T04:00:00Z"}' WHERE id = $1`,
      [taskId],
    )
    const [claim] = await recovery.claimDue(now, 2)
    await db.query('DELETE FROM billing_ledger_entries WHERE id = $1', [`refund-${taskId}`])
    expect(await recovery.complete(claim!, descriptors, now)).toBe(false)
    expect((await row()).status).toBe('failed')
  })

  it('never scans true upstream failures or untagged failed history', async () => {
    await db.query(
      `UPDATE generation_tasks SET metadata = metadata - 'providerReconciliationReason' WHERE id = $1`,
      [taskId],
    )
    expect(await recovery.claimDue(now, 2)).toEqual([])
    await db.query(
      `UPDATE generation_tasks SET metadata = metadata || '{"providerReconciliationReason":"upstream_failed"}' WHERE id = $1`,
      [taskId],
    )
    expect(await recovery.claimDue(now, 2)).toEqual([])
  })

  it('refuses a partial refund instead of losing the remaining refund work', async () => {
    const [claim] = await recovery.claimDue(now, 2)
    await db.query('UPDATE billing_ledger_entries SET amount = 1 WHERE id = $1', [`refund-${taskId}`])
    expect(await recovery.complete(claim!, descriptors, now)).toBe(false)
    expect((await row()).status).toBe('failed')
  })

  it('rolls back task completion and shot binding if the audit insert fails', async () => {
    const [claim] = await recovery.claimDue(now, 2)
    await db.query(`ALTER TABLE audit_log_entries ADD CONSTRAINT test_recovery_audit_failure
      CHECK (action <> 'generation.remote_result_reconciled') NOT VALID`)
    try {
      await expect(recovery.complete(claim!, descriptors, now)).rejects.toThrow()
      expect((await row()).status).toBe('failed')
      expect((await row()).outputs).toEqual([])
      expect(await shotSelection()).toBeNull()
    } finally {
      await db.query('ALTER TABLE audit_log_entries DROP CONSTRAINT test_recovery_audit_failure')
    }
  })

  it('persists the poll schedule and stops scanning after confirmed failure or expiration', async () => {
    const [claim] = await recovery.claimDue(now, 2)
    expect(await recovery.defer(claim!, 'pending', 'REMOTE_TASK_RUNNING', now)).toBe(true)
    expect(await recovery.claimDue(new Date(now.getTime() + 59_000), 2)).toEqual([])
    const [next] = await recovery.claimDue(new Date(now.getTime() + 60_000), 2)
    expect(next).toBeDefined()
    expect(await recovery.defer(next!, 'upstream_failed', 'REMOTE_TASK_FAILED', now)).toBe(true)
    expect(await recovery.claimDue(new Date(now.getTime() + 360_000), 2)).toEqual([])
  })

  it('rejects stale normal cache flushes both during claim and after reconciliation completes', async () => {
    await tasks.refreshRuntimeTaskFromDatabase(taskId)
    const [claim] = await recovery.claimDue(now, 2)
    await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      state.tasks.find((task) => task.id === taskId)!.updatedAt = '2026-09-22T06:00:00.000Z'
    })
    expect(await tasks.flushRuntimeTaskToDatabase(taskId)).toBe(false)
    expect(await recovery.complete(claim!, descriptors, new Date(now.getTime() + 1000))).toBe(true)
    expect(await tasks.flushRuntimeTaskToDatabase(taskId)).toBe(false)
    expect((await row()).status).toBe('completed')
    await tasks.refreshRuntimeTaskFromDatabase(taskId)
    await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      const task = state.tasks.find((item) => item.id === taskId)!
      task.status = 'failed'
      task.updatedAt = '2026-09-22T06:00:00.000Z'
    })
    expect(await tasks.flushRuntimeTaskToDatabase(taskId)).toBe(false)
  })
})
