import { describe, expect, it, vi } from 'vitest'
import { createProjectSchema, generateScriptRequestSchema, type Principal } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { ProjectRepository } from './repository.js'
import { ProjectService } from './service.js'
import { generateEpisodeBatch } from './episodeBatch.js'
import { StoreCreditLedger } from '../billing/creditLedger.js'
import { UserRepository } from '../users/repository.js'

describe('episode batch recovery', () => {
  it('keeps saved episodes, retries only unfinished material and carries the previous ending', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
    const repository = new ProjectRepository(store)
    const service = new ProjectService(repository)
    const project = await service.create(
      createProjectSchema.parse({ name: '分集恢复测试', contentType: 'short-drama', aspectRatio: '9:16' }),
      principal,
    )
    const input = generateScriptRequestSchema.parse({
      episodePlan: {
        id: '7c3763e5-0ea7-46ef-b8b6-de95107ec674',
        episodes: [
          { title: '回家', source: '林晚回家。' },
          { title: '出发', source: '林晚出发。' },
        ],
      },
    })
    let failed = false
    const generate = vi.spyOn(service, 'generateScript').mockImplementation(async (...args) => {
      if (args[1].includes('出发') && !failed) {
        failed = true
        throw new Error('temporary provider failure')
      }
      const episode = await repository.writeScriptEpisodeDraft(args[0], null, args[1], args[8], {
        ...args[16],
        generationClientRequestId: args[7],
      })
      return { script: args[1], episode: episode!, mode: 'quick', warnings: [] }
    })
    await expect(generateEpisodeBatch(service, project.id, input, principal)).rejects.toThrow(
      'temporary provider failure',
    )
    const first = (await service.workspace(project.id, principal)).scriptEpisodes[0]!
    await service.saveScriptEpisode(project.id, first.id, first.draftContent, principal)
    const result = await generateEpisodeBatch(service, project.id, input, principal)
    expect(result.episodes).toHaveLength(2)
    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls[2]?.[16]?.continuity).toBe('林晚回家。')
    expect(
      (await service.workspace(project.id, principal)).scriptEpisodes.map((episode) => episode.title),
    ).toEqual(['回家', '出发'])
    const stopped = vi.fn(async () => {
      throw new Error('stopped')
    })
    await expect(
      generateEpisodeBatch(service, project.id, input, principal, { assertActive: stopped }),
    ).rejects.toThrow('stopped')
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('does not debit twice after restart, and charges a refunded retry once', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
    const ledger = new StoreCreditLedger(store, new UserRepository(store))
    const before = store.read((state) => state.users.find((user) => user.id === principal.userId)!.credits)
    const first = await ledger.reserveRecoverable(principal, 3, 'episode-plan-test', '分集生成')
    expect(await ledger.reserveRecoverable(principal, 3, 'episode-plan-test', '分集生成')).toBe(first)
    await ledger.refundReservation(principal, first, '失败退款')
    const retry = await ledger.reserveRecoverable(principal, 3, 'episode-plan-test', '分集生成')
    expect(retry).not.toBe(first)
    expect(store.read((state) => state.users.find((user) => user.id === principal.userId)!.credits)).toBe(
      before - 3,
    )
  })
})

describe('batch generation and actual billing', () => {
  it('uses the real script service, refunds a stopped episode, then resumes without charging completed episodes', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
    const repository = new ProjectRepository(store)
    const ledger = new StoreCreditLedger(store, new UserRepository(store))
    const generated = Array.from(
      { length: 6 },
      (_, i) =>
        `场次：S0${i + 1}｜时长：10秒｜剧情：林晚追查第${i + 1}条线索。｜场景：诊所。｜角色：林晚；程野。｜动作：林晚推门，程野抬眼。｜对白：[对白]林晚：请告诉我实情。[对白]程野：那个人刚离开。[对白]林晚：我要找到他。[对白]程野：跟我来。｜衔接：两人走向门口。`,
    ).join('\n')
    const provider = { generate: vi.fn(async () => generated) }
    const service = new ProjectService(repository, provider, ledger)
    const project = await service.create(
      createProjectSchema.parse({ name: '扣费恢复', contentType: 'short-drama', aspectRatio: '9:16' }),
      principal,
    )
    const input = generateScriptRequestSchema.parse({
      episodePlan: {
        id: '7c3763e5-0ea7-46ef-b8b6-de95107ec675',
        episodes: [
          { title: '回家', source: '林晚回家找程野。' },
          { title: '出发', source: '林晚与程野出发。' },
        ],
      },
    })
    const initial = (await ledger.summary(principal)).credits
    let checks = 0
    const context = {
      assertActive: async () => {
        if (++checks === 4) throw new Error('cancelled before save')
      },
    }
    await expect(
      generateEpisodeBatch(service, project.id, input, principal, context, 'task-one'),
    ).rejects.toThrow('cancelled before save')
    expect((await service.workspace(project.id, principal)).scriptEpisodes).toHaveLength(1)
    expect((await ledger.summary(principal)).credits).toBe(initial - 3)
    await generateEpisodeBatch(service, project.id, input, principal, undefined, 'task-two')
    expect((await service.workspace(project.id, principal)).scriptEpisodes).toHaveLength(2)
    expect((await ledger.summary(principal)).credits).toBe(initial - 6)
    const callCount = provider.generate.mock.calls.length
    await generateEpisodeBatch(service, project.id, input, principal, undefined, 'task-two')
    expect(provider.generate).toHaveBeenCalledTimes(callCount)
    expect((await ledger.summary(principal)).credits).toBe(initial - 6)
  })
})
