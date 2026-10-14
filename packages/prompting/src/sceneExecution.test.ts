import { describe, expect, it } from 'vitest'
import { sceneExecutionGaps } from './sceneExecution.js'
import { inspectVideoPreflight } from './videoPreflight.js'
import { compileStoryboardVideoPrompt } from './videoPromptCompiler.js'
import { prioritizeShotExecution } from './videoShotExecution.js'
import { compileQualityRules } from './qualityRuleCompiler.js'

const local =
  '首帧与空间调度\n人群挤在隔离栏前，守卫在内侧。\n动作时序\n前排推挤栏杆，守卫未动。\n镜尾状态\n栏杆倾斜，人群仍施压。'
describe('scene execution flow', () => {
  it('reports actionable missing specs without claiming semantic certainty or blocking legacy work', () => {
    const issues = inspectVideoPreflight(local).issues
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'PHYSICAL_SETUP_REVIEW',
        'RIGID_STRUCTURE_REVIEW',
        'POPULATION_LAYOUT_REVIEW',
        'RESPONSE_PLAN_REVIEW',
      ]),
    )
    expect(issues.every((issue) => issue.severity === 'warning' && issue.evidence.length)).toBe(true)
  })
  it('does not treat future scene events or quoted dialogue as visible action', () => {
    expect(
      sceneExecutionGaps(
        '场景上下文\n随后士兵阻挡人群推门。\n首帧与空间调度\n房间无人。\n动作时序\n光线变暗。\n镜尾状态\n仍然无人。\n对白约束\n提到人群推栏杆。',
      ),
    ).toEqual([])
    expect(
      sceneExecutionGaps('首帧与空间调度\n两人坐着。\n动作时序\n一人读信。\n镜尾状态\n读完放下。'),
    ).toEqual([])
  })
  it('uses duties established in the scene header without requiring a character name heuristic', () => {
    const prompt =
      '场景上下文\nDain 在闸门内侧执勤。\n首帧与空间调度\nDain 在面板旁，人群挤在栏外。\n动作时序\n人群推挤栏杆。\n镜尾状态\nDain 仍在原位。'
    expect(sceneExecutionGaps(prompt).map((issue) => issue.code)).toContain('RESPONSE_PLAN_REVIEW')
  })
  it('retains operational specs as local constraints through compilation, without inventing a design', () => {
    const prompt = `${local}\n支撑与受力\n制作设计：栏杆为刚性钢制模块，长度、杆件数量和杆间距保持不变；底座可移动，受推后仅整体摩擦滑动。\n空间与通行\n保留内侧退路。\n群体与纵深\n正文依据：人群延伸到后排通道，远景连续。\n职责与反应\n后镜才触发撤离，本镜不提前执行。`
    expect(sceneExecutionGaps(prompt)).toEqual([])
    const prioritized = prioritizeShotExecution(prompt, true)
    expect(prioritized).toContain('支撑与受力\n制作设计')
    const result = compileStoryboardVideoPrompt({
      project: { aspectRatio: '16:9' },
      shot: { id: 'x', prompt, duration: 4 },
    })
    expect(result).toContain('底座可移动')
    expect(result).toContain('空场参考只提供环境')
    expect(result).toContain('不提前执行后镜事件')
    expect(result).toContain('禁止像弹簧、橡胶、布料或液体一样拉伸')
    expect(result).not.toContain('底座固定在地面')
  })
  it('requires rigid structure invariants when a rigid object is under force', () => {
    const issues = sceneExecutionGaps(
      '首帧与空间调度\n人群挤在铁栅栏前。\n动作时序\n人群推挤栏杆。\n镜尾状态\n栏杆仍在原位。\n支撑与受力\n受力方式未说明。',
    )
    expect(issues.map((issue) => issue.code)).toContain('RIGID_STRUCTURE_REVIEW')
  })
  it('flags fixed rigid objects described as flexible', () => {
    const issues = sceneExecutionGaps(
      '首帧与空间调度\n固定隔离栏前有密集人群。\n动作时序\n人群推挤栏杆。\n镜尾状态\n人群仍在栏外。\n支撑与受力\n栏杆底板以螺栓固定，栏片可弯曲震颤。',
    )
    expect(issues.map((issue) => issue.code)).toContain('RIGID_CONTRADICTION_REVIEW')
  })
  it('does not let general negative prompts suppress required crowds or force people into empty asset images', () => {
    const video = compileQualityRules({ mediaKind: 'video', visualStyles: ['photorealistic'] })
    expect(video.negativePrompt).not.toContain('不要多余人物和道具')
    expect(video.negativePrompt).toContain('保留既定群众规模与设施支撑')
    const rigidVideo = compileQualityRules({ mediaKind: 'video', sourcePrompt: '人群推挤固定铁栅栏' })
    expect(rigidVideo.presetIds).toContain('rigid-structure-continuity')
    expect(rigidVideo.negativePrompt).toContain('不要像弹簧、橡胶或布料一样伸缩')
    const scene = compileQualityRules({ mediaKind: 'image', assetKind: 'scene', emptyScene: true })
    expect(scene.negativePrompt).toContain('不要乱入人物')
    expect(scene.positivePrompt).toContain('空场图只描述环境')
    expect(compileQualityRules({ mediaKind: 'image', assetKind: 'character' }).positivePrompt).not.toContain(
      '安装接口',
    )
  })
})
