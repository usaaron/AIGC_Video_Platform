import { describe, expect, it } from 'vitest'
import {
  deliveryContractSchema,
  DELIVERY_PROVIDER_COMPLETION_REQUIREMENT,
  type GenerationTask,
} from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import { freezeDeliveryContract, verifyFrozenDeliveryContract } from './deliveryContractFreeze.js'
import { buildDeliveryVerificationSnapshot } from './deliveryVerification.js'

const principal = { tenantId: 'tenant-seqora-demo', userId: 'user-member', roles: ['member'] as ['member'] }

const contract = deliveryContractSchema.parse({
  version: 'seqora.delivery.v1',
  intent: { mode: 'shot', projectId: 'project-midnight-film', shotIds: ['shot-1'] },
  expectedArtifact: { type: 'video', count: 1 },
  must: [
    DELIVERY_PROVIDER_COMPLETION_REQUIREMENT,
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
  it.each([{}, { providerName: 'stringx-seedance' }, { providerCompletionReceipt: null }])(
    'rejects missing completion requirements independently of legacy metadata %j',
    async (metadata) => {
      const { task, repository, store } = await fixture()
      await store.mutate((state) => {
        state.tasks[0]!.metadata = metadata
      })
      const draft = {
        ...contract,
        must: contract.must.filter((requirement) => requirement.id !== 'provider-completed'),
      }
      const before = store.read((state) => state.tasks[0])
      await expect(
        repository.freezeDeliveryContract(task.id, draft, task.updatedAt, principal),
      ).rejects.toMatchObject({ statusCode: 400, code: 'DELIVERY_PROVIDER_COMPLETION_REQUIRED' })
      expect(store.read((state) => state.tasks[0])).toEqual(before)
      expect(draft.must.some((requirement) => requirement.id === 'provider-completed')).toBe(false)
    },
  )

  it('does not accept provider-accepted as a substitute for provider-completed', async () => {
    const { task, repository } = await fixture()
    const draft = {
      ...contract,
      must: [{ id: 'provider-accepted', source: 'provider' as const, statement: 'Provider 接受任务' }],
    }
    await expect(
      repository.freezeDeliveryContract(task.id, draft, task.updatedAt, principal),
    ).rejects.toMatchObject({ code: 'DELIVERY_PROVIDER_COMPLETION_REQUIRED' })
  })

  it.each([
    ['image', 'img2'],
    ['video', 'local-compose'],
  ] as const)('does not impose the video provider policy on %s/%s', async (kind, provider) => {
    const { task, repository, store } = await fixture()
    await store.mutate((state) => {
      state.tasks[0]!.kind = kind
      state.tasks[0]!.provider = provider
    })
    const draft = {
      ...contract,
      must: [{ id: 'media-url', source: 'provider' as const, statement: '当前媒体可读' }],
    }
    const frozen = await repository.freezeDeliveryContract(task.id, draft, task.updatedAt, principal)
    expect((frozen.metadata.deliveryContract as typeof contract).must).toEqual(draft.must)
  })

  it('checks authorization, project, version and already-frozen state before new-freeze policy', async () => {
    const { task, repository, store } = await fixture()
    const draft = {
      ...contract,
      must: [{ id: 'media-url', source: 'provider' as const, statement: '历史要求' }],
    }
    for (const other of [
      { ...principal, tenantId: 'tenant-other' },
      { ...principal, userId: 'user-other' },
    ]) {
      await expect(
        repository.freezeDeliveryContract(task.id, draft, task.updatedAt, other),
      ).rejects.toMatchObject({ statusCode: 404, code: 'TASK_NOT_FOUND' })
    }
    await expect(
      repository.freezeDeliveryContract(
        task.id,
        { ...draft, intent: { ...draft.intent, projectId: 'other' } },
        task.updatedAt,
        principal,
      ),
    ).rejects.toMatchObject({ code: 'DELIVERY_CONTRACT_SCOPE_MISMATCH' })
    await expect(
      repository.freezeDeliveryContract(task.id, draft, '2026-10-12T00:00:00.000Z', principal),
    ).rejects.toMatchObject({ code: 'DELIVERY_CONTRACT_STALE' })
    const legacy = freezeDeliveryContract(draft, '2026-10-13T00:01:00.000Z')
    await store.mutate((state) => {
      state.tasks[0]!.metadata.deliveryContract = legacy
    })
    await expect(
      repository.freezeDeliveryContract(task.id, draft, task.updatedAt, principal),
    ).rejects.toMatchObject({ code: 'DELIVERY_CONTRACT_ALREADY_FROZEN' })
    const stored = store.read((state) => state.tasks[0]!)
    expect(verifyFrozenDeliveryContract(stored.metadata.deliveryContract)).toBe(true)
    const snapshot = await buildDeliveryVerificationSnapshot(stored, null, '2026-10-14T00:00:00.000Z')
    expect(snapshot.contract).toEqual(legacy)
    expect(snapshot.contract?.must.some((requirement) => requirement.id === 'provider-completed')).toBe(false)
    expect(store.read((state) => state.tasks[0]!.metadata.deliveryContract)).toEqual(legacy)
  })

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
