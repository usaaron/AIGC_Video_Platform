import { createHash } from 'node:crypto'
import {
  createProjectSchema,
  generateScriptRequestSchema,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import { assert, describe, expect, it, vi } from 'vitest'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { LocalTaskExecutionContext } from '../../core/jobs/localTaskHandler.js'
import { claimGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { buildTextCompletionReceipt, textResultDigest } from '../../core/jobs/textCompletion.js'
import {
  assertTextTaskWriteGuard,
  captureTextTaskWriteGuard,
} from '../../core/jobs/textTaskExecutionGuard.js'
import { AppStore } from '../../infra/store.js'
import { queuedTextTask } from '../../testing/generationTaskFixtures.js'
import { textCompletionEvidence } from '../generation/textCompletionEvidence.js'
import { generateEpisodeBatch } from './episodeBatch.js'
import { ProjectRepository } from './repository.js'
import { ProjectService } from './service.js'

const firstScript = Array.from(
  { length: 6 },
  (_, index) =>
    '场次：S0' +
    (index + 1) +
    '｜时长：10秒｜剧情：林晚追查第' +
    (index + 1) +
    '条线索。｜场景：诊所。｜角色：林晚；程野。｜动作：林晚推门，程野抬眼。｜对白：[对白]林晚：请告诉我实情。[对白]程野：那个人刚离开。[对白]林晚：我要找到他。[对白]程野：跟我来。｜衔接：两人走向门口。',
).join(String.fromCharCode(10))
const secondScript = Array.from(
  { length: 6 },
  (_, index) =>
    '场次：T0' +
    (index + 1) +
    '｜时长：10秒｜剧情：赵岚在气象塔寻找第' +
    (index + 1) +
    '份航标图。｜场景：气象塔。｜角色：赵岚；顾衡。｜动作：赵岚拆开锈锁，顾衡点亮信号灯。｜对白：[对白]赵岚：信号还在吗？[对白]顾衡：北侧灯已经恢复。[对白]赵岚：把坐标发出去。[对白]顾衡：现在就发。｜衔接：两人转向控制台。',
).join(String.fromCharCode(10))
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
type BatchResult = Awaited<ReturnType<typeof generateEpisodeBatch>>

async function fixture() {
  const store = new AppStore(null)
  await store.initialize()
  const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
  const repository = new ProjectRepository(store)
  const project = await repository.create(
    createProjectSchema.parse({
      name: '分集完成来源',
      contentType: 'short-drama',
      aspectRatio: '9:16',
    }),
    principal,
  )
  const input = generateScriptRequestSchema.parse({
    model: 'seqora-5.6',
    episodeDurationSeconds: 60,
    episodePlan: {
      id: '7c3763e5-0ea7-46ef-b8b6-de95107ec678',
      episodes: [
        { title: '诊所线索', source: '林晚回诊所找程野，追查失踪的人。' },
        { title: '气象塔信号', source: '赵岚去气象塔找顾衡，修复灯塔信号。' },
      ],
    },
  })
  const task = queuedTextTask('episode-batch-completion-' + project.id)
  task.projectId = project.id
  task.model = input.model
  const provider = { generate: vi.fn<TextGenerationProvider['generate']>() }
  const service = new ProjectService(repository, provider)
  const claim = async () => {
    task.status = 'queued'
    claimGenerationTaskLease(task, 'episode-batch-worker', 60_000)
    const guard = captureTextTaskWriteGuard(task)
    await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      state.tasks = [structuredClone(task)]
    })
    return {
      taskWriteGuard: guard,
      assertActive: async () =>
        assertTextTaskWriteGuard(
          store.read((state) => state.tasks.find((item) => item.id === task.id)),
          guard,
        ),
      onTextTiming: vi.fn(),
    }
  }
  const run = (context: LocalTaskExecutionContext) =>
    generateEpisodeBatch(service, project.id, input, principal, context, task.id)
  const complete = (result: BatchResult, context: LocalTaskExecutionContext) => {
    const completedAt = new Date().toISOString()
    const completed: GenerationTask = {
      ...task,
      status: 'completed',
      metadata: {
        ...task.metadata,
        localTaskCompletedAt: completedAt,
        textResult: structuredClone(result),
      },
    }
    const receipt = buildTextCompletionReceipt(completed, result, context.taskWriteGuard!, completedAt)
    assert(receipt, 'all returned episodes must have fresh or explicit reused provenance')
    completed.metadata.textCompletionReceipt = receipt
    expect(textCompletionEvidence(completed)).toMatchObject({ reason: 'verified', receipt })
    expect(receipt.units).toHaveLength(2)
    expect(receipt.units.map((unit) => unit.unitId)).toEqual(
      result.episodes.map((episode) => 'episode:' + episode.id),
    )
    for (const [index, episode] of result.episodes.entries()) {
      const digest = textResultDigest(episode)!
      expect(receipt.units[index]).toMatchObject({ resultSha256: digest.sha256, resultBytes: digest.bytes })
      expect(episode).toMatchObject({ projectId: project.id, tenantId: principal.tenantId })
    }
    expect(result.episode).toEqual(result.episodes[1])
    expect(result.script).toBe(result.episodes[1]!.draftContent || result.episodes[1]!.content)
    return { receipt, completed }
  }
  return { store, repository, project, task, provider, service, principal, claim, run, complete }
}

describe('episode batch text completion provenance', () => {
  it('binds both fresh persisted episodes rather than only the final script', async () => {
    const f = await fixture()
    f.provider.generate.mockResolvedValueOnce(firstScript).mockResolvedValueOnce(secondScript)
    const context = await f.claim()
    const result = await f.run(context)
    expect(f.provider.generate).toHaveBeenCalledTimes(2)
    const saved = (await f.service.workspace(f.project.id, f.principal)).scriptEpisodes
    expect(result.episodes).toEqual(saved)
    expect(result.episodes.map((episode) => episode.revision)).toEqual([1, 1])
    expect(result.episodes.map((episode) => episode.draftContent)).toEqual([firstScript, secondScript])
    const { receipt, completed } = f.complete(result, context)
    expect(receipt.units.map((unit) => unit.source)).toEqual(['mixed', 'mixed'])
    expect(receipt.units.flatMap((unit) => unit.providerCalls.map((call) => call.sequence))).toEqual([1, 2])
    expect(receipt.units.flatMap((unit) => unit.providerCalls.map((call) => call.responseSha256))).toEqual([
      sha256(firstScript),
      sha256(secondScript),
    ])
    for (const patch of [
      { id: 'different-episode' },
      { revision: 2 },
      { draftContent: 'changed-first-episode' },
      { content: 'changed-saved-content' },
    ]) {
      const changed = { ...result, episodes: [{ ...result.episodes[0]!, ...patch }, result.episodes[1]!] }
      expect(
        textCompletionEvidence({ ...completed, metadata: { ...completed.metadata, textResult: changed } })
          .reason,
      ).toBe('receipt-mismatch')
    }
    const reversed = {
      ...result,
      episodes: [...result.episodes].reverse(),
      episode: result.episodes[0],
      script: result.episodes[0]!.draftContent,
    }
    expect(
      textCompletionEvidence({ ...completed, metadata: { ...completed.metadata, textResult: reversed } })
        .reason,
    ).toBe('receipt-mismatch')
  })

  it('records the saved first episode as reused after a failed second episode is retried under a new attempt', async () => {
    const f = await fixture()
    f.provider.generate
      .mockResolvedValueOnce(firstScript)
      .mockRejectedValueOnce(new Error('second episode unavailable'))
    const original = await f.claim()
    await expect(f.run(original)).rejects.toThrow('second episode unavailable')
    const saved = (await f.service.workspace(f.project.id, f.principal)).scriptEpisodes
    expect(saved).toHaveLength(1)
    f.provider.generate.mockResolvedValueOnce(secondScript)
    const retry = await f.claim()
    expect(retry.taskWriteGuard.attempts).toBe(original.taskWriteGuard.attempts + 1)
    expect(retry.taskWriteGuard.leaseToken).not.toBe(original.taskWriteGuard.leaseToken)
    const result = await f.run(retry)
    expect(f.provider.generate).toHaveBeenCalledTimes(3)
    expect(result.episodes[0]).toEqual(saved[0])
    expect(result.script).toBe(secondScript)
    const { receipt } = f.complete(result, retry)
    expect(receipt.attempts).toBe(retry.taskWriteGuard.attempts)
    expect(receipt.units.map((unit) => unit.source)).toEqual(['reused-episode', 'mixed'])
    expect(receipt.units[0]!.providerCalls).toEqual([])
    expect(receipt.units[1]!.providerCalls).toEqual([
      expect.objectContaining({ sequence: 1, responseSha256: sha256(secondScript) }),
    ])
  })

  it('records an all-checkpoint replay with no current Provider calls or body revisions', async () => {
    const f = await fixture()
    f.provider.generate.mockResolvedValueOnce(firstScript).mockResolvedValueOnce(secondScript)
    const initial = await f.run(await f.claim())
    f.provider.generate.mockClear()
    const retry = await f.claim()
    const result = await f.run(retry)
    expect(f.provider.generate).not.toHaveBeenCalled()
    expect(result.episodes).toEqual(initial.episodes)
    expect((await f.service.workspace(f.project.id, f.principal)).scriptEpisodes).toEqual(initial.episodes)
    const { receipt } = f.complete(result, retry)
    expect(receipt.units.map((unit) => unit.source)).toEqual(['reused-episode', 'reused-episode'])
    expect(receipt.units.flatMap((unit) => unit.providerCalls)).toEqual([])
  })

  it('does not attest an all-checkpoint batch under a different user execution scope', async () => {
    const f = await fixture()
    f.provider.generate.mockResolvedValueOnce(firstScript).mockResolvedValueOnce(secondScript)
    const initial = await f.run(await f.claim())
    f.provider.generate.mockClear()
    const retry = await f.claim()
    const foreignTask = { ...f.task, userId: 'different-user' }
    const foreignGuard = { ...retry.taskWriteGuard, userId: foreignTask.userId }
    const result = await f.run({ taskWriteGuard: foreignGuard })
    expect(result.episodes).toEqual(initial.episodes)
    expect(f.provider.generate).not.toHaveBeenCalled()
    expect(buildTextCompletionReceipt(foreignTask, result, foreignGuard, new Date().toISOString())).toBeNull()
  })
})
