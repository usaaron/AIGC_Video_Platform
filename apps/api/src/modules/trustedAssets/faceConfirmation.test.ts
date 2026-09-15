import {
  assetId,
  createFaceConfirmationStore,
  face,
  principal,
  projectId,
} from './faceConfirmationFixtures.js'
import { faceConfirmationResponseSchema, type Asset, type TrustedPortrait } from '@seqora/contracts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../app.js'
import { loadConfig } from '../../config.js'
import type { AppStore } from '../../infra/store.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import type { AssetLibraryProvider } from '../../core/generation/volcArkAssetLibraryProvider.js'
import { ProjectRepository } from '../projects/repository.js'
import { automaticFaceRegistrationId } from './faceConfirmationService.js'
import { StoreCreditLedger } from '../billing/creditLedger.js'
import { UserRepository } from '../users/repository.js'
import { GenerationTaskRepository } from '../generation/repository.js'

let postgres: PostgresAuthFixture
let database: AccountDatabase
let app: Awaited<ReturnType<typeof buildApp>>
let cookie: string
let store: AppStore
const route = `/api/v1/projects/${projectId}/assets/${assetId}/face-confirmation`
const dispatch = vi.fn(async () => undefined)
const provider: AssetLibraryProvider = {
  createVirtualGroup: vi.fn(async () => {
    throw new Error('No paid calls in tests')
  }),
  createVirtualAsset: vi.fn(async () => {
    throw new Error('No paid calls in tests')
  }),
  getPortrait: vi.fn(async () => {
    throw new Error('No provider calls in confirmation')
  }),
  listPortraits: vi.fn(async () => []),
  listAuthorizedPortraits: vi.fn(async () => []),
}

beforeAll(async () => {
  postgres = await startPostgresAuthFixture()
}, 120_000)
beforeEach(async () => {
  await postgres.reset()
  dispatch.mockReset().mockResolvedValue(undefined)
  store = await createFaceConfirmationStore()
  database = new AccountDatabase(postgres.connectionString)
  await new UserRepository(store, database).bootstrapFromStore()
  await new ProjectRepository(store, database).importFromStore()
  await new GenerationTaskRepository(store, null, database).importFromStore()
  app = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'local',
      DATABASE_URL: postgres.connectionString,
      DATA_FILE: ':memory:',
      STORAGE_DRIVER: 'local',
      PUBLIC_API_BASE_URL: 'https://test.example',
      // Build the production transactional outbox; dispatcher override prevents any Redis connection.
      TASK_QUEUE_DRIVER: 'bullmq',
      REDIS_URL: 'redis://127.0.0.1:1',
    }),
    store,
    startWorker: false,
    taskDispatcher: { dispatch },
    assetLibraryProvider: provider,
  })
  cookie = await login('member@seqora.local', 'MemberPassword123!')
}, 30_000)
afterEach(async () => {
  const activeApp = app
  app = undefined!
  const activeDatabase = database
  database = undefined!
  await activeApp?.close()
  await activeDatabase?.close()
})
afterAll(async () => {
  await postgres?.close()
})

describe('face confirmation HTTP + PostgreSQL', { timeout: 30_000 }, () => {
  it('serializes manual and automatic submissions for the same face before charging', async () => {
    const repository = new ProjectRepository(store, database)
    await repository.confirmFace(projectId, assetId, face(), principal)
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) => (index % 2 ? manual(`manual-concurrent-${index}`) : confirm())),
    )
    const tasks = responses.map((response) => {
      expect([200, 202]).toContain(response.statusCode)
      return response.statusCode === 202 ? response.json() : response.json().registrationTask
    })
    expect(new Set(tasks.map((task) => task.id)).size).toBe(1)
    expect(tasks[0].estimatedCredits).toBe(1)
    expect(await chargeAmounts(tasks[0].clientRequestId)).toEqual([-1])
    expect(
      (
        await database.query(
          "SELECT count(*)::int AS count FROM generation_tasks WHERE provider='asset-library'",
        )
      ).rows[0].count,
    ).toBe(1)
    expect(
      (
        await database.query('SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id=$1', [
          tasks[0].id,
        ])
      ).rows[0].count,
    ).toBe(1)
  })

  it('does not charge manual clicks for an active portrait, with or without historical task', async () => {
    const first = (await confirm()).json()
    const repository = new ProjectRepository(store, database)
    await repository.updateTrustedPortrait(first.asset, portrait(face().id), 'ai-virtual', principal)
    await database.query("UPDATE generation_tasks SET status='completed' WHERE id=$1", [
      first.registrationTask.id,
    ])
    const repeats = await Promise.all([manual('active-manual-1'), manual('active-manual-2')])
    for (const result of repeats) {
      expect(result.statusCode).toBe(202)
      expect(result.json().id).toBe(first.registrationTask.id)
    }
    expect(await chargeAmounts('active-manual-1')).toEqual([])
    expect(await chargeAmounts('active-manual-2')).toEqual([])
    // A legacy binding may have no corresponding registration job.
    await database.query("UPDATE generation_tasks SET metadata=metadata - 'faceReferenceId' WHERE id=$1", [
      first.registrationTask.id,
    ])
    expect((await manual('active-without-history')).statusCode).toBe(409)
    expect(await chargeAmounts('active-without-history')).toEqual([])
  })

  it('permits one explicit manual retry after failure and automatic confirmation reuses it', async () => {
    const first = (await confirm()).json()
    await database.query("UPDATE generation_tasks SET status='failed', error='Provider failed' WHERE id=$1", [
      first.registrationTask.id,
    ])
    const retries = await Promise.all([manual('retry-1'), manual('retry-2')])
    expect(retries.map((result) => result.statusCode)).toEqual([202, 202])
    expect(retries[0].json().id).toBe(retries[1].json().id)
    expect(retries[0].json().id).not.toBe(first.registrationTask.id)
    expect((await confirm()).json()).toMatchObject({
      registrationTask: { id: retries[0].json().id },
      registrationError: null,
    })
    expect(await chargeAmounts(retries[0].json().clientRequestId)).toEqual([-1])
  })

  it('confirms and queues once under concurrent calls; preserves approved body and versions', async () => {
    const replies = await Promise.all(Array.from({ length: 5 }, () => confirm()))
    const results = replies.map((reply) => {
      expect(reply.statusCode).toBe(200)
      return faceConfirmationResponseSchema.parse(reply.json())
    })
    const task = results[0]!.registrationTask!
    expect(new Set(results.map((result) => result.registrationTask?.id)).size).toBe(1)
    expect(task.estimatedCredits).toBe(1)
    expect(results[0]!.asset.attributes).toMatchObject({
      faceStatus: 'approved',
      faceReference: face(),
      bodyStatus: 'pending',
    })
    expect(await chargeAmounts(task.clientRequestId)).toEqual([-1])
    expect(
      (
        await database.query('SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id=$1', [
          task.id,
        ])
      ).rows[0].count,
    ).toBe(1)
    const repository = new ProjectRepository(store, database)
    const asset = (await repository.findOwnedAsset(projectId, assetId, principal))!
    if (asset.attributes.type !== 'character') throw new Error('Expected character')
    await repository.updateAsset(
      projectId,
      assetId,
      {
        attributes: {
          ...asset.attributes,
          bodyStatus: 'approved',
          bodyReference: face('body'),
          activeAppearanceVariantId: 'look-one',
          appearanceVariants: [
            {
              id: 'look-one',
              name: '造型',
              bodyReference: face('body'),
              turnaroundReferences: [],
              turnaroundLayout: 'sheet',
              createdAt: asset.createdAt,
              updatedAt: asset.updatedAt,
            },
          ],
        },
      },
      principal,
    )
    const repeated = (await confirm()).json()
    expect(repeated.asset.attributes).toMatchObject({
      bodyStatus: 'approved',
      bodyReference: face('body'),
      activeAppearanceVariantId: 'look-one',
      appearanceVariants: [{ id: 'look-one' }],
    })
    expect(await chargeAmounts(task.clientRequestId)).toEqual([-1])
    expect(provider.createVirtualAsset).not.toHaveBeenCalled()
  })

  it('queues a new face while the old face task is running and rejects stale provider writeback', async () => {
    const first = (await confirm()).json()
    const oldAsset = first.asset as Asset
    await database.query("UPDATE generation_tasks SET status='running' WHERE id=$1", [
      first.registrationTask.id,
    ])
    const next = (await confirm('face-two')).json()
    expect(next.registrationTask.id).not.toBe(first.registrationTask.id)
    expect(next.registrationTask.metadata.faceReferenceId).toBe('face-two-single')
    expect(next.asset.attributes).toMatchObject({ trustedPortrait: null, faceReference: face('face-two') })
    const repository = new ProjectRepository(store, database)
    await expect(
      repository.updateTrustedPortrait(oldAsset, portrait('face-one-single'), 'ai-virtual', principal),
    ).rejects.toMatchObject({ code: 'FACE_CONFIRMATION_CHANGED' })
    expect((await repository.findOwnedAsset(projectId, assetId, principal))!.attributes).toMatchObject({
      trustedPortrait: null,
      faceReference: face('face-two'),
    })
  })

  it('atomically rejects a late resource A callback after resource B is bound to the same face', async () => {
    const repository = new ProjectRepository(store, database)
    const confirmed = (await repository.confirmFace(projectId, assetId, face(), principal))!
    const observed = (await repository.updateTrustedPortrait(
      confirmed,
      { ...portrait(face().id), assetId: 'resource-a' },
      'ai-virtual',
      principal,
    ))!
    await repository.updateTrustedPortrait(
      observed,
      { ...portrait(face().id), assetId: 'resource-b', status: 'processing' },
      'ai-virtual',
      principal,
      'bind',
    )
    await expect(
      repository.updateTrustedPortrait(
        observed,
        { ...portrait(face().id), assetId: 'resource-a' },
        'ai-virtual',
        principal,
      ),
    ).rejects.toMatchObject({ code: 'PORTRAIT_BINDING_CHANGED' })
    expect((await repository.findOwnedAsset(projectId, assetId, principal))!.attributes).toMatchObject({
      trustedPortrait: { assetId: 'resource-b', status: 'processing' },
      faceReference: face(),
    })
  })

  it.each(['active', 'processing'] as const)('reuses %s portrait without a new fee', async (status) => {
    const repository = new ProjectRepository(store, database)
    const asset = (await repository.confirmFace(projectId, assetId, face(), principal))!
    await repository.updateTrustedPortrait(
      asset,
      { ...portrait('face-one-single'), status },
      'ai-virtual',
      principal,
    )
    const result = (await confirm()).json()
    expect(result).toMatchObject({
      registrationTask: null,
      registrationError: null,
      asset: { attributes: { trustedPortrait: { status } } },
    })
    expect(await chargeAmounts(automaticFaceRegistrationId(asset, face()))).toEqual([])
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('preserves a failed/archived task on repeated confirmation without repeated fees', async () => {
    const first = (await confirm()).json()
    await database.query(
      "UPDATE generation_tasks SET status='failed', error='审核失败', metadata=metadata || '{\"queueHiddenAt\":\"2026-09-15T00:00:00Z\"}'::jsonb WHERE id=$1",
      [first.registrationTask.id],
    )
    const result = (await confirm()).json()
    expect(result).toMatchObject({
      registrationTask: { id: first.registrationTask.id, status: 'failed' },
      registrationError: '审核失败',
      asset: { attributes: { faceStatus: 'approved' } },
    })
    expect(await chargeAmounts(first.registrationTask.clientRequestId)).toEqual([-1])
  })

  it('refunds a failed automatic job once and keeps repeated confirmation from recharging', async () => {
    const first = (await confirm()).json()
    const task = first.registrationTask
    await database.query("UPDATE generation_tasks SET status='failed', error='Provider failed' WHERE id=$1", [
      task.id,
    ])
    const ledger = new StoreCreditLedger(store, new UserRepository(store, database), false, database)
    await Promise.all([ledger.refundGeneration(task), ledger.refundGeneration(task)])
    expect((await confirm()).json()).toMatchObject({
      registrationTask: { id: task.id, status: 'failed' },
      registrationError: 'Provider failed',
    })
    const refunded = await database.query(
      'SELECT amount FROM billing_ledger_entries WHERE id=$1 UNION ALL SELECT amount FROM organization_billing_ledger_entries WHERE id=$1',
      [`refund-${task.id}`],
    )
    expect(refunded.rows.map((row) => Number(row.amount))).toEqual([1])
    expect(await chargeAmounts(task.clientRequestId)).toEqual([-1])
  })

  it('keeps confirmation on insufficient credits and safely creates one task after top-up', async () => {
    await database.query('UPDATE billing_accounts SET credits=0')
    await database.query('UPDATE organization_billing_accounts SET credits=0')
    const response = await confirm()
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      registrationTask: null,
      registrationError: expect.any(String),
      asset: { attributes: { faceStatus: 'approved' } },
    })
    expect(await chargeAmounts(automaticFaceRegistrationId(response.json().asset, face()))).toEqual([])
    await database.query('UPDATE billing_accounts SET credits=10')
    await database.query('UPDATE organization_billing_accounts SET credits=10')
    const task = (await confirm()).json().registrationTask
    expect(task.status).toBe('queued')
    expect(await chargeAmounts(task.clientRequestId)).toEqual([-1])
  })

  it('returns saved asset plus queued task if dispatch fails after commit', async () => {
    dispatch.mockRejectedValueOnce(new Error('Queue disconnected'))
    const response = await confirm()
    expect(response.statusCode).toBe(200)
    const first = response.json()
    expect(first).toMatchObject({
      registrationTask: { status: 'queued' },
      registrationError: expect.any(String),
      asset: { attributes: { faceStatus: 'approved' } },
    })
    expect((await confirm()).json().registrationTask.id).toBe(first.registrationTask.id)
    expect(await chargeAmounts(first.registrationTask.clientRequestId)).toEqual([-1])
    expect(
      (
        await database.query('SELECT status FROM outbox_events WHERE aggregate_id=$1', [
          first.registrationTask.id,
        ])
      ).rows[0].status,
    ).toBe('pending')
  })

  it.each(['animal', 'authorized-real', 'import'] as const)(
    'confirms %s without automatic registration or source downgrading',
    async (mode) => {
      const repository = new ProjectRepository(store, database)
      const asset = (await repository.findOwnedAsset(projectId, assetId, principal))!
      if (asset.attributes.type !== 'character') throw new Error('Expected character')
      await repository.updateAsset(
        projectId,
        assetId,
        {
          sourceMode: mode === 'import' ? 'import' : 'generate',
          attributes: {
            ...asset.attributes,
            subjectType: mode === 'animal' ? 'animal' : 'human',
            portraitSource: mode === 'authorized-real' ? 'authorized-real' : 'ai-virtual',
          },
        },
        principal,
      )
      const response = await confirm()
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        registrationTask: null,
        registrationError: null,
        asset: {
          attributes: {
            faceStatus: 'approved',
            portraitSource: mode === 'authorized-real' ? 'authorized-real' : 'ai-virtual',
          },
        },
      })
      expect(dispatch).not.toHaveBeenCalled()
    },
  )

  it('requires login, ownership and a persisted completed face output', async () => {
    expect(
      (await app.inject({ method: 'POST', url: route, payload: { faceReference: face() } })).statusCode,
    ).toBe(401)
    const other = await login('owner@seqora.local', 'OwnerPassword123!')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route,
          headers: { cookie: other },
          payload: { faceReference: face() },
        })
      ).statusCode,
    ).toBe(404)
    expect((await confirm('missing-task')).statusCode).toBe(409)
    await database.query("UPDATE generation_tasks SET status='running' WHERE id='face-one'")
    expect((await confirm()).statusCode).toBe(409)
    await database.query(
      "UPDATE generation_tasks SET status='completed', metadata=metadata || '{\"generationStage\":\"body\"}'::jsonb WHERE id='face-one'",
    )
    expect((await confirm()).statusCode).toBe(409)
    expect(dispatch).not.toHaveBeenCalled()
  })
})

async function confirm(id = 'face-one') {
  return app.inject({ method: 'POST', url: route, headers: { cookie }, payload: { faceReference: face(id) } })
}
async function manual(clientRequestId: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/generation/tasks',
    headers: { cookie },
    payload: {
      clientRequestId,
      projectId,
      kind: 'text',
      label: 'Manual registration',
      provider: 'asset-library',
      estimatedCredits: 999,
      metadata: { assetId, generationStage: 'trusted-portrait', trustedAssetOperation: 'register-virtual' },
    },
  })
}
async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  })
  expect(response.statusCode).toBe(200)
  const session = response.cookies.find((item) => item.name === 'seqora_session')!
  return `seqora_session=${session.value}`
}
async function chargeAmounts(clientId: string): Promise<number[]> {
  const result = await database.query(
    'SELECT amount FROM billing_ledger_entries WHERE id=$1 UNION ALL SELECT amount FROM organization_billing_ledger_entries WHERE id=$1',
    [`generation-${clientId}`],
  )
  return result.rows.map((row) => Number(row.amount))
}
function portrait(faceId: string): TrustedPortrait {
  return {
    assetId: `upstream-${faceId}`,
    groupId: 'test-group',
    groupType: 'AIGC',
    faceReferenceId: faceId,
    name: 'Test',
    status: 'active',
    previewUrl: null,
    errorCode: null,
    errorMessage: null,
    checkedAt: new Date().toISOString(),
  }
}
