import { describe, expect, it } from 'vitest'
import { splitScriptIntoBeatShots, splitScriptParagraphs, type ShotDraft } from './shotPlanning.js'

function scene(actions: string, dialogue: string, number = 'S01') {
  return `场次：${number}｜场景：档案室｜角色：甲、乙｜动作：${actions}｜对白：${dialogue}`
}

function dialogueFields(shots: ShotDraft[]) {
  return shots.map((shot) =>
    shot.prompt
      .split('\n')
      .find((line) => line.startsWith('对白：'))
      ?.slice(3),
  )
}

const cues = [
  '[对白]甲：第一句确认身份。',
  '[对白]乙：第二句说明来意。',
  '[对白]甲：第三句提出要求。',
  '[对白]乙：第四句解释条件。',
  '[对白]甲：第五句答应合作。',
]

describe('action shot dialogue coverage', () => {
  it('keeps all three ordered lines when a scene has only one action', () => {
    const shots = splitScriptIntoBeatShots(
      splitScriptParagraphs(scene('甲推开门', cues.slice(0, 3).join('；'))),
      12,
      true,
    )

    expect(shots).toHaveLength(1)
    expect(dialogueFields(shots)).toEqual([cues.slice(0, 3).join('；')])
    expect(shots[0]?.prompt).toContain('动作：甲推开门')
  })

  it('distributes surplus whole cues across existing action shots without omissions or duplicates', () => {
    const shots = splitScriptIntoBeatShots(
      splitScriptParagraphs(scene('动作1：甲推开门；动作2：乙递出档案', cues.join('；'))),
      12,
      true,
    )

    expect(shots).toHaveLength(2)
    expect(dialogueFields(shots)).toEqual([cues.slice(0, 3).join('；'), cues.slice(3).join('；')])
    expect(shots[0]?.prompt).toContain('动作1：甲推开门')
    expect(shots[1]?.prompt).toContain('动作2：乙递出档案')
    expect(shots.every((shot) => shot.duration >= 3 && shot.duration <= 15)).toBe(true)
  })

  it('retains sparse dialogue on the first action and leaves later actions silent', () => {
    const shots = splitScriptIntoBeatShots(
      splitScriptParagraphs(scene('动作1：甲推开门；动作2：甲停下；动作3：乙转身', cues[0]!)),
      12,
      true,
    )

    expect(shots).toHaveLength(3)
    expect(dialogueFields(shots)).toEqual([cues[0], '无台词', '无台词'])
  })

  it('keeps current scene dialogue when the existing shot limit cuts off its later actions', () => {
    const shots = splitScriptIntoBeatShots(
      splitScriptParagraphs(scene('动作1：甲推开门；动作2：乙转身；动作3：甲接过档案', cues.join('；'))),
      2,
      true,
    )

    expect(shots).toHaveLength(2)
    expect(dialogueFields(shots)).toEqual([cues.slice(0, 3).join('；'), cues.slice(3).join('；')])
    expect(shots[1]?.prompt).toContain('动作2：乙转身')
    expect(shots.map((shot) => shot.prompt).join('\n')).not.toContain('动作3：甲接过档案')
  })

  it('keeps dialogue attached to its own scene and emits each sound cue only once', () => {
    const sound = '[音效]门锁弹开；[环境声]窗外雨声'
    const next = '[画外音]甲：第二场的线索出现了。'
    const shots = splitScriptIntoBeatShots(
      splitScriptParagraphs(
        [
          scene('甲推开门', `${cues.slice(0, 3).join('；')}；${sound}`),
          scene('乙翻开档案', next, 'S02'),
        ].join('\n'),
      ),
      12,
      true,
    )

    expect(shots).toHaveLength(2)
    expect(dialogueFields(shots)).toEqual([`${cues.slice(0, 3).join('；')}；${sound}`, next])
  })

  it('retains a long utterance with its punctuation and performance cue under the existing duration cap', () => {
    const longCue = `[对白]甲：（压低声音）${'我们必须先核对档案，再决定怎样保护证人。'.repeat(8)}；这段话还没有说完。`
    const shots = splitScriptIntoBeatShots(splitScriptParagraphs(scene('甲推开门', longCue)), 12, true)

    expect(shots).toHaveLength(1)
    expect(dialogueFields(shots)).toEqual([longCue])
    expect(shots[0]?.duration).toBe(15)
  })
})
