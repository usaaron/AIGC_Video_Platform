import { describe, expect, it } from 'vitest'
import {
  completedFilmExportTask,
  downloadNameForTask,
  isPlayableVideoUrl,
  latestFilmExportTask,
} from './taskResults'

describe('task result helpers', () => {
  it('treats platform media URLs as playable video results when used by video tasks', () => {
    expect(isPlayableVideoUrl('/api/v1/media/media-1')).toBe(true)
    expect(isPlayableVideoUrl('/demo/still.jpg')).toBe(false)
  })

  it('uses media type to choose download extensions', () => {
    expect(downloadNameForTask(task({ kind: 'audio', outputs: [{ mediaType: 'audio' }] }))).toBe('Result.mp3')
    expect(downloadNameForTask(task({ kind: 'video', outputs: [{ mediaType: 'video' }] }))).toBe('Result.mp4')
  })

  it('finds latest and completed film export tasks', () => {
    const tasks = [
      task({ id: 'export-2', provider: 'film-export', status: 'completed', resultUrl: '/api/v1/media/film' }),
      task({ id: 'shot-video', provider: 'seedance', status: 'completed', resultUrl: '/api/v1/media/shot' }),
      task({ id: 'export-1', provider: 'film-export', status: 'failed' }),
    ]

    expect(latestFilmExportTask(tasks)?.id).toBe('export-2')
    expect(completedFilmExportTask(tasks)?.resultUrl).toBe('/api/v1/media/film')
  })
})

function task(overrides = {}) {
  return {
    id: 'task',
    kind: 'video',
    provider: 'seedance',
    label: 'Result',
    status: 'completed',
    resultUrl: null,
    outputs: [],
    metadata: {},
    ...overrides,
  }
}
