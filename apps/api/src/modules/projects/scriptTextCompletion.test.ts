import { createHash } from 'node:crypto'
import { ASSET_SUGGESTION_MODEL, DEFAULT_SCRIPT_DIRECTION, type Principal } from '@seqora/contracts'
import { assert, describe, expect, it, vi } from 'vitest'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import { claimGenerationTaskLease } from '../../core/jobs/taskLease.js'
import {
  buildTextCompletionReceipt,
  markReusedTextEpisode,
  textResultDigest,
} from '../../core/jobs/textCompletion.js'
import { captureTextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import { queuedTextTask } from '../../testing/generationTaskFixtures.js'
import { textCompletionEvidence } from '../generation/textCompletionEvidence.js'
import type { ProjectRepository } from './repository.js'
import type { ScriptTaskExecution } from './scriptTaskExecution.js'
import { ProjectService } from './service.js'

const scene = (index: number) =>
  '场次：S' +
  String(index).padStart(2, '0') +
  '｜时长：10秒｜剧情：林晚追查第' +
  index +
  '条线索。｜场景：诊所。｜角色：林晚；程野。｜动作：林晚推门，程野抬眼。｜对白：[对白]林晚：请告诉我实情。[对白]程野：那个人刚离开。[对白]林晚：我要找到他。[对白]程野：跟我来。｜风格：影视CG。｜构图：中景。｜光影：冷光。｜运镜：稳定跟随。｜衔接：两人走向门口。'
const script = [scene(1), scene(2), scene(3)].join('\n')
const longSource = '这是必须保持的长篇故事原稿。'.repeat(900)
const assetScript =
  '资产：\n人物：林晚｜性别：女性｜服装：蓝色衬衫\n场景：诊所\n物品：旧雨伞\n正文：\n场次：S01｜角色：林晚｜场景：诊所｜关键物件：旧雨伞'
const englishScript = [
  'The swordsman enters the courtyard and watches the silent guards step backward.',
  'The captain raises his blade, shouts an order, and forces everyone toward the gate.',
].join('\n')
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
type Operation = 'generate' | 'enrich' | 'suggest-assets'
type Surface = 'project' | 'episode'
type Input = {
  source?: string
  mode?: 'quick' | 'segment'
  revisionNote?: string
  duration?: number
  timing?: boolean
  unguarded?: boolean
}

function fixture(operation: Operation = 'generate', surface: Surface = 'project', providerAvailable = true) {
  const task = queuedTextTask('completion-' + operation)
  task.model = 'seqora-5.6'
  task.metadata.scriptOperation = operation
  claimGenerationTaskLease(task, 'worker-text-completion', 60_000)
  const guard = captureTextTaskWriteGuard(task)
  const principal: Principal = { userId: task.userId, tenantId: task.tenantId, roles: ['member'] }
  const episode = {
    id: 'episode-1',
    projectId: task.projectId,
    tenantId: task.tenantId,
    revision: 1,
    status: 'saved',
    content: script,
    draftContent: '',
    continuityState: {} as Record<string, unknown>,
  }
  const workspace = {
    project: {
      id: task.projectId,
      tenantId: task.tenantId,
      name: '追查',
      synopsis: '',
      contentType: surface === 'episode' ? 'short-drama' : 'short-video',
      visualStyle: 'cinematic-cg',
      aspectRatio: '16:9',
      script,
    },
    assets: [],
    ...(surface === 'episode' ? { scriptEpisodes: [episode] } : {}),
  }
  const repository = {
    workspace: vi.fn(async () => workspace),
    update: vi.fn(async (_id: string, input: { script?: string }) => ({
      ...workspace.project,
      script: input.script,
    })),
    writeScriptEpisodeDraft: vi.fn(async (_id: string, _episodeId: string | null, content: string) => ({
      ...episode,
      revision: 2,
      status: 'draft',
      draftContent: content,
    })),
  }
  const provider = { generate: vi.fn<TextGenerationProvider['generate']>(async () => script) }
  const service = new ProjectService(
    repository as unknown as ProjectRepository,
    providerAvailable ? provider : null,
  )
  const execution: ScriptTaskExecution = { taskWriteGuard: guard, assertActive: vi.fn(async () => {}) }
  const productionMode = surface === 'episode' ? 'web-series' : 'short-video'
  const onTextTiming = vi.fn()
  const generate = (input: Input = {}) =>
    service.generateScript(
      task.projectId,
      input.source ?? script,
      DEFAULT_SCRIPT_DIRECTION,
      input.mode ?? 'quick',
      { goal: '', targetMinutes: 1 },
      productionMode,
      1,
      task.clientRequestId,
      principal,
      'seqora-5.6',
      input.revisionNote ?? '保持原剧情',
      'prepaid',
      input.duration ?? 60,
      undefined,
      input.timing ? onTextTiming : undefined,
      surface === 'episode' && input.mode !== 'segment' ? episode.id : undefined,
      undefined,
      input.unguarded ? undefined : execution,
    )
  const enrich = (input: Input = {}) =>
    service.enrichScript(
      task.projectId,
      input.source ?? script,
      DEFAULT_SCRIPT_DIRECTION,
      productionMode,
      1,
      task.clientRequestId,
      principal,
      'seqora-5.6',
      input.revisionNote ?? '',
      'prepaid',
      input.duration ?? 60,
      undefined,
      input.timing ? onTextTiming : undefined,
      surface === 'episode' ? episode.id : undefined,
      input.unguarded ? undefined : execution,
    )
  const suggest = (strategy: 'fast' | 'model' = 'model', unguarded = false) =>
    service.suggestScriptAssets(
      task.projectId,
      assetScript,
      DEFAULT_SCRIPT_DIRECTION,
      principal,
      undefined,
      undefined,
      strategy,
      unguarded ? undefined : execution,
    )
  const receipt = (result: object) => {
    const completedAt = new Date().toISOString()
    task.status = 'completed'
    task.metadata.localTaskCompletedAt = completedAt
    task.metadata.textResult = structuredClone(result)
    const value = buildTextCompletionReceipt(task, result, guard, completedAt)
    assert(value, 'service result must have execution-bound completion provenance')
    task.metadata.textCompletionReceipt = value
    expect(textCompletionEvidence(task)).toMatchObject({ reason: 'verified', receipt: value })
    expect(value.resultSha256).toBe(textResultDigest(result)?.sha256)
    expect(result).not.toHaveProperty('textCompletionReceipt')
    return value
  }
  return {
    task,
    guard,
    principal,
    service,
    workspace,
    episode,
    repository,
    provider,
    execution,
    generate,
    enrich,
    suggest,
    receipt,
  }
}

describe('script service text completion provenance', () => {
  it.each(['project', 'episode'] as const)(
    'records a retained long %s input without inventing a Provider call',
    async (surface) => {
      const f = fixture('generate', surface)
      const result = await f.generate({ source: longSource })
      expect(result.script).toBe(longSource)
      expect(f.provider.generate).not.toHaveBeenCalled()
      expect(f.receipt(result).units[0]).toMatchObject({ source: 'retained-input', providerCalls: [] })
    },
  )

  it.each(['project', 'episode'] as const)(
    'distinguishes discarded short Provider output from retained %s content',
    async (surface) => {
      const f = fixture('enrich', surface)
      const result = await f.enrich({ source: longSource })
      expect(result.script).toBe(longSource)
      const unit = f.receipt(result).units[0]!
      expect(unit.source).toBe('retained-input')
      expect(unit.providerCalls).toEqual([
        expect.objectContaining({ responseSha256: sha256(script), observation: 'adapter-returned' }),
      ])
      expect(unit.providerCalls[0]!.responseSha256).not.toBe(sha256(result.script))
    },
  )

  it.each(['project', 'episode'] as const)(
    'records all successful generation and enrichment on the %s surface',
    async (surface) => {
      for (const operation of ['generate', 'enrich'] as const) {
        const f = fixture(operation, surface)
        const result = await f[operation]()
        const unit = f.receipt(result).units[0]!
        expect(unit.source).toBe('mixed')
        expect(unit.providerCalls).toHaveLength(1)
        expect(unit.providerCalls[0]).toMatchObject({
          model: 'seqora-5.6',
          responseSha256: sha256(script),
          stage: null,
        })
        expect(unit.unitId).toBe(surface === 'episode' ? 'episode:' + f.episode.id : 'result')
      }
    },
  )

  it.each(['project', 'episode'] as const)(
    'records segment writes on the %s surface and binds the final body',
    async (surface) => {
      const f = fixture('generate', surface)
      f.provider.generate.mockResolvedValueOnce(scene(4))
      const result = await f.generate({ mode: 'segment' })
      expect(result.script).toContain(scene(4))
      if (surface === 'project') expect(result.script).toBe(script + '\n\n' + scene(4))
      const unit = f.receipt(result).units[0]!
      expect(unit.source).toBe('mixed')
      expect(unit.providerCalls[0]!.responseSha256).toBe(sha256(scene(4)))
    },
  )

  it.each(['generate', 'enrich', 'segment'] as const)(
    'observes the nested language repair used by %s',
    async (operation) => {
      const f = fixture(operation === 'enrich' ? 'enrich' : 'generate')
      f.provider.generate.mockResolvedValueOnce(englishScript).mockResolvedValueOnce(script)
      const result =
        operation === 'enrich'
          ? await f.enrich({ timing: true })
          : await f.generate({ mode: operation === 'segment' ? 'segment' : 'quick', timing: true })
      const calls = f.receipt(result).units[0]!.providerCalls
      expect(calls.map((call) => call.stage)).toEqual([
        operation === 'enrich' ? 'rewrite' : operation === 'segment' ? 'next-episode' : 'first-draft',
        'language-repair',
      ])
      expect(calls.map((call) => call.responseSha256)).toEqual([sha256(englishScript), sha256(script)])
      expect(result.script).not.toContain('swordsman')
    },
  )

  it('records both the superseded idea and structural repair response', async () => {
    const f = fixture()
    f.workspace.project.contentType = 'advertisement'
    const repaired = [scene(1), scene(2), scene(3), scene(4)].join('\n')
    f.provider.generate.mockResolvedValueOnce('只有一句广告创意').mockResolvedValueOnce(repaired)
    const result = await f.generate({ source: '诊所的宣传广告', duration: 30, timing: true })
    expect(result.script).toBe(repaired)
    expect(f.receipt(result).units[0]!.providerCalls.map((call) => call.stage)).toEqual([
      'first-draft',
      'structure-repair',
    ])
  })

  it('records scene-count replacement without treating the first candidate as the saved body', async () => {
    const f = fixture('enrich')
    const repaired = [scene(1), scene(2)].join('\n')
    f.provider.generate.mockResolvedValueOnce(scene(1)).mockResolvedValueOnce(repaired)
    const result = await f.enrich({ revisionNote: '只要2个场次', timing: true })
    expect(result.script).toBe(repaired)
    expect(f.receipt(result).units[0]!.providerCalls.map((call) => call.stage)).toEqual([
      'rewrite',
      'scene-count-repair',
    ])
  })

  it('records additive scene completion and its nested language repair', async () => {
    const f = fixture('generate', 'episode')
    f.provider.generate
      .mockResolvedValueOnce(scene(1))
      .mockResolvedValueOnce(englishScript)
      .mockResolvedValueOnce(scene(2))
    const result = await f.generate({ source: '林晚去诊所寻找程野', timing: true })
    expect(result.script).toBe(scene(1) + '\n\n' + scene(2))
    expect(f.receipt(result).units[0]!.providerCalls.map((call) => call.stage)).toEqual([
      'first-draft',
      'scene-completion',
      'language-repair',
    ])
  })

  it('keeps local dialogue additions distinct from the observed Provider output', async () => {
    const f = fixture('generate', 'episode')
    const silent = script.replace(/对白：[^｜]+/gu, '对白：无台词。')
    f.provider.generate.mockResolvedValueOnce(silent)
    const result = await f.generate()
    expect(result.script).not.toBe(silent)
    const unit = f.receipt(result).units[0]!
    expect(unit.source).toBe('mixed')
    expect(unit.providerCalls[0]!.responseSha256).toBe(sha256(silent))
  })

  it('binds checkpoint returns to their actual stored content without claiming current generation', async () => {
    const f = fixture('generate', 'episode')
    const stored = '此前已经保存的检查点正文。'
    const checkpoint = markReusedTextEpisode({
      ...f.episode,
      revision: 7,
      status: 'draft',
      draftContent: stored,
    })
    f.repository.writeScriptEpisodeDraft.mockResolvedValueOnce(checkpoint)
    const result = await f.generate()
    expect(f.provider.generate).toHaveBeenCalledOnce()
    expect(result.script).toBe(stored)
    expect(f.receipt(result).units[0]).toMatchObject({
      source: 'reused-episode',
      providerCalls: [],
      resultSha256: textResultDigest(checkpoint)?.sha256,
    })
  })

  it('does not write or finish a generation rejected by the execution guard', async () => {
    const f = fixture()
    vi.mocked(f.execution.assertActive!).mockRejectedValueOnce(new Error('execution stopped'))
    await expect(f.generate()).rejects.toThrow('execution stopped')
    expect(f.repository.update).not.toHaveBeenCalled()
    expect(buildTextCompletionReceipt(f.task, { script }, f.guard, new Date().toISOString())).toBeNull()
  })

  it.each(['generate', 'enrich'] as const)(
    'preserves unguarded direct %s behavior without creating a task receipt',
    async (operation) => {
      const f = fixture(operation)
      const result = await f[operation]({ unguarded: true })
      expect(result.script).toBe(script)
      expect(buildTextCompletionReceipt(f.task, result, f.guard, new Date().toISOString())).toBeNull()
    },
  )
})

describe('script asset suggestion completion provenance', () => {
  it.each(['fast', 'no-provider', 'provider-error', 'invalid-json'] as const)(
    'marks %s suggestions as local even when a discarded adapter return exists',
    async (path) => {
      const f = fixture('suggest-assets', 'project', path !== 'no-provider')
      if (path === 'provider-error') f.provider.generate.mockRejectedValueOnce(new Error('unavailable'))
      if (path === 'invalid-json') f.provider.generate.mockResolvedValueOnce('invalid json response')
      const result = await f.suggest(path === 'fast' ? 'fast' : 'model')
      expect(result.assets.length).toBeGreaterThan(0)
      const unit = f.receipt(result).units[0]!
      expect(unit.source).toBe('local-derived')
      expect(unit.providerCalls).toHaveLength(path === 'invalid-json' ? 1 : 0)
      if (path === 'fast' || path === 'no-provider') expect(f.provider.generate).not.toHaveBeenCalled()
    },
  )

  it('records an empty adapter return while attesting the nonempty local fallback result', async () => {
    const f = fixture('suggest-assets')
    f.provider.generate.mockResolvedValueOnce('')

    const result = await f.suggest('model')

    expect(result.assets.length).toBeGreaterThan(0)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.every((warning) => warning.trim().length > 0)).toBe(true)
    expect(f.provider.generate).toHaveBeenCalledOnce()
    const receipt = f.receipt(result)
    expect(receipt.resultBytes).toBeGreaterThan(0)
    expect(receipt.units).toHaveLength(1)
    const unit = receipt.units[0]!
    expect(unit.source).toBe('local-derived')
    expect(unit.resultBytes).toBeGreaterThan(0)
    expect(unit.providerCalls).toEqual([
      {
        sequence: 1,
        observation: 'adapter-returned',
        model: ASSET_SUGGESTION_MODEL,
        stage: 'asset-suggestions',
        responseBytes: 0,
        responseSha256: sha256(''),
      },
    ])
  })

  it('marks existing asset delivery reuse as local without a fresh Provider call', async () => {
    const f = fixture('suggest-assets', 'episode')
    f.episode.continuityState.scriptAssetDesignDelivery = { version: 'script_asset_design_delivery.v1' }
    const result = await f.suggest()
    expect(result.assets).toEqual([])
    expect(f.provider.generate).not.toHaveBeenCalled()
    expect(f.receipt(result).units[0]).toMatchObject({ source: 'local-derived', providerCalls: [] })
  })

  it('records an accepted model summary plus locally completed assets as mixed', async () => {
    const f = fixture('suggest-assets')
    const response = JSON.stringify({ summary: '模型建议优先设计诊所与林晚', assets: [] })
    f.provider.generate.mockResolvedValueOnce(response)
    const result = await f.suggest()
    expect(result.summary).toBe('模型建议优先设计诊所与林晚')
    expect(result.assets.length).toBeGreaterThan(0)
    const unit = f.receipt(result).units[0]!
    expect(unit.source).toBe('mixed')
    expect(unit.providerCalls[0]).toMatchObject({
      model: ASSET_SUGGESTION_MODEL,
      stage: 'asset-suggestions',
      responseSha256: sha256(response),
    })
    expect(f.repository.update).not.toHaveBeenCalled()
  })

  it('does not create provenance for an unguarded direct suggestion request', async () => {
    const f = fixture('suggest-assets')
    const result = await f.suggest('fast', true)
    expect(result.assets.length).toBeGreaterThan(0)
    expect(buildTextCompletionReceipt(f.task, result, f.guard, new Date().toISOString())).toBeNull()
  })

  it.each(['projectId', 'tenantId', 'userId'] as const)(
    'does not attest suggestions computed for a different %s',
    async (field) => {
      for (const strategy of ['fast', 'model'] as const) {
        const f = fixture('suggest-assets')
        f.provider.generate.mockResolvedValueOnce(JSON.stringify({ summary: '可采用的模型摘要', assets: [] }))
        const principal = { ...f.principal, ...(field === 'projectId' ? {} : { [field]: 'different-scope' }) }
        const result = await f.service.suggestScriptAssets(
          field === 'projectId' ? 'different-project' : f.task.projectId,
          assetScript,
          DEFAULT_SCRIPT_DIRECTION,
          principal,
          undefined,
          undefined,
          strategy,
          f.execution,
        )
        expect(result.assets.length).toBeGreaterThan(0)
        expect(buildTextCompletionReceipt(f.task, result, f.guard, new Date().toISOString())).toBeNull()
      }
    },
  )
})
