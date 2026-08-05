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

  it('keeps advanced character prompts isolated by workflow stage', () => {
    const attributes = createDefaultAttributes('character')
    attributes.stagePrompts = {
      face: '自定义面部完整提示词',
      body: '自定义全身完整提示词',
      turnaround: '自定义三视图完整提示词',
    }
    const asset = {
      name: '岚星',
      description: '星际引路人',
      sourceMode: 'generate',
      promptMode: 'advanced',
      customPromptMode: 'replace',
      customPrompt: '旧的全局提示词',
      attributes,
    }

    expect(compileCharacterStagePrompt(asset, '9:16', 'face')).toBe('自定义面部完整提示词')
    expect(compileCharacterStagePrompt(asset, '9:16', 'body')).toBe('自定义全身完整提示词')
    expect(compileCharacterStagePrompt(asset, '9:16', 'turnaround')).toBe('自定义三视图完整提示词')
  })

  it('does not reuse a legacy face prompt for full-body generation', () => {
    const asset = {
      name: '岚星',
      description: '星际引路人',
      sourceMode: 'generate',
      promptMode: 'advanced',
      customPromptMode: 'replace',
      customPrompt: '人物面部大头照，头部和肩部完整入镜，画面比例1:1',
      attributes: createDefaultAttributes('character'),
    }

    const bodyPrompt = compileCharacterStagePrompt(asset, '9:16', 'body')
    expect(bodyPrompt).toContain('全身完整入镜')
    expect(bodyPrompt).toContain('画面比例9:16')
    expect(bodyPrompt).not.toContain('人物面部大头照')

    const facePrompt = compileCharacterStagePrompt(
      { ...asset, customPrompt: '人物全身完整入镜，标准站姿，画面比例9:16' },
      '9:16',
      'face',
    )
    expect(facePrompt).toContain('人物面部大头照')
    expect(facePrompt).toContain('画面比例1:1')
    expect(facePrompt).not.toContain('标准站姿')
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

  it('keeps character outputs transparent and free of lighting effects', () => {
    const asset = {
      name: '角色',
      description: '',
      sourceMode: 'generate',
      promptMode: 'standard',
      customPromptMode: 'append',
      customPrompt: '',
      attributes: createDefaultAttributes('character'),
    }

    const prompt = compileAssetPrompt(asset, '9:16')
    expect(prompt).toContain('Alpha通道')
    expect(prompt).toContain('无光影效果')
    expect(prompt).toContain('无投影')
  })

  it('injects advanced human appearance settings into the prompt', () => {
    const attributes = createDefaultAttributes('character')
    Object.assign(attributes, {
      ethnicity: 'east-asian',
      skinTone: 'tan',
      eyeColor: 'amber',
      hairColor: 'white',
    })
    const prompt = compileAssetPrompt(
      {
        name: '角色',
        description: '',
        sourceMode: 'generate',
        promptMode: 'standard',
        customPrompt: '',
        attributes,
      },
      '9:16',
    )

    expect(prompt).toContain('东亚族裔特征')
    expect(prompt).toContain('小麦肤色')
    expect(prompt).toContain('琥珀色瞳孔')
    expect(prompt).toContain('白色头发')
  })

  it('does not inject human gender or age into animal prompts', () => {
    const attributes = createDefaultAttributes('character')
    Object.assign(attributes, {
      subjectType: 'animal',
      species: '雪豹',
      gender: 'female',
      ageGroup: 'young',
      exactAge: 22,
    })
    const asset = {
      name: '雪山守卫',
      description: '',
      sourceMode: 'generate',
      promptMode: 'standard',
      customPrompt: '',
      attributes,
    }

    const prompt = compileCharacterStagePrompt(asset, '1:1', 'face')
    expect(prompt).toContain('动物角色，雪豹')
    expect(prompt).toContain('禁止人类形态')
    expect(prompt).not.toContain('女性')
    expect(prompt).not.toContain('青年')
    expect(prompt).not.toContain('22岁')
  })

  it('always reserves an empty stage for scene production', () => {
    const attributes = createDefaultAttributes('scene')
    Object.assign(attributes, { emptyScene: false, activitySpace: false })
    const prompt = compileAssetPrompt(
      {
        name: '青云宗山门',
        description: '',
        sourceMode: 'generate',
        promptMode: 'standard',
        customPrompt: '',
        attributes,
      },
      '16:9',
    )

    expect(prompt).toContain('空场景，不出现人物')
    expect(prompt).toContain('预留人物表演和镜头运动空间')
  })
})
