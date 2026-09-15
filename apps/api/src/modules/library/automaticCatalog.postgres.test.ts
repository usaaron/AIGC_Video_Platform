import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createProjectSchema,
  createGenerationTaskSchema,
  createAssetSchema,
  type Principal,
} from '@seqora/contracts'
import { AppStore, defaultAssetAttributes } from '../../infra/store.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { UserRepository } from '../users/repository.js'
import { ProjectRepository } from '../projects/repository.js'
import { GenerationTaskRepository } from '../generation/repository.js'
import { AssetLibraryRepository } from './repository.js'
import { StoreCreditLedger } from '../billing/creditLedger.js'
import { automaticCatalogItems } from './automaticCatalog.js'

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

describe('automatic catalog in Postgres', () => {
  it('indexes complete outputs, trims identically, avoids repeat inserts and isolates accounts', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await new UserRepository(store, database).bootstrapFromStore()
    const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
    const projects = new ProjectRepository(store, database)
    const project = await projects.create(
      createProjectSchema.parse({ name: '目录测试', contentType: 'short-drama', aspectRatio: '9:16' }),
      principal,
    )
    await projects.update(project.id, { script: '\n\t林晚回家。\u3000\r\n' }, principal)
    await projects.writeScriptEpisodeDraft(project.id, null, '林晚回家。', principal)
    const tasks = new GenerationTaskRepository(store, null, database)
    const task = await tasks.createWithCharge(
      createGenerationTaskSchema.parse({
        projectId: project.id,
        clientRequestId: 'catalog-test-image',
        kind: 'image',
        provider: 'mock',
        label: '候选图',
        estimatedCredits: 1,
      }),
      principal,
    )
    await database.query("UPDATE generation_tasks SET status='completed', metadata=$2::jsonb WHERE id=$1", [
      task.id,
      JSON.stringify({
        previewStorageKey: `${principal.tenantId}/${project.id}/generated/${task.id}-film-preview.mp4`,
        previewSize: 24,
        generatedOutputs: [
          {
            view: 'front',
            storageKey: 'another-tenant/private/image.png',
            contentType: 'image/png',
            size: 8,
          },
          {
            view: 'single',
            storageKey: `${principal.tenantId}/${project.id}/generated/${task.id}-single.png`,
            contentType: 'image/png',
            size: 8,
          },
        ],
      }),
    ])
    const assetInput = createAssetSchema.parse({
      kind: 'character',
      name: '林晚',
      reuseExisting: true,
      sourceMode: 'generate',
      attributes: defaultAssetAttributes('character'),
    })
    const [assetA, assetB] = await Promise.all([
      projects.createAsset(project.id, assetInput, principal),
      projects.createAsset(project.id, assetInput, principal),
    ])
    expect(assetA?.id).toBe(assetB?.id)
    const ledger = new StoreCreditLedger(store, new UserRepository(store, database), false, database)
    const balance = (await ledger.summary(principal)).credits
    const reference = await ledger.reserveRecoverable(principal, 3, 'catalog-episode-billing', '分集测试')
    expect(await ledger.reserveRecoverable(principal, 3, 'catalog-episode-billing', '分集测试')).toBe(
      reference,
    )
    await ledger.refundReservation(principal, reference, '失败退款')
    await ledger.reserveRecoverable(principal, 3, 'catalog-episode-billing', '分集测试')
    expect((await ledger.summary(principal)).credits).toBe(balance - 3)
    const library = new AssetLibraryRepository(store, database)
    await Promise.all([library.syncGenerated(principal), library.syncGenerated(principal)])
    const result = await library.list({ deleted: 'active', page: 1, pageSize: 24 }, principal)
    expect(result.items.map((item) => item.kind).sort()).toEqual(['final-cut', 'image', 'script'])
    expect(await automaticCatalogItems(database, store, principal)).toEqual([])
    const script = result.items.find((item) => item.kind === 'script')!
    expect(script.sourceSnapshot.inlineContent).toBe('林晚回家。')
    await library.delete(script.id, principal)
    await library.syncGenerated(principal)
    expect((await library.list({ deleted: 'active', page: 1, pageSize: 24 }, principal)).total).toBe(2)
    expect(await automaticCatalogItems(database, store, { ...principal, userId: 'user-free' })).toEqual([])
    await projects.archive(project.id, principal)
    expect((await library.list({ deleted: 'active', page: 1, pageSize: 24 }, principal)).total).toBe(2)
  }, 60_000)
})
