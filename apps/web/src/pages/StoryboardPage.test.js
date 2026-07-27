import { describe, expect, it } from 'vitest'
import { groupShotsByEpisode } from './StoryboardPage'

describe('groupShotsByEpisode', () => {
  it('summarizes episodes and keeps the hook group last', () => {
    const groups = groupShotsByEpisode([
      { id: 'shot-1', episodeNumber: 1, episodeTitle: '起点', episodeKind: 'standard', duration: 5 },
      { id: 'shot-2', episodeNumber: 1, episodeTitle: '起点', episodeKind: 'standard', duration: 6 },
      { id: 'hook-1', episodeNumber: 2, episodeTitle: '剧情钩子', episodeKind: 'hook', duration: 4 },
    ])

    expect(groups).toMatchObject([
      { number: 1, title: '起点', kind: 'standard', hasHook: false, duration: 11 },
      { number: 2, title: '剧情钩子', kind: 'hook', hasHook: true, duration: 4 },
    ])
  })

  it('renders a hook and standard shots as one episode when their episode number matches', () => {
    const groups = groupShotsByEpisode([
      { id: 'shot-1', episodeNumber: 1, episodeTitle: '反击前夜', episodeKind: 'standard', duration: 8 },
      { id: 'hook-1', episodeNumber: 1, episodeTitle: '反击前夜', episodeKind: 'hook', duration: 5 },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      number: 1,
      kind: 'hook',
      hasHook: true,
      duration: 13,
      shots: [{ id: 'shot-1' }, { id: 'hook-1' }],
    })
  })
})
