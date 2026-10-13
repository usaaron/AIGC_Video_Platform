import { describe, expect, it } from 'vitest'
import { prioritizeShotExecution, referenceVisualDetail } from './videoShotExecution.js'
import { compileStoryboardVideoPrompt } from './videoPromptCompiler.js'

const source = [
  '场景上下文', '晚些时候 Mira 进入，守卫翻转终端。',
  '参考绑定状态', '参考图待绑定核对。',
  '首帧与空间调度', '守卫右手持名单终端，左手空着；Mira 尚未入画。',
  '动作时序', '人群推挤，隔离栏向内倾斜；守卫持物不变。',
  '对白约束', '守卫说：“Hold the line.”；中文对照：守住队列。',
  '镜尾状态', '终端仍在守卫右手。',
  '屏幕呈现', '倒计时屏只见红色光，具体读数不可辨。',
].join('\n')

describe('video shot execution precedence', () => {
  it('prioritizes the actual shot over whole-scene events without losing dialogue or actions', () => {
    const result = prioritizeShotExecution(source, true)
    expect(result.indexOf('守卫右手持名单终端')).toBeLessThan(result.indexOf('晚些时候 Mira 进入'))
    expect(result).toContain('人群推挤，隔离栏向内倾斜；守卫持物不变。')
    expect(result).toContain('守卫说：“Hold the line.”；中文对照：守住队列。')
    expect(result).toContain('具体读数不可辨')
    expect(result).not.toContain('参考图待绑定核对')
    expect(prioritizeShotExecution(source, false)).toContain('参考图待绑定核对')
  })

  it('does not reinterpret free prose, incomplete formats, intentional gun actions or reversing clocks', () => {
    for (const text of ['首帧与空间调度\n守卫拔枪。', '女人右手举枪；时钟倒转到 08:00。', '自定义要求\n'+source]) {
      expect(prioritizeShotExecution(text, true)).toBe(text)
    }
  })

  it('removes bilingual pose/camera advice from asset text but retains costume and physical marks', () => {
    const text = referenceVisualDetail('深灰制服，右手常按在武器附近；黑色防弹背心，左前臂旧烧伤疤。right hand resting near weapon, worn cuffs, square face；适用于舱内场景；光线为探照灯；便于紧迫场面插入特写')
    expect(text).toContain('深灰制服')
    expect(text).toContain('黑色防弹背心')
    expect(text).toContain('左前臂旧烧伤疤')
    expect(text).toContain('worn cuffs')
    expect(text).toContain('square face')
    expect(text).not.toMatch(/右手|resting|场景|光线|特写/u)
  })

  it('prevents reference-only actions and display closeups from overriding explicit shot states', () => {
    const appearance = { name: '执勤装', description: '深灰制服；右手常按在武器附近；right hand resting near weapon' }
    const input = {
      project: { aspectRatio: '16:9', contentType: 'short-drama' },
      shot: { id: 'shot', prompt: source, duration: 4 },
      assets: [
        { id: 'guard', kind: 'character', name: '守卫' },
        { id: 'timer', kind: 'prop', name: '倒计时屏', description: '红色工业显示屏，数字持续下降；便于紧迫场面插入特写' },
      ],
      references: [
        { id: 'guard', appearance, imageBindings: [{ number: 1, purpose: '面部身份' }] },
        { id: 'timer', imageBindings: [{ number: 2, purpose: '外观' }] },
      ],
    }
    const result = compileStoryboardVideoPrompt(input)
    expect(result).not.toMatch(/右手常按|right hand resting|便于紧迫场面插入特写/u)
    expect(result).toContain('右手持名单终端')
    expect(result).toContain('具体读数不可辨')
    expect(result).toContain('图2用于外观')
    expect(result.indexOf('参考资产')).toBeLessThan(result.indexOf('本镜执行'))
    expect(appearance.description).toContain('右手常按在武器附近')
    const unbound = compileStoryboardVideoPrompt({ ...input, references: [{ id: 'guard', appearance, imageBindings: [] }] })
    expect(unbound).toContain('本次未附图片')
    expect(unbound).not.toContain('右手常按在武器附近')
  })
})
