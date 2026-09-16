import { describe, expect, it } from 'vitest'
import { shotVersionState } from './storyboardState'

const task = (id, day, overrides = {}) => ({
  id,
  kind: 'video',
  status: 'completed',
  metadata: { shotId: 'shot-1' },
  createdAt: `2026-09-${day}T00:00:00Z`,
  updatedAt: `2026-09-${day}T00:00:00Z`,
  ...overrides,
})
const first = task('first', '01')
const second = task('second', '02')
const third = task('third', '03')

describe('shot rollback versions', () => {
  it('steps backwards from the selected version instead of toggling to the newest', () => {
    const tasks = [third, first, second]
    expect(shotVersionState(tasks, { id: 'shot-1', selectedVideoTaskId: third.id }, 'video')).toMatchObject({
      current: { task: third, number: 3 },
      previous: { task: second, number: 2 },
    })
    expect(shotVersionState(tasks, { id: 'shot-1', selectedVideoTaskId: second.id }, 'video')).toMatchObject({
      current: { task: second, number: 2 },
      previous: { task: first, number: 1 },
      latest: { task: third, number: 3 },
    })
    expect(
      shotVersionState(tasks, { id: 'shot-1', selectedVideoTaskId: first.id }, 'video').previous,
    ).toBeNull()
  })

  it('ignores failed, running, image and other-shot tasks; generation order survives later edits', () => {
    const editedFirst = { ...first, updatedAt: '2026-09-09T00:00:00Z' }
    const tasks = [
      task('failed', '05', { status: 'failed' }),
      task('running', '06', { status: 'running' }),
      task('image', '07', { kind: 'image' }),
      task('other', '08', { metadata: { shotId: 'other' } }),
      editedFirst,
      third,
      second,
    ]
    expect(shotVersionState(tasks, { id: 'shot-1', selectedVideoTaskId: third.id }, 'video')).toMatchObject({
      current: { number: 3 },
      previous: { task: second, number: 2 },
      latest: { task: third },
    })
  })

  it('handles an empty history and the first generation', () => {
    expect(shotVersionState([], { id: 'shot-1' }, 'video')).toEqual({
      current: null,
      previous: null,
      latest: null,
    })
    expect(shotVersionState([first], { id: 'shot-1' }, 'video')).toEqual({
      current: { task: first, number: 1 },
      previous: null,
      latest: { task: first, number: 1 },
    })
  })
})
