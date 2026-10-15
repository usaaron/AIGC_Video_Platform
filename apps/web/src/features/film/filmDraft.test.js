import { describe, expect, it } from 'vitest'
import {
  createFilmDraft,
  filmExportDraftForTask,
  moveFilmClip,
  replaceFilmClip,
  syncFilmDraft,
  updateFilmClip,
} from './filmDraft'

const shots = [
  { id: 'shot-1', title: '开场', duration: 4 },
  { id: 'shot-2', title: '对话', duration: 6 },
  { id: 'shot-3', title: '特写', duration: 3 },
]

const tasks = [
  task('task-shot-1', 'video', { shotId: 'shot-1' }),
  task('task-shot-2', 'video', { shotId: 'shot-2' }),
  task('task-shot-3', 'video', { shotId: 'shot-3' }),
  task('task-audio', 'audio', { assetId: 'asset-bgm' }, 'audio'),
]

describe('film draft helpers', () => {
  it('creates a lightweight edit draft from shots and completed audio', () => {
    const draft = createFilmDraft({ aspectRatio: '16:9' }, shots, tasks)

    expect(draft.sequence).toEqual(['shot-1', 'shot-2', 'shot-3'])
    expect(draft.coverShotId).toBe('shot-1')
    expect(draft.ratio).toBe('16:9')
    expect(draft.bgmTaskId).toBe('task-audio')
    expect(draft.clips['shot-2'].subtitle).toBe('对话')
  })

  it('moves and swaps clips without duplicating shots', () => {
    expect(moveFilmClip(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveFilmClip(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(replaceFilmClip(['a', 'b', 'c'], 0, 'c')).toEqual(['c', 'b', 'a'])
  })

  it('normalizes clip edits into export metadata', () => {
    const draft = updateFilmClip(createFilmDraft({ aspectRatio: '9:16' }, shots, tasks), 'shot-2', {
      duration: 2,
      subtitle: '她停住脚步',
    })
    draft.sequence = moveFilmClip(draft.sequence, 2, -1)
    draft.voiceoverText = '旁白草稿'

    const exportDraft = filmExportDraftForTask(draft, shots, tasks)

    expect(exportDraft.sourceTaskIds).toEqual(['task-shot-1', 'task-shot-3', 'task-shot-2'])
    expect(exportDraft.audioTaskIds).toEqual(['task-audio'])
    expect(exportDraft.exportOptions.timeline.at(-1)).toMatchObject({
      shotId: 'shot-2',
      taskId: 'task-shot-2',
      duration: 2,
      subtitle: '她停住脚步',
    })
    expect(exportDraft.exportOptions.voiceoverText).toBe('旁白草稿')
  })

  it('syncs a draft when shots change and keeps valid edits', () => {
    const draft = createFilmDraft({ aspectRatio: '9:16' }, shots, tasks)
    draft.sequence = ['shot-2', 'shot-1', 'missing']
    draft.clips['shot-2'].duration = 9

    const synced = syncFilmDraft(draft, { aspectRatio: '9:16' }, shots.slice(0, 2), tasks)

    expect(synced.sequence).toEqual(['shot-2', 'shot-1'])
    expect(synced.clips['shot-2'].duration).toBe(9)
  })
})

function task(id, kind, metadata, mediaType = 'video') {
  return {
    id,
    kind,
    status: 'completed',
    metadata,
    outputs: [{ id: `${id}-out`, url: `/api/v1/media/${id}`, mediaType }],
  }
}
