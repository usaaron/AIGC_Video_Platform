import { describe, expect, it } from 'vitest'
import { deliveryContractSchema, type GenerationTask } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import { verifyFrozenDeliveryContract } from './deliveryContractFreeze.js'

const principal = { tenantId: 'tenant-seqora-demo', userId: 'user-member', roles: ['member'] as ['member'] }

const contract = deliveryContractSchema.parse({
  version: 'seqora.delivery.v1',
  intent: { mode: 'shot', projectId: 'project-midnight-film', shotIds: ['shot-1'] },
  expectedArtifact: { type: 'video', count: 1 },
  must: [
    { id: 'media-url', statement: '当前视频候选可读', source: 'provider' },
    { id: 'content-review', statement: '内容审核通过', source: 'review' },
  ],
})

async function fixture(metadata: Record<string, unknown> = {}) {
  const store = new AppStore(null)
  await store.initialize()
  const task = buildQueuedGenerationTask(
    {
      clientRequestId: 'delivery-contract',
      projectId: 'project-midnight-film',
      provider: 'seedance',
      kind: 'video',
      label: '合同测试任务',
      estimatedCredits: 18,
      metadata,
    },
    principal,
    '2026-10-13T00:00:00.000Z',
  )
  await store.mutate((state) => {
    state.tasks = [task]
  })
  return { store, task, repository: new GenerationTaskRepository(store) }
}

describe('delivery contract task persistence', () => {
  it('freezes one scoped task contract and preserves optimistic concurrency', async () => {
    const { store, task, repository } = await fixture({ deliveryContract: { forged: true } })
    const expectedUpdatedAt = task.updatedAt
    const frozen = await repository.freezeDeliveryContract(task.id, contract, expectedUpdatedAt, principal)
    expect(frozen.projectId).toBe(contract.intent.projectId)
    expect(verifyFrozenDeliveryContract(frozen.metadata.deliveryContract)).toBe(true)
    expect(frozen.metadata.deliveryContract).toMatchObject({
      contractHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      frozenAt: expect.any(String),
    })
    expect(store.read((state) => state.tasks[0]?.metadata.deliveryContract)).toEqual(
      frozen.metadata.deliveryContract,
    )

    await expect(
      repository.freezeDeliveryContract(task.id, contract, expectedUpdatedAt, principal),
    ).rejects.toMatchObject({ code: 'DELIVERY_CONTRACT_STALE' })
    await expect(
      repository.freezeDeliveryContract(task.id, contract, frozen.updatedAt, principal),
    ).rejects.toMatchObject({ code: 'DELIVERY_CONTRACT_ALREADY_FROZEN' })
  })

  it('enforces project scope and tenant/user authorization before writing', async () => {
    const { task, repository } = await fixture()
    const wrongProject = deliveryContractSchema.parse({
      ...contract,
      intent: { ...contract.intent, projectId: 'project-other' },
    })
    await expect(
      repository.freezeDeliveryContract(task.id, wrongProject, task.updatedAt, principal),
    ).rejects.toMatchObject({ code: 'DELIVERY_CONTRACT_SCOPE_MISMATCH' })
    await expect(
      repository.freezeDeliveryContract(task.id, contract, task.updatedAt, {
        ...principal,
        tenantId: 'tenant-other',
        roles: ['owner'],
      }),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' })
  })

  it('strips a user supplied contract before the repository freeze boundary', async () => {
    const { task } = await fixture({ deliveryContract: { forged: true } })
    expect((task as GenerationTask).metadata.deliveryContract).toBeUndefined()
  })
})
