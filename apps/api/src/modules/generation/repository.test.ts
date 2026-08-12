import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import type { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'

const memberPrincipal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

describe('GenerationTaskRepository charged creation', () => {
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
