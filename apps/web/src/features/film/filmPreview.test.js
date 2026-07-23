import { describe, expect, it } from 'vitest'
import {
  completedShotVideoTask,
  contiguousSourceVideoTaskIds,
  filmPreviewTaskFor,
  isCurrentFilmPreview,
  latestCompletedFilmPreviewTask,
  sourceVideoTaskIds,
} from './filmPreview'

const shots = [{ id: 'shot-1' }, { id: 'shot-2' }]
const sourceTasks = [shotTask('video-1', 'shot-1'), shotTask('video-2', 'shot-2')]

describe('film preview task selection', () => {
  it('requires one completed Seedance video for every shot', () => {
    expect(completedShotVideoTask(sourceTasks, 'shot-1')?.id).toBe('video-1')
    expect(contiguousSourceVideoTaskIds(sourceTasks.slice(0, 1), shots)).toEqual(['video-1'])
    expect(sourceVideoTaskIds(sourceTasks, shots)).toEqual(['video-1', 'video-2'])
    expect(sourceVideoTaskIds(sourceTasks.slice(0, 1), shots)).toEqual([])
  })

  it('keeps partial and full preview tasks separate', () => {
    const full = previewTask('preview-full', ['video-1', 'video-2'])
    const partial = previewTask('preview-partial', ['video-1'], 'partial')

    expect(filmPreviewTaskFor([full, partial], ['video-1'], 'partial')?.id).toBe('preview-partial')
    expect(isCurrentFilmPreview(partial, ['video-1'], 'partial')).toBe(true)
    expect(isCurrentFilmPreview(partial, ['video-1'], 'full')).toBe(false)
  })

  it('prefers a composition built from the current source videos', () => {
    const stale = previewTask('preview-old', ['old-1', 'old-2'])
    const current = previewTask('preview-current', ['video-1', 'video-2'])

    expect(filmPreviewTaskFor([stale, current], ['video-1', 'video-2'])?.id).toBe('preview-current')
    expect(isCurrentFilmPreview(current, ['video-1', 'video-2'])).toBe(true)
    expect(isCurrentFilmPreview(stale, ['video-1', 'video-2'])).toBe(false)
  })

  it('keeps the latest completed film available after shots are replaced', () => {
    const older = previewTask('preview-old', ['old-video-1'])
    older.updatedAt = '2026-07-22T10:00:00.000Z'
    const latest = previewTask('preview-latest', ['video-1', 'video-2'])
    latest.updatedAt = '2026-07-23T10:00:00.000Z'
    const currentShots = [{ id: 'replacement-shot-1' }]

    expect(sourceVideoTaskIds(sourceTasks, currentShots)).toEqual([])
    expect(isCurrentFilmPreview(latest, [], 'full')).toBe(false)
    expect(latestCompletedFilmPreviewTask([older, latest], 'full')?.id).toBe('preview-latest')
  })
})

function shotTask(id, shotId) {
  return {
    id,
    kind: 'video',
    provider: 'seedance',
    status: 'completed',
    metadata: { shotId },
  }
}

function previewTask(id, sourceVideoTaskIds, previewMode = 'full') {
  return {
    id,
    kind: 'video',
    provider: 'local-compose',
    status: 'completed',
    updatedAt: '2026-07-23T00:00:00.000Z',
    metadata: { generationStage: 'film-preview', previewMode, sourceVideoTaskIds },
  }
}
