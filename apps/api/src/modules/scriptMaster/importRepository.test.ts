import { beforeEach, describe, expect, it } from 'vitest'
import { createProjectSchema, scriptMasterImportRequestSchema, type Principal } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { ProjectRepository } from '../projects/repository.js'
import { ScriptMasterImportRepository } from './importRepository.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
let store: AppStore
let projects: ProjectRepository
let imports: ScriptMasterImportRepository
let target: string
beforeEach(async () => {
  store = new AppStore(null)
  await store.initialize()
  projects = new ProjectRepository(store)
  target = (await projects.create(createProjectSchema.parse({ name: '批量导入测试' }), principal)).id
  imports = new ScriptMasterImportRepository(store)
})
function payload(overrides: Record<string, unknown> = {}) {
  return scriptMasterImportRequestSchema.parse({
    contractVersion: 'script_master_delivery.v2',
    targetProjectId: target,
    sourceProjectId: 'independent-project',
    sourceRevision: 1,
    idempotencyKey: 'import-test-1',
    episodes: [
      {
        sourceEpisodeId: 'episode-1',
        episodeNumber: 1,
        title: '重逢',
        content: '林岚在院子重逢。',
        shots: [
          { sourceShotId: 'shot-1', title: '重逢', framing: '中景', duration: 5, prompt: '林岚走进院子。' },
        ],
      },
    ],
    assets: [{ sourceAssetId: 'character:林岚', kind: 'character', name: '林岚', description: '青年' }],
    ...overrides,
  })
}
describe('bulk Script Master import', () => {
  it('imports a complete workspace without creating generation tasks or charging credits', async () => {
    const ledger = store.read((s) => structuredClone(s.ledger))
    const tasks = store.read((s) => s.tasks.length)
    expect(await imports.import(payload(), principal)).toMatchObject({
      importedEpisodes: 1,
      importedAssets: 1,
      importedShots: 1,
    })
    const workspace = (await projects.workspace(target, principal))!
    expect(workspace.shots[0]?.scriptEpisodeId).toBe(workspace.scriptEpisodes[0]?.id)
    expect(workspace.assets[0]?.attributes).toMatchObject({
      subjectType: 'human',
      gender: 'unspecified',
      faceStatus: 'pending',
    })
    expect(store.read((s) => s.ledger)).toEqual(ledger)
    expect(store.read((s) => s.tasks.length)).toBe(tasks)
  })
  it('serializes duplicate delivery and keeps IDs stable across revisions', async () => {
    const input = payload()
    const [a, b] = await Promise.all([imports.import(input, principal), imports.import(input, principal)])
    expect(b).toEqual(a)
    const original = (await projects.workspace(target, principal))!
    const next = payload({ sourceRevision: 2, idempotencyKey: 'import-test-2' })
    next.episodes[0]!.content = '修订正文'
    expect(await imports.import(next, principal)).toMatchObject({
      importedEpisodes: 0,
      updatedEpisodes: 1,
      importedShots: 0,
      importedAssets: 0,
    })
    const updated = (await projects.workspace(target, principal))!
    expect(updated.scriptEpisodes).toHaveLength(1)
    expect(updated.scriptEpisodes[0]?.id).toBe(original.scriptEpisodes[0]?.id)
    expect(updated.shots).toHaveLength(1)
  })
  it('rejects changed content with the same key and lower revisions', async () => {
    await imports.import(payload({ sourceRevision: 3 }), principal)
    await expect(imports.import(payload(), principal)).rejects.toMatchObject({
      code: 'IMPORT_IDEMPOTENCY_CONFLICT',
    })
    await expect(
      imports.import(payload({ idempotencyKey: 'import-old-1' }), principal),
    ).rejects.toMatchObject({ code: 'IMPORT_STALE_REVISION' })
  })
  it('validates the entire batch before writing any earlier episode', async () => {
    await projects.saveScriptEpisode(target, null, '用户原稿', principal)
    const input = payload()
    input.episodes.unshift({ ...input.episodes[0]!, sourceEpisodeId: 'new-episode', episodeNumber: 2 })
    await expect(imports.import(input, principal)).rejects.toMatchObject({ code: 'IMPORT_EPISODE_CONFLICT' })
    const workspace = (await projects.workspace(target, principal))!
    expect(workspace.scriptEpisodes).toHaveLength(1)
    expect(workspace.assets).toHaveLength(0)
  })
  it('preserves confirmed character and registered face on later imports', async () => {
    await imports.import(payload(), principal)
    const asset = (await projects.workspace(target, principal))!.assets[0]!
    await projects.updateAsset(
      target,
      asset.id,
      { status: 'confirmed', imageUrl: '/saved-face.png' },
      principal,
    )
    const updated = payload({ idempotencyKey: 'import-new-1', sourceRevision: 2 })
    updated.assets[0]!.description = '新版描述'
    expect(await imports.import(updated, principal)).toMatchObject({ preservedAssets: 1, updatedAssets: 0 })
    expect((await projects.workspace(target, principal))!.assets[0]!.imageUrl).toBe('/saved-face.png')
  })
  it('does not overwrite another user or organization even with a matching receipt', async () => {
    await imports.import(payload(), principal)
    await expect(imports.import(payload(), { ...principal, userId: 'someone-else' })).rejects.toMatchObject({
      statusCode: 404,
    })
    await expect(imports.import(payload(), { ...principal, tenantId: 'another-org' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })
  it('supports asset-only import and rejects duplicate source identifiers', async () => {
    expect(await imports.import(payload({ episodes: [] }), principal)).toMatchObject({
      importedEpisodes: 0,
      importedAssets: 1,
    })
    const input = payload()
    expect(
      scriptMasterImportRequestSchema.safeParse({ ...input, assets: [...input.assets, ...input.assets] })
        .success,
    ).toBe(false)
  })
  it('keeps episode playback order when earlier episodes are imported later', async () => {
    const second = payload()
    second.episodes[0]!.episodeNumber = 2
    second.episodes[0]!.sourceEpisodeId = 'episode-2'
    await imports.import(second, principal)
    await imports.import(payload({ idempotencyKey: 'import-earlier-1' }), principal)
    const shots = (await projects.workspace(target, principal))!.shots.sort((a, b) => a.order - b.order)
    expect(shots.map((s) => s.episodeNumber)).toEqual([1, 2])
  })
  it('rejects changed scripts without current storyboards and preserves removed source shots', async () => {
    await imports.import(payload(), principal)
    const next = payload({ sourceRevision: 2, idempotencyKey: 'import-new-2' })
    next.episodes[0]!.content = '新版正文'
    delete next.episodes[0]!.shots
    await expect(imports.import(next, principal)).rejects.toMatchObject({
      code: 'IMPORT_STORYBOARD_REQUIRED',
    })
    next.episodes[0]!.shots = []
    await expect(imports.import(next, principal)).rejects.toMatchObject({
      code: 'IMPORT_SHOT_REMOVAL_CONFLICT',
    })
    expect((await projects.workspace(target, principal))!.scriptEpisodes[0]!.content).toBe('林岚在院子重逢。')
  })
  it('keeps selected video media when a newer storyboard changes a shot', async () => {
    await imports.import(payload(), principal)
    await store.mutate((state) => {
      state.shots.find((s) => s.projectId === target)!.selectedVideoTaskId = 'existing-video'
    })
    const next = payload({ sourceRevision: 2, idempotencyKey: 'import-new-3' })
    next.episodes[0]!.shots![0]!.prompt = '改为在门外等待'
    await expect(imports.import(next, principal)).rejects.toMatchObject({ code: 'IMPORT_SHOT_HAS_MEDIA' })
    expect((await projects.workspace(target, principal))!.shots[0]!.selectedVideoTaskId).toBe(
      'existing-video',
    )
  })
  it('adopts revised shot order and inserts new shots in place with correct continuity', async () => {
    const first = payload()
    const one = first.episodes[0]!.shots![0]!
    const two = { ...one, sourceShotId: 'shot-2', title: '门外' }
    first.episodes[0]!.shots!.push(two)
    await imports.import(first, principal)
    const next = payload({ sourceRevision: 2, idempotencyKey: 'reordered-import' })
    next.episodes[0]!.shots = [two, { ...one, sourceShotId: 'shot-3', title: '转身' }, one]
    await imports.import(next, principal)
    const shots = (await projects.workspace(target, principal))!.shots.sort((a, b) => a.order - b.order)
    expect(shots.map((s) => s.title)).toEqual(['门外', '转身', '重逢'])
    expect(shots.map((s) => s.continuityMode)).toEqual(['independent', 'continue', 'continue'])
    expect(shots.map((s) => s.episodeBreakBefore)).toEqual([true, false, false])
    expect(shots.map((s) => s.order)).toEqual([1, 2, 3])
  })
})
