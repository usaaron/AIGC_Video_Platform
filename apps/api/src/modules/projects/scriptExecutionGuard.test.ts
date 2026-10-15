import { DEFAULT_SCRIPT_DIRECTION, type Principal } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../core/errors.js'
import type { TextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { ProjectRepository } from './repository.js'
import { ProjectService } from './service.js'

const principal: Principal = { userId: 'user-1', tenantId: 'tenant-1', roles: ['member'] }
const script = Array.from(
  { length: 6 },
  (_, i) =>
    `场次：S0${i + 1}｜时长：10秒｜剧情：林晚追查第${i + 1}条线索。｜场景：诊所。｜角色：林晚；程野。｜动作：林晚推门，程野抬眼。｜对白：[对白]林晚：请告诉我实情。[对白]程野：那个人刚离开。[对白]林晚：我要找到他。[对白]程野：跟我来。｜衔接：两人走向门口。`,
).join('\n')
type Operation = 'long-generate' | 'segment' | 'generate' | 'enrich' | 'long-enrich'
type Surface = 'project' | 'episode'
const writeGuard = Object.freeze({ marker: 'private-write-guard' }) as unknown as TextTaskWriteGuard
const leaseLost = () => new AppError(409, 'TASK_LEASE_LOST', '旧任务租约已失效')

function fixture(surface: Surface = 'project') {
  const episode = { id: 'episode-1', status: 'saved', content: script, draftContent: '', continuityState: {} }
  const workspace = {
    project: {
      id: 'project-1',
      name: '追查',
      contentType: surface === 'episode' ? 'short-drama' : 'short-video',
      synopsis: '',
      aspectRatio: '16:9',
      script,
    },
    assets: [],
    ...(surface === 'episode' ? { scriptEpisodes: [episode] } : {}),
  }
  const repository = {
    workspace: vi.fn(async () => workspace),
    update: vi.fn(
      async (
        _project: string,
        input: { script?: string },
        _principal: Principal,
        _guard?: TextTaskWriteGuard,
      ) => ({ ...workspace.project, script: input.script }),
    ),
    writeScriptEpisodeDraft: vi.fn(
      async (
        _project: string,
        _episode: string | null,
        content: string,
        _principal: Principal,
        _options?: object,
      ) => ({ ...episode, draftContent: content, status: 'draft' }),
    ),
  }
  const provider: TextGenerationProvider = { generate: vi.fn(async () => script) }
  const ledger = {
    reserve: vi.fn(async () => true),
    refundReservation: vi.fn<CreditLedger['refundReservation']>(async () => {}),
  }
  const service = new ProjectService(
    repository as unknown as ProjectRepository,
    provider,
    ledger as unknown as CreditLedger,
  )
  const invoke = (
    operation: Operation,
    assertActive?: () => Promise<void>,
    billingMode: 'direct' | 'prepaid' = 'prepaid',
    batch?: Parameters<ProjectService['generateScript']>[16],
  ) => {
    const source = operation.startsWith('long-') ? '长篇故事原稿。'.repeat(1500) : script
    const productionMode = surface === 'episode' ? 'web-series' : 'short-video'
    const episodeId = surface === 'episode' && operation !== 'segment' ? 'episode-1' : undefined
    const execution = { assertActive, taskWriteGuard: writeGuard }
    if (operation === 'enrich' || operation === 'long-enrich')
      return service.enrichScript(
        'project-1',
        source,
        DEFAULT_SCRIPT_DIRECTION,
        productionMode,
        1,
        'request-1',
        principal,
        'seqora-5.6',
        '',
        billingMode,
        60,
        undefined,
        undefined,
        episodeId,
        execution,
      )
    return service.generateScript(
      'project-1',
      source,
      DEFAULT_SCRIPT_DIRECTION,
      operation === 'segment' ? 'segment' : 'quick',
      { goal: '', targetMinutes: 1 },
      productionMode,
      1,
      'request-1',
      principal,
      'seqora-5.6',
      '保持原剧情',
      billingMode,
      60,
      undefined,
      undefined,
      episodeId,
      batch,
      execution,
    )
  }
  return { repository, provider, ledger, service, invoke }
}

describe('script service task execution guard', () => {
  const paths = (['project', 'episode'] as const).flatMap((surface) =>
    (['long-generate', 'segment', 'generate', 'enrich', 'long-enrich'] as const).map((operation) => ({
      surface,
      operation,
    })),
  )

  it.each(paths)(
    'rejects stale $operation before writing its $surface destination',
    async ({ surface, operation }) => {
      const f = fixture(surface)
      const assertActive = vi.fn(async () => {
        throw leaseLost()
      })
      await expect(f.invoke(operation, assertActive)).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
      expect(assertActive).toHaveBeenCalledOnce()
      expect(f.repository.update).not.toHaveBeenCalled()
      expect(f.repository.writeScriptEpisodeDraft).not.toHaveBeenCalled()
      expect(f.ledger.refundReservation).not.toHaveBeenCalled()
      if (operation === 'long-generate') expect(f.provider.generate).not.toHaveBeenCalled()
    },
  )

  it.each(paths)(
    'awaits active $operation and forwards its guard to the $surface destination',
    async ({ surface, operation }) => {
      const f = fixture(surface)
      let release!: () => void
      const assertActive = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
      const pending = f.invoke(operation, assertActive)
      await vi.waitFor(() => expect(assertActive).toHaveBeenCalledOnce())
      expect(f.repository.update).not.toHaveBeenCalled()
      expect(f.repository.writeScriptEpisodeDraft).not.toHaveBeenCalled()
      release()
      await pending
      if (surface === 'project') {
        expect(f.repository.update).toHaveBeenCalledOnce()
        expect(f.repository.update.mock.calls[0]?.[3]).toBe(writeGuard)
      } else {
        expect(f.repository.writeScriptEpisodeDraft).toHaveBeenCalledOnce()
        expect(f.repository.writeScriptEpisodeDraft.mock.calls[0]?.[4]).toMatchObject({
          taskWriteGuard: writeGuard,
        })
      }
    },
  )

  it.each(['generate', 'segment', 'enrich'] as const)(
    'does not refund a late %s Provider failure after losing the lease',
    async (operation) => {
      const f = fixture()
      const providerError = new Error('late provider error')
      vi.mocked(f.provider.generate).mockRejectedValueOnce(providerError)
      f.ledger.refundReservation.mockRejectedValueOnce(leaseLost())
      const assertActive = vi.fn(async () => {
        throw leaseLost()
      })
      await expect(f.invoke(operation, assertActive, 'direct')).rejects.toBe(providerError)
      expect(f.ledger.reserve).toHaveBeenCalledOnce()
      expect(assertActive).not.toHaveBeenCalled()
      expect(f.ledger.refundReservation).toHaveBeenCalledOnce()
      expect(f.ledger.refundReservation.mock.calls[0]?.[4]).toBe(writeGuard)
      expect(f.repository.update).not.toHaveBeenCalled()
    },
  )

  it.each(['generate', 'segment', 'enrich'] as const)(
    'still refunds an active %s Provider failure',
    async (operation) => {
      const f = fixture()
      vi.mocked(f.provider.generate).mockRejectedValueOnce(new Error('provider unavailable'))
      const assertActive = vi.fn(async () => {})
      await expect(f.invoke(operation, assertActive, 'direct')).rejects.toThrow('provider unavailable')
      expect(assertActive).not.toHaveBeenCalled()
      expect(f.ledger.refundReservation).toHaveBeenCalledOnce()
      expect(f.ledger.refundReservation.mock.calls[0]?.[4]).toBe(writeGuard)
    },
  )

  it('checks distinct legacy batch and execution guards before writing', async () => {
    const f = fixture('episode')
    const calls: string[] = []
    const assertActive = vi.fn(async () => {
      calls.push('execution')
    })
    const beforeWrite = vi.fn(async () => {
      calls.push('batch')
    })
    await f.invoke('generate', assertActive, 'prepaid', {
      createNext: true,
      title: '本集',
      batchGenerationKey: 'batch-1',
      continuity: '',
      beforeWrite,
    })
    expect(calls).toEqual(['execution', 'batch'])
    expect(f.repository.writeScriptEpisodeDraft.mock.calls[0]?.[4]).toMatchObject({
      batchGenerationKey: 'batch-1',
      taskWriteGuard: writeGuard,
    })
  })

  it('calls an identical shared batch guard once per write', async () => {
    const f = fixture('episode')
    const assertActive = vi.fn(async () => {})
    await f.invoke('generate', assertActive, 'prepaid', {
      createNext: true,
      title: '本集',
      batchGenerationKey: 'batch-1',
      continuity: '',
      beforeWrite: assertActive,
    })
    expect(assertActive).toHaveBeenCalledOnce()
  })
})
