import { beforeEach, describe, expect, it } from 'vitest'
import {
  createProjectSchema,
  generateShotsRequestSchema,
  scriptMasterImportRequestSchema,
  type Principal,
} from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { ProjectRepository } from '../projects/repository.js'
import { ProjectService } from '../projects/service.js'
import { ScriptMasterImportRepository } from './importRepository.js'
import { writeImportEntities } from './importPersistence.js'
import { planImport } from './importPlan.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
const text = (first = '核对原件') =>
  `第1集《原件》\n\n预计时长：90秒\n\n正式正文\n\nFADE IN / 淡入：\n\nINT. 档案室 - 夜\n\n△ 林岚${first}。\n\n林岚\n\n保存编号。\n\nEXT. 车站 - 日\n\n△ 周原收好背包。\n\n周原\n\n按时出发。\n\nFADE OUT / 淡出。\n`
let store: AppStore
let repository: ProjectRepository
let service: ProjectService
let imports: ScriptMasterImportRepository
let target: string
const workspace = () => repository.workspace(target, principal)
function payload(content = text(), revision = 1, revise = false) {
  return scriptMasterImportRequestSchema.parse({
    contractVersion: 'script_master_delivery.v2',
    targetProjectId: target,
    sourceProjectId: 'quick-fixture',
    sourceRevision: revision,
    idempotencyKey: `production-revision-${revision}-${revise}`,
    ...(revise ? { storyboardRevision: 'preserve-history' } : {}),
    episodes: [{ sourceEpisodeId: 'one', episodeNumber: 1, title: '原件', content }],
  })
}
beforeEach(async () => {
  store = new AppStore(null)
  await store.initialize()
  repository = new ProjectRepository(store)
  service = new ProjectService(repository)
  imports = new ScriptMasterImportRepository(store)
  target = (
    await repository.create(
      createProjectSchema.parse({ name: '修订测试', contentType: 'short-drama' }),
      principal,
    )
  ).id
  await imports.import(payload(), principal)
  await service.generateShots(
    target,
    generateShotsRequestSchema.parse({ mode: 'scene', maxShots: 120 }),
    principal,
  )
})

describe('explicit production revisions', () => {
  it('keeps protection by default and stores old media while revising only changed scenes', async () => {
    await store.mutate((state) => {
      for (const shot of state.shots.filter((shot) => shot.projectId === target)) {
        shot.imageUrl = `/fixture-${shot.id}.png`
        shot.selectedVideoTaskId = `video-${shot.id}`
        shot.referenceImages = [{ url: `https://fixture.invalid/${shot.id}.png` }]
      }
    })
    const before = (await workspace())!
    const ledger = store.read((state) => structuredClone(state.ledger))
    const tasks = store.read((state) => structuredClone(state.tasks))
    await expect(imports.import(payload(text('复核新版编号'), 2), principal)).rejects.toMatchObject({
      code: 'IMPORT_STORYBOARD_REQUIRED',
    })
    expect(await workspace()).toEqual(before)
    const input = payload(text('复核新版编号'), 2, true)
    const receipt = await imports.import(input, principal)
    const after = (await workspace())!
    const history = after.scriptEpisodes[0]!.continuityState.scriptProductionHistory as Array<any>
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ content: before.scriptEpisodes[0]!.content, shots: before.shots })
    expect(after.shots[0]!.id).not.toBe(before.shots[0]!.id)
    expect(after.shots[0]).toMatchObject({ imageUrl: null, prompt: expect.stringContaining('复核新版编号') })
    expect(after.shots[0]!.selectedVideoTaskId).toBeUndefined()
    expect(after.shots[0]!.referenceImages).toBeUndefined()
    expect(after.shots[1]!.id).toBe(before.shots[1]!.id)
    expect(after.shots[1]!.selectedVideoTaskId).toBe(before.shots[1]!.selectedVideoTaskId)
    expect(after.shots[1]!.referenceImages).toEqual(before.shots[1]!.referenceImages)
    expect(receipt.revisionSummary).toEqual({ episodeNumbers: [1], preservedShots: 1, renewedShots: 1 })
    expect(store.read((state) => state.ledger)).toEqual(ledger)
    expect(store.read((state) => state.tasks)).toEqual(tasks)
    expect(await imports.import(input, principal)).toEqual(receipt)
    expect(await workspace()).toEqual(after)
  })

  it('keeps earlier history across subsequent revisions, draft saves and normal body saves', async () => {
    await imports.import(payload(text('复核编号'), 2, true), principal)
    await imports.import(payload(text('交接编号'), 3, true), principal)
    const before = (await workspace())!.scriptEpisodes[0]!
    const history = structuredClone(before.continuityState.scriptProductionHistory)
    expect(history).toHaveLength(2)
    await repository.writeScriptEpisodeDraft(target, before.id, before.content, principal)
    await repository.saveScriptEpisode(target, before.id, before.content, principal)
    expect((await workspace())!.scriptEpisodes[0]!.continuityState.scriptProductionHistory).toEqual(history)
    const identical = payload(before.content, 4, true)
    await imports.import(identical, principal)
    expect((await workspace())!.scriptEpisodes[0]!.continuityState.scriptProductionHistory).toEqual(history)
  })

  it('retains unchanged episodes and their media exactly', async () => {
    const second = payload(text().replace('第1集', '第2集'), 2)
    second.episodes[0]!.sourceEpisodeId = 'two'
    second.episodes[0]!.episodeNumber = 2
    await imports.import(second, principal)
    const ep = (await workspace())!.scriptEpisodes[1]!
    await service.generateShots(target, generateShotsRequestSchema.parse({ episodeId: ep.id }), principal)
    const before = (await workspace())!
    await imports.import(payload(text('换新原件'), 3, true), principal)
    const after = (await workspace())!
    expect(after.scriptEpisodes[1]).toEqual(before.scriptEpisodes[1])
    expect(after.shots.filter((shot) => shot.scriptEpisodeId === ep.id)).toEqual(
      before.shots.filter((shot) => shot.scriptEpisodeId === ep.id),
    )
  })

  it('renews dependent continuing shots when their predecessor changed', async () => {
    const first = payload(
      '场次：S01｜档案室｜夜晚｜内景\n△ 林岚核对编号。\n林岚：保存原件。\n场次：S02｜档案室｜夜晚｜内景\n△ 林岚把原件装入信封。\n林岚：已经归档。',
      2,
      true,
    )
    await imports.import(first, principal)
    const before = (await workspace())!
    expect(before.shots[1]!.continuityMode).toBe('continue')
    const next = {
      ...first,
      sourceRevision: 3,
      idempotencyKey: 'production-dependent-3',
      episodes: [
        { ...first.episodes[0]!, content: first.episodes[0]!.content.replace('核对编号', '更换原件') },
      ],
    }
    await imports.import(next, principal)
    const after = (await workspace())!
    expect(after.shots.every((shot) => !before.shots.some((old) => old.id === shot.id))).toBe(true)
  })

  it('keeps shots when only the title changes and archives their previous title', async () => {
    const before = (await workspace())!
    const next = payload(text(), 2, true)
    next.episodes[0]!.title = '重新核验'
    await imports.import(next, principal)
    const after = (await workspace())!
    expect(after.shots.map((shot) => shot.id)).toEqual(before.shots.map((shot) => shot.id))
    expect(after.shots.every((shot) => shot.episodeTitle === '重新核验')).toBe(true)
    expect((after.scriptEpisodes[0]!.continuityState.scriptProductionHistory as any[])[0].title).toBe('原件')
  })

  it('refuses revision while a task is active and leaves all production data intact', async () => {
    await store.mutate((state) => {
      state.tasks.push({
        id: 'active-fixture',
        projectId: target,
        tenantId: principal.tenantId,
        status: 'running',
      } as any)
    })
    const before = await workspace()
    await expect(imports.import(payload(text('改写编号'), 2, true), principal)).rejects.toMatchObject({
      code: 'IMPORT_TASK_ACTIVE',
    })
    expect(await workspace()).toEqual(before)
  })

  it('handles inserted and removed scenes without losing old shots or duplicating their identities', async () => {
    const before = (await workspace())!
    const three = text().replace(
      'FADE OUT / 淡出。',
      'INT. 阅览室 - 夜\n\n△ 林岚坐下。\n\n林岚\n\n继续核对。\n\nFADE OUT / 淡出。',
    )
    await imports.import(payload(three, 2, true), principal)
    const inserted = (await workspace())!
    expect(inserted.shots).toHaveLength(3)
    expect(inserted.shots.slice(0, 2).map((shot) => shot.id)).toEqual(before.shots.map((shot) => shot.id))
    await imports.import(payload(text(), 3, true), principal)
    const removed = (await workspace())!
    expect(removed.shots).toHaveLength(2)
    expect(removed.shots.map((shot) => shot.id)).toEqual(before.shots.map((shot) => shot.id))
    const history = removed.scriptEpisodes[0]!.continuityState.scriptProductionHistory as any[]
    expect(history[1].shots).toEqual(inserted.shots)
    expect(new Set(removed.shots.map((shot) => shot.id)).size).toBe(2)
  })

  it('does not guess which old media belongs to repeated identical-looking scenes', async () => {
    const repeated = text().replace(
      'FADE OUT / 淡出。',
      'INT. 档案室 - 夜\n\n△ 林岚核对原件。\n\n林岚\n\n保存编号。\n\nFADE OUT / 淡出。',
    )
    await imports.import(payload(repeated, 2, true), principal)
    const before = (await workspace())!
    const next = repeated.replace('周原收好背包', '周原提起背包')
    await imports.import(payload(next, 3, true), principal)
    const after = (await workspace())!
    expect(after.shots).toHaveLength(3)
    expect(after.shots.every((shot) => !before.shots.some((old) => old.id === shot.id))).toBe(true)
    expect((after.scriptEpisodes[0]!.continuityState.scriptProductionHistory as any[])[1].shots).toEqual(
      before.shots,
    )
  })

  it('prepares SQL writes with deferred order, scoped removal, history and complete shot media fields', async () => {
    const before = (await workspace())!
    const plan = planImport(before, payload(text('复核编号'), 2, true), principal.userId)
    const calls: Array<{ sql: string; params: any[] }> = []
    await writeImportEntities(
      {
        query: async (sql: string, params: any[] = []) => {
          calls.push({ sql, params })
          return { rows: [] }
        },
      } as any,
      plan,
    )
    expect(calls[0]!.sql).toContain('DEFERRED')
    expect(calls[1]!.sql).toMatch(/DELETE FROM shots.*project_id = \$2 AND tenant_id = \$3/u)
    expect(calls[1]!.params).toEqual([plan.removedShotIds, target, principal.tenantId])
    const episodes = JSON.parse(
      calls.find((call) => call.sql.includes('INSERT INTO script_episodes'))!.params[0],
    )
    expect(episodes[0].continuity_state.scriptProductionHistory[0].shots).toEqual(before.shots)
    const shots = JSON.parse(calls.find((call) => call.sql.includes('INSERT INTO shots'))!.params[0])
    expect(shots[0]).toMatchObject({
      reference_images: [],
      selected_image_task_id: null,
      selected_video_task_id: null,
    })
    expect(calls.some((call) => /DELETE FROM (?:generation_tasks|media_objects)/u.test(call.sql))).toBe(false)
  })
})
