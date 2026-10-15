import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AccountDatabase } from '../../infra/postgres.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { setupTextWriteGuard, textWritePrincipal as principal } from './textTaskWriteGuard.fixture.js'

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

async function contentSnapshot(projectId: string) {
  const [project, episodes] = await Promise.all([
    database.query('SELECT script, updated_at FROM projects WHERE id = $1', [projectId]),
    database.query(
      'SELECT id, draft_content, revision, continuity_state, updated_at FROM script_episodes WHERE project_id = $1 ORDER BY episode_number',
      [projectId],
    ),
  ])
  return { project: project.rows, episodes: episodes.rows }
}

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
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
      { timeout: 5_000, interval: 20 },
    )
    .toBeGreaterThan(0)
}

describe('text task content write guard in PostgreSQL', () => {
  it('writes a project and episode under the current persisted lease', async () => {
    const { repository, project, episode, guard } = await setupTextWriteGuard(database)
    expect(
      await repository.update(project.id, { script: 'Accepted script' }, principal, guard),
    ).toMatchObject({ script: 'Accepted script' })
    expect(
      await repository.writeScriptEpisodeDraft(project.id, episode.id, 'Accepted draft', principal, {
        taskWriteGuard: guard,
      }),
    ).toMatchObject({ draftContent: 'Accepted draft', revision: episode.revision + 1 })
    const saved = await contentSnapshot(project.id)
    expect(saved.project[0]!.script).toBe('Accepted script')
    expect(saved.episodes[0]!.draft_content).toBe('Accepted draft')
  })

  it.each([
    ['cancelled', "status = 'cancelled'"],
    ['completed', "status = 'completed'"],
    ['new attempt', 'attempts = attempts + 1'],
    ['new token at the same attempt', "lease_token = 'new-token'"],
    ['new owner', "lease_owner_id = 'new-owner'"],
    ['expired lease', "lease_expires_at = now() - interval '1 minute'"],
    ['missing lease expiry', 'lease_expires_at = null'],
    ['changed operation', "metadata = jsonb_set(metadata, '{scriptOperation}', '\"enrich\"'::jsonb)"],
    ['changed model', "model = 'different-model'"],
    ['changed request', "client_request_id = 'different-request'"],
  ])('rejects %s from the database even while the runtime cache is active', async (_label, change) => {
    const { repository, store, project, episode, task, guard } = await setupTextWriteGuard(database)
    const before = await contentSnapshot(project.id)
    const cachedBefore = store.read((state) => ({
      project: state.projects.find((item) => item.id === project.id),
      episode: state.scriptEpisodes.find((item) => item.id === episode.id),
    }))
    await database.query(`UPDATE generation_tasks SET ${change} WHERE id = $1`, [task.id])
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id)!.status)).toBe('running')
    await expect(
      repository.update(project.id, { script: 'Late script' }, principal, guard),
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    await expect(
      repository.writeScriptEpisodeDraft(project.id, episode.id, 'Late draft', principal, {
        taskWriteGuard: guard,
      }),
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    expect(await contentSnapshot(project.id)).toEqual(before)
    expect(
      store.read((state) => ({
        project: state.projects.find((item) => item.id === project.id),
        episode: state.scriptEpisodes.find((item) => item.id === episode.id),
      })),
    ).toEqual(cachedBefore)
  })

  it('binds the write target and actor before locking the database task', async () => {
    const { repository, project, episode, guard } = await setupTextWriteGuard(database)
    const before = await contentSnapshot(project.id)
    for (const actor of [
      { ...principal, tenantId: 'different-tenant' },
      { ...principal, userId: 'different-user' },
    ]) {
      await expect(
        repository.update(project.id, { script: 'Wrong actor' }, actor, guard),
      ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
      await expect(
        repository.writeScriptEpisodeDraft(project.id, episode.id, 'Wrong actor', actor, {
          taskWriteGuard: guard,
        }),
      ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    }
    await expect(
      repository.update('different-project', { script: 'Wrong project' }, principal, guard),
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    await expect(
      repository.writeScriptEpisodeDraft('different-project', null, 'Wrong project', principal, {
        taskWriteGuard: guard,
      }),
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    expect(await contentSnapshot(project.id)).toEqual(before)
  })

  it('uses persisted task identity and rejects a missing database task', async () => {
    const { repository, store, project, task, guard } = await setupTextWriteGuard(database)
    await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      state.tasks[0]!.status = 'cancelled'
    })
    expect(
      await repository.update(project.id, { script: 'Persisted lease owns this write' }, principal, guard),
    ).toMatchObject({ script: 'Persisted lease owns this write' })
    await database.query('DELETE FROM generation_tasks WHERE id = $1', [task.id])
    const before = await contentSnapshot(project.id)
    await expect(
      repository.update(project.id, { script: 'Deleted task' }, principal, guard),
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    await expect(
      repository.writeScriptEpisodeDraft(project.id, null, 'Deleted task', principal, {
        taskWriteGuard: guard,
      }),
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    expect(await contentSnapshot(project.id)).toEqual(before)
  })

  it('retains completed batch drafts but prevents checkpoints or new drafts after cancellation', async () => {
    const { repository, project, task, guard } = await setupTextWriteGuard(database)
    await repository.writeScriptEpisodeDraft(
      project.id,
      null,
      'Accepted distinct batch material',
      principal,
      { createNext: true, generationClientRequestId: 'episode-plan-saved', taskWriteGuard: guard },
    )
    await database.query("UPDATE generation_tasks SET status = 'cancelled' WHERE id = $1", [task.id])
    const before = await contentSnapshot(project.id)
    for (const generationClientRequestId of ['episode-plan-saved', 'episode-plan-new']) {
      await expect(
        repository.writeScriptEpisodeDraft(project.id, null, 'Late batch draft', principal, {
          createNext: true,
          generationClientRequestId,
          taskWriteGuard: guard,
        }),
      ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    }
    expect(await contentSnapshot(project.id)).toEqual(before)
  })

  it('keeps manual edits available without a worker guard', async () => {
    const { repository, project, episode, task } = await setupTextWriteGuard(database)
    await database.query("UPDATE generation_tasks SET status = 'cancelled' WHERE id = $1", [task.id])
    expect(await repository.update(project.id, { script: 'Manual script' }, principal)).toMatchObject({
      script: 'Manual script',
    })
    expect(
      await repository.writeScriptEpisodeDraft(project.id, episode.id, 'Manual draft', principal),
    ).toMatchObject({ draftContent: 'Manual draft' })
  })

  it.each(['project', 'episode'] as const)(
    'rejects %s content when cancellation commits while the task lock is pending',
    async (target) => {
      const { repository, project, episode, task, guard } = await setupTextWriteGuard(database)
      const before = await contentSnapshot(project.id)
      const locked = gate()
      const release = gate()
      const blocker = database.transaction(async (client) => {
        await client.query("UPDATE generation_tasks SET status = 'cancelled' WHERE id = $1", [task.id])
        locked.resolve()
        await release.promise
      })
      await locked.promise
      const writing =
        target === 'project'
          ? repository.update(project.id, { script: 'Raced script' }, principal, guard)
          : repository.writeScriptEpisodeDraft(project.id, episode.id, 'Raced draft', principal, {
              taskWriteGuard: guard,
            })
      const rejected = expect(writing).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
      try {
        await waitForBlockedQuery('FROM generation_tasks')
      } finally {
        release.resolve()
        await blocker
      }
      await rejected
      expect(await contentSnapshot(project.id)).toEqual(before)
    },
  )

  it.each(['project', 'episode'] as const)(
    'rejects %s content when its lease expires while waiting for the project lock',
    async (target) => {
      const { repository, project, episode, task, guard } = await setupTextWriteGuard(database)
      const before = await contentSnapshot(project.id)
      const locked = gate()
      const release = gate()
      const blocker = database.transaction(async (client) => {
        await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [project.id])
        locked.resolve()
        await release.promise
      })
      await locked.promise
      const writing =
        target === 'project'
          ? repository.update(project.id, { script: 'Expired script' }, principal, guard)
          : repository.writeScriptEpisodeDraft(project.id, episode.id, 'Expired draft', principal, {
              taskWriteGuard: guard,
            })
      const rejected = expect(writing).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
      try {
        await waitForBlockedQuery('FROM projects')
        vi.spyOn(Date, 'now').mockReturnValue(Date.parse(task.leaseExpiresAt!) + 1)
      } finally {
        release.resolve()
        await blocker
      }
      await rejected
      expect(await contentSnapshot(project.id)).toEqual(before)
    },
  )

  it('keeps cancellation behind the content transaction until the accepted write commits', async () => {
    const { repository, project, task, guard } = await setupTextWriteGuard(database)
    const locked = gate()
    const release = gate()
    const blocker = database.transaction(async (client) => {
      await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [project.id])
      locked.resolve()
      await release.promise
    })
    await locked.promise
    const writing = repository.update(
      project.id,
      { script: 'Write linearized before cancellation' },
      principal,
      guard,
    )
    let cancellation: Promise<unknown> | undefined
    try {
      await waitForBlockedQuery('FROM projects')
      cancellation = database.query("UPDATE generation_tasks SET status = 'cancelled' WHERE id = $1", [
        task.id,
      ])
      await waitForBlockedQuery('UPDATE generation_tasks')
    } finally {
      release.resolve()
      await blocker
    }
    expect(await writing).toMatchObject({ script: 'Write linearized before cancellation' })
    await cancellation
    expect((await contentSnapshot(project.id)).project[0]!.script).toBe(
      'Write linearized before cancellation',
    )
    expect(
      (await database.query('SELECT status FROM generation_tasks WHERE id = $1', [task.id])).rows[0]!.status,
    ).toBe('cancelled')
  })

  it.each(['project', 'episode'] as const)(
    'does not mirror an older committed %s over a later cache edit',
    async (target) => {
      const { store, repository, project, episode, guard } = await setupTextWriteGuard(database)
      const entered = gate()
      const release = gate()
      const mutate = store.mutateProjectWorkspaceRuntimeCacheAsync.bind(store)
      vi.spyOn(store, 'mutateProjectWorkspaceRuntimeCacheAsync').mockImplementationOnce(async (operation) => {
        entered.resolve()
        await release.promise
        return mutate(operation)
      })
      const writing =
        target === 'project'
          ? repository.update(project.id, { script: 'First committed project' }, principal, guard)
          : repository.writeScriptEpisodeDraft(project.id, episode.id, 'First committed episode', principal, {
              taskWriteGuard: guard,
            })
      await entered.promise
      try {
        if (target === 'project')
          await repository.update(project.id, { script: 'Later project edit' }, principal)
        else await repository.writeScriptEpisodeDraft(project.id, episode.id, 'Later episode edit', principal)
        // Timestamps alone cannot establish which content owns the cache.
        await mutate((state) => {
          state.projects.find((item) => item.id === project.id)!.updatedAt = project.updatedAt
          state.scriptEpisodes.find((item) => item.id === episode.id)!.updatedAt = episode.updatedAt
        })
      } finally {
        release.resolve()
      }
      await writing
      const saved = await contentSnapshot(project.id)
      if (target === 'project') {
        expect(saved.project[0]!.script).toBe('Later project edit')
        expect(store.read((state) => state.projects.find((item) => item.id === project.id)!.script)).toBe(
          'Later project edit',
        )
      } else {
        expect(saved.episodes[0]!.draft_content).toBe('Later episode edit')
        expect(
          store.read((state) => state.scriptEpisodes.find((item) => item.id === episode.id)!.draftContent),
        ).toBe('Later episode edit')
      }
    },
  )
})
