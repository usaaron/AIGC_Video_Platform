import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCRIPT_DIRECTION, type Principal } from '@seqora/contracts'
import type { TextGenerationProvider, TextGenerationRequest } from '../../core/generation/textProvider.js'
import type { ProjectRepository } from './repository.js'
import { ProjectService } from './service.js'
import * as assetProvider from './assetSuggestionProvider.js'
import * as assetSuggestions from './assetSuggestions.js'

const principal: Principal = { userId: 'user-1', tenantId: 'tenant-1', roles: ['creator'] }
const firstScript =
  '资产：\n人物：林夏｜性别：女性｜服装：蓝色衬衫\n场景：车站\n物品：旧雨伞\n正文：\n场次：S01｜角色：林夏｜场景：车站\n动作：她想起父亲的叮嘱。'
const secondScript = '资产：\n人物：顾砚｜性别：男性\n场景：诊所\n正文：\n场次：S01｜角色：顾砚｜场景：诊所'

function fixture(provider: TextGenerationProvider | null = null) {
  const state = {
    project: {
      name: '复用规则依据',
      contentType: 'short-drama',
      visualStyle: 'cinematic-cg',
      aspectRatio: '9:16',
    },
    assets: [] as unknown[],
    scriptEpisodes: [
      { id: 'episode-1', status: 'saved', content: firstScript },
      { id: 'episode-2', status: 'saved', content: secondScript },
    ],
  }
  const workspace = vi.fn(async () => state as typeof state | null)
  const service = new ProjectService({ workspace } as unknown as ProjectRepository, provider)
  const run = (strategy: 'fast' | 'model' = 'fast', script = '') =>
    service.suggestScriptAssets(
      'project-1',
      script,
      DEFAULT_SCRIPT_DIRECTION,
      principal,
      undefined,
      undefined,
      strategy,
    )
  return { state, workspace, run }
}

afterEach(() => vi.restoreAllMocks())

describe('asset suggestion rule reuse', () => {
  it('skips model evidence and normalizes each fallback candidate only once on the fast path', async () => {
    const evidence = vi.spyOn(assetProvider, 'buildScriptAssetEvidence')
    const normalize = vi.spyOn(assetSuggestions, 'normalizeScriptAssetSuggestion')
    const generate = vi.fn()
    const { run } = fixture({ generate })
    const result = await run()
    expect(generate).not.toHaveBeenCalled()
    expect(evidence).not.toHaveBeenCalled()
    expect(normalize).toHaveBeenCalledTimes(result.assets.length)
    expect(result.assets.map((asset) => asset.name)).toEqual(
      expect.arrayContaining(['林夏', '顾砚', '车站', '诊所', '旧雨伞']),
    )
    expect(result.assets.some((asset) => asset.name === '父亲')).toBe(false)
  })

  it('also skips model evidence when no provider is configured', async () => {
    const evidence = vi.spyOn(assetProvider, 'buildScriptAssetEvidence')
    const { run } = fixture()
    const result = await run('model')
    expect(evidence).not.toHaveBeenCalled()
    expect(result.warnings.join('')).toContain('文本服务未配置')
  })

  it('retains evidence-based model requests and fills omitted explicit assets after a model response', async () => {
    const evidence = vi.spyOn(assetProvider, 'buildScriptAssetEvidence')
    const generate = vi.fn(async (_request: TextGenerationRequest) =>
      JSON.stringify({ summary: '已分析', assets: [] }),
    )
    const { run } = fixture({ generate })
    const result = await run('model')
    expect(evidence).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ userPrompt: expect.stringContaining('顾砚') }),
    )
    expect(result.assets.map((asset) => asset.name)).toContain('林夏')
  })

  it('updates changed or removed episodes and uses current style and asset library on a cache hit', async () => {
    const { state, run } = fixture()
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-09-20T00:00:00.000Z')
    const first = await run()
    expect((await run('fast', firstScript)).assets).toEqual(first.assets)

    state.scriptEpisodes[1]!.content = secondScript.replaceAll('顾砚', '沈舟').replaceAll('诊所', '书店')
    const changed = await run()
    expect(changed.assets.map((asset) => asset.name)).toEqual(
      expect.arrayContaining(['林夏', '沈舟', '书店']),
    )
    expect(changed.assets.some((asset) => ['顾砚', '诊所'].includes(asset.name))).toBe(false)

    state.scriptEpisodes.pop()
    state.project.visualStyle = 'anime'
    const restyled = await run()
    expect(restyled.assets.some((asset) => asset.name === '沈舟')).toBe(false)
    expect(restyled.assets.every((asset) => asset.attributes.visualStyle === 'anime')).toBe(true)
    const existing = restyled.assets.find((asset) => asset.name === '林夏')!
    state.assets = [{ ...existing, id: 'existing-character', projectId: 'project-1' }]
    expect((await run()).assets.some((asset) => asset.name === '林夏')).toBe(false)
  })

  it('checks project access before reusing previously parsed sources', async () => {
    const { workspace, run } = fixture()
    await run()
    workspace.mockResolvedValueOnce(null)
    await expect(run()).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' })
    expect(workspace).toHaveBeenCalledTimes(2)
  })
})
