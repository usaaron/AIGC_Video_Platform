import type { CreateGenerationTask, GenerationTask, Principal, ScriptEpisode } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import type { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'

const memberPrincipal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

const ownerPrincipal: Principal = {
  userId: 'user-owner',
  tenantId: 'tenant-seqora-demo',
  roles: ['owner'],
}

describe('GenerationTaskRepository charged creation', () => {
  it('allows a tenant owner to generate for another member project', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)

    await expect(repository.canCreate('project-midnight-film', ownerPrincipal)).resolves.toBe(true)
  })

  it('passes the tenant manager scope into the database creation check', async () => {
    let capturedParams: readonly unknown[] = []
    const database = {
      query: async (_sql: string, params: readonly unknown[]) => {
        capturedParams = params
        return { rows: params[2] === true ? [{ id: 'project-midnight-film' }] : [] }
      },
    } as unknown as AccountDatabase
    const repository = new GenerationTaskRepository(null, null, database)

    await expect(repository.canCreate('project-midnight-film', ownerPrincipal)).resolves.toBe(true)
    expect(capturedParams).toEqual([
      'project-midnight-film',
      ownerPrincipal.tenantId,
      true,
      ownerPrincipal.userId,
    ])
  })

  it('recovers an expired local film composition when project tasks are read', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const expired = generationTask({
      id: 'expired-film-preview',
      provider: 'local-compose',
      status: 'running',
      progress: 92,
      leaseOwnerId: 'stopped-api',
      leaseToken: 'expired-token',
      leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      metadata: { generationStage: 'film-preview', compositionStage: 'uploading' },
    })
    await store.mutate((state) => state.tasks.unshift(expired))

    const tasks = await repository.listByProject('project-midnight-film', memberPrincipal)

    expect(tasks.find((task) => task.id === expired.id)).toMatchObject({
      status: 'failed',
      progress: 100,
      error: '成片预览合成进程已中断，请重新合成',
      leaseOwnerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      metadata: {
        providerState: 'failed',
        compositionStage: 'failed',
        compositionRecoveredAt: expect.any(String),
      },
    })
  })

  it('keeps a recently updated composition during the recovery grace period', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const recent = generationTask({
      id: 'recent-film-preview',
      provider: 'local-compose',
      status: 'running',
      progress: 45,
      leaseOwnerId: 'slow-api',
      leaseToken: 'recent-token',
      leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      metadata: { generationStage: 'film-preview', compositionStage: 'composing' },
    })
    await store.mutate((state) => state.tasks.unshift(recent))

    const tasks = await repository.listByProject('project-midnight-film', memberPrincipal)

    expect(tasks.find((task) => task.id === recent.id)).toMatchObject({
      status: 'running',
      progress: 45,
      leaseOwnerId: 'slow-api',
    })
  })

  it('does not recover a local film composition with an active lease', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const active = generationTask({
      id: 'active-film-preview',
      provider: 'local-compose',
      status: 'running',
      progress: 50,
      leaseOwnerId: 'active-api',
      leaseToken: 'active-token',
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      metadata: { generationStage: 'film-preview', compositionStage: 'composing' },
    })
    await store.mutate((state) => state.tasks.unshift(active))

    const tasks = await repository.listByProject('project-midnight-film', memberPrincipal)

    expect(tasks.find((task) => task.id === active.id)).toMatchObject({
      status: 'running',
      progress: 50,
      leaseOwnerId: 'active-api',
      leaseToken: 'active-token',
    })
  })

  it('does not replace a newer runtime composition lease with a stale database snapshot', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const stale = generationTask({
      id: 'stale-database-film-preview',
      provider: 'local-compose',
      status: 'running',
      progress: 50,
      leaseOwnerId: 'composer-before-heartbeat',
      leaseToken: 'stale-token',
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
      metadata: { generationStage: 'film-preview', compositionStage: 'composing' },
    })
    const current = {
      ...stale,
      progress: 92,
      leaseOwnerId: 'active-composer',
      leaseToken: 'current-token',
      leaseHeartbeatAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: { generationStage: 'film-preview', compositionStage: 'uploading' },
    }
    await store.mutate((state) => state.tasks.unshift(current))
    const database = {
      query: async (sql: string) => {
        if (sql.includes('UPDATE generation_tasks')) return { rows: [] }
        if (sql.includes('SELECT')) return { rows: [generationTaskRow(stale)] }
        throw new Error(`Unexpected query: ${sql}`)
      },
    } as unknown as AccountDatabase
    const repository = new GenerationTaskRepository(store, null, database)

    const tasks = await repository.listByProject('project-midnight-film', memberPrincipal)

    expect(tasks[0]).toMatchObject({ progress: 50, leaseToken: 'stale-token' })
    expect(store.read((state) => state.tasks.find((task) => task.id === current.id))).toMatchObject({
      progress: 92,
      leaseOwnerId: 'active-composer',
      leaseToken: 'current-token',
      metadata: { compositionStage: 'uploading' },
    })
  })

  it('flushes only the requested runtime tasks', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const selected = generationTask({ id: 'selected-runtime-task', status: 'running' })
    const untouched = generationTask({ id: 'untouched-runtime-task', status: 'running' })
    await store.mutate((state) => state.tasks.unshift(selected, untouched))
    const updatedTaskIds: string[] = []
    const database = {
      transaction: async (
        operation: (client: {
          query: (sql: string, params: readonly unknown[]) => Promise<{ rows: unknown[] }>
        }) => Promise<number>,
      ) =>
        operation({
          query: async (sql: string, params: readonly unknown[]) => {
            if (!sql.includes('UPDATE generation_tasks')) throw new Error(`Unexpected query: ${sql}`)
            const taskId = String(params[0])
            updatedTaskIds.push(taskId)
            const task = store.read((state) => state.tasks.find((item) => item.id === taskId))
            return { rows: task ? [generationTaskRow(task)] : [] }
          },
        }),
    } as unknown as AccountDatabase
    const repository = new GenerationTaskRepository(store, null, database)

    await expect(repository.flushRuntimeTasksToDatabase([selected.id])).resolves.toBe(1)
    expect(updatedTaskIds).toEqual([selected.id])
  })

  it('reads the canonical storyboard prompt from postgres instead of the runtime cache', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const currentPrompt = '0-2 seconds: current database action.\n2-5 seconds: current database reaction.'
    const database = {
      query: async (sql: string) => {
        if (sql.includes('FROM projects')) {
          return {
            rows: [
              {
                id: 'project-midnight-film',
                tenant_id: memberPrincipal.tenantId,
                owner_user_id: memberPrincipal.userId,
                name: 'Database project',
                content_type: 'short-drama',
                visual_style: 'photorealistic',
                episode_duration_seconds: 60,
                aspect_ratio: '16:9',
                status: 'draft',
                synopsis: '',
                script: '',
                version: 8,
                created_at: '2026-08-08T00:00:00.000Z',
                updated_at: '2026-08-08T01:00:00.000Z',
              },
            ],
          }
        }
        if (sql.includes('FROM shots')) {
          return {
            rows: [
              {
                id: 'shot-1',
                project_id: 'project-midnight-film',
                tenant_id: memberPrincipal.tenantId,
                shot_order: 1,
                title: 'Current shot',
                framing: 'Medium',
                duration_seconds: 5,
                prompt: currentPrompt,
                negative_prompt: '',
                image_url: null,
                continuity_mode: 'continue',
                continuity_note: '',
                episode_break_before: false,
                episode_number: 1,
                episode_title: 'Episode 1',
                episode_kind: 'standard',
                created_at: '2026-08-08T00:00:00.000Z',
                updated_at: '2026-08-08T01:00:00.000Z',
              },
            ],
          }
        }
        if (sql.includes('FROM assets')) return { rows: [] }
        throw new Error(`Unexpected query: ${sql}`)
      },
    } as unknown as AccountDatabase
    const repository = new GenerationTaskRepository(store, null, database)

    const context = await repository.storyboardVideoContext(
      taskInput({
        kind: 'video',
        provider: 'seedance',
        metadata: { shotId: 'shot-1' },
      }),
      memberPrincipal,
    )

    expect(context?.shot.prompt).toBe(currentPrompt)
    expect(context?.project.version).toBe(8)
    expect(context?.project.visualStyle).toBe('photorealistic')
    expect(context?.project.episodeDurationSeconds).toBe(60)
  })

  it('keeps active task dependencies while excluding unrelated historical tasks', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const dependency = generationTask({
      id: 'continuity-source-task',
      status: 'completed',
      updatedAt: '2026-08-08T00:00:01.000Z',
    })
    const active = generationTask({
      id: 'active-dependent-task',
      status: 'running',
      updatedAt: '2026-08-08T00:00:02.000Z',
      metadata: { continuitySourceTaskId: dependency.id },
    })
    const historical = generationTask({
      id: 'unrelated-completed-task',
      status: 'completed',
      updatedAt: '2026-08-08T00:00:03.000Z',
    })
    const rowsById = new Map(
      [dependency, active, historical].map((task) => [task.id, generationTaskRow(task)]),
    )
    const database = {
      query: async (sql: string, params: readonly unknown[] = []) => {
        if (sql.includes('WHERE id = ANY')) {
          const ids = (params[0] as string[]).map((id) => rowsById.get(id)).filter(Boolean)
          return { rows: ids }
        }
        if (sql.includes('status IN')) return { rows: [rowsById.get(active.id)] }
        if (sql.includes('ORDER BY updated_at DESC')) {
          return { rows: [{ id: historical.id, updated_at: historical.updatedAt }] }
        }
        throw new Error(`Unexpected query: ${sql}`)
      },
    } as unknown as AccountDatabase
    const repository = new GenerationTaskRepository(store, null, database)

    await repository.refreshRuntimeCacheFromDatabase({ activeOnly: true })

    expect(store.readGenerationTaskRuntimeCache((state) => state.tasks.map((task) => task.id))).toEqual([
      active.id,
      dependency.id,
    ])
    expect(
      store.readGenerationTaskRuntimeCache((state) => state.tasks.some((task) => task.id === historical.id)),
    ).toBe(false)
  })

  it('loads the first task through the active query when the worker starts with an empty cache', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const firstTask = generationTask({
      id: 'first-task-after-empty-start',
      status: 'queued',
      updatedAt: '2026-08-08T00:00:05.000Z',
    })
    let taskAvailable = false
    let fullRefreshQueries = 0
    const database = {
      query: async (sql: string) => {
        if (sql.includes('ORDER BY created_at DESC, id DESC')) {
          fullRefreshQueries += 1
          return { rows: taskAvailable ? [generationTaskRow(firstTask)] : [] }
        }
        if (sql.includes('status IN')) {
          return { rows: taskAvailable ? [generationTaskRow(firstTask)] : [] }
        }
        if (sql.includes('ORDER BY updated_at DESC')) {
          taskAvailable = true
          return { rows: [{ id: firstTask.id, updated_at: firstTask.updatedAt }] }
        }
        throw new Error(`Unexpected query: ${sql}`)
      },
    } as unknown as AccountDatabase
    const repository = new GenerationTaskRepository(store, null, database)

    await repository.refreshRuntimeCacheFromDatabase({ activeOnly: true })

    expect(fullRefreshQueries).toBe(0)
    expect(store.readGenerationTaskRuntimeCache((state) => state.tasks.map((task) => task.id))).toEqual([
      firstTask.id,
    ])
  })

  it('applies active task deltas without rescanning all active tasks', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const queued = generationTask({
      id: 'incremental-active-task',
      status: 'queued',
      updatedAt: '2020-01-01T00:00:00.000Z',
    })
    const completed = generationTask({
      ...queued,
      status: 'completed',
      progress: 100,
      updatedAt: '2020-01-01T00:00:01.000Z',
    })
    let activeQueries = 0
    const database = {
      query: async (sql: string) => {
        if (sql.includes('WHERE updated_at >')) return { rows: [generationTaskRow(completed)] }
        if (sql.includes('status IN')) {
          activeQueries += 1
          return { rows: [generationTaskRow(queued)] }
        }
        if (sql.includes('ORDER BY updated_at DESC')) {
          return { rows: [{ id: queued.id, updated_at: queued.updatedAt }] }
        }
        throw new Error(`Unexpected query: ${sql}`)
      },
    } as unknown as AccountDatabase
    const repository = new GenerationTaskRepository(store, null, database)

    await repository.refreshRuntimeCacheFromDatabase({ activeOnly: true })
    await repository.refreshRuntimeCacheDeltaFromDatabase()

    expect(activeQueries).toBe(1)
    expect(store.readGenerationTaskRuntimeCache((state) => state.tasks)).toEqual([])
  })

  it('keeps a selected completed video after the shot has been regenerated', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const now = new Date().toISOString()
    const retainedTask: GenerationTask = {
      id: 'retained-shot-version',
      clientRequestId: 'retained-shot-version-request',
      projectId: 'project-midnight-film',
      tenantId: memberPrincipal.tenantId,
      userId: memberPrincipal.userId,
      kind: 'video',
      label: 'Retained version',
      prompt: '',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      tier: null,
      metadata: { shotId: 'superseded-shot-id', providerTaskId: 'remote-retained-version' },
      status: 'completed',
      progress: 100,
      estimatedCredits: 18,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
      resultUrl: '/api/v1/generation/tasks/retained-shot-version/content',
      outputs: [],
      error: null,
      attempts: 1,
    }
    await store.mutate((state) => {
      state.shots.find((shot) => shot.id === 'shot-1')!.selectedVideoTaskId = retainedTask.id
      state.tasks.unshift(retainedTask)
    })

    const plan = await repository.filmPreviewPlan('project-midnight-film', memberPrincipal)

    expect(plan?.sources.find((source) => source.shot.id === 'shot-1')?.task?.id).toBe(retainedTask.id)
  })

  it('creates the task, charges credits, and writes ledger in one transaction', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const input = taskInput({ clientRequestId: 'atomic-image-task', estimatedCredits: 7 })

    const task = await repository.createWithCharge(input, memberPrincipal, {
      traceId: 'trace-generation-task',
    })
    const persisted = store.read((state) => ({
      credits: state.users.find((user) => user.id === memberPrincipal.userId)!.credits,
      ledger: state.ledger.find((entry) => entry.id === 'generation-atomic-image-task'),
      taskCount: state.tasks.filter((item) => item.clientRequestId === input.clientRequestId).length,
    }))

    expect(task).toMatchObject({
      clientRequestId: input.clientRequestId,
      estimatedCredits: 7,
      status: 'queued',
      metadata: { traceId: 'trace-generation-task' },
    })
    expect(persisted).toMatchObject({
      credits: 279,
      ledger: {
        amount: -7,
        balance: 279,
        type: 'generation',
        description: input.label,
      },
      taskCount: 1,
    })
  })

  it('rolls back the task and ledger when credits are insufficient', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => {
      state.users.find((user) => user.id === memberPrincipal.userId)!.credits = 3
    })
    const repository = new GenerationTaskRepository(store)
    const input = taskInput({ clientRequestId: 'insufficient-image-task', estimatedCredits: 4 })

    await expect(repository.createWithCharge(input, memberPrincipal)).rejects.toMatchObject({
      statusCode: 402,
      code: 'INSUFFICIENT_CREDITS',
    })

    expect(
      store.read((state) => ({
        credits: state.users.find((user) => user.id === memberPrincipal.userId)!.credits,
        ledgerCount: state.ledger.filter((entry) => entry.id === 'generation-insufficient-image-task').length,
        taskCount: state.tasks.filter((item) => item.clientRequestId === input.clientRequestId).length,
      })),
    ).toEqual({
      credits: 3,
      ledgerCount: 0,
      taskCount: 0,
    })
  })

  it('replays duplicate client requests without double charging', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const input = taskInput({ clientRequestId: 'duplicate-image-task', estimatedCredits: 9 })

    const first = await repository.createWithCharge(input, memberPrincipal)
    const second = await repository.createWithCharge(input, memberPrincipal)
    const persisted = store.read((state) => ({
      credits: state.users.find((user) => user.id === memberPrincipal.userId)!.credits,
      ledgerCount: state.ledger.filter((entry) => entry.id === 'generation-duplicate-image-task').length,
      taskCount: state.tasks.filter((item) => item.clientRequestId === input.clientRequestId).length,
    }))

    expect(second.id).toBe(first.id)
    expect(persisted).toEqual({
      credits: 277,
      ledgerCount: 1,
      taskCount: 1,
    })
  })

  it('preempts an active script task when the same account starts a new project', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const firstInput = taskInput({
      clientRequestId: 'script-task-first',
      kind: 'text',
      provider: 'text',
      label: '生成第 1 集',
      estimatedCredits: 12,
      metadata: { generationStage: 'script-generate', scriptOperation: 'generate', mode: 'quick' },
    })
    const secondInput = {
      ...firstInput,
      clientRequestId: 'script-task-second',
      projectId: 'project-second-script',
      label: '生成另一个项目的第 1 集',
    }

    const first = await repository.createWithCharge(firstInput, memberPrincipal)
    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === first.id)!
      task.status = 'running'
    })
    const second = await repository.createWithCharge(secondInput, memberPrincipal)
    const persisted = store.read((state) => ({
      credits: state.users.find((user) => user.id === memberPrincipal.userId)!.credits,
      firstTask: state.tasks.find((item) => item.id === first.id),
      secondTask: state.tasks.find((item) => item.id === second.id),
      ledgerCount: state.ledger.filter((entry) => entry.type === 'generation').length,
    }))

    expect(second.id).not.toBe(first.id)
    expect(persisted).toMatchObject({
      credits: 262,
      firstTask: {
        status: 'cancelled',
        progress: 100,
        error: '同一账号已启动新的剧本任务，本任务已自动停止',
        metadata: {
          providerState: 'cancelled',
          cancelReason: 'new_script_task',
          accountPreemptedAt: expect.any(String),
          cancelledAt: expect.any(String),
          queueHiddenAt: expect.any(String),
        },
        leaseToken: null,
      },
      secondTask: { status: 'queued', projectId: 'project-second-script' },
      ledgerCount: 2,
    })
  })

  it('preempts slow asset suggestions when the same account starts a script task', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const suggestionInput = taskInput({
      clientRequestId: 'asset-suggestion-before-script',
      kind: 'text',
      provider: 'text',
      label: '资产建议',
      estimatedCredits: 2,
      metadata: {
        generationStage: 'script-asset-suggestions',
        scriptOperation: 'suggest-assets',
      },
    })
    const scriptInput = taskInput({
      clientRequestId: 'script-after-asset-suggestion',
      kind: 'text',
      provider: 'text',
      label: '生成第 1 集',
      estimatedCredits: 12,
      metadata: { generationStage: 'script-generate', scriptOperation: 'generate', mode: 'quick' },
    })

    const suggestion = await repository.createWithCharge(suggestionInput, memberPrincipal)
    await store.mutate((state) => {
      state.tasks.find((task) => task.id === suggestion.id)!.status = 'running'
    })
    const script = await repository.createWithCharge(scriptInput, memberPrincipal)

    expect(store.read((state) => state.tasks.find((task) => task.id === suggestion.id))).toMatchObject({
      status: 'cancelled',
      progress: 100,
      error: '同一账号已启动新的剧本任务，本任务已自动停止',
      metadata: {
        cancelReason: 'new_script_task',
        queueHiddenAt: expect.any(String),
      },
    })
    expect(script).toMatchObject({ status: 'queued', metadata: { scriptOperation: 'generate' } })
  })

  it('does not preempt an active script task when asset suggestions are requested', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const scriptInput = taskInput({
      clientRequestId: 'script-before-asset-suggestion',
      kind: 'text',
      provider: 'text',
      label: '生成第 1 集',
      estimatedCredits: 12,
      metadata: { generationStage: 'script-generate', scriptOperation: 'generate', mode: 'quick' },
    })
    const suggestionInput = taskInput({
      clientRequestId: 'asset-suggestion-after-script',
      kind: 'text',
      provider: 'text',
      label: '资产建议',
      estimatedCredits: 2,
      metadata: {
        generationStage: 'script-asset-suggestions',
        scriptOperation: 'suggest-assets',
      },
    })

    const script = await repository.createWithCharge(scriptInput, memberPrincipal)
    await store.mutate((state) => {
      state.tasks.find((task) => task.id === script.id)!.status = 'running'
    })
    await repository.createWithCharge(suggestionInput, memberPrincipal)

    expect(store.read((state) => state.tasks.find((task) => task.id === script.id))).toMatchObject({
      status: 'running',
      metadata: { scriptOperation: 'generate' },
    })
  })

  it('rejects next-episode generation before charging when a draft episode exists', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => {
      const now = new Date().toISOString()
      const draft: ScriptEpisode = {
        id: 'draft-episode-for-generation-guard',
        projectId: 'project-midnight-film',
        tenantId: memberPrincipal.tenantId,
        episodeNumber: 1,
        title: '第 1 集',
        content: '',
        draftContent: '场次：S01｜剧情：草稿内容。',
        status: 'draft',
        summary: '',
        continuityState: {},
        revision: 1,
        lastEditedBy: memberPrincipal.userId,
        createdAt: now,
        updatedAt: now,
      }
      state.scriptEpisodes.push(draft)
    })
    const repository = new GenerationTaskRepository(store)
    const input = taskInput({
      clientRequestId: 'script-segment-draft-guard',
      kind: 'text',
      provider: 'text',
      label: '续写下一集',
      estimatedCredits: 12,
      metadata: { generationStage: 'script-generate', scriptOperation: 'generate', mode: 'segment' },
    })

    await expect(repository.createWithCharge(input, memberPrincipal)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SCRIPT_EPISODE_DRAFT_EXISTS',
    })
    expect(
      store.read((state) => ({
        credits: state.users.find((user) => user.id === memberPrincipal.userId)!.credits,
        taskCount: state.tasks.filter((item) => item.clientRequestId === input.clientRequestId).length,
      })),
    ).toEqual({ credits: 286, taskCount: 0 })
  })

  it('tags running cancellations with a resource lock', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const input = taskInput({
      clientRequestId: 'cancel-lock-task',
      kind: 'video',
      metadata: { shotId: 'shot-1' },
    })

    const task = await repository.createWithCharge(input, memberPrincipal)
    await store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)!
      stored.status = 'running'
      stored.metadata = {
        ...stored.metadata,
        providerName: 'stringx-seedance',
        providerTaskId: 'remote-cancel-lock-task',
      }
    })

    const result = await repository.deleteFromQueue(task.id, memberPrincipal)

    expect(result).toMatchObject({ outcome: 'deleted', refund: false })
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'cancelled',
      metadata: {
        cancelResourceLockKind: 'video-shot',
        cancelResourceLockKey: 'shotId:shot-1',
        providerCancelRequestedAt: expect.any(String),
      },
    })
  })
})

function generationTask(overrides: Partial<GenerationTask> = {}): GenerationTask {
  const now = new Date().toISOString()
  return {
    id: 'generation-task',
    clientRequestId: 'generation-task-request',
    projectId: 'project-midnight-film',
    tenantId: memberPrincipal.tenantId,
    userId: memberPrincipal.userId,
    kind: 'video',
    label: 'Film preview',
    prompt: '',
    negativePrompt: '',
    provider: 'seedance',
    model: null,
    tier: null,
    metadata: {},
    status: 'queued',
    progress: 0,
    estimatedCredits: 0,
    attempts: 1,
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
    ...overrides,
  }
}

function generationTaskRow(task: GenerationTask) {
  return {
    id: task.id,
    client_request_id: task.clientRequestId,
    project_id: task.projectId,
    tenant_id: task.tenantId,
    user_id: task.userId,
    kind: task.kind,
    label: task.label,
    prompt: task.prompt,
    negative_prompt: task.negativePrompt,
    provider: task.provider,
    model: task.model,
    tier: task.tier ?? null,
    metadata: task.metadata,
    status: task.status,
    progress: task.progress,
    estimated_credits: task.estimatedCredits,
    attempts: task.attempts ?? 0,
    max_attempts: task.maxAttempts ?? 3,
    lease_owner_id: task.leaseOwnerId ?? null,
    lease_token: task.leaseToken ?? null,
    lease_acquired_at: task.leaseAcquiredAt ?? null,
    lease_heartbeat_at: task.leaseHeartbeatAt ?? null,
    lease_expires_at: task.leaseExpiresAt ?? null,
    result_url: task.resultUrl,
    outputs: task.outputs,
    error: task.error,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  }
}

function taskInput(overrides: Partial<CreateGenerationTask> = {}): CreateGenerationTask {
  return {
    clientRequestId: 'generation-task',
    projectId: 'project-midnight-film',
    kind: 'image',
    label: 'Atomic generation task',
    provider: 'local',
    estimatedCredits: 6,
    ...overrides,
  }
}
