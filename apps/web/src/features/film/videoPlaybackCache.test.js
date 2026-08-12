import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasVideoMetadataLoaded, markVideoMetadataLoaded, warmVideoPlaybackCache } from './videoPlaybackCache'

afterEach(() => vi.unstubAllGlobals())

describe('video playback cache', () => {
  it('warms completed video metadata once and remembers it across page mounts', () => {
    const videos = []
    vi.stubGlobal('window', {
      document: {
        createElement: () => {
          const video = { load: vi.fn() }
          videos.push(video)
          return video
        },
      },
    })
    const tasks = [
      {
        id: 'video-1',
        kind: 'video',
        status: 'completed',
        resultUrl: '/api/v1/generation/tasks/video-1/content',
      },
    ]

    warmVideoPlaybackCache(tasks)
    warmVideoPlaybackCache(tasks)
    videos[0].onloadedmetadata()

    expect(videos).toHaveLength(1)
    expect(hasVideoMetadataLoaded(tasks[0].resultUrl)).toBe(true)
  })

  it('marks video metadata loaded from the visible player', () => {
    markVideoMetadataLoaded('/video/current.mp4')
    expect(hasVideoMetadataLoaded('/video/current.mp4')).toBe(true)
  })
})
