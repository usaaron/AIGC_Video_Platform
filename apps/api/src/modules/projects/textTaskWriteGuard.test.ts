import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { setupTextWriteGuard, textWritePrincipal as principal } from './textTaskWriteGuard.fixture.js'

describe('text task content write guard in JSON store', () => {
  it('writes project and episode content with the current task lease', async () => {
    const { repository, project, episode, guard } = await setupTextWriteGuard()
    expect(
      await repository.update(project.id, { script: 'Accepted script' }, principal, guard),
    ).toMatchObject({
      script: 'Accepted script',
    })
    expect(
      await repository.writeScriptEpisodeDraft(project.id, episode.id, 'Accepted draft', principal, {
        taskWriteGuard: guard,
      }),
    ).toMatchObject({ draftContent: 'Accepted draft', revision: episode.revision + 1 })
  })

  const invalidTasks: Array<[string, (task: GenerationTask) => void]> = [
    [
      'cancelled task',
      (task) => {
        task.status = 'cancelled'
      },
    ],
    [
      'completed task',
      (task) => {
        task.status = 'completed'
      },
    ],
    [
      'new attempt',
      (task) => {
        task.attempts = (task.attempts ?? 0) + 1
      },
    ],
    [
      'new token at the same attempt',
      (task) => {
        task.leaseToken = 'new-token'
      },
    ],
    [
      'new owner',
      (task) => {
        task.leaseOwnerId = 'new-worker'
      },
    ],
    [
      'expired lease',
      (task) => {
        task.leaseExpiresAt = new Date(Date.now() - 1).toISOString()
      },
    ],
    [
      'missing lease expiry',
      (task) => {
        task.leaseExpiresAt = null
      },
    ],
    [
      'changed operation',
      (task) => {
        task.metadata.scriptOperation = 'enrich'
      },
    ],
    [
      'changed model',
      (task) => {
        task.model = 'different-model'
      },
    ],
    [
      'changed request',
      (task) => {
        task.clientRequestId = 'different-request'
      },
    ],
    [
      'changed project',
      (task) => {
        task.projectId = 'different-project'
      },
    ],
    [
      'changed tenant',
      (task) => {
        task.tenantId = 'different-tenant'
      },
    ],
    [
      'changed actor',
      (task) => {
        task.userId = 'different-user'
      },
    ],
    [
      'changed kind',
      (task) => {
        task.kind = 'image'
      },
    ],
    [
      'changed provider',
      (task) => {
        task.provider = 'other'
      },
    ],
  ]
  it.each(invalidTasks)('rejects %s without changing content or revisions', async (_label, invalidate) => {
    const { store, repository, project, episode, task, guard } = await setupTextWriteGuard()
    await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      invalidate(state.tasks.find((item) => item.id === task.id)!)
    })
    const before = store.read((state) => ({ projects: state.projects, episodes: state.scriptEpisodes }))
    await expect(
      repository.update(project.id, { script: 'Late script' }, principal, guard),
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    await expect(
      repository.writeScriptEpisodeDraft(project.id, episode.id, 'Late draft', principal, {
        taskWriteGuard: guard,
      }),
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    expect(store.read((state) => ({ projects: state.projects, episodes: state.scriptEpisodes }))).toEqual(
      before,
    )
  })

  it('rejects missing tasks and mismatched write targets', async () => {
    const { store, repository, project, episode, guard } = await setupTextWriteGuard()
    const before = store.read((state) => ({ projects: state.projects, episodes: state.scriptEpisodes }))
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
    await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      state.tasks = []
    })
    await expect(
      repository.update(project.id, { script: 'Missing task' }, principal, guard),
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    await expect(
      repository.writeScriptEpisodeDraft(project.id, episode.id, 'Missing task', principal, {
        taskWriteGuard: guard,
      }),
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    expect(store.read((state) => ({ projects: state.projects, episodes: state.scriptEpisodes }))).toEqual(
      before,
    )
  })

  it('keeps manual editing compatible without a task guard', async () => {
    const { store, repository, project, episode } = await setupTextWriteGuard()
    await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      state.tasks = []
    })
    expect(await repository.update(project.id, { script: 'Manual script' }, principal)).toMatchObject({
      script: 'Manual script',
    })
    expect(
      await repository.writeScriptEpisodeDraft(project.id, episode.id, 'Manual draft', principal),
    ).toMatchObject({ draftContent: 'Manual draft' })
  })

  it('rechecks the lease inside a queued mutation after cancellation wins the store lock', async () => {
    const { store, repository, project, episode, guard } = await setupTextWriteGuard()
    let release!: () => void
    let locked!: () => void
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const cancelling = store.mutate(async (state) => {
      state.tasks[0]!.status = 'cancelled'
      locked()
      await released
    })
    await isLocked
    const before = store.read((state) => ({ projects: state.projects, episodes: state.scriptEpisodes }))
    const projectWrite = repository.update(project.id, { script: 'Queued stale script' }, principal, guard)
    const episodeWrite = repository.writeScriptEpisodeDraft(
      project.id,
      episode.id,
      'Queued stale draft',
      principal,
      { taskWriteGuard: guard },
    )
    const rejections = Promise.all([
      expect(projectWrite).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' }),
      expect(episodeWrite).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' }),
    ])
    release()
    await cancelling
    await rejections
    expect(store.read((state) => ({ projects: state.projects, episodes: state.scriptEpisodes }))).toEqual(
      before,
    )
  })

  it('checks activity before returning a saved batch checkpoint or creating a new draft', async () => {
    const { store, repository, project, episode, guard } = await setupTextWriteGuard()
    await store.mutate((state) => {
      state.scriptEpisodes.find((item) => item.id === episode.id)!.continuityState.batchGenerationKey =
        'episode-plan-saved'
    })
    await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      state.tasks[0]!.status = 'cancelled'
    })
    const before = store.read((state) => state.scriptEpisodes)
    for (const generationClientRequestId of ['episode-plan-saved', 'episode-plan-new']) {
      await expect(
        repository.writeScriptEpisodeDraft(project.id, null, 'Late batch draft', principal, {
          createNext: true,
          generationClientRequestId,
          taskWriteGuard: guard,
        }),
      ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
    }
    expect(store.read((state) => state.scriptEpisodes)).toEqual(before)
  })
})
