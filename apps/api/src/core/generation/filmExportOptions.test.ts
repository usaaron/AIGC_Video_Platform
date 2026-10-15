import { describe, expect, it } from 'vitest'
import { frameSizeForFilmExport, normalizeFilmExportOptions } from './filmExportOptions.js'

describe('film export options', () => {
  it('normalizes timeline, ratio and fps values', () => {
    const options = normalizeFilmExportOptions(
      {
        ratio: '9:16',
        resolution: '1080p',
        fps: 30,
        subtitlesEnabled: true,
        coverShotId: 'shot-1',
        voiceoverText: '旁白',
        timeline: [
          { shotId: 'shot-1', taskId: 'task-1', title: '开场', duration: 3.6, subtitle: '开场字幕' },
          { shotId: 'shot-2', taskId: 'task-2', title: '过渡', duration: 0, subtitle: '' },
        ],
      },
      '16:9',
    )

    expect(options.ratio).toBe('9:16')
    expect(options.resolution).toBe('1080p')
    expect(options.fps).toBe(30)
    expect(options.timeline[0]).toMatchObject({ duration: 4, subtitle: '开场字幕' })
    expect(options.timeline[1]).toMatchObject({ duration: 1, subtitle: '过渡' })
  })

  it('derives output sizes from ratio and resolution', () => {
    expect(frameSizeForFilmExport('16:9', '720p')).toEqual({ width: 1280, height: 720 })
    expect(frameSizeForFilmExport('9:16', '1080p')).toEqual({ width: 1080, height: 1920 })
    expect(frameSizeForFilmExport('1:1', '720p')).toEqual({ width: 720, height: 720 })
  })
})
