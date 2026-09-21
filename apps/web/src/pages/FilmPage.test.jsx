import { describe, expect, it } from 'vitest'
import { filmCompositionButtonLabel, videoTaskFor } from './FilmPage'

describe('film composition scope labels', () => {
  it('uses explicit episode and series actions', () => {
    expect(filmCompositionButtonLabel(1, true, 4, 4)).toBe('合成当集成片')
    expect(filmCompositionButtonLabel(null, true, 12, 12)).toBe('合成全集')
  })

  it('explains which scope is still incomplete', () => {
    expect(filmCompositionButtonLabel(2, false, 3, 5)).toBe('当集待完成 3/5')
    expect(filmCompositionButtonLabel(null, false, 7, 10)).toBe('全集待完成 7/10')
  })
})

describe('film shot playback selection', () => {
  it('skips recovered history for playback but honors a user-selected recovered video', () => {
    const recovered = {
      id: 'recovered',
      kind: 'video',
      status: 'completed',
      metadata: { shotId: 'shot-1', providerReconciliationHistoryOnly: true },
    }
    const current = { ...recovered, id: 'current', metadata: { shotId: 'shot-1' } }
    expect(videoTaskFor([recovered], { id: 'shot-1' })).toBeUndefined()
    expect(videoTaskFor([recovered, current], { id: 'shot-1' })).toBe(current)
    expect(videoTaskFor([recovered, current], { id: 'shot-1', selectedVideoTaskId: recovered.id })).toBe(
      recovered,
    )
    const running = { ...current, id: 'running', status: 'running' }
    expect(videoTaskFor([recovered, running], { id: 'shot-1', selectedVideoTaskId: recovered.id })).toBe(
      running,
    )
  })
})
