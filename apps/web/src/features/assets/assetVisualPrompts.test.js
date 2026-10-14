import { describe, expect, it } from 'vitest'
import { createDefaultAttributes } from './assetOptions'
import { compileAssetPrompt, compileCharacterStagePrompt } from './promptCompiler'

function character(style = 'cinematic-cg') {
  return {
    name: '林岚',
    description: '左眉有旧疤，穿朴素灰色制服。',
    promptMode: 'standard',
    attributes: createDefaultAttributes('character', style),
  }
}

describe('asset visual prompt boundaries', () => {
  it.each(['face', 'body', 'turnaround'])(
    'keeps age and authored features in photoreal %s assets',
    (stage) => {
      const asset = character('photorealistic')
      asset.attributes.ageGroup = 'senior'
      const prompt = compileCharacterStagePrompt(asset, '9:16', stage)
      expect(prompt).toContain('符合既定年龄')
      expect(prompt).toContain('左眉有旧疤')
      expect(prompt).toContain('不美颜换脸或年轻化')
      expect(prompt).not.toContain('无高光')
      expect(prompt).not.toContain('年轻肌肤')
    },
  )

  it.each(['anime', 'storybook', 'chinese-2d', 'chinese-3d', 'cinematic-cg'])(
    'does not impose photographic skin on %s',
    (style) => {
      const prompt = compileCharacterStagePrompt(character(style), '9:16', 'body')
      expect(prompt).not.toContain('写实人像')
      expect(prompt).not.toContain('皮肤细节清晰')
      expect(prompt).not.toContain('去噪')
    },
  )

  it('keeps real animal textures without human skin or face instructions', () => {
    const asset = character('photorealistic')
    Object.assign(asset.attributes, { subjectType: 'animal', species: '蜥蜴' })
    const prompt = compileCharacterStagePrompt(asset, '9:16', 'body')
    expect(prompt).toContain('不删去物种本身的纹理')
    expect(prompt).not.toContain('写实人像')
    expect(prompt).not.toContain('去除鱼鳞纹')
  })

  it('keeps selected variant and conditional state distinct from base identity', () => {
    const asset = character()
    Object.assign(asset.attributes, {
      activeAppearanceVariantId: 'rain',
      appearanceVariants: [
        {
          id: 'rain',
          name: '雨夜',
          description: '灰色防水服',
          prompt: '裤脚有湿痕',
          continuityNote: '仅第3场雨后使用；第4场换下。',
        },
        { id: 'formal', name: '礼服', description: '不应混入的红色礼服' },
      ],
    })
    const before = structuredClone(asset)
    const prompt = compileCharacterStagePrompt(asset, '9:16', 'body')
    expect(prompt).toContain('造型要求：裤脚有湿痕')
    expect(prompt).toContain('适用与连续性：仅第3场雨后使用；第4场换下。')
    expect(prompt).toContain('不执行其中的剧情动作')
    expect(prompt).not.toContain('不应混入')
    expect(compileCharacterStagePrompt(asset, '1:1', 'face')).not.toContain('裤脚有湿痕')
    expect(asset).toEqual(before)
  })

  it('preserves a stage-specific author replacement instead of adding a skin or layout template', () => {
    const asset = character('photorealistic')
    asset.promptMode = 'advanced'
    asset.attributes.stagePrompts.face = '只修复图中噪点，保留所有皱纹与原构图。'
    expect(compileCharacterStagePrompt(asset, '1:1', 'face')).toBe(asset.attributes.stagePrompts.face)
  })

  it('keeps source-view instructions out of facial crops and removes model-side sheet composition', () => {
    const asset = character()
    const face = compileCharacterStagePrompt(asset, '1:1', 'face')
    const views = compileCharacterStagePrompt(asset, '9:16', 'turnaround')
    expect(face).toContain('画面比例1:1')
    expect(face).not.toContain('头部与足端')
    expect(views).toContain('三张独立源图')
    expect(views).toContain('身体图保留完整头部与足端')
    expect(views).not.toContain('最终组合为一张')
    expect(views).not.toContain('3:2')
  })

  it.each(['scene', 'prop', 'costume'])('adds only applicable %s asset rules', (kind) => {
    const prompt = compileAssetPrompt(
      {
        name: '测试资产',
        description: '已确认外观',
        promptMode: 'standard',
        attributes: createDefaultAttributes(kind),
      },
      '16:9',
    )
    expect(prompt).not.toContain('写实人像')
    expect(prompt).not.toContain('三联')
    expect(prompt).toContain(
      kind === 'scene' ? '固定建筑' : kind === 'prop' ? '不因外观陈旧补造年代' : '保留指定单色',
    )
  })
})
