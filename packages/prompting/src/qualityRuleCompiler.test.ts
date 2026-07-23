import { describe, expect, it } from 'vitest'
import { compileQualityRules, QUALITY_RULE_VERSION } from './qualityRuleCompiler.js'

describe('compileQualityRules', () => {
  it('combines the video floor, photoreal rules and custom constraints', () => {
    const result = compileQualityRules({
      mediaKind: 'video',
      visualStyles: ['photorealistic'],
      sourcePrompt: '人物走入室内',
      customNegativePrompt: '不要出现红色雨伞',
    })

    expect(result.version).toBe(QUALITY_RULE_VERSION)
    expect(result.presetIds).toEqual(['video-base', 'photoreal-video'])
    expect(result.negativePrompt).toContain('不要闪烁、频闪、跳帧')
    expect(result.negativePrompt).toContain('摄影机、轨道、云台')
    expect(result.negativePrompt).toContain('不要出现红色雨伞')
  })

  it('does not reject animation styles for an animation project', () => {
    const result = compileQualityRules({
      mediaKind: 'image',
      assetKind: 'character',
      contentType: 'animation',
      visualStyles: ['anime'],
    })

    expect(result.presetIds).not.toContain('photoreal-character')
    expect(result.negativePrompt).not.toContain('不要卡通、动漫')
    expect(result.negativePrompt).toContain('不要多余手指')
  })

  it('keeps fog when requested and blocks unrequested people in an empty scene', () => {
    const result = compileQualityRules({
      mediaKind: 'image',
      assetKind: 'scene',
      visualStyles: ['photorealistic'],
      emptyScene: true,
      weather: 'fog',
      sourcePrompt: '清晨山谷薄雾',
    })

    expect(result.presetIds).toContain('empty-scene')
    expect(result.presetIds).not.toContain('clear-atmosphere')
    expect(result.negativePrompt).toContain('不要乱入人物')
    expect(result.negativePrompt).not.toContain('保持空气通透')
  })

  it('protects specified branding in advertisement output', () => {
    const result = compileQualityRules({
      mediaKind: 'video',
      contentType: 'advertisement',
      visualStyles: ['photorealistic'],
    })

    expect(result.presetIds).toContain('product-advertisement')
    expect(result.negativePrompt).toContain('保持产品结构、包装、材质和指定品牌标识准确')
    expect(result.negativePrompt).toContain('未经指定的水印、文字、logo')
  })
})
