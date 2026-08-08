import { DEFAULT_SCRIPT_DIRECTION } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { AppStore, type AppState } from '../../infra/store.js'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { projectGenerationSummary, projectPreviewUrl } from './repository.js'
import { ProjectRepository } from './repository.js'
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

  it('removes model reasoning preambles before saving a script', async () => {
    const generatedScript =
      '用户希望我生成一个场次。让我先分析人物与动作。\n场次：S01｜剧情：林夏推门进入。｜场景：雨夜车站。｜角色：林夏。｜动作：林夏收伞并抬头。｜对白：无台词。｜风格：影视CG。｜构图：中景。｜光影：冷色顶光。｜运镜：缓慢推进。｜衔接：林夏停在门内。'
    const repository = {
      workspace: () => ({
        project: {
          name: '雨夜来信',
          contentType: '短片',
          synopsis: '林夏进入车站。',
          aspectRatio: '16:9',
          script: '',
        },
        assets: [],
      }),
      update: vi.fn(async (_projectId, input) => ({ script: input.script })),
    } as unknown as ProjectRepository
    const service = new ProjectService(repository, { generate: vi.fn(async () => generatedScript) }, {
      reserve: vi.fn(),
      refundReservation: vi.fn(),
    } as unknown as CreditLedger)

    const result = await service.generateScript(
      'project-1',
      '林夏进入车站',
      DEFAULT_SCRIPT_DIRECTION,
      'quick',
      { goal: '', targetMinutes: 1 },
      'short-video',
      1,
      'reasoning-cleanup',
      { userId: 'user-1', tenantId: 'tenant-1', roles: ['creator'] },
      'seqora-5.6',
      '',
      'prepaid',
    )

    expect(result.script).toMatch(/^场次：S01/u)
    expect(result.script).not.toContain('用户希望')
  })

  it('rejects an explicitly requested scene count when the provider truncates the result', async () => {
    const incomplete = Array.from(
      { length: 5 },
      (_, index) =>
        `场次：S0${index + 1}｜剧情：推进冲突。｜场景：屋顶。｜角色：侠客。｜动作：侠客向前一步。｜对白：无台词。｜风格：影视CG。｜构图：中景。｜光影：冷光。｜运镜：推进。｜衔接：保持站姿。`,
    ).join('\n')
    const repository = {
      workspace: () => ({
        project: {
          name: '十场短片',
          contentType: '短片',
          synopsis: '',
          aspectRatio: '16:9',
          script: '',
        },
        assets: [],
      }),
      update: vi.fn(),
    } as unknown as ProjectRepository
    const service = new ProjectService(repository, { generate: vi.fn(async () => incomplete) }, {
      reserve: vi.fn(),
      refundReservation: vi.fn(),
    } as unknown as CreditLedger)

    await expect(
      service.generateScript(
        'project-1',
        '请把故事拆成10个场次，每场独立成镜。',
        DEFAULT_SCRIPT_DIRECTION,
        'quick',
        { goal: '', targetMinutes: 1 },
        'short-video',
        1,
        'truncated-scenes',
        { userId: 'user-1', tenantId: 'tenant-1', roles: ['creator'] },
        'seqora-5.6',
        '',
        'prepaid',
      ),
    ).rejects.toThrow('明确要求 10 个场次，实际只返回 5 个')
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('automatically repairs an English-dominant script before writing it back', async () => {
    const englishResult = [
      'S01: The swordsman enters the courtyard and watches the silent guards step backward.',
      'S02: The captain raises his blade, shouts an order, and forces everyone toward the gate.',
      'S03: The swordsman blocks the attack, turns aside, and prepares the final counterattack.',
    ].join('\n')
    const repairedScript =
      '场次：S01｜剧情：剑客进入庭院，守卫无声后退。｜场景：夜色庭院。｜角色：剑客；守卫。｜动作：剑客停步观察，守卫后退。｜对白：无台词。｜风格：影视CG。｜构图：中景。｜光影：冷色月光。｜运镜：缓慢推进。｜衔接：剑客停在庭院中央。'
    const repository = {
      workspace: () => ({
        project: {
          name: '庭院对决',
          contentType: 'short-video',
          synopsis: '剑客进入庭院。',
          aspectRatio: '16:9',
          script: '',
        },
        assets: [],
      }),
      update: vi.fn(async (_projectId, input) => ({ script: input.script })),
    } as unknown as ProjectRepository
    const textProvider: TextGenerationProvider = {
      generate: vi.fn().mockResolvedValueOnce(englishResult).mockResolvedValueOnce(repairedScript),
    }
    const service = new ProjectService(repository, textProvider)

    const result = await service.generateScript(
      'project-1',
      '剑客进入庭院与守卫对峙',
      DEFAULT_SCRIPT_DIRECTION,
      'quick',
      { goal: '', targetMinutes: 1 },
      'short-video',
      1,
      'repair-english-script',
      { userId: 'user-1', tenantId: 'tenant-1', roles: ['creator'] },
    )

    expect(result.script).toBe(repairedScript)
    expect(textProvider.generate).toHaveBeenCalledTimes(2)
    expect(vi.mocked(textProvider.generate).mock.calls[1]?.[0].systemPrompt).toContain('中文剧本格式校对员')
    expect(repository.update).toHaveBeenCalledWith('project-1', { script: repairedScript }, expect.anything())
  })

  it('keeps the original scene count when a short structured script is rewritten', async () => {
    const source = [
      '场次：S01｜剧情：林砚推门进入大殿。｜场景：宗门大殿。｜角色：林砚。｜动作：动作1：林砚推门；动作2：林砚停步。｜对白：无台词。',
      '场次：S02｜剧情：长老宣布测试开始。｜场景：宗门大殿。｜角色：林砚；长老。｜动作：动作1：长老抬手；动作2：林砚抬眼。｜对白：[对白]长老：开始。',
    ].join('\n')
    const candidate = [
      '场次：S01｜剧情：林砚推门进入大殿。｜场景：宗门大殿。｜角色：林砚。｜动作：林砚推门后停步。｜对白：无台词。',
      '场次：S02｜剧情：长老宣布测试开始。｜场景：宗门大殿。｜角色：林砚；长老。｜动作：长老抬手，林砚抬眼。｜对白：[对白]长老：开始。',
      '场次：S03｜剧情：凭空新增的围观冲突。｜场景：宗门大殿。｜角色：围观弟子。｜动作：众人起哄。｜对白：无台词。',
    ].join('\n')
    const repository = {
      workspace: () => ({
        project: {
          name: '宗门测试',
          contentType: 'short-drama',
          synopsis: '林砚参加测试。',
          aspectRatio: '9:16',
          script: source,
        },
        assets: [],
      }),
      update: vi.fn(async (_projectId, input) => ({ script: input.script })),
    } as unknown as ProjectRepository
    const textProvider: TextGenerationProvider = { generate: vi.fn(async () => candidate) }
    const service = new ProjectService(repository, textProvider)

    const result = await service.generateScript(
      'project-1',
      source,
      DEFAULT_SCRIPT_DIRECTION,
      'quick',
      { goal: '', targetMinutes: 1 },
      'web-series',
      1,
      'preserve-scene-count',
      { userId: 'user-1', tenantId: 'tenant-1', roles: ['creator'] },
    )

    expect(splitScriptParagraphs(result.script)).toHaveLength(2)
    expect(result.script).not.toContain('S03')
    expect(result.script).not.toContain('围观弟子')
  })
})

describe('ProjectService director beat splitting', () => {
  it('keeps labelled action details together and carries scene state into two executable shots', async () => {
    const script =
      '场次：S01｜剧情：岚星确认观景桥上的异常坐标。｜目标：岚星确认异常来源。｜阻力：巡逻守卫正在接近。｜变化：坐标指向她腕上的导航环。｜场景：黎明前的天穹环城观景桥。｜角色：岚星（主角，左侧护栏旁）；巡逻守卫（配角，右侧桥廊）。｜入场状态：岚星停在左侧护栏旁，右手压住导航环；守卫在右侧桥廊远处。｜动作：动作1：岚星抬眼看向异常光点，右手收紧导航环，表情从警觉转为错愕；动作2：她侧身贴近护栏，手指划过导航环投出坐标，守卫同时停步转头。｜对白：[内心独白]岚星：坐标为什么在我身上？｜出场状态：岚星半蹲贴在护栏内侧，导航环投出悬浮坐标；守卫停在右侧桥廊。｜风格：影视CG。｜构图：竖屏中景。｜光影：银蓝晨光。｜运镜：稳定推进。｜衔接：本场结尾交付悬浮坐标和守卫转头状态。'
    const repository = {
      workspace: vi.fn(async () => ({ project: { contentType: 'short-drama', script }, assets: [] })),
      replaceShots: vi.fn(async (_projectId, shots) => shots),
    } as unknown as ProjectRepository
    const service = new ProjectService(repository)

    const shots = await service.generateShots(
      'project-1',
      { mode: 'beat', maxShots: 2, episodeDurationSeconds: 60 },
      { userId: 'user-1', tenantId: 'tenant-1', roles: ['creator'] },
    )

    expect(shots).toHaveLength(2)
    expect(shots.map((shot) => shot.duration)).toEqual([4, 5])
    expect(shots[0]).toMatchObject({
      prompt: expect.stringContaining('目标：岚星确认异常来源'),
    })
    expect(shots[0]?.prompt).toContain('入场状态：岚星停在左侧护栏旁')
    expect(shots[0]?.prompt).not.toContain('出场状态：岚星半蹲')
    expect(shots[1]?.prompt).toContain('出场状态：岚星半蹲贴在护栏内侧')
    expect(shots[1]?.continuityNote).toContain('本镜所在场次的最终出场状态')
    expect(shots[1]?.prompt).toContain('动作2：她侧身贴近护栏，手指划过导航环投出坐标')
    expect(shots[1]?.prompt).toContain('对白：无台词')
    expect(shots[1]?.prompt).not.toContain('坐标为什么在我身上')
  })

  it('creates one video shot per scene in the default scene mode', async () => {
    const script =
      '场次：S01｜剧情：岚星确认异常坐标。｜场景：天穹环城观景桥。｜角色：岚星；巡逻守卫。｜动作：动作1：岚星抬眼看向光点；动作2：她收紧导航环；动作3：守卫停步转头。｜对白：[内心独白]岚星：坐标为什么在我身上？｜风格：影视CG。｜构图：中景。｜光影：银蓝晨光。｜运镜：稳定推进。｜衔接：导航环保持发光。'
    const repository = {
      workspace: vi.fn(async () => ({ project: { contentType: 'short-drama', script }, assets: [] })),
      replaceShots: vi.fn(async (_projectId, shots) => shots),
    } as unknown as ProjectRepository
    const service = new ProjectService(repository)

    const shots = await service.generateShots(
      'project-1',
      { mode: 'scene', maxShots: 120, episodeDurationSeconds: 60 },
      { userId: 'user-1', tenantId: 'tenant-1', roles: ['creator'] },
    )

    expect(shots).toHaveLength(1)
    expect(shots[0]?.prompt).toContain('镜头边界：本镜只覆盖当前场次')
    expect(shots[0]?.prompt).toContain('动作1：岚星抬眼看向光点')
    expect(shots[0]?.prompt).toContain('动作3：守卫停步转头')
  })

  it('does not turn comma-separated performance detail into duplicate beat videos', async () => {
    const script =
      '场次：S01｜剧情：林砚观察来敌。｜场景：雨夜长街。｜角色：林砚。｜动作：林砚抬眼，收紧剑柄，侧身让开道路。｜对白：无台词。'
    const repository = {
      workspace: vi.fn(async () => ({ project: { contentType: 'short-drama', script }, assets: [] })),
      replaceShots: vi.fn(async (_projectId, shots) => shots),
    } as unknown as ProjectRepository
    const service = new ProjectService(repository)

    const shots = await service.generateShots(
      'project-1',
      { mode: 'beat', maxShots: 120, episodeDurationSeconds: 60 },
      { userId: 'user-1', tenantId: 'tenant-1', roles: ['creator'] },
    )

    expect(shots).toHaveLength(1)
    expect(shots[0]?.prompt).toContain('林砚抬眼，收紧剑柄，侧身让开道路')
  })
})

describe('ProjectService shot deletion', () => {
  it('blocks deletion while the shot still has an active generation task', async () => {
    const repository = {
      deleteShot: vi.fn(async () => 'active' as const),
    } as unknown as ProjectRepository
    const service = new ProjectService(repository)

    await expect(
      service.deleteShot('project-1', 'shot-1', {
        userId: 'user-1',
        tenantId: 'tenant-1',
        roles: ['creator'],
      }),
    ).rejects.toThrow('这个分镜仍在排队、暂停或生成中')
  })
})

describe('ProjectRepository shot ordering', () => {
  it('inserts after the selected shot and compacts orders after deletion', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new ProjectRepository(store)
    const principal = {
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member'] as const,
    }
    const before = await repository.workspace('project-midnight-film', principal)
    const anchor = before?.shots[1]
    expect(anchor).toBeDefined()

    const inserted = await repository.createShot(
      'project-midnight-film',
      {
        title: '插入镜头',
        framing: '中景',
        duration: 5,
        prompt: '承接第二镜后的补充动作。',
        negativePrompt: '',
        imageUrl: null,
        continuityMode: 'continue',
        continuityNote: '',
        episodeBreakBefore: false,
        episodeNumber: anchor!.episodeNumber,
        episodeTitle: anchor!.episodeTitle,
        episodeKind: 'standard',
        insertAfterShotId: anchor!.id,
      },
      principal,
    )
    expect(inserted?.order).toBe(3)
    const afterInsert = await repository.workspace('project-midnight-film', principal)
    expect(afterInsert?.shots.map((shot) => shot.order)).toEqual(
      Array.from({ length: afterInsert.shots.length }, (_, index) => index + 1),
    )
    expect(afterInsert?.shots[2]?.id).toBe(inserted?.id)

    await expect(repository.deleteShot('project-midnight-film', inserted!.id, principal)).resolves.toBe(
      'deleted',
    )
    const afterDelete = await repository.workspace('project-midnight-film', principal)
    expect(afterDelete?.shots.map((shot) => shot.order)).toEqual(
      Array.from({ length: afterDelete.shots.length }, (_, index) => index + 1),
    )
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
    expect(result.map((shot) => shot.continuityMode)).toEqual([
      'independent',
      'continue',
      'independent',
      'continue',
    ])
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
    expect(result.map((shot) => shot.continuityMode)).toEqual(['independent', 'continue', 'independent'])
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

  it('clears textual continuity on the first shot of every episode', () => {
    const result = assignShotEpisodes(
      [
        { id: 'shot-1', duration: 8, continuityNote: '上一场状态' },
        { id: 'shot-2', duration: 8, continuityNote: '上一集状态' },
      ],
      8,
    )

    expect(result.map((shot) => shot.continuityMode)).toEqual(['independent', 'independent'])
    expect(result.map((shot) => shot.continuityNote)).toEqual(['', ''])
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
