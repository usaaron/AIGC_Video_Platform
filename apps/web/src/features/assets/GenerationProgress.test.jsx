import { describe, expect, it } from 'vitest'
import { assetGenerationErrorMessage } from './GenerationProgress'

describe('asset generation progress', () => {
  it('turns upstream safety failures into actionable Chinese copy', () => {
    expect(
      assetGenerationErrorMessage(
        'Your request was rejected by the safety system. safety_violations=[violence].',
      ),
    ).toBe('内容触发图片模型安全审核，未生成图片。请弱化暴力、血腥或危险描述后重试。')
  })

  it('keeps other provider errors intact', () => {
    expect(assetGenerationErrorMessage('上游连接超时')).toBe('上游连接超时')
  })
})
