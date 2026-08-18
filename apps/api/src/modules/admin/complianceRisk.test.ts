import { describe, expect, it } from 'vitest'
import { classifyComplianceRisk } from './repository.js'

describe('classifyComplianceRisk', () => {
  it('does not flag exposed-rock landscape text as sexual content', () => {
    const prompt = [
      '冰雪覆盖的高山山峰作为画面主体，巍峨挺拔，主体山峰居中显突出，',
      '山体细节清晰锐利，锋利的雪岩，积雪层次与裸露岩石纹理清楚可见。',
      '周围云层与云雾缭绕，云海缥缈山脊与山脚，营造空灵冷峻的雪山氛围。',
    ].join('')

    expect(classifyComplianceRisk(prompt)).not.toContainEqual(
      expect.objectContaining({ category: 'sexual_content' }),
    )
  })

  it('still flags explicit sexual content', () => {
    const prompt = '成人色情内容，裸露人体，明确的性行为描写。'

    expect(classifyComplianceRisk(prompt)).toContainEqual(
      expect.objectContaining({ category: 'sexual_content', severity: 'high' }),
    )
  })
})
