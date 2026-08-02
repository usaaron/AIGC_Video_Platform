import { describe, expect, it } from 'vitest'
import { executeQuickStartRequestSchema, quickStartPlanSchema } from './quickStart.js'

const scene = {
  kind: 'scene' as const,
  name: '雨夜站台',
  description: '故事冲突发生的核心外景',
  prompt: '废弃火车站，雨夜，湿润铁轨',
  negativePrompt: '',
  attributes: {
    type: 'scene' as const,
    space: 'exterior' as const,
    sceneType: 'street' as const,
    era: 'modern' as const,
    time: 'night' as const,
    weather: 'rain' as const,
    mood: 'mystery' as const,
    camera: 'wide' as const,
    visualStyle: 'cinematic-cg' as const,
    emptyScene: true,
    activitySpace: true,
  },
}

describe('quick start contracts', () => {
  it('accepts a bounded asset plan with a server estimate', () => {
    expect(
      quickStartPlanSchema.safeParse({
        summary: '围绕主角和雨夜车站建立最小资产闭环',
        sourceScriptHash: 'a'.repeat(64),
        generatedAt: new Date().toISOString(),
        assets: [scene],
        estimate: {
          assetCount: 1,
          taskCount: 1,
          credits: 6,
          concurrency: 1,
          queueAhead: 0,
          minSeconds: 45,
          maxSeconds: 180,
        },
      }).success,
    ).toBe(true)
  })

  it('rejects audio, props and client-supplied pricing fields', () => {
    const invalidAsset = { ...scene, kind: 'audio', estimatedCredits: 1 }
    expect(
      executeQuickStartRequestSchema.safeParse({
        clientRequestId: 'quick-start-1',
        sourceScriptHash: 'b'.repeat(64),
        assets: [invalidAsset],
      }).success,
    ).toBe(false)
  })
})
