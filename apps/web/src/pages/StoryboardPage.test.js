import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { addStoryboardVideosToArchive, groupShotsByEpisode, StoryboardPage } from './StoryboardPage'

describe('groupShotsByEpisode', () => {
  it('keeps available videos when another completed source has expired', async () => {
    const zip = new JSZip()
    const fetchVideo = vi.fn(async (url) =>
      url.endsWith('/available')
        ? { ok: true, blob: async () => new Uint8Array([1, 2, 3]) }
        : { ok: false, status: 502 },
    )

    const result = await addStoryboardVideosToArchive(
      zip,
      [
        {
          shot: { title: '可用镜头', order: 1, episodeNumber: 1 },
          url: '/available',
        },
        {
          shot: { title: '过期镜头', order: 2, episodeNumber: 1 },
          url: '/expired',
        },
      ],
      fetchVideo,
    )

    expect(result).toMatchObject({ successCount: 1, failures: [{ message: 'HTTP 502' }] })
    expect(zip.file('第01集/01-可用镜头.mp4')).not.toBeNull()
    expect(await zip.file('_下载失败清单.txt').async('string')).toContain('过期镜头：HTTP 502')
  })

  it('summarizes episodes and keeps the hook group last', () => {
    const groups = groupShotsByEpisode([
      { id: 'shot-1', episodeNumber: 1, episodeTitle: '起点', episodeKind: 'standard', duration: 5 },
      { id: 'shot-2', episodeNumber: 1, episodeTitle: '起点', episodeKind: 'standard', duration: 6 },
      { id: 'hook-1', episodeNumber: 2, episodeTitle: '剧情钩子', episodeKind: 'hook', duration: 4 },
    ])

    expect(groups).toMatchObject([
      { number: 1, title: '起点', kind: 'standard', hasHook: false, duration: 11 },
      { number: 2, title: '剧情钩子', kind: 'hook', hasHook: true, duration: 4 },
    ])
  })

  it('renders a hook and standard shots as one episode when their episode number matches', () => {
    const groups = groupShotsByEpisode([
      { id: 'shot-1', episodeNumber: 1, episodeTitle: '反击前夜', episodeKind: 'standard', duration: 8 },
      { id: 'hook-1', episodeNumber: 1, episodeTitle: '反击前夜', episodeKind: 'hook', duration: 5 },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      number: 1,
      kind: 'hook',
      hasHook: true,
      duration: 13,
      shots: [{ id: 'shot-1' }, { id: 'hook-1' }],
    })
  })

  it('keeps saved script episodes visible before their storyboards are generated', () => {
    const groups = groupShotsByEpisode([], 3, [
      {
        id: 'episode-1',
        episodeNumber: 1,
        title: '第一集',
        status: 'saved',
        content: '场次：S01｜动作：主角推门。',
      },
      {
        id: 'episode-draft',
        episodeNumber: 2,
        title: '草稿',
        status: 'draft',
        content: '尚未保存',
      },
    ])

    expect(groups).toMatchObject([
      { number: 1, title: '第一集', scriptEpisodeId: 'episode-1', duration: 0, shots: [] },
    ])
  })

  it('shows one-click episode generation instead of legacy duration splitting for saved episodes', () => {
    const html = renderToStaticMarkup(
      createElement(StoryboardPage, {
        project: { id: 'project-1', contentType: 'short-drama' },
        scriptEpisodes: [
          {
            id: 'episode-1',
            episodeNumber: 1,
            title: '第一集',
            status: 'saved',
            content: '场次：S01｜动作：主角推门。',
          },
        ],
        shots: [],
        assets: [],
        tasks: [],
        onUpdateEpisodeDuration: vi.fn(),
        onRegenerate: vi.fn(),
        onAutoSplitEpisodes: vi.fn(),
        onCreate: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        onUpload: vi.fn(),
        onGenerateVideo: vi.fn(),
        onGenerateAllVideos: vi.fn(),
        onNext: vi.fn(),
      }),
    )

    expect(html).toContain('本集还没有分镜')
    expect(html).toContain('生成第 1 集分镜')
    expect(html).not.toContain('按目标时长自动分集')
    expect(html).not.toContain('添加分集')
  })

  it('renders the selected completed video directly inside the shot row', () => {
    const html = renderToStaticMarkup(
      createElement(StoryboardPage, {
        project: { id: 'project-1', contentType: 'short-drama' },
        shots: [
          {
            id: 'shot-1',
            order: 1,
            title: '镜头 01',
            framing: '中景',
            duration: 5,
            prompt: '林砚抬眼看向长老。',
            continuityMode: 'independent',
            episodeNumber: 1,
            episodeTitle: '第 1 集',
            episodeKind: 'standard',
            selectedVideoTaskId: 'video-1',
          },
        ],
        assets: [],
        tasks: [
          {
            id: 'video-1',
            kind: 'video',
            status: 'completed',
            resultUrl: '/generated/shot-1.mp4',
            metadata: { shotId: 'shot-1', resolution: '720p' },
          },
        ],
        onUpdateEpisodeDuration: vi.fn(),
        onRegenerate: vi.fn(),
        onAutoSplitEpisodes: vi.fn(),
        onCreate: vi.fn(),
        onUpdate: vi.fn(),
        onUpload: vi.fn(),
        onGenerateVideo: vi.fn(),
        onGenerateAllVideos: vi.fn(),
        onNext: vi.fn(),
      }),
    )

    expect(html).toContain('<video')
    expect(html).toContain('/generated/shot-1.mp4')
    expect(html).toContain('成片预览')
    expect(html).toContain('下载第 1 集 · 1 条')
    expect(html).toContain('生成第 1 集分镜')
  })
})
