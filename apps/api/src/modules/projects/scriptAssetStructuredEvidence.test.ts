import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SCRIPT_DIRECTION, type ScriptAssetEvidence } from '@seqora/contracts'
import { ScriptAssetSourceIndexCache } from './scriptAssetSourceIndex.js'
import { ProjectService } from './service.js'
import type { ProjectRepository } from './repository.js'

const scope = { tenantId: 'tenant-1', projectId: 'project-1' }
const content = '第1集\n正式正文\n林夏想起父亲的叮嘱，拿起雨伞走入旧车站。'
function evidence(text = content): ScriptAssetEvidence {
  return {
    version: 'script_asset_evidence.v1',
    contentHash: createHash('sha256').update(text.trim()).digest('hex'),
    complete: { character: true, scene: true, prop: true },
    assets: [
      {
        kind: 'character',
        name: '林夏',
        facts: { 外观: '黑色短发，蓝色棉布外套', 性别: '女性', 年龄: '25岁' },
        sourceSceneIds: ['episode-1:1'],
      },
      { kind: 'scene', name: '旧车站', facts: {}, sourceSceneIds: ['episode-1:1'] },
      { kind: 'prop', name: '雨伞', facts: {}, sourceSceneIds: ['episode-1:1'] },
    ],
  }
}

function revisedScreenplay(body: string): string {
  return `第1集《复核》\n\n预计时长：90秒\n\n正式正文\n\nFADE IN / 淡入：\n\n${body}\n\nFADE OUT / 淡出。\n`
}

const revisedBody = revisedScreenplay(
  'INT. 阅览室 - 夜\n\n△ 顾砚想起父亲的叮嘱，把旧信放进药箱。\n\n顾砚\n\n（低声）\n\n请保留原件。\n\nEXT. 旧码头 - 日\n\n△ 陆青检查封条。\n\n陆青\n\n我来复核编号。',
)

describe('structured script asset evidence', () => {
  it.each([
    ['室内', 'interior'],
    ['室外', 'exterior'],
  ])('keeps explicit space %s even when model fields disagree', async (space, expected) => {
    const declared = evidence()
    declared.assets = [
      {
        kind: 'scene',
        name: '档案室',
        facts: { 空间: space, 外观: '红砖墙、木制档案柜' },
        sourceSceneIds: ['episode-1:1'],
      },
    ]
    const state = {
      project: {
        name: '明确场景',
        contentType: 'short-drama',
        visualStyle: 'cinematic-cg',
        aspectRatio: '9:16',
      },
      assets: [],
      scriptEpisodes: [
        { id: 'one', status: 'saved', content, continuityState: { scriptAssetEvidence: declared } },
      ],
    }
    const service = new ProjectService({ workspace: async () => state } as unknown as ProjectRepository, {
      generate: async () =>
        JSON.stringify({
          summary: '场景',
          assets: [
            {
              kind: 'scene',
              name: '档案室',
              description: '档案室',
              visualNotes: '墙面与柜子',
              reason: '场景设计',
              priority: 4,
              attributes: { space: expected === 'interior' ? 'exterior' : 'interior' },
            },
          ],
        }),
    })
    const result = await service.suggestScriptAssets(scope.projectId, '', DEFAULT_SCRIPT_DIRECTION, {
      tenantId: scope.tenantId,
      userId: 'user-1',
      roles: ['creator'],
    })
    expect(result.assets[0]!.attributes).toMatchObject({ space: expected })
    expect(result.assets[0]!.sourceFacts).toMatchObject({ 空间: space })
  })
  it('recovers explicit scenes and dialogue speakers from revised exports without generated metadata', () => {
    const cache = new ScriptAssetSourceIndexCache()
    for (const assetEvidence of [
      undefined,
      {
        ...evidence(revisedBody),
        complete: { character: false, scene: false, prop: false },
        assets: [],
      },
    ]) {
      const result = cache.analyze(scope, [{ id: 'edited', content: revisedBody, assetEvidence }])
      expect(result.names.character).toEqual(['顾砚', '陆青'])
      expect(result.names.scene).toEqual(['阅览室 - 夜', '旧码头 - 日'])
      expect(result.names.prop).toEqual([])
      expect(result.names.character).not.toContain('父亲')
      expect(result.complete).toEqual({ character: false, scene: false, prop: false })
    }
  })

  it('keeps complete empty evidence authoritative even when an export names scenes and speakers', () => {
    const complete = { ...evidence(revisedBody), assets: [] }
    const cache = new ScriptAssetSourceIndexCache()
    const result = cache.analyze(scope, [{ id: 'empty', content: revisedBody, assetEvidence: complete }])
    expect(result.names).toEqual({ character: [], scene: [], prop: [], costume: [], brand: [] })
    expect(result.complete).toEqual({ character: true, scene: true, prop: true })
    const partial = cache.analyze(scope, [
      {
        id: 'empty',
        content: revisedBody,
        assetEvidence: { ...complete, complete: { character: true, scene: false, prop: false } },
      },
    ])
    expect(partial.names.character).toEqual([])
    expect(partial.names.scene).toEqual(['阅览室 - 夜', '旧码头 - 日'])
    expect(partial.names.prop).toEqual([])
  })

  it('merges an edited screenplay with another episode complete evidence without suppressing new names', () => {
    const result = new ScriptAssetSourceIndexCache().analyze(scope, [
      { id: 'original', content, assetEvidence: evidence() },
      {
        id: 'edited',
        content: revisedBody,
        assetEvidence: {
          ...evidence(revisedBody),
          complete: { character: false, scene: false, prop: false },
          assets: [],
        },
      },
    ])
    expect(result.names.character).toEqual(['林夏', '顾砚', '陆青'])
    expect(result.names.scene).toEqual(['旧车站', '阅览室 - 夜', '旧码头 - 日'])
    expect(result.names.prop).toEqual(['雨伞'])
    expect(result.complete).toEqual({ character: false, scene: false, prop: false })
  })

  it.each(['INT. 档案室 - 夜', 'EXT. 档案室 - 日', 'INT./EXT. 档案室 - 夜'])(
    'keeps the real location in screenplay heading %s',
    async (heading) => {
      const declared = evidence()
      declared.assets = [{ kind: 'scene', name: heading, facts: {}, sourceSceneIds: ['episode-1:1'] }]
      const state = {
        project: {
          name: '快速正文',
          contentType: 'short-drama',
          visualStyle: 'cinematic-cg',
          aspectRatio: '9:16',
        },
        assets: [],
        scriptEpisodes: [
          { id: 'one', status: 'saved', content, continuityState: { scriptAssetEvidence: declared } },
        ],
      }
      const service = new ProjectService({ workspace: async () => state } as unknown as ProjectRepository)
      const result = await service.suggestScriptAssets(
        scope.projectId,
        '',
        DEFAULT_SCRIPT_DIRECTION,
        { tenantId: scope.tenantId, userId: 'user-1', roles: ['creator'] },
        undefined,
        undefined,
        'fast',
      )
      expect(result.assets.map((asset) => asset.name)).toEqual([heading.replace(/^[A-Z./]+\s+/u, '')])
    },
  )

  it('keeps explicit delivered facts when model fields disagree', async () => {
    const state = {
      project: {
        name: '明确设定',
        contentType: 'short-drama',
        visualStyle: 'cinematic-cg',
        aspectRatio: '9:16',
      },
      assets: [],
      scriptEpisodes: [
        { id: 'one', status: 'saved', content, continuityState: { scriptAssetEvidence: evidence() } },
      ],
    }
    let prompt = ''
    const service = new ProjectService({ workspace: async () => state } as unknown as ProjectRepository, {
      generate: async (request) => {
        prompt = request.userPrompt
        return JSON.stringify({
          summary: '建议',
          assets: [
            {
              kind: 'character',
              name: '林夏',
              description: '人物',
              visualNotes: '人物设定',
              reason: '主角',
              priority: 5,
              sourceFacts: { 性别: '男性', 年龄: '15岁' },
              attributes: { gender: 'male', exactAge: 15 },
            },
          ],
        })
      },
    })
    const result = await service.suggestScriptAssets(scope.projectId, '', DEFAULT_SCRIPT_DIRECTION, {
      tenantId: scope.tenantId,
      userId: 'user-1',
      roles: ['creator'],
    })
    const character = result.assets.find((asset) => asset.name === '林夏')!
    expect(character.sourceFacts).toMatchObject({
      性别: '女性',
      年龄: '25岁',
      外观: '黑色短发，蓝色棉布外套',
    })
    expect(character.attributes).toMatchObject({ gender: 'female', exactAge: 25 })
    expect(prompt).toContain('黑色短发，蓝色棉布外套')
  })

  it('does not let model guesses expand explicitly complete lists, but retains discovery for incomplete legacy sources', async () => {
    const declared = evidence()
    declared.assets = declared.assets.filter((asset) => asset.kind !== 'character')
    let prompt = ''
    const state = {
      project: {
        name: '空场景',
        contentType: 'short-drama',
        visualStyle: 'cinematic-cg',
        aspectRatio: '9:16',
      },
      assets: [],
      scriptEpisodes: [
        { id: 'one', status: 'saved', content, continuityState: { scriptAssetEvidence: declared } },
      ],
    }
    const service = new ProjectService({ workspace: async () => state } as unknown as ProjectRepository, {
      generate: async (request) => {
        prompt = request.userPrompt
        return JSON.stringify({
          summary: '建议',
          assets: [
            {
              kind: 'character',
              name: '父亲',
              description: '灰色长衫',
              visualNotes: '灰色长衫',
              reason: '被提及',
              priority: 3,
            },
          ],
        })
      },
    })
    const run = () =>
      service.suggestScriptAssets(scope.projectId, '', DEFAULT_SCRIPT_DIRECTION, {
        tenantId: scope.tenantId,
        userId: 'user-1',
        roles: ['creator'],
      })
    expect((await run()).assets.some((asset) => asset.kind === 'character')).toBe(false)
    expect(prompt).toContain('旧车站')
    declared.complete.character = false
    expect((await run()).assets.some((asset) => asset.name === '父亲')).toBe(true)
  })

  it('uses saved explicit evidence without needing labels in exported prose', () => {
    const cache = new ScriptAssetSourceIndexCache()
    const source = { id: 'episode-1', content, assetEvidence: evidence() }
    const first = cache.analyze(scope, [source])
    expect(first.names).toEqual({
      character: ['林夏'],
      scene: ['旧车站'],
      prop: ['雨伞'],
      costume: [],
      brand: [],
    })
    expect(first.manifest.character[0]?.facts['外观']).toBe('黑色短发，蓝色棉布外套')
    expect(cache.analyze(scope, [source]).stats.hits).toBe(1)
  })

  it('respects explicit empty lists and uses text only for missing categories', () => {
    const text =
      '资产：\n人物：父亲｜性别：男性\n场景：阁楼\n道具：旧信\n正文：\n场次：S01｜角色：父亲｜场景：阁楼｜道具：旧信'
    const complete = { ...evidence(text), assets: [] }
    const cache = new ScriptAssetSourceIndexCache()
    const empty = cache.analyze(scope, [{ id: 'one', content: text, assetEvidence: complete }])
    expect(empty.names.character).toEqual([])
    expect(empty.names.scene).toEqual([])
    expect(empty.names.prop).toEqual([])
    const partial = cache.analyze(scope, [
      {
        id: 'one',
        content: text,
        assetEvidence: { ...complete, complete: { character: true, scene: false, prop: false } },
      },
    ])
    expect(partial.names.character).toEqual([])
    expect(partial.names.scene).toEqual(['阁楼'])
    expect(partial.names.prop).toEqual(['旧信'])
    expect(partial.stats.misses).toBe(1)
  })

  it('invalidates metadata changes even when the prose is unchanged and returns independent facts', () => {
    const cache = new ScriptAssetSourceIndexCache()
    const original = evidence()
    const first = cache.analyze(scope, [{ id: 'one', content, assetEvidence: original }])
    first.manifest.character[0]!.facts['外观'] = '污染'
    expect(
      cache.analyze(scope, [{ id: 'one', content, assetEvidence: original }]).manifest.character[0]?.facts[
        '外观'
      ],
    ).toBe('黑色短发，蓝色棉布外套')
    const revised = structuredClone(original)
    revised.assets[0]!.facts['外观'] = '白色衬衫'
    const next = cache.analyze(scope, [{ id: 'one', content, assetEvidence: revised }])
    expect(next.stats).toMatchObject({ hits: 0, misses: 1, entries: 1 })
    expect(next.manifest.character[0]?.facts['外观']).toBe('白色衬衫')
  })

  it('falls back to current text after hand edits, bad hashes, unsupported versions or removed metadata', () => {
    const cache = new ScriptAssetSourceIndexCache()
    cache.analyze(scope, [{ id: 'one', content, assetEvidence: evidence() }])
    const edited = '角色：顾砚\n场景：诊所\n道具：药箱'
    for (const assetEvidence of [
      evidence(),
      { ...evidence(edited), version: 'future' },
      { ...evidence(edited), contentHash: 'wrong' },
      undefined,
    ]) {
      const result = cache.analyze(scope, [{ id: 'one', content: edited, assetEvidence }])
      expect(result.names.character).toEqual(['顾砚'])
      expect(result.names.scene).toEqual(['诊所'])
      expect(result.names.prop).toEqual(['药箱'])
    }
  })

  it('merges a structured episode with legacy fields and preserves character variants', () => {
    const explicit = evidence()
    explicit.assets[0]!.name = '林夏-工作服版'
    explicit.assets[0]!.facts = { 服装: '白色大褂' }
    const result = new ScriptAssetSourceIndexCache().analyze(scope, [
      { id: 'one', content, assetEvidence: explicit },
      { id: 'two', content: '角色：林夏、顾砚\n场景：诊所\n道具：药箱' },
    ])
    expect(result.names.character).toEqual(['林夏-工作服版本', '顾砚'])
    expect(result.names.scene).toEqual(['旧车站', '诊所'])
    expect(result.names.prop).toEqual(['雨伞', '药箱'])
  })

  it('suggests imported facts through ProjectService while retaining current asset-library matching', async () => {
    const state = {
      project: {
        name: '结构化交接',
        contentType: 'short-drama',
        visualStyle: 'cinematic-cg',
        aspectRatio: '9:16',
      },
      assets: [] as unknown[],
      scriptEpisodes: [
        { id: 'one', status: 'saved', content, continuityState: { scriptAssetEvidence: evidence() } },
      ],
    }
    const service = new ProjectService({ workspace: async () => state } as unknown as ProjectRepository)
    const run = () =>
      service.suggestScriptAssets(
        scope.projectId,
        content,
        DEFAULT_SCRIPT_DIRECTION,
        { tenantId: scope.tenantId, userId: 'user-1', roles: ['creator'] },
        undefined,
        undefined,
        'fast',
      )
    const result = await run()
    const character = result.assets.find((asset) => asset.name === '林夏')!
    expect(character.sourceFacts?.['外观']).toBe('黑色短发，蓝色棉布外套')
    expect(character.attributes).toMatchObject({ gender: 'female', exactAge: 25 })
    expect(result.assets.map((asset) => asset.name)).toEqual(['林夏', '旧车站', '雨伞'])
    state.assets = [{ ...character, id: 'existing', projectId: scope.projectId }]
    expect((await run()).assets.map((asset) => asset.name)).toEqual(['旧车站', '雨伞'])
  })
})
