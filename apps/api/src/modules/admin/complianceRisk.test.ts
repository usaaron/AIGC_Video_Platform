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

  it('does not flag clothing or color references as sexual content without body context', () => {
    const prompt = '服装设计参考：裸色丝绸礼服，泳装产品图，强调布料质感、色调和电商白底陈列。'

    expect(classifyComplianceRisk(prompt)).not.toContainEqual(
      expect.objectContaining({ category: 'sexual_content' }),
    )
  })

  it('flags exposed human body context as sexual content', () => {
    const prompt = '成人写真镜头，裸露身体和私密部位，姿势挑逗。'

    expect(classifyComplianceRisk(prompt)).toContainEqual(
      expect.objectContaining({ category: 'sexual_content', severity: 'medium' }),
    )
  })

  it('does not flag cinematic explosion effects as terrorism', () => {
    const prompt = '电影特效镜头，远处烟花和爆炸效果照亮夜空，强调视觉效果和安全拍摄。'

    expect(classifyComplianceRisk(prompt)).not.toContainEqual(
      expect.objectContaining({ category: 'terrorism' }),
    )
  })

  it('flags explosive instruction context as terrorism', () => {
    const prompt = '自制炸药教程，说明炸弹配方、安装方式和引爆步骤。'

    expect(classifyComplianceRisk(prompt)).toContainEqual(
      expect.objectContaining({ category: 'terrorism', severity: 'high' }),
    )
  })

  it('returns matched terms and review reasons', () => {
    const prompt = '自制炸药教程，说明炸弹配方、安装方式和引爆步骤。'
    const tag = classifyComplianceRisk(prompt).find((item) => item.category === 'terrorism')

    expect(tag).toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({
          term: '自制炸药',
          severity: 'high',
          reason: expect.stringContaining('爆炸物词与制作、投放或袭击上下文同时出现'),
        }),
      ]),
    })
  })

  it('does not flag self-harm prevention content', () => {
    const prompt = '自杀预防公益海报，强调心理健康、求助热线、危机干预和陪伴支持。'

    expect(classifyComplianceRisk(prompt)).not.toContainEqual(
      expect.objectContaining({ category: 'self_harm' }),
    )
  })

  it('flags self-harm method content with critical severity', () => {
    const prompt = '如何自杀的方法教程，包含割腕和服毒步骤。'

    expect(classifyComplianceRisk(prompt)).toContainEqual(
      expect.objectContaining({ category: 'self_harm', severity: 'critical' }),
    )
  })

  it('does not flag color metaphors as graphic violence', () => {
    const prompt = '血色晚霞覆盖海面，红色颜料般的云层，浪漫风景摄影。'

    expect(classifyComplianceRisk(prompt)).not.toContainEqual(
      expect.objectContaining({ category: 'graphic_violence' }),
    )
  })

  it('flags explicit graphic violence', () => {
    const prompt = '恐怖片镜头，血腥砍杀、斩首、残肢和内脏散落。'

    expect(classifyComplianceRisk(prompt)).toContainEqual(
      expect.objectContaining({ category: 'graphic_violence', severity: 'high' }),
    )
  })

  it('flags other illegal or high-risk instruction content', () => {
    const prompt = '诈骗教程，批量收集身份证和银行卡信息并绕过风控。'

    expect(classifyComplianceRisk(prompt)).toContainEqual(
      expect.objectContaining({ category: 'other', severity: 'high' }),
    )
  })

  it('uses the short-drama project threshold to reduce medium graphic-violence noise', () => {
    const prompt = '人物打斗后受伤，伤口流血。'

    expect(classifyComplianceRisk(prompt)).toContainEqual(
      expect.objectContaining({ category: 'graphic_violence', severity: 'medium' }),
    )
    expect(classifyComplianceRisk(prompt, { projectContentType: 'short-drama' })).not.toContainEqual(
      expect.objectContaining({ category: 'graphic_violence' }),
    )
  })

  it('keeps explicit high-risk violence under the short-drama project threshold', () => {
    const prompt = '短剧剧本分镜：恐怖片镜头，斩首、残肢和内脏散落。'
    const tag = classifyComplianceRisk(prompt, { projectContentType: 'short-drama' }).find(
      (item) => item.category === 'graphic_violence',
    )

    expect(tag).toMatchObject({
      severity: 'high',
      matches: expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringContaining('影视创作语境'),
        }),
      ]),
    })
  })

  it('uses historical documentary context to reduce medium political-sensitive noise', () => {
    const prompt = '历史纪录片旁白：中立讲解一场政变的背景、年代和社会影响。'

    expect(classifyComplianceRisk(prompt)).not.toContainEqual(
      expect.objectContaining({ category: 'political_sensitive' }),
    )
  })

  it('uses medical education context to reduce medium injury-description noise', () => {
    const prompt = '医学科普图文：讲解打斗受伤后伤口流血的急救处理。'

    expect(classifyComplianceRisk(prompt)).not.toContainEqual(
      expect.objectContaining({ category: 'graphic_violence' }),
    )
  })
})
