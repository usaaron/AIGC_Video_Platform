import { describe, expect, it } from 'vitest'
import { formatStoryOverviewText } from './storyOverviewText'

describe('story overview text formatting', () => {
  it('localizes common story overview labels while keeping useful English terms bilingual', () => {
    expect(
      formatStoryOverviewText(
        'coreApproach: 以翠翠的主观感受为叙事轴点; episodeStructure: 按章节与守渡展开; visualLanguage: 建立河岸意象; continuityPriority: 固定人物关系和 foreshadowing。',
      ),
    ).toBe(
      '核心改编方式：以翠翠的主观感受为叙事轴点；篇章结构：按章节与守渡展开；视觉语言：建立河岸意象；连续性重点：固定人物关系和 伏笔（foreshadowing）。',
    )
  })
})
