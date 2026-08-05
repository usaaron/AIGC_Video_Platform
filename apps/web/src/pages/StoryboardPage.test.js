import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { groupShotsByEpisode, StoryboardPage } from './StoryboardPage'

describe('groupShotsByEpisode', () => {
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
    expect(html).toContain('批量下载 1 条')
  })
})
