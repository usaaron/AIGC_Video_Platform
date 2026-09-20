import { describe, expect, it } from 'vitest'
import {
  expandLongScriptParagraphs,
  splitScriptIntoBeatShots,
  splitScriptIntoSceneShots,
  splitScriptParagraphs,
} from './shotPlanning.js'

const actions = Array.from(
  { length: 24 },
  (_, index) =>
    `动作${index + 1}：林澈检查第${index + 1}份原始材料，把透明比对尺贴住纸面边缘，沿破损处核对残留签名。`,
)
const dialogue = Array.from(
  { length: 25 },
  (_, index) =>
    `[对白]林澈：第${index + 1}项请对照原件核实后再保存。每一张档案都需要完整的来源证明，否则无法提交复核。`,
)

describe('long screenplay paragraph coverage', () => {
  it('retains every long action and dialogue once instead of dropping the second long field', () => {
    const paragraphs = expandLongScriptParagraphs(
      splitScriptParagraphs(
        `场次：S01｜场景：档案室｜角色：林澈｜动作：${actions.join('')}｜对白：${dialogue.join('；')}`,
      ),
    )
    expect(paragraphs.length).toBeGreaterThan(1)
    const prompt = splitScriptIntoSceneShots(paragraphs, 120, true)
      .map((shot) => shot.prompt)
      .join('\n')
    for (const line of [...actions, ...dialogue]) expect(prompt.split(line).length - 1).toBe(1)
    expect(prompt.indexOf(actions[0]!)).toBeLessThan(prompt.indexOf(actions.at(-1)!))
    expect(prompt.indexOf(dialogue[0]!)).toBeLessThan(prompt.indexOf(dialogue.at(-1)!))
  })

  it('does not repeat a short dialogue across expanded action chunks', () => {
    const paragraphs = expandLongScriptParagraphs(
      splitScriptParagraphs(`场次：S01｜场景：档案室｜动作：${actions.join('')}｜对白：${dialogue[0]}`),
    )
    const prompt = splitScriptIntoSceneShots(paragraphs, 120, true)
      .map((shot) => shot.prompt)
      .join('\n')
    expect(prompt.split(dialogue[0]!).length - 1).toBe(1)
    for (const action of actions) expect(prompt).toContain(action)
  })

  it('keeps natural screenplay action and speech order, whole lines and break markers', () => {
    const body = actions.flatMap((action, index) => [`△ ${action}`, dialogue[index]!])
    const paragraphs = expandLongScriptParagraphs([
      {
        text: `场次：S01｜档案室｜夜晚｜内景\n${body.join('\n')}`,
        forceEpisodeBreakBefore: true,
        forceShotBreakBefore: true,
      },
    ])
    expect(paragraphs.length).toBeGreaterThan(1)
    expect(paragraphs.flatMap((paragraph) => paragraph.text.split('\n').slice(1))).toEqual(body)
    expect(paragraphs.filter((paragraph) => paragraph.forceEpisodeBreakBefore)).toHaveLength(1)
    expect(paragraphs.filter((paragraph) => paragraph.forceShotBreakBefore)).toHaveLength(1)
    expect(paragraphs[0]).toMatchObject({ forceEpisodeBreakBefore: true, forceShotBreakBefore: true })
  })

  it.each(['scene', 'beat'] as const)(
    'keeps dialogue-only chunks once in %s shots without copying speech into action',
    (mode) => {
      const paragraphs = expandLongScriptParagraphs(
        splitScriptParagraphs(`场次：S01｜场景：档案室｜角色：林澈｜对白：${dialogue.join('；')}`),
      )
      const shots = (mode === 'scene' ? splitScriptIntoSceneShots : splitScriptIntoBeatShots)(
        paragraphs,
        120,
        true,
      )
      expect(shots.length).toBeGreaterThan(1)
      const prompt = shots.map((shot) => shot.prompt).join('\n')
      for (const line of dialogue) expect(prompt.split(line).length - 1).toBe(1)
      expect(prompt).not.toContain('动作：')
    },
  )
})
