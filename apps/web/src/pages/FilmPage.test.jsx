import { describe, expect, it } from 'vitest'
import { filmCompositionButtonLabel } from './FilmPage'

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
