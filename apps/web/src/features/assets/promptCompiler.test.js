import { describe, expect, it } from 'vitest'
import { createDefaultAttributes } from './assetOptions'
import { buildPromptBlueprint, compileAssetPrompt, compileCharacterStagePrompt } from './promptCompiler'
import { negativePromptForVideoProject } from '../prompts/negativePromptPresets'

describe('asset prompt compiler', () => {
  it('includes selected character controls and project ratio', () => {
    const attributes = createDefaultAttributes('character')
    attributes.legStretch = true
    attributes.faceBrightening = true
    attributes.turnaround = true
    const prompt = compileAssetPrompt(
      {
        name: '林夏',
        description: '纪录片导演',
        sourceMode: 'generate',
        promptMode: 'standard',
        customPrompt: '',
        attributes,
      },
      '9:16',
    )

    expect(prompt).toContain('影视 CG风格')
    expect(prompt).toContain('拉长腿部')
    expect(prompt).toContain('自然提亮面部肤色')
    expect(prompt).toContain('保留皮肤纹理')
    expect(prompt).toContain('正面、侧面、背面')
    expect(prompt).toContain('画面比例9:16')
  })

  it('can replace the automatic prompt in advanced mode', () => {
    expect(
      compileAssetPrompt(
        {
          name: '道具',
          description: '',
          sourceMode: 'generate',
          promptMode: 'advanced',
          customPromptMode: 'replace',
          customPrompt: '完全自定义内容',
          attributes: createDefaultAttributes('prop'),
        },
        '16:9',
      ),
    ).toBe('完全自定义内容')
  })

  it('uses dedicated ratios and constraints for character workflow stages', () => {
    const asset = {
      name: '林夏',
      description: '青年导演',
      sourceMode: 'generate',
      promptMode: 'standard',
      customPrompt: '',
      attributes: createDefaultAttributes('character'),
    }

    expect(compileCharacterStagePrompt(asset, '9:16', 'face')).toContain('画面比例1:1')
    expect(compileCharacterStagePrompt(asset, '9:16', 'body')).toContain('画面比例9:16')
    expect(compileCharacterStagePrompt(asset, '9:16', 'turnaround')).toContain('16:9三栏')
  })

  it('respects the selected character turnaround output layout', () => {
    const attributes = createDefaultAttributes('character')
    attributes.turnaroundLayout = 'separate'
    const prompt = compileCharacterStagePrompt(
      {
        name: '林夏',
        description: '青年导演',
        sourceMode: 'generate',
        promptMode: 'standard',
        customPrompt: '',
        attributes,
      },
      '9:16',
      'turnaround',
    )

    expect(prompt).toContain('人物三视图源图')
    expect(prompt).toContain('三张源图视角清楚')
    expect(prompt).not.toContain('16:9三栏人物三视图设定表')
  })

  it('exposes the image prompt framework in formula order', () => {
    const attributes = createDefaultAttributes('scene')
    attributes.weather = 'rain'
    const blueprint = buildPromptBlueprint(
      {
        name: '雨夜便利店',
        description: '主角第一次相遇的街角',
        sourceMode: 'generate',
        promptMode: 'standard',
        customPrompt: '',
        attributes,
      },
      '16:9',
    )

    expect(blueprint.formula).toEqual(['风格', '构图', '主体', '动作', '场景', '光影', '细节', '质量词'])
    expect(blueprint.sections.map((section) => section.label)).toEqual(blueprint.formula)
    expect(blueprint.sections.find((section) => section.key === 'lighting')?.value).toContain('雨面反光')
    expect(blueprint.qualityTerms).toContain('清晰锐利')
  })

  it('exposes stable negative prompt suggestions for visual assets', () => {
    const blueprint = buildPromptBlueprint(
      {
        name: '主角',
        description: '',
        sourceMode: 'generate',
        promptMode: 'standard',
        customPrompt: '',
        attributes: createDefaultAttributes('character'),
      },
      '9:16',
    )

    expect(blueprint.negativeTerms).toContain('不要畸形、解剖错误、多余手指、手指粘连、手部扭曲')
    expect(blueprint.suggestedNegativePrompt).toContain('塑料皮肤')
    expect(blueprint.suggestedNegativePrompt).toContain('多余手指')
  })

  it('uses scene and product negative prompt presets', () => {
    const sceneBlueprint = buildPromptBlueprint(
      {
        name: '雨夜便利店',
        description: '',
        sourceMode: 'generate',
        promptMode: 'standard',
        customPrompt: '',
        attributes: createDefaultAttributes('scene'),
      },
      '16:9',
    )
    const propBlueprint = buildPromptBlueprint(
      {
        name: '复古收音机',
        description: '',
        sourceMode: 'generate',
        promptMode: 'standard',
        customPrompt: '',
        attributes: createDefaultAttributes('prop'),
      },
      '1:1',
    )

    expect(sceneBlueprint.suggestedNegativePrompt).toContain('穿帮接缝')
    expect(sceneBlueprint.suggestedNegativePrompt).toContain('暗部死黑')
    expect(propBlueprint.suggestedNegativePrompt).toContain('假材质')
    expect(propBlueprint.suggestedNegativePrompt).toContain('多余道具')
  })

  it('marks prop assets as key or recurring instead of one-off objects', () => {
    const attributes = createDefaultAttributes('prop')
    attributes.usage = 'recurring'
    const prompt = compileAssetPrompt(
      {
        name: '透明雨伞',
        description: '',
        sourceMode: 'generate',
        promptMode: 'standard',
        customPrompt: '',
        attributes,
      },
      '9:16',
    )

    expect(prompt).toContain('多次出现')
    expect(prompt).not.toContain('一次性')
  })

  it('combines video negative presets by project type', () => {
    const shortDramaPrompt = negativePromptForVideoProject({ contentType: 'short-drama' })
    const advertisementPrompt = negativePromptForVideoProject({ contentType: 'advertisement' })

    expect(shortDramaPrompt).toContain('不要出现机械臂')
    expect(shortDramaPrompt).toContain('不要闪烁、频闪')
    expect(advertisementPrompt).toContain('不要塑料感、油腻反光')
    expect(advertisementPrompt).toContain('不要闪烁、频闪')
  })

  it('uses an audio-specific formula and quality language for audio assets', () => {
    const attributes = createDefaultAttributes('audio')
    attributes.loop = true
    const blueprint = buildPromptBlueprint(
      {
        name: '雨夜站台',
        description: '环境音',
        sourceMode: 'generate',
        promptMode: 'standard',
        customPrompt: '',
        attributes,
      },
      '16:9',
    )

    expect(blueprint.formula).toEqual(['类型', '时长', '主体', '情绪', '语言', '音色', '细节', '质量词'])
    expect(blueprint.finalPrompt).toContain('可循环播放')
    expect(blueprint.qualityTerms).toContain('音质清晰')
    expect(blueprint.suggestedNegativePrompt).toContain('破音')
  })
})
