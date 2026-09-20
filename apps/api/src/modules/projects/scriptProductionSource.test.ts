import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createProjectSchema,
  createAssetSchema,
  DEFAULT_SCRIPT_DIRECTION,
  generateShotsRequestSchema,
  scriptMasterImportRequestSchema,
  scriptAssetSuggestionsResultSchema,
  type Principal,
  type ScriptAssetEvidence,
} from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { ScriptMasterImportRepository } from '../scriptMaster/importRepository.js'
import { ProjectRepository } from './repository.js'
import { ProjectService } from './service.js'
import { prepareScriptProductionParagraphs } from './scriptProductionSource.js'
import { splitScriptIntoSmartSceneShots } from './directorShotPlanning.js'
import { splitScriptIntoBeatShots } from './shotPlanning.js'
import {
  explicitAssetMatch,
  shotAssetFields,
} from '../../../../web/src/features/storyboard/shotAssetFields.js'

const productionText = (episode = 1, action = '△ 他核对原件。') =>
  `第${episode}集《原件》\n\n预计时长：90秒\n\n正式正文\n\nFADE IN / 淡入：\n\nINT. 档案室 - 夜\n\n${action}\n\nEthan\n\nKeep the original.\n\n中文：保留原件。\n\nEXT. 车站 - 日\n\n△ 无人，信封留在长椅上。\n\nFADE OUT / 淡出。\n`

function productionEvidence(content = productionText(), episode = 1): ScriptAssetEvidence {
  return {
    version: 'script_asset_evidence.v1',
    contentHash: createHash('sha256').update(content.trim()).digest('hex'),
    complete: { character: true, scene: true, prop: true },
    // Deliberately nonconsecutive source numbers: ordinal guesses are unsafe.
    scenes: [
      { sourceSceneId: `source-${episode}:7`, heading: 'INT. 档案室 - 夜' },
      { sourceSceneId: `source-${episode}:31`, heading: 'EXT. 车站 - 日' },
    ],
    assets: [
      {
        kind: 'character',
        name: 'Ethan',
        facts: { 年龄: '32', 性别: '男', 身份: '调查员', 外观: '黑色短发，蓝衣' },
        sourceSceneIds: [`source-${episode}:7`],
      },
      {
        kind: 'character',
        name: 'Mary',
        facts: { 年龄: '29', 性别: '女', 身份: '保管员', 外观: '灰色短发，黑衣' },
        sourceSceneIds: [`source-${episode}:7`],
      },
      {
        kind: 'scene',
        name: '档案室',
        facts: { 空间: '室内', 外观: '灰色砖墙', 固定细节: '南墙三扇拱窗' },
        sourceSceneIds: [`source-${episode}:7`],
      },
      {
        kind: 'scene',
        name: '车站',
        facts: { 外观: '混凝土站台' },
        sourceSceneIds: [`source-${episode}:31`],
      },
      {
        kind: 'prop',
        name: '蓝色档案夹',
        facts: { 外观: '蓝色硬纸封面', 固定细节: '铜制书脊' },
        sourceSceneIds: [`source-${episode}:7`],
      },
      { kind: 'prop', name: '信封', facts: { 外观: '米色牛皮纸' }, sourceSceneIds: [`source-${episode}:31`] },
    ],
  }
}

describe('verified scene production source', () => {
  it.each(['scene', 'beat'])(
    'keeps silent appearances, exact props and bilingual prose in %s rules',
    (mode) => {
      const text = productionText()
      const paragraphs = prepareScriptProductionParagraphs(text, productionEvidence(text))
      const shots =
        mode === 'scene'
          ? splitScriptIntoSmartSceneShots(paragraphs, 120, true)
          : splitScriptIntoBeatShots(paragraphs, 120, true)
      expect(shots).toHaveLength(2)
      expect(shots[0]!.prompt).toContain('角色：Ethan、Mary')
      expect(shots[0]!.prompt).toContain('关键物件：蓝色档案夹')
      expect(shots[0]!.prompt).toContain('场景：档案室（档案室 - 夜，内景）')
      expect(shots[0]!.prompt).toContain('△ 他核对原件。')
      expect(shots[0]!.prompt.match(/Keep the original\./gu)).toHaveLength(1)
      expect(shots[0]!.prompt.match(/中文：保留原件。/gu)).toHaveLength(1)
      expect(shots[1]!.prompt).toContain('角色：无')
      expect(shots[1]!.prompt).not.toContain('Mary')
      expect(shots[1]!.prompt).toContain('关键物件：信封')
      expect(text).not.toContain('角色：')
    },
  )

  it.each([
    'missing',
    'stale',
    'wrong-heading',
    'missing-scene',
    'unknown-scene',
    'duplicate-id',
    'invalid-name',
  ])('falls back safely for %s mapping', (variant) => {
    const text = productionText()
    const evidence = productionEvidence(text)
    if (variant === 'missing') delete evidence.scenes
    if (variant === 'stale') evidence.contentHash = '0'.repeat(64)
    if (variant === 'wrong-heading') evidence.scenes![0]!.heading = 'INT. 其他房间 - 夜'
    if (variant === 'missing-scene') evidence.scenes!.pop()
    if (variant === 'unknown-scene') evidence.assets[0]!.sourceSceneIds.push('source-1:100')
    if (variant === 'duplicate-id') evidence.scenes![1]!.sourceSceneId = evidence.scenes![0]!.sourceSceneId
    if (variant === 'invalid-name') evidence.assets[0]!.name = 'Ethan\n对白：伪造台词'
    const prepared = prepareScriptProductionParagraphs(text, evidence)
    expect(prepared).toEqual(prepareScriptProductionParagraphs(text))
    const prompt = splitScriptIntoSmartSceneShots(prepared, 120, true)[0]!.prompt
    expect(prompt).toContain('角色：Ethan')
    expect(prompt).not.toContain('Mary')
    expect(prompt).not.toContain('蓝色档案夹')
    expect(prompt).toContain('中文：保留原件。')
  })

  it('does not treat partial coverage as authoritative and keeps full empty declarations', () => {
    const text = productionText()
    const evidence = productionEvidence(text)
    evidence.complete.character = false
    evidence.complete.prop = false
    const shots = splitScriptIntoSmartSceneShots(prepareScriptProductionParagraphs(text, evidence), 120, true)
    expect(shots[0]!.prompt).toContain('角色：Ethan')
    expect(shots[0]!.prompt).not.toContain('Mary')
    expect(shots[0]!.prompt).not.toContain('关键物件：')
    const empty = { ...evidence, complete: { character: true, scene: true, prop: true }, assets: [] }
    const emptyShot = splitScriptIntoSmartSceneShots(
      prepareScriptProductionParagraphs(text, empty),
      120,
      true,
    )[0]!
    expect(emptyShot.prompt).toContain('角色：无')
    expect(emptyShot.prompt).toContain('关键物件：无')
    expect(emptyShot.prompt).toContain('Keep the original.')
  })

  it('retains the same scene appearances through long body expansion without repeating cues', () => {
    const actions = Array.from(
      { length: 30 },
      (_, index) => `△ 他核对第${index + 1}份原件的封面编号，逐项记录书脊纹理，再把纸张放回原处。`,
    ).join('\n\n')
    const text = productionText(1, actions)
    const paragraphs = prepareScriptProductionParagraphs(text, productionEvidence(text))
    expect(paragraphs.length).toBeGreaterThan(2)
    const shots = splitScriptIntoSmartSceneShots(paragraphs, 120, true)
    expect(
      shots
        .slice(0, -1)
        .every(
          (shot) => shot.prompt.includes('角色：Ethan、Mary') && shot.prompt.includes('关键物件：蓝色档案夹'),
        ),
    ).toBe(true)
    const combined = shots.map((shot) => shot.prompt).join('\n')
    expect(combined.match(/Keep the original\./gu)).toHaveLength(1)
    expect(combined.match(/中文：保留原件。/gu)).toHaveLength(1)
    for (let number = 1; number <= 30; number++)
      expect(combined.match(new RegExp(`第${number}份原件`, 'gu'))).toHaveLength(1)
  })
})

it.each(['scene', 'beat'])('keeps every declared prop name intact in %s fields', (mode) => {
  const text = productionText()
  const evidence = productionEvidence(text)
  const props = Array.from({ length: 30 }, (_, index) => `档案原件专用编号第${index + 1}号蓝色文件夹`)
  evidence.assets.push(
    ...props.map((name) => ({ kind: 'prop' as const, name, facts: {}, sourceSceneIds: ['source-1:7'] })),
  )
  const paragraphs = prepareScriptProductionParagraphs(text, evidence)
  const shot = (
    mode === 'scene'
      ? splitScriptIntoSmartSceneShots(paragraphs, 120, true)
      : splitScriptIntoBeatShots(paragraphs, 120, true)
  )[0]!
  for (const name of props) expect(shot.prompt).toContain(name)
})

describe('saved script to assets and rule storyboard', () => {
  const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
  async function setup() {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new ProjectRepository(store)
    let providerCalls = 0
    const service = new ProjectService(repository, {
      generate: async () => {
        providerCalls++
        throw new Error('Model is forbidden for this flow')
      },
    })
    const imports = new ScriptMasterImportRepository(store)
    const project = await repository.create(
      createProjectSchema.parse({ name: '衔接验收', contentType: 'short-drama' }),
      principal,
    )
    const episodes = [1, 2].map((episodeNumber) => {
      const content = productionText(episodeNumber)
      return {
        sourceEpisodeId: `source-${episodeNumber}`,
        episodeNumber,
        title: `第${episodeNumber}集`,
        content,
        assetEvidence: productionEvidence(content, episodeNumber),
      }
    })
    const payload = (revision: number, revise = false) =>
      scriptMasterImportRequestSchema.parse({
        contractVersion: 'script_master_delivery.v2',
        targetProjectId: project.id,
        sourceProjectId: 'production-source-fixture',
        sourceRevision: revision,
        idempotencyKey: `production-source-${revision}-${revise}`,
        ...(revise ? { storyboardRevision: 'preserve-history' } : {}),
        episodes,
      })
    await imports.import(payload(1), principal)
    return {
      store,
      repository,
      service,
      imports,
      project,
      episodes,
      payload,
      providerCalls: () => providerCalls,
    }
  }

  it('reads two delivered episodes into complete cards and scoped storyboards without model extraction', async () => {
    const context = await setup()
    const { service, project, repository } = context
    const suggestions = await service.suggestScriptAssets(
      project.id,
      '',
      DEFAULT_SCRIPT_DIRECTION,
      principal,
      undefined,
      undefined,
      'fast',
    )
    expect(suggestions.assets.map((asset) => `${asset.kind}:${asset.name}`).sort()).toEqual(
      [
        'character:Ethan',
        'character:Mary',
        'scene:档案室',
        'scene:车站',
        'prop:蓝色档案夹',
        'prop:信封',
      ].sort(),
    )
    expect(suggestions.assets.find((asset) => asset.name === 'Mary')!.sourceFacts).toMatchObject({
      身份: '保管员',
      外观: '灰色短发，黑衣',
    })
    expect(suggestions.assets.find((asset) => asset.name === 'Ethan')!.attributes).toMatchObject({
      exactAge: 32,
      gender: 'male',
    })
    expect(suggestions.assets.find((asset) => asset.name === 'Mary')!.attributes).toMatchObject({
      exactAge: 29,
      gender: 'female',
    })
    expect(suggestions.assets.find((asset) => asset.name === '档案室')!.attributes).toMatchObject({
      space: 'interior',
    })
    expect(suggestions.assets.find((asset) => asset.name === '档案室')!.sourceFacts).toMatchObject({
      固定细节: '南墙三扇拱窗',
    })
    expect(suggestions.assets.find((asset) => asset.name === '蓝色档案夹')!.sourceFacts).toMatchObject({
      固定细节: '铜制书脊',
    })
    const before = (await repository.workspace(project.id, principal))!
    await service.generateShots(
      project.id,
      generateShotsRequestSchema.parse({ episodeId: before.scriptEpisodes[1]!.id }),
      principal,
    )
    const selected = (await repository.workspace(project.id, principal))!
    expect(selected.shots).toHaveLength(2)
    expect(selected.shots.every((shot) => shot.scriptEpisodeId === before.scriptEpisodes[1]!.id)).toBe(true)
    await service.generateShots(project.id, generateShotsRequestSchema.parse({ mode: 'scene' }), principal)
    const after = (await repository.workspace(project.id, principal))!
    expect(after.shots).toHaveLength(4)
    for (const episode of after.scriptEpisodes) {
      const shots = after.shots.filter((shot) => shot.scriptEpisodeId === episode.id)
      expect(shots[0]!.prompt).toContain('角色：Ethan、Mary')
      expect(shots[0]!.prompt).toContain('关键物件：蓝色档案夹')
      expect(shots[1]!.prompt).toContain('角色：无')
    }
    expect(context.providerCalls()).toBe(0)
  })

  it('keeps normal import protection and refreshes only explicitly revised scenes using the same mappings', async () => {
    const context = await setup()
    const { service, project, repository, episodes, imports, payload, store } = context
    await service.generateShots(project.id, generateShotsRequestSchema.parse({}), principal)
    await store.mutate((state) => {
      for (const shot of state.shots.filter((shot) => shot.projectId === project.id))
        shot.imageUrl = `/synthetic-${shot.id}.png`
    })
    const before = (await repository.workspace(project.id, principal))!
    episodes[0]!.content = productionText(1, '△ 他重新编号原件。')
    episodes[0]!.assetEvidence = productionEvidence(episodes[0]!.content)
    await expect(imports.import(payload(2), principal)).rejects.toMatchObject({
      code: 'IMPORT_STORYBOARD_REQUIRED',
    })
    expect(await repository.workspace(project.id, principal)).toEqual(before)
    const receipt = await imports.import(payload(2, true), principal)
    const after = (await repository.workspace(project.id, principal))!
    const first = after.shots.filter((shot) => shot.episodeNumber === 1)
    expect(first[0]!.prompt).toContain('角色：Ethan、Mary')
    expect(first[0]!.prompt).toContain('重新编号原件')
    expect(first[0]!.imageUrl).toBeNull()
    expect(first[1]!.id).toBe(
      before.shots.find((shot) => shot.episodeNumber === 1 && shot.prompt.includes('关键物件：信封'))!.id,
    )
    expect(after.shots.filter((shot) => shot.episodeNumber === 2)).toEqual(
      before.shots.filter((shot) => shot.episodeNumber === 2),
    )
    expect(receipt.revisionSummary).toMatchObject({ preservedShots: 1, renewedShots: 1 })
    expect(after.scriptEpisodes[0]!.continuityState.scriptProductionHistory).toHaveLength(1)
    expect(context.providerCalls()).toBe(0)
  })

  it('updates an explicitly requested production revision when only scene appearances changed', async () => {
    const { service, project, repository, episodes, imports, payload } = await setup()
    await service.generateShots(project.id, generateShotsRequestSchema.parse({}), principal)
    const before = (await repository.workspace(project.id, principal))!
    episodes[0]!.assetEvidence.assets = episodes[0]!.assetEvidence.assets.filter(
      (asset) => asset.name !== 'Mary',
    )
    await imports.import(payload(2, true), principal)
    const after = (await repository.workspace(project.id, principal))!
    expect(after.shots[0]!.prompt).toContain('角色：Ethan\n')
    expect(after.shots[0]!.prompt).not.toContain('Mary')
    expect(after.shots[0]!.id).not.toBe(before.shots[0]!.id)
    expect(after.scriptEpisodes[0]!.continuityState.scriptProductionHistory).toHaveLength(1)
  })

  it('keeps already produced shots and media on metadata-only import without explicit revision', async () => {
    const { service, project, repository, episodes, imports, payload, store } = await setup()
    await service.generateShots(project.id, generateShotsRequestSchema.parse({}), principal)
    await store.mutate((state) => {
      for (const shot of state.shots.filter((shot) => shot.projectId === project.id))
        shot.imageUrl = `/existing-${shot.id}.png`
    })
    const before = (await repository.workspace(project.id, principal))!
    episodes[0]!.assetEvidence.assets = episodes[0]!.assetEvidence.assets.filter(
      (asset) => asset.name !== 'Mary',
    )
    episodes[0]!.assetEvidence.assets[0]!.facts.外观 = '棕色短发，白色衬衫'
    await imports.import(payload(2), principal)
    const after = (await repository.workspace(project.id, principal))!
    expect(after.shots).toEqual(before.shots)
    expect(after.scriptEpisodes[0]!.continuityState.scriptAssetEvidence).toEqual(episodes[0]!.assetEvidence)
    expect(after.scriptEpisodes[0]!.continuityState.scriptProductionHistory).toBeUndefined()
  })

  it('preserves long physical design facts across the public suggestion response contract', async () => {
    const { service, project, episodes, imports, payload } = await setup()
    const details = '南墙有三扇带铜框的拱窗，地面由灰色方砖铺设。'.repeat(25) + '东墙最后一块砖刻有双鱼花纹'
    episodes[0]!.assetEvidence.assets.find((asset) => asset.name === '档案室')!.facts.固定细节 = details
    episodes[1]!.assetEvidence.assets.find((asset) => asset.name === '档案室')!.facts.固定细节 = details
    episodes[0]!.assetEvidence.assets[0]!.facts.人物动机 = '找出真相'
    await imports.import(payload(2), principal)
    const result = await service.suggestScriptAssets(
      project.id,
      '',
      DEFAULT_SCRIPT_DIRECTION,
      principal,
      undefined,
      undefined,
      'fast',
    )
    const publicResult = scriptAssetSuggestionsResultSchema.parse(result)
    expect(publicResult.assets.find((asset) => asset.name === '档案室')!.sourceFacts!.固定细节).toBe(details)
    const scene = publicResult.assets.find((asset) => asset.name === '档案室')!
    const created = await service.createAsset(
      project.id,
      createAssetSchema.parse({ ...scene, sourceMode: 'generate' }),
      principal,
    )
    expect(created.prompt).toContain('东墙最后一块砖刻有双鱼花纹')
    expect(publicResult.assets.find((asset) => asset.name === 'Ethan')!.sourceFacts).not.toHaveProperty(
      '人物动机',
    )
  })

  it('keeps declared parenthetical identities and facts through design cards and strict storyboard matching', async () => {
    const { service, project, repository, episodes, imports, payload } = await setup()
    episodes[0]!.content = productionText().replaceAll('档案室', '档案室（地下）')
    const evidence = productionEvidence(episodes[0]!.content)
    evidence.scenes![0]!.heading = 'INT. 档案室（地下） - 夜'
    evidence.assets.find((asset) => asset.kind === 'scene' && asset.name === '档案室')!.name =
      '档案室（地下）'
    evidence.assets.find((asset) => asset.kind === 'prop' && asset.name === '蓝色档案夹')!.name =
      '钥匙（备用）'
    episodes[0]!.assetEvidence = evidence
    await imports.import(payload(2), principal)
    const result = await service.suggestScriptAssets(
      project.id,
      '',
      DEFAULT_SCRIPT_DIRECTION,
      principal,
      undefined,
      undefined,
      'fast',
    )
    const location = result.assets.find((asset) => asset.name === '档案室（地下）')!
    const prop = result.assets.find((asset) => asset.name === '钥匙（备用）')!
    expect(location.sourceFacts).toMatchObject({ 空间: '室内', 固定细节: '南墙三扇拱窗' })
    expect(prop.sourceFacts).toMatchObject({ 外观: '蓝色硬纸封面', 固定细节: '铜制书脊' })
    const created = await Promise.all(
      [location, prop].map((asset) =>
        service.createAsset(
          project.id,
          createAssetSchema.parse({ ...asset, sourceMode: 'generate' }),
          principal,
        ),
      ),
    )
    await service.generateShots(project.id, generateShotsRequestSchema.parse({}), principal)
    const after = (await repository.workspace(project.id, principal))!
    const fields = shotAssetFields(after.shots[0]!.prompt)
    expect(explicitAssetMatch(created[0], fields.get('scene'))).toBe(true)
    expect(explicitAssetMatch(created[1], fields.get('prop'))).toBe(true)
    expect(explicitAssetMatch({ kind: 'scene', name: '档案室' }, fields.get('scene'))).toBe(false)
    expect(explicitAssetMatch({ kind: 'prop', name: '钥匙' }, fields.get('prop'))).toBe(false)
  })
})
