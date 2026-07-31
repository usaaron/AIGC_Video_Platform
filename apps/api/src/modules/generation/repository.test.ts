import type { CreateGenerationTask, Principal } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'

const creator: Principal = {
  userId: 'user-creator',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

describe('GenerationTaskRepository charged creation', () => {
  it('creates the task, charges credits, and writes ledger in one transaction', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new GenerationTaskRepository(store)
    const input = taskInput({ clientRequestId: 'atomic-image-task', estimatedCredits: 7 })

    const task = await repository.createWithCharge(input, creator)
    const persisted = store.read((state) => ({
      credits: state.users.find((user) => user.id === creator.userId)!.credits,
      ledger: state.ledger.find((entry) => entry.id === 'generation-atomic-image-task'),
      taskCount: state.tasks.filter((item) => item.clientRequestId === input.clientRequestId).length,
    }))

    expect(task).toMatchObject({
      clientRequestId: input.clientRequestId,
      estimatedCredits: 7,
      status: 'queued',
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
      state.users.find((user) => user.id === creator.userId)!.credits = 3
    })
    const repository = new GenerationTaskRepository(store)
    const input = taskInput({ clientRequestId: 'insufficient-image-task', estimatedCredits: 4 })

    await expect(repository.createWithCharge(input, creator)).rejects.toMatchObject({
      statusCode: 402,
      code: 'INSUFFICIENT_CREDITS',
    })

    expect(
      store.read((state) => ({
        credits: state.users.find((user) => user.id === creator.userId)!.credits,
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

    const first = await repository.createWithCharge(input, creator)
    const second = await repository.createWithCharge(input, creator)
    const persisted = store.read((state) => ({
      credits: state.users.find((user) => user.id === creator.userId)!.credits,
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

    const task = await repository.createWithCharge(input, creator)
    await store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)!
      stored.status = 'running'
      stored.metadata = {
        ...stored.metadata,
        providerName: 'stringx-seedance',
        providerTaskId: 'remote-cancel-lock-task',
      }
    })

    const result = await repository.deleteFromQueue(task.id, creator)

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
