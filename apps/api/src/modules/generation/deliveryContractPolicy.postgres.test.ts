import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import {
  createProjectSchema,
  deliveryContractSchema,
  DELIVERY_PROVIDER_COMPLETION_REQUIREMENT,
  videoReviewVersion,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { UserRepository } from '../users/repository.js'
import { ProjectRepository } from '../projects/repository.js'
import { GenerationTaskRepository } from './repository.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import { freezeDeliveryContract, verifyFrozenDeliveryContract } from './deliveryContractFreeze.js'
import { buildDeliveryVerificationSnapshot } from './deliveryVerification.js'
import { providerCompletionEvidence } from './providerCompletionEvidence.js'
import { GenerationService } from './service.js'
import { registerGenerationRoutes } from './routes.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
let fixture: PostgresAuthFixture
let database: AccountDatabase
beforeAll(async () => {
  fixture = await startPostgresAuthFixture()
  database = new AccountDatabase(fixture.connectionString)
}, 120_000)
afterAll(async () => {
  await database?.close()
  await fixture?.close()
})

async function setup(kind: GenerationTask['kind'] = 'video', provider = 'seedance') {
  const store = new AppStore(null)
  await store.initialize()
  await new UserRepository(store, database).bootstrapFromStore()
  const project = await new ProjectRepository(store, database).create(
    createProjectSchema.parse({
      name: 'Isolated contract policy',
      contentType: 'short-drama',
      aspectRatio: '9:16',
    }),
    principal,
  )
  const task = buildQueuedGenerationTask(
    {
      clientRequestId: `policy-${project.id}`,
      projectId: project.id,
      provider,
      kind,
      label: 'Policy fixture',
      estimatedCredits: 18,
    },
    principal,
    '2026-10-14T00:00:00.000Z',
  )
  await store.mutate((state) => {
    state.tasks = [task]
  })
  const repository = new GenerationTaskRepository(store, null, database)
  expect((await repository.importFromStore()).tasks.inserted).toBe(1)
  const draft = deliveryContractSchema.parse({
    version: 'seqora.delivery.v1',
    intent: { mode: 'shot', projectId: project.id, shotIds: [] },
    expectedArtifact: { type: 'video', count: 1 },
    must: [{ id: 'media-url', statement: '媒体可读', source: 'provider' }],
  })
  return { task, store, repository, draft }
}

describe('new delivery contract policy in Postgres', () => {
  it.each(['invalid', 'mismatch', 'valid'] as const)(
    'uses persisted %s receipt facts and never mirrors a rejected freeze',
    async (receiptState) => {
      const { task, store, repository, draft } = await setup()
      const completed = {
        ...task,
        status: 'completed' as const,
        attempts: 1,
        progress: 100,
        resultUrl: `/api/v1/generation/tasks/${task.id}/content`,
      }
      const media = {
        view: 'single',
        storageKey: `${task.tenantId}/${task.projectId}/generated/${task.id}-video.mp4`,
        contentType: 'video/mp4',
        size: 24,
        sha256: 'a'.repeat(64),
      }
      completed.outputs = [
        { id: `${task.id}-video`, url: completed.resultUrl, mediaType: 'video', view: 'single' },
      ]
      completed.metadata = {
        providerName: 'stringx-seedance',
        providerTaskId: 'synthetic-provider-task',
        providerState: 'completed',
        generatedOutputs: [media],
        videoStorageKey: media.storageKey,
        videoContentType: media.contentType,
        videoSize: media.size,
      }
      const receipt = {
        version: 'seqora.provider-completion.v1',
        attestation: 'server-observed-completion',
        tenantId: task.tenantId,
        projectId: task.projectId,
        taskId: receiptState === 'mismatch' ? 'another-task' : task.id,
        provider: 'seedance',
        providerName: 'stringx-seedance',
        providerTaskId: 'synthetic-provider-task',
        attempts: 1,
        completedAt: task.updatedAt,
        mediaVersion: videoReviewVersion(completed),
        media,
      }
      completed.metadata.providerCompletionReceipt = receiptState === 'invalid' ? { damaged: true } : receipt
      await database.query(
        'UPDATE generation_tasks SET status = $2, attempts = $3, progress = $4, result_url = $5, outputs = $6::jsonb, metadata = $7::jsonb WHERE id = $1',
        [
          task.id,
          completed.status,
          completed.attempts,
          completed.progress,
          completed.resultUrl,
          JSON.stringify(completed.outputs),
          JSON.stringify(completed.metadata),
        ],
      )
      const persistedBefore = await repository.findById(task.id, principal)
      const cachedBefore = store.read((state) => state.tasks.find((current) => current.id === task.id))
      expect(cachedBefore?.metadata.providerCompletionReceipt).toBeUndefined()
      expect(providerCompletionEvidence(persistedBefore!).reason).toBe(
        receiptState === 'valid'
          ? 'verified'
          : receiptState === 'invalid'
            ? 'invalid-receipt'
            : 'receipt-mismatch',
      )
      const app = Fastify()
      app.addHook('onRequest', async (request) => {
        request.principal = principal
      })
      await registerGenerationRoutes(
        app,
        new GenerationService(repository, {
          dispatch: async () => {
            throw new Error('Contract freeze must not dispatch')
          },
        }),
      )
      try {
        const response = await app.inject({
          method: 'POST',
          url: `/generation/tasks/${task.id}/delivery-contract`,
          payload: {
            expectedUpdatedAt: task.updatedAt,
            contract: { ...draft, must: [...draft.must, DELIVERY_PROVIDER_COMPLETION_REQUIREMENT] },
          },
        })
        if (receiptState === 'valid') {
          expect(response.statusCode).toBe(200)
          expect(verifyFrozenDeliveryContract(response.json().metadata.deliveryContract)).toBe(true)
          expect(response.json().metadata.providerCompletionReceipt).toEqual(receipt)
          expect((await repository.findById(task.id, principal))?.metadata.deliveryContract).toEqual(
            response.json().metadata.deliveryContract,
          )
          expect(store.read((state) => state.tasks.find((current) => current.id === task.id))).toEqual(
            response.json(),
          )
        } else {
          expect(response.statusCode).toBe(409)
          expect(response.json()).toMatchObject({ code: 'DELIVERY_CONTRACT_WRITE_CONFLICT' })
          expect(response.json().metadata).toBeUndefined()
          expect(await repository.findById(task.id, principal)).toEqual(persistedBefore)
          expect(store.read((state) => state.tasks.find((current) => current.id === task.id))).toEqual(
            cachedBefore,
          )
        }
      } finally {
        await app.close()
      }
    },
  )

  it.each([undefined, 'stringx-seedance', 'dora-router-seedance'])(
    'requires completion even without receipt/provider metadata (%s)',
    async (providerName) => {
      const { task, store, repository, draft } = await setup()
      if (providerName)
        await database.query('UPDATE generation_tasks SET metadata = $2::jsonb WHERE id = $1', [
          task.id,
          JSON.stringify({ providerName }),
        ])
      const before = await repository.findById(task.id, principal)
      await expect(
        repository.freezeDeliveryContract(task.id, draft, task.updatedAt, principal),
      ).rejects.toMatchObject({ statusCode: 400, code: 'DELIVERY_PROVIDER_COMPLETION_REQUIRED' })
      expect(await repository.findById(task.id, principal)).toEqual(before)
      expect(
        store.read(
          (state) => state.tasks.find((current) => current.id === task.id)?.metadata.deliveryContract,
        ),
      ).toBeUndefined()
      const requested = { ...draft, must: [...draft.must, DELIVERY_PROVIDER_COMPLETION_REQUIREMENT] }
      const frozen = await repository.freezeDeliveryContract(task.id, requested, task.updatedAt, principal)
      expect((frozen.metadata.deliveryContract as typeof draft).must).toEqual(requested.must)
      expect(verifyFrozenDeliveryContract(frozen.metadata.deliveryContract)).toBe(true)
      const recovered = new GenerationTaskRepository(null, null, database)
      expect((await recovered.findById(task.id, principal))?.metadata.deliveryContract).toEqual(
        frozen.metadata.deliveryContract,
      )
      expect(draft.must).toHaveLength(1)
    },
  )

  it('rejects provider-accepted without provider-completed', async () => {
    const { task, repository, draft } = await setup()
    draft.must = [{ id: 'provider-accepted', source: 'provider', statement: '提交已受理' }]
    await expect(
      repository.freezeDeliveryContract(task.id, draft, task.updatedAt, principal),
    ).rejects.toMatchObject({ code: 'DELIVERY_PROVIDER_COMPLETION_REQUIRED' })
  })

  it.each([
    ['image', 'hunyuan'],
    ['video', 'local-compose'],
  ] as const)('does not require remote completion for %s/%s', async (kind, provider) => {
    const { task, repository, draft } = await setup(kind, provider)
    const frozen = await repository.freezeDeliveryContract(task.id, draft, task.updatedAt, principal)
    expect((frozen.metadata.deliveryContract as typeof draft).must).toEqual(draft.must)
  })

  it('requires completion for new Image2 image contracts in Postgres', async () => {
    const { task, repository, draft } = await setup('image', 'img2')
    draft.intent.mode = 'asset'
    draft.expectedArtifact.type = 'image'
    await expect(
      repository.freezeDeliveryContract(task.id, draft, task.updatedAt, principal),
    ).rejects.toMatchObject({ code: 'DELIVERY_PROVIDER_COMPLETION_REQUIRED' })
    const required = { ...draft, must: [...draft.must, DELIVERY_PROVIDER_COMPLETION_REQUIREMENT] }
    const frozen = await repository.freezeDeliveryContract(task.id, required, task.updatedAt, principal)
    expect((frozen.metadata.deliveryContract as typeof draft).must).toEqual(required.must)
    expect((await repository.findById(task.id, principal))?.metadata.deliveryContract).toEqual(
      frozen.metadata.deliveryContract,
    )
  })

  it('retains auth/scope/version priorities and preserves old frozen contracts and hashes', async () => {
    const { task, store, repository, draft } = await setup()
    for (const other of [
      { ...principal, tenantId: 'other-tenant' },
      { ...principal, userId: 'other-user' },
    ]) {
      await expect(
        repository.freezeDeliveryContract(task.id, draft, task.updatedAt, other),
      ).rejects.toMatchObject({ statusCode: 404, code: 'TASK_NOT_FOUND' })
    }
    await expect(
      repository.freezeDeliveryContract(
        task.id,
        { ...draft, intent: { ...draft.intent, projectId: 'other-project' } },
        task.updatedAt,
        principal,
      ),
    ).rejects.toMatchObject({ code: 'DELIVERY_CONTRACT_SCOPE_MISMATCH' })
    await expect(
      repository.freezeDeliveryContract(task.id, draft, '2026-10-13T00:00:00.000Z', principal),
    ).rejects.toMatchObject({ code: 'DELIVERY_CONTRACT_STALE' })
    const legacy = freezeDeliveryContract(draft, '2026-10-14T00:01:00.000Z')
    await database.query('UPDATE generation_tasks SET metadata = $2::jsonb WHERE id = $1', [
      task.id,
      JSON.stringify({ deliveryContract: legacy }),
    ])
    await expect(
      repository.freezeDeliveryContract(task.id, draft, task.updatedAt, principal),
    ).rejects.toMatchObject({ code: 'DELIVERY_CONTRACT_ALREADY_FROZEN' })
    const saved = (await repository.findById(task.id, principal))!
    const before = JSON.stringify(saved)
    expect(verifyFrozenDeliveryContract(saved.metadata.deliveryContract)).toBe(true)
    const verification = await buildDeliveryVerificationSnapshot(saved, null, '2026-10-14T00:02:00.000Z')
    expect(verification.contract).toEqual(legacy)
    expect(verification.contract?.must.map((requirement) => requirement.id)).toEqual(['media-url'])
    expect(JSON.stringify(await repository.findById(task.id, principal))).toBe(before)
    expect(
      store.read((state) => state.tasks.find((current) => current.id === task.id)?.metadata.deliveryContract),
    ).toBeUndefined()
  })
})
