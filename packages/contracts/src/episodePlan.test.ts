import { describe, expect, it } from 'vitest'
import { episodePlanSchema, suggestEpisodePlan } from './episodePlan.js'

describe('episode material planning', () => {
  it('only triggers past 2200 characters and preserves all ordered material when splitting', () => {
    expect(suggestEpisodePlan('字'.repeat(2200)).required).toBe(false)
    const source = `开头${'事件。'.repeat(1800)}结尾`
    const plan = suggestEpisodePlan(source)
    expect(plan.required).toBe(true)
    expect(plan.episodes.length).toBeGreaterThan(1)
    expect(plan.episodes.map((episode) => episode.source).join('')).toBe(source)
  })
  it('recognizes explicit episodes and crowded scenes even below the character limit', () => {
    const source = '第1集\n林晚回家。\n第2集\n林晚出发。'
    const plan = suggestEpisodePlan(source)
    expect(plan.required).toBe(true)
    expect(plan.episodes.map((item) => item.source)).toEqual(['第1集\n林晚回家。', '第2集\n林晚出发。'])
    expect(
      suggestEpisodePlan(Array.from({ length: 7 }, (_, i) => `场次：S${i}｜林晚行走。`).join('\n')).required,
    ).toBe(true)
  })
  it('allows editable boundaries but rejects blank and oversized plans', () => {
    const id = '8bfa43a7-4fe0-4014-8b10-518a157ce68f'
    expect(
      episodePlanSchema.safeParse({
        id,
        episodes: [
          { title: '一', source: '' },
          { title: '二', source: '故事' },
        ],
      }).success,
    ).toBe(false)
    const changed = suggestEpisodePlan('情节。'.repeat(300), 60, 3)
    expect(changed.episodes).toHaveLength(3)
    expect(episodePlanSchema.safeParse({ id, episodes: changed.episodes }).success).toBe(true)
  })
})
