import { describe, expect, it } from 'vitest'
import { createDefaultAttributes } from './assetOptions'
import { compileAssetPrompt, compileCharacterStagePrompt } from './promptCompiler'

describe('asset prompt compiler', () => {
  it('includes selected character controls and project ratio', () => {
    const attributes = createDefaultAttributes('character')
    attributes.legStretch = true
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
    expect(prompt).toContain('拉长双腿')
    expect(prompt).toContain('55%到58%')
    expect(prompt).toContain('不拉伸躯干和手臂')
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

  it('adds identity constraints when Img2 receives reference images', () => {
    const asset = {
      name: '林夏',
      description: '青年导演',
      sourceMode: 'generate',
      promptMode: 'standard',
      customPrompt: '',
      references: [{ id: 'media-1', url: '/media/1', name: 'face.png' }],
      attributes: createDefaultAttributes('character'),
    }

    expect(compileCharacterStagePrompt(asset, '1:1', 'face')).toContain('严格保持导入参考图')
    expect(compileAssetPrompt(asset, '9:16')).toContain('严格保持参考图')
  })
})
