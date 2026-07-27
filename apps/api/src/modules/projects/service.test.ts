import { DEFAULT_SCRIPT_DIRECTION } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../infra/store.js'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { projectGenerationSummary, projectPreviewUrl } from './repository.js'
import type { ProjectRepository } from './repository.js'
import { assignShotEpisodes, ProjectService, splitScriptParagraphs } from './service.js'

describe('ProjectService script billing', () => {
  it('does not reserve credits again for a queue-prepaid script task', async () => {
    const generatedScript =
      '场次：1｜剧情：林夏进入雨夜车站。｜场景：雨夜车站。｜角色：林夏。｜动作：她收起雨伞并望向站台。｜对白：林夏：“终于到了。”'
    const repository = {
      workspace: () => ({
        project: {
          name: '雨夜来信',
          contentType: '短剧',
          synopsis: '林夏寻找一封失踪的信。',
          aspectRatio: '16:9',
          script: '',
        },
        assets: [],
      }),
      update: vi.fn(async (_projectId, input) => ({ script: input.script })),
    } as unknown as ProjectRepository
    const textProvider: TextGenerationProvider = { generate: vi.fn(async () => generatedScript) }
    const creditLedger = {
      reserve: vi.fn(),
      refundReservation: vi.fn(),
    } as unknown as CreditLedger
    const service = new ProjectService(repository, textProvider, creditLedger)

    const result = await service.generateScript(
      'project-1',
      '雨夜车站里藏着一封信',
      DEFAULT_SCRIPT_DIRECTION,
      'quick',
      { goal: '', targetMinutes: 1 },
      'short-video',
      1,
      'queued-script-1',
      { userId: 'user-1', tenantId: 'tenant-1', roles: ['creator'] },
      'seqora-5.6',
      '',
      'prepaid',
    )

    expect(result.script).toBe(generatedScript)
    expect(creditLedger.reserve).not.toHaveBeenCalled()
    expect(repository.update).toHaveBeenCalledOnce()
  })
})

describe('assignShotEpisodes', () => {
  it('keeps shots whole while assigning target-duration episodes', () => {
    const result = assignShotEpisodes(
      [
        { id: 'shot-1', duration: 12 },
        { id: 'shot-2', duration: 12 },
        { id: 'shot-3', duration: 10 },
        { id: 'shot-4', duration: 15 },
      ],
      30,
    )

    expect(result.map((shot) => shot.episodeNumber)).toEqual([1, 1, 2, 2])
    expect(result.map((shot) => shot.id)).toEqual(['shot-1', 'shot-2', 'shot-3', 'shot-4'])
  })

  it('keeps a hook as the last shot of its current episode', () => {
    const result = assignShotEpisodes(
      [
        { id: 'shot-1', duration: 15 },
        { id: 'shot-2', duration: 15 },
        { id: 'hook-1', duration: 8, episodeKind: 'hook' as const },
      ],
      30,
    )

    expect(result[2]).toMatchObject({
      episodeNumber: 1,
      episodeTitle: '第 1 集',
      episodeKind: 'hook',
    })
  })

  it('starts the shot after a hook in the next episode', () => {
    const result = assignShotEpisodes(
      [
        { id: 'shot-1', duration: 12 },
        { id: 'hook-1', duration: 8, episodeKind: 'hook' as const },
        { id: 'shot-2', duration: 10 },
      ],
      60,
    )

    expect(result.map((shot) => shot.episodeNumber)).toEqual([1, 1, 2])
  })

  it('prioritizes an explicit episode break over duration grouping', () => {
    const result = assignShotEpisodes(
      [
        { id: 'shot-1', duration: 8 },
        { id: 'shot-2', duration: 8, episodeBreakBefore: true },
      ],
      60,
    )

    expect(result.map((shot) => shot.episodeNumber)).toEqual([1, 2])
    expect(result[1]?.episodeBreakBefore).toBe(true)
  })
})

describe('splitScriptParagraphs', () => {
  it('removes manual markers and flags the next script paragraph', () => {
    expect(splitScriptParagraphs('第一场\n【强制下一集】\n第二场')).toEqual([
      { text: '第一场', forceEpisodeBreakBefore: false },
      { text: '第二场', forceEpisodeBreakBefore: true },
    ])
  })

  it('keeps a separate forced shot marker without turning it into an episode break', () => {
    expect(splitScriptParagraphs('第一场\n【强制分镜】\n第二场')).toEqual([
      { text: '第一场', forceEpisodeBreakBefore: false },
      { text: '第二场', forceEpisodeBreakBefore: false, forceShotBreakBefore: true },
    ])
  })
})

describe('projectPreviewUrl', () => {
  it('prefers a completed video last frame over still images and assets', () => {
    const state = {
      tasks: [
        {
          projectId: 'project-1',
          kind: 'video',
          status: 'completed',
          updatedAt: '2026-07-27T01:00:00.000Z',
          outputs: [{ url: '/video-last-frame.png', mediaType: 'image', view: 'last-frame' }],
        },
      ],
      shots: [{ projectId: 'project-1', order: 1, imageUrl: '/shot.png' }],
      assets: [{ projectId: 'project-1', kind: 'scene', imageUrl: '/scene.png', references: [] }],
    } as unknown as Pick<AppState, 'tasks' | 'shots' | 'assets'>

    expect(projectPreviewUrl('project-1', state)).toBe('/video-last-frame.png')
  })

  it('falls back from generated images to the first shot or asset preview', () => {
    const state = {
      tasks: [],
      shots: [{ projectId: 'project-1', order: 1, imageUrl: '/shot.png' }],
      assets: [{ projectId: 'project-1', kind: 'scene', imageUrl: '/scene.png', references: [] }],
    } as unknown as Pick<AppState, 'tasks' | 'shots' | 'assets'>

    expect(projectPreviewUrl('project-1', state)).toBe('/shot.png')
  })
})

describe('projectGenerationSummary', () => {
  it('counts actionable states and returns the latest affected task labels', () => {
    const state = {
      tasks: [
        {
          id: 'running-1',
          projectId: 'project-1',
          label: '镜头 03 · 推门',
          kind: 'video',
          status: 'running',
          progress: 48,
          updatedAt: '2026-07-27T03:00:00.000Z',
        },
        {
          id: 'queued-1',
          projectId: 'project-1',
          label: '镜头 04 · 入室',
          kind: 'video',
          status: 'queued',
          progress: 0,
          updatedAt: '2026-07-27T02:00:00.000Z',
        },
        {
          id: 'failed-1',
          projectId: 'project-1',
          label: '主角全身图',
          kind: 'image',
          status: 'failed',
          progress: 100,
          updatedAt: '2026-07-27T01:00:00.000Z',
        },
        {
          id: 'hidden-paused-1',
          projectId: 'project-1',
          label: '已删除的暂停任务',
          kind: 'video',
          status: 'paused',
          progress: 0,
          updatedAt: '2026-07-27T05:00:00.000Z',
          metadata: { queueHiddenAt: '2026-07-27T05:01:00.000Z' },
        },
        {
          id: 'completed-1',
          projectId: 'project-1',
          label: '已完成任务',
          kind: 'image',
          status: 'completed',
          progress: 100,
          updatedAt: '2026-07-27T04:00:00.000Z',
        },
      ],
    } as unknown as Pick<AppState, 'tasks'>

    expect(projectGenerationSummary('project-1', state)).toMatchObject({
      running: 1,
      queued: 1,
      paused: 0,
      failed: 1,
      latest: [
        { id: 'running-1', label: '镜头 03 · 推门', status: 'running' },
        { id: 'queued-1', label: '镜头 04 · 入室', status: 'queued' },
        { id: 'failed-1', label: '主角全身图', status: 'failed' },
      ],
    })
  })
})
