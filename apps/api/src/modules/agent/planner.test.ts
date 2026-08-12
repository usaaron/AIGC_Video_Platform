import { describe, expect, it } from 'vitest'
import { createAgentPlan } from './planner.js'

describe('one-click agent planner', () => {
  it('extracts a complete Chinese production request', () => {
    const plan = createAgentPlan('做个1分钟竖屏CG网剧，女孩在末班地铁醒来并发现时间循环')
    expect(plan).toMatchObject({
      contentType: 'web-series',
      durationSeconds: 60,
      episodeDurationSeconds: 60,
      episodeCount: 1,
      aspectRatio: '9:16',
      visualStyle: 'cinematic-cg',
      missingFields: [],
    })
    expect(plan.estimate?.totalCredits).toBeGreaterThan(0)
  })

  it('asks explicitly for fields that were not stated', () => {
    const plan = createAgentPlan('女孩在末班地铁醒来并发现时间循环')
    expect(plan.missingFields).toEqual(['contentType', 'durationSeconds', 'aspectRatio', 'visualStyle'])
    expect(plan.estimate).toBeNull()
  })

  it('merges clarification without losing the original story', () => {
    const first = createAgentPlan('女孩在末班地铁醒来并发现时间循环')
    const clarified = createAgentPlan('60秒竖屏', first, {
      contentType: 'short-film',
      visualStyle: 'photorealistic',
    })
    expect(clarified.storyBrief).toContain('女孩在末班地铁醒来')
    expect(clarified).toMatchObject({
      contentType: 'short-film',
      durationSeconds: 60,
      aspectRatio: '9:16',
      visualStyle: 'photorealistic',
      missingFields: [],
    })
  })

  it('uses the stated subject instead of production parameters for the project name', () => {
    const plan = createAgentPlan(
      '制作一支30秒、16:9横屏、仿真人风格的广告，主题是太原万柏林区汾河两岸的城市温度，包含清晨跑步、市民生活和夜景收束。',
    )

    expect(plan.projectName).toBe('太原万柏林区汾河两岸的城市温度')
  })
})
