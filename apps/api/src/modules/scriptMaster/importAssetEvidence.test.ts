import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProjectSchema,
  scriptMasterImportRequestSchema,
  type Principal,
  type ScriptAssetEvidence,
} from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { ProjectRepository } from '../projects/repository.js'
import { scriptEpisodeFromRow, type ScriptEpisodeRow } from '../projects/repositoryData.js'
import { planImport } from './importPlan.js'
import { writeImportEntities } from './importPersistence.js'
import { ScriptMasterImportRepository } from './importRepository.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
const content = '场次：S01｜角色：林夏｜场景：车站｜动作：林夏撑开雨伞。'
let store: AppStore
let projects: ProjectRepository
let imports: ScriptMasterImportRepository
let target: string

function evidence(text = content, appearance = '蓝衣'): ScriptAssetEvidence {
  return {
    version: 'script_asset_evidence.v1',
    contentHash: createHash('sha256').update(text.trim()).digest('hex'),
    complete: { character: true, scene: true, prop: true },
    assets: [
      { kind: 'character', name: '林夏', facts: { 外观: appearance, 性别: '女' }, sourceSceneIds: ['S01'] },
    ],
  }
}

function payload(revision = 1, assetEvidence: ScriptAssetEvidence | undefined = evidence()) {
  return scriptMasterImportRequestSchema.parse({
    contractVersion: 'script_master_delivery.v2',
    targetProjectId: target,
    sourceProjectId: 'source-evidence',
    sourceRevision: revision,
    idempotencyKey: `evidence-import-${revision}`,
    episodes: [
      {
        sourceEpisodeId: 'episode-1',
        episodeNumber: 1,
        title: '重逢',
        content,
        assetEvidence,
        shots: [
          { sourceShotId: 'shot-1', title: '重逢', framing: '中景', duration: 5, prompt: '林夏走进车站。' },
        ],
      },
    ],
  })
}

async function workspace() {
  return (await projects.workspace(target, principal))!
}

beforeEach(async () => {
  store = new AppStore(null)
  await store.initialize()
  projects = new ProjectRepository(store)
  target = (await projects.create(createProjectSchema.parse({ name: '资产依据导入' }), principal)).id
  imports = new ScriptMasterImportRepository(store)
})

describe('Script Master episode asset evidence persistence', () => {
  it('persists explicit evidence without creating assets, tasks or billing entries', async () => {
    const ledger = store.read((state) => structuredClone(state.ledger))
    const taskCount = store.read((state) => state.tasks.length)
    const input = payload()
    input.episodes[0]!.content = `  ${content}\n`
    const parsed = scriptMasterImportRequestSchema.parse(input)
    expect(await imports.import(parsed, principal)).toMatchObject({ importedEpisodes: 1, importedAssets: 0 })
    const state = await workspace()
    expect(state.scriptEpisodes[0]!.continuityState).toEqual({ scriptAssetEvidence: evidence() })
    expect(state.scriptEpisodes[0]!.content).toBe(content)
    expect(state.assets).toHaveLength(0)
    expect(store.read((data) => data.tasks.length)).toBe(taskCount)
    expect(store.read((data) => data.ledger)).toEqual(ledger)
    parsed.episodes[0]!.assetEvidence!.assets[0]!.facts['外观'] = '调用方修改'
    expect((await workspace()).scriptEpisodes[0]!.continuityState).toEqual({
      scriptAssetEvidence: evidence(),
    })
  })

  it('rejects a mismatched text hash with 400 before any entity is persisted', async () => {
    const input = payload()
    input.episodes.push({
      ...input.episodes[0]!,
      sourceEpisodeId: 'episode-2',
      episodeNumber: 2,
      assetEvidence: evidence('别的正文'),
    })
    await expect(imports.import(input, principal)).rejects.toMatchObject({
      statusCode: 400,
      code: 'IMPORT_ASSET_EVIDENCE_HASH_MISMATCH',
    })
    expect((await workspace()).scriptEpisodes).toHaveLength(0)
    expect((await workspace()).shots).toHaveLength(0)
  })

  it('updates only evidence while preserving a draft, other state, manual summary and existing shot media', async () => {
    await imports.import(payload(), principal)
    await store.mutate((state) => {
      const episode = state.scriptEpisodes.find((item) => item.projectId === target)!
      episode.draftContent = '用户正在写的新草稿'
      episode.status = 'draft'
      episode.summary = '用户手工摘要'
      episode.continuityState['custom'] = { note: '保留用户设定' }
      state.shots.find((item) => item.projectId === target)!.selectedVideoTaskId = 'selected-video'
      state.projects.find((item) => item.id === target)!.script = '主项目手工编排的正文'
    })
    const before = await workspace()
    const next = payload(2, evidence(content, '绿色雨衣'))
    delete next.episodes[0]!.shots
    expect(await imports.import(next, principal)).toMatchObject({ updatedEpisodes: 1, updatedShots: 0 })
    const after = await workspace()
    expect(after.scriptEpisodes[0]).toMatchObject({
      id: before.scriptEpisodes[0]!.id,
      content,
      draftContent: '用户正在写的新草稿',
      status: 'draft',
      summary: '用户手工摘要',
      revision: before.scriptEpisodes[0]!.revision + 1,
      continuityState: {
        custom: { note: '保留用户设定' },
        scriptAssetEvidence: evidence(content, '绿色雨衣'),
      },
    })
    expect(after.shots).toEqual(before.shots)
    expect(after.project.script).toBe(before.project.script)
  })

  it('accepts legacy delivery and removes only obsolete evidence when text is unchanged', async () => {
    await imports.import(payload(), principal)
    await store.mutate((state) => {
      const episode = state.scriptEpisodes.find((item) => item.projectId === target)!
      episode.continuityState['manual'] = { approved: true }
      episode.draftContent = '未保存草稿'
    })
    const legacy = payload(2)
    delete legacy.episodes[0]!.assetEvidence
    delete legacy.episodes[0]!.shots
    expect(await imports.import(legacy, principal)).toMatchObject({ updatedEpisodes: 1, updatedShots: 0 })
    expect((await workspace()).scriptEpisodes[0]).toMatchObject({
      draftContent: '未保存草稿',
      continuityState: { manual: { approved: true } },
    })
    expect((await workspace()).scriptEpisodes[0]!.continuityState).not.toHaveProperty('scriptAssetEvidence')
    const again = { ...legacy, sourceRevision: 3, idempotencyKey: 'legacy-again' }
    expect(await imports.import(again, principal)).toMatchObject({ updatedEpisodes: 0 })
  })

  it('keeps duplicate imports and equivalent JSONB key ordering stable across source revisions', async () => {
    const input = payload()
    const [first, second] = await Promise.all([
      imports.import(input, principal),
      imports.import(input, principal),
    ])
    expect(second).toEqual(first)
    const before = await workspace()
    const next = payload(2)
    next.episodes[0]!.assetEvidence!.assets[0]!.facts = { 性别: '女', 外观: '蓝衣' }
    expect(await imports.import(next, principal)).toMatchObject({ updatedEpisodes: 0, updatedShots: 0 })
    expect((await workspace()).scriptEpisodes).toEqual(before.scriptEpisodes)
    expect((await workspace()).shots).toEqual(before.shots)
  })

  it('includes evidence changes in receipt identity and retains revision protection', async () => {
    await imports.import(payload(2), principal)
    await expect(imports.import(payload(2, evidence(content, '绿衣')), principal)).rejects.toMatchObject({
      code: 'IMPORT_IDEMPOTENCY_CONFLICT',
    })
    await expect(imports.import(payload(1, evidence(content, '绿衣')), principal)).rejects.toMatchObject({
      code: 'IMPORT_STALE_REVISION',
    })
    await expect(imports.import(payload(3), { ...principal, tenantId: 'other-org' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('keeps text and title changes subject to existing storyboard protection', async () => {
    await imports.import(payload(), principal)
    const next = payload(2)
    delete next.episodes[0]!.shots
    next.episodes[0]!.title = '新标题'
    await expect(imports.import(next, principal)).rejects.toMatchObject({
      code: 'IMPORT_STORYBOARD_REQUIRED',
    })
    next.episodes[0]!.title = '重逢'
    next.episodes[0]!.content = '新正文'
    next.episodes[0]!.assetEvidence = evidence('新正文')
    await expect(imports.import(next, principal)).rejects.toMatchObject({
      code: 'IMPORT_STORYBOARD_REQUIRED',
    })
  })

  it('resets old continuity and draft state when importing a changed episode body', async () => {
    const first = payload()
    delete first.episodes[0]!.shots
    await imports.import(first, principal)
    await store.mutate((state) => {
      const episode = state.scriptEpisodes.find((item) => item.projectId === target)!
      episode.continuityState['manual'] = '旧设定'
      episode.draftContent = '旧草稿'
      episode.status = 'draft'
    })
    const next = payload(2)
    delete next.episodes[0]!.shots
    next.episodes[0]!.content = '新的已确认正文'
    next.episodes[0]!.assetEvidence = evidence(next.episodes[0]!.content, '雨衣')
    await imports.import(next, principal)
    expect((await workspace()).scriptEpisodes[0]).toMatchObject({
      content: '新的已确认正文',
      draftContent: '',
      status: 'saved',
      continuityState: { scriptAssetEvidence: evidence('新的已确认正文', '雨衣') },
    })
    expect((await workspace()).scriptEpisodes[0]!.continuityState).not.toHaveProperty('manual')
  })

  it('round-trips evidence through the existing PostgreSQL JSONB writer and row parser without a database', async () => {
    const plan = planImport(await workspace(), payload(), principal.userId)
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => ({ rows: [], rowCount: 0 }))
    await writeImportEntities({ query } as unknown as PoolClient, plan)
    const call = query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO script_episodes'))!
    const rows = JSON.parse(call[1]![0] as string) as ScriptEpisodeRow[]
    expect(rows[0]!.continuity_state).toEqual({ scriptAssetEvidence: evidence() })
    expect(scriptEpisodeFromRow(rows[0]!)).toEqual(plan.episodes[0])
  })
})
