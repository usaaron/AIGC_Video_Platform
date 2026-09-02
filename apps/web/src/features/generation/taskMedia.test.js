import { describe, expect, it } from 'vitest'
import { hasLastFrame, latestVideoTaskFor } from './taskMedia'

const task = (id, status, outputs = []) => ({
  id,
  kind: 'video',
  status,
  metadata: { shotId: 'shot-1' },
  outputs,
})

describe('task media selection', () => {
  it('prefers an active task over a selected completed result', () => {
    const selected = task('selected', 'completed')
    const active = task('active', 'running')

    expect(latestVideoTaskFor([selected, active], { id: 'shot-1', selectedVideoTaskId: 'selected' })).toBe(
      active,
    )
  })

  it('requires a last frame when requested', () => {
    const withoutLastFrame = task('first', 'completed')
    const withLastFrame = task('second', 'completed', [{ view: 'last-frame' }])

    expect(latestVideoTaskFor([withoutLastFrame, withLastFrame], 'shot-1', true)).toBe(withLastFrame)
    expect(hasLastFrame(withLastFrame)).toBe(true)
  })
})
