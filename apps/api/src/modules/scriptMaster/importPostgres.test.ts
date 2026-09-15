import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectSchema, scriptMasterImportRequestSchema, type Principal } from '@seqora/contracts'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { UserRepository } from '../users/repository.js'
import { ProjectRepository } from '../projects/repository.js'
import { ScriptMasterImportRepository } from './importRepository.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
let fixture: PostgresAuthFixture
let db: AccountDatabase
let store: AppStore
let projects: ProjectRepository
let imports: ScriptMasterImportRepository
let target: string
beforeAll(async () => {
  fixture = await startPostgresAuthFixture()
}, 120_000)
beforeEach(async () => {
  await fixture.reset()
  db = new AccountDatabase(fixture.connectionString)
  store = new AppStore(null)
  await store.initialize()
  await new UserRepository(store, db).bootstrapFromStore()
  projects = new ProjectRepository(store, db)
  target = (await projects.create(createProjectSchema.parse({ name: 'PG导入验收' }), principal)).id
  imports = new ScriptMasterImportRepository(store, db)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await db?.close()
})
afterAll(async () => {
  await fixture?.close()
})
function payload() {
  return scriptMasterImportRequestSchema.parse({
    contractVersion: 'script_master_delivery.v2',
    targetProjectId: target,
    sourceProjectId: 'source-pg',
    sourceRevision: 1,
    idempotencyKey: 'pg-import-1',
    episodes: [
      {
        sourceEpisodeId: 'ep-1',
        episodeNumber: 1,
        title: '第一集',
        content: '验收正文',
        shots: [
          { sourceShotId: 's-1', title: '第一镜', framing: '中景', duration: 5, prompt: '院子里的人物' },
        ],
      },
    ],
    assets: [{ sourceAssetId: 'character:林岚', name: '林岚', kind: 'character' }],
  })
}
describe('Postgres atomic bulk import', () => {
  it('commits all entities and receipt atomically and deduplicates across repository instances', async () => {
    const input = payload()
    const second = new ScriptMasterImportRepository(store, db)
    const [a, b] = await Promise.all([imports.import(input, principal), second.import(input, principal)])
    expect(b).toEqual(a)
    const workspace = (await projects.workspace(target, principal))!
    expect(workspace.scriptEpisodes).toHaveLength(1)
    expect(workspace.assets).toHaveLength(1)
    expect(workspace.shots).toHaveLength(1)
    expect(workspace.shots[0]!.scriptEpisodeId).toBe(workspace.scriptEpisodes[0]!.id)
    expect((await db.query('SELECT * FROM script_master_imports')).rowCount).toBe(1)
  })
  it('rolls back entity writes if receipt persistence fails and allows retry', async () => {
    await db.query(
      'ALTER TABLE script_master_imports ADD CONSTRAINT forced_import_failure CHECK (source_revision > 99)',
    )
    try {
      await expect(imports.import(payload(), principal)).rejects.toThrow()
      const workspace = (await projects.workspace(target, principal))!
      expect(workspace.scriptEpisodes).toHaveLength(0)
      expect(workspace.assets).toHaveLength(0)
      expect(workspace.shots).toHaveLength(0)
    } finally {
      await db.query('ALTER TABLE script_master_imports DROP CONSTRAINT forced_import_failure')
    }
    expect(await imports.import(payload(), principal)).toMatchObject({
      importedEpisodes: 1,
      importedShots: 1,
      importedAssets: 1,
    })
  })
  it('keeps ownership restrictions and replays receipts after a process restart', async () => {
    const receipt = await imports.import(payload(), principal)
    const restarted = new ScriptMasterImportRepository(store, db)
    expect(await restarted.import(payload(), principal)).toEqual(receipt)
    await expect(restarted.import(payload(), { ...principal, userId: 'user-owner' })).rejects.toMatchObject({
      statusCode: 404,
    })
    await expect(
      restarted.import(payload(), { ...principal, tenantId: 'another-tenant' }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
  it('reorders newly imported earlier episodes with deferred unique constraints', async () => {
    const second = payload()
    second.episodes[0]!.episodeNumber = 2
    second.episodes[0]!.sourceEpisodeId = 'ep-2'
    await imports.import(second, principal)
    const first = payload()
    first.idempotencyKey = 'pg-import-first'
    await imports.import(first, principal)
    expect(
      (await projects.workspace(target, principal))!.shots.map((s) => [s.order, s.episodeNumber]),
    ).toEqual([
      [1, 1],
      [2, 2],
    ])
  })
})
