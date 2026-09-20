import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  historicalShotMedia,
  scriptProductionHistoryEntries,
  ScriptRevisionHistory,
  ScriptRevisionSnapshot,
} from './ScriptRevisionHistory'

const savedAt = '2026-09-20T08:00:00Z'
const shot = {
  id: 'old-shot',
  projectId: 'project-1',
  order: 1,
  title: '旧镜头',
  prompt: '旧动作与对白',
  framing: '中景',
  duration: 6,
  imageUrl: '/api/v1/media/old-image',
  selectedVideoTaskId: 'old-video',
  referenceImages: [{ url: '/api/v1/media/old-reference', name: '原参考图' }],
}
const olderVideo = {
  id: 'old-video',
  projectId: 'project-1',
  kind: 'video',
  status: 'completed',
  createdAt: '2026-09-20T07:00:00Z',
  resultUrl: '/api/v1/generation/tasks/old-video/outputs/main',
  metadata: { shotId: 'old-shot' },
}
const newerVideo = {
  ...olderVideo,
  id: 'new-video',
  createdAt: '2026-09-20T09:00:00Z',
  resultUrl: '/api/v1/generation/tasks/new-video/outputs/main',
}
const entry = {
  id: 'revision-1',
  savedAt,
  episodeRevision: 2,
  title: '旧集名',
  content: '这是返修前的完整正文。',
  shots: [shot],
}
const episode = {
  id: 'episode-1',
  episodeNumber: 1,
  content: '当前新版正文',
  continuityState: { scriptProductionHistory: [entry] },
}

describe('script production revision history', () => {
  it('keeps empty and malformed history out of the storyboard interface', () => {
    expect(renderToStaticMarkup(<ScriptRevisionHistory scriptEpisodes={[]} />)).toBe('')
    expect(
      scriptProductionHistoryEntries([
        {
          ...episode,
          continuityState: { scriptProductionHistory: [null, {}, { id: 'invalid', content: 7, shots: [] }] },
        },
      ]),
    ).toEqual([])
  })

  it('sorts saved snapshots without changing current episodes and keeps the overview compact', () => {
    const input = [
      episode,
      {
        ...episode,
        id: 'episode-2',
        episodeNumber: 2,
        continuityState: {
          scriptProductionHistory: [{ ...entry, id: 'revision-2', savedAt: '2026-09-21T08:00:00Z' }],
        },
      },
    ]
    const before = structuredClone(input)
    expect(scriptProductionHistoryEntries(input).map((item) => item.episodeNumber)).toEqual([2, 1])
    expect(input).toEqual(before)
    const html = renderToStaticMarkup(<ScriptRevisionHistory scriptEpisodes={input} />)
    expect(html).toContain('制作修订历史')
    expect(html).toContain('2 个旧版')
    expect(html).not.toContain('这是返修前的完整正文')
    expect(html).not.toContain('<video')
  })

  it('uses the saved selected video even when the same shot has a newer completed version', () => {
    const media = historicalShotMedia(shot, savedAt, [newerVideo, olderVideo])
    expect(media).toMatchObject({
      imageUrl: shot.imageUrl,
      videoUrl: olderVideo.resultUrl,
      references: shot.referenceImages,
    })
  })

  it('never substitutes a newer or unrelated video for a missing historical selection', () => {
    expect(historicalShotMedia(shot, savedAt, [newerVideo]).videoUrl).toBeNull()
    expect(
      historicalShotMedia(shot, savedAt, [{ ...olderVideo, projectId: 'another-project' }]).videoUrl,
    ).toBeNull()
    expect(
      historicalShotMedia(shot, savedAt, [{ ...olderVideo, metadata: { shotId: 'another-shot' } }]).videoUrl,
    ).toBeNull()
    expect(historicalShotMedia(shot, savedAt, [{ ...olderVideo, status: 'failed' }]).videoUrl).toBeNull()
  })

  it('limits fallback media to versions that already existed when the snapshot was saved', () => {
    const unselected = { ...shot, selectedVideoTaskId: null }
    expect(historicalShotMedia(unselected, savedAt, [newerVideo, olderVideo]).videoUrl).toBe(
      olderVideo.resultUrl,
    )
    expect(historicalShotMedia(unselected, savedAt, [newerVideo]).videoUrl).toBeNull()
    expect(
      historicalShotMedia(unselected, savedAt, [{ ...olderVideo, createdAt: undefined }]).videoUrl,
    ).toBeNull()
  })

  it('renders old text, shots, selected media and original references without restore or delete controls', () => {
    const html = renderToStaticMarkup(
      <ScriptRevisionSnapshot entry={entry} tasks={[olderVideo, newerVideo]} />,
    )
    expect(html).toContain('这是返修前的完整正文。')
    expect(html).toContain('旧动作与对白')
    expect(html).toContain(olderVideo.resultUrl)
    expect(html).toContain(shot.imageUrl)
    expect(html).toContain('/api/v1/media/old-reference')
    expect(html).toContain('preload="none"')
    expect(html).not.toContain(newerVideo.resultUrl)
    expect(html).not.toContain('当前新版正文')
    expect(html).not.toMatch(/恢复|删除|重新生成/)
  })
})
