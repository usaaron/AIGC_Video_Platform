import { describe, expect, it } from 'vitest'
import {
  formatOutlineDraft,
  formatOutlineRegenerationIdea,
  formatScenesDraft,
  formatStructureDraft,
} from './outlineDraft'

const outline = {
  title: '雪夜归剑',
  logline: '退隐女剑客在婚约与复仇之间选择守护故土。',
  protagonist: '退隐女剑客，想摆脱江湖旧债并保护爱人。',
  conflict: '门派追杀和复仇执念同时逼近。',
  tone: '浪漫、悲情、中国风武侠',
  ending: '牺牲式圆满。',
  estimatedDuration: '约100分钟',
  summary: '女剑客被迫重拾长剑，在救人与复仇之间完成选择。',
}

describe('outline draft formatter', () => {
  it('turns a selected outline into an editable script draft', () => {
    const draft = formatOutlineDraft(outline)

    expect(draft).toContain('标题：雪夜归剑')
    expect(draft).toContain('核心冲突：门派追杀和复仇执念同时逼近。')
    expect(draft).toContain('故事大纲：女剑客被迫重拾长剑')
  })

  it('keeps the selected outline context when regenerating one option', () => {
    const idea = formatOutlineRegenerationIdea('浪漫悲情武侠长片', outline)

    expect(idea).toContain('浪漫悲情武侠长片')
    expect(idea).toContain('原标题：雪夜归剑')
    expect(idea).toContain('避免只是同义改写')
  })

  it('turns a generated plot structure into an editable draft', () => {
    const draft = formatStructureDraft({
      title: '雪夜归剑',
      premise: '退隐女剑客在婚约与复仇之间选择守护故土。',
      mainPlot: '屠城令打破隐居生活，主角从护送百姓走向最终守护。',
      acts: [
        {
          id: 'act-1',
          title: '第一幕',
          purpose: '建立人物目标。',
          summary: '旧债打破婚约。',
          keyBeats: ['婚约', '屠城令', '护送'],
          turningPoint: '决定重拾长剑。',
          estimatedMinutes: 25,
        },
      ],
      subplots: [
        {
          id: 'subplot-1',
          title: '爱情副线',
          characters: ['女剑客', '药师'],
          arc: '从相守到分歧。',
          payoff: '离别回收。',
        },
      ],
      characterArcs: [
        {
          character: '女剑客',
          desire: '摆脱旧债。',
          obstacle: '复仇执念。',
          change: '成为守护者。',
        },
      ],
      visualDirection: '雪夜边城贯穿。',
      nextStep: '继续细化关键场景。',
    })

    expect(draft).toContain('主线剧情：屠城令打破隐居生活')
    expect(draft).toContain('关键节拍：婚约；屠城令；护送')
    expect(draft).toContain('副线：')
  })

  it('turns a generated scene-by-scene script into an editable draft', () => {
    const draft = formatScenesDraft({
      title: '雪夜归剑分场剧本',
      sourceStructureTitle: '雪夜归剑',
      scenes: [
        {
          id: 'scene-1',
          order: 1,
          actId: 'act-1',
          title: '雪夜婚约',
          location: '边城药铺',
          timeOfDay: '夜',
          characters: ['女剑客', '药师'],
          purpose: '建立隐居愿望',
          conflict: '旧身份与新生活冲突',
          plot: '女剑客准备收起长剑，与药师确认婚约，却被窗外急促马蹄打断。',
          action: '她把剑匣推入柜底，药师点亮桌上油灯。',
          dialogue: ['女剑客：明日之后，我不再握剑。'],
          visualNotes: '室内暖灯与窗外冷雪形成对比。',
          transition: '门外马蹄声引出下一场。',
          estimatedMinutes: 5,
        },
      ],
      continuityNotes: '长剑、雪夜和药铺灯光需要连续。',
      nextStep: '继续扩写完整动作和对白。',
    })

    expect(draft).toContain('场次 01｜雪夜婚约')
    expect(draft).toContain('对白：女剑客：明日之后，我不再握剑。')
    expect(draft).toContain('连续性注意：长剑、雪夜和药铺灯光需要连续。')
  })
})
