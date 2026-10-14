import { describe, expect, it } from 'vitest'
import { inspectVideoPreflight } from './videoPreflight.js'
describe('bounded video text preflight', () => {
  it('blocks mutually exclusive screen requirements with evidence', () => {
    const result = inspectVideoPreflight('屏幕呈现\n必须显示可辨认的数字。不要显示可辨认的数字。')
    expect(result.issues.find((i) => i.code === 'SCREEN_READABILITY_CONFLICT')?.evidence).toHaveLength(2)
  })
  it('blocks a named actor with conflicting whole-shot hand locks', () => {
    const result = inspectVideoPreflight('局部锁定\nDain 右手全程握着终端。Dain 右手始终持枪。')
    expect(result.issues.some((i) => i.code === 'HAND_PROP_CONFLICT')).toBe(true)
  })
  it('preserves different actors, explicit action changes, dialogue and scene background', () => {
    for (const prompt of [
      '局部锁定\nDain 右手全程握着终端。Elena 右手始终持枪。',
      '动作时序\nDain 先放下终端，再拿枪。',
      '场景上下文\n必须显示数字。不要显示数字。',
      '对白约束\nDain说：“必须显示数字。不要显示数字。”',
    ]) {
      expect(inspectVideoPreflight(prompt).issues.filter((i) => i.severity === 'error')).toEqual([])
    }
  })
  it('records asset staging treatment as a warning, without changing source assets', () => {
    const assets = [{ name: 'Dain', description: '黑色背心，右手常按在武器附近' }]
    expect(inspectVideoPreflight('', assets).issues[0]?.code).toBe('ASSET_STAGING_FILTERED')
    expect(assets[0]?.description).toContain('右手')
  })
  it('blocks an intra-shot cut when the shot declares one continuous take', () => {
    const result = inspectVideoPreflight('摄影机\n单一连续镜头，镜内硬切到闸门另一侧。')
    expect(result.issues.find((issue) => issue.code === 'CONTINUOUS_SHOT_CUT_CONFLICT')).toMatchObject({
      severity: 'error',
    })
  })
  it('allows an explicit no-cut rule and a legal inter-shot hard cut', () => {
    const result = inspectVideoPreflight(
      '格式模式\n单一连续镜头\n摄影机\n固定机位，单一连续镜头，不在镜内切换。\n镜间剪辑\n镜间硬切。',
    )
    expect(result.issues.some((issue) => issue.code === 'CONTINUOUS_SHOT_CUT_CONFLICT')).toBe(false)
  })
  it('does not mistake a prohibition on cuts or an inter-shot edit for an intra-shot cut', () => {
    const result = inspectVideoPreflight('摄影机\n单一连续镜头，不在镜内切换。\n镜间剪辑\n镜间硬切。')
    expect(result.issues.some((issue) => issue.code === 'CONTINUOUS_SHOT_CUT_CONFLICT')).toBe(false)
  })
  it('blocks a fixed barrier that is also described as bending', () => {
    const result = inspectVideoPreflight('支撑与受力\n隔离栏底板以螺栓固定在混凝土地面；栏片受压弯曲震颤。')
    expect(result.issues.find((issue) => issue.code === 'FIXED_RIGID_FLEX_CONFLICT')).toMatchObject({
      severity: 'error',
    })
  })
  it('keeps the sample camera rule legal while surfacing its unsupported flex mode', () => {
    const result = inspectVideoPreflight(
      [
        '格式模式',
        '单一连续镜头',
        '支撑与受力',
        '隔离栏底板以螺栓固定混凝土地面并有斜撑；栏片可弯曲震颤，固定底座不滑移。',
        '摄影机',
        '固定机位，画面完整覆盖本镜人物与动作，单一连续镜头；不在镜内切换。',
        '镜间剪辑',
        '镜间硬切。',
      ].join('\n'),
    )
    expect(result.issues.some((issue) => issue.code === 'FIXED_RIGID_FLEX_CONFLICT')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'CONTINUOUS_SHOT_CUT_CONFLICT')).toBe(false)
  })
  it('guides old rigid-force prompts without blocking them for missing anchors', () => {
    const result = inspectVideoPreflight('动作时序\n人群推挤隔离栏。\n支撑与受力\n受力方式待补。')
    expect(result.issues.find((issue) => issue.code === 'RIGID_ANCHOR_GUIDANCE')).toMatchObject({
      severity: 'warning',
    })
  })
})
