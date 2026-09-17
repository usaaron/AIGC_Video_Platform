import { describe, expect, it } from 'vitest'
import { cleanShotContinuityNote, cleanStoryboardPrompt } from './storyboardPrompt.js'
import { compileStoryboardVideoPrompt } from './videoPromptCompiler.js'

const ACTION = '陈默压低声音开口；陈默朝老周走了三步；老周转身向铁皮亭后门小跑，陈默站在原地，右手握拳。'
const LEGACY = [
  '场次：S01',
  `剧情：本镜叙事目的：建立场景空间、威胁来源和人物目标；本镜只推进：${ACTION}`,
  '镜头任务：建立场景空间、威胁来源和人物目标',
  '目标：角色完成当前可见行动',
  '阻力：当前环境或对手阻碍角色推进',
  '变化：动作结束后角色状态发生可见变化',
  '场景：废弃东街，白天，外景',
  '角色：陈默、老周',
  '镜头隔离：只执行本镜的镜头内容和对白；不得执行其他镜头',
  `镜头内容：${ACTION}`,
  '对白：[对白]陈默：有人来了。',
  '运镜：固定机位',
  '执行时序：0-1秒确认首帧和人物位置，最后1秒固定尾帧',
  '衔接：人物位置、视线、服装、物件和光线状态交给下一镜',
  '人物外形参考【图1】，场景参考【图2】。',
].join('｜')

describe('legacy storyboard prompt compatibility', () => {
  it('removes generated scaffolding but retains each action, dialogue and reference instruction', () => {
    const cleaned = cleanStoryboardPrompt(LEGACY)
    expect(cleaned).not.toMatch(
      /本镜叙事目的|本镜只推进|镜头任务|目标：|阻力：|变化：|镜头隔离|执行时序|交给下一镜/u,
    )
    expect(cleaned.match(/陈默压低声音开口/gu)).toHaveLength(1)
    expect(cleaned).toContain(ACTION)
    expect(cleaned).toContain('对白：[对白]陈默：有人来了。')
    expect(cleaned).toContain('运镜：固定机位')
    expect(cleaned).toContain('人物外形参考【图1】，场景参考【图2】。')
    expect(cleanStoryboardPrompt(cleaned)).toBe(cleaned)
  })

  it('leaves custom prose, timelines and purposeful dialogue untouched', () => {
    const custom = '0-2秒：陈默说：“本镜只推进这个动作是什么意思？”\n2-5秒：镜头任务：拍清他手里的字条。'
    expect(cleanStoryboardPrompt(custom)).toBe(custom)
    const quoted = '对白：陈默问：“剧情：本镜叙事目的：建立场景空间，这是什么意思？”'
    expect(cleanStoryboardPrompt(quoted)).toBe(quoted)
    expect(cleanStoryboardPrompt('目标：找出藏在桌下的钥匙｜动作：陈默蹲下')).toBe(
      '目标：找出藏在桌下的钥匙｜动作：陈默蹲下',
    )
  })

  it('does not include chopped previous actions or future scene outcomes as opening state', () => {
    const note = [
      '上一镜已完成；首帧直接承接该镜真实尾帧，不得重演、解释或复述上一镜已经完成的事件。',
      '上一镜终态：场景在废弃东街；人物为陈默、老周；已完成色短寸头上沾着碎玻璃渣。',
      '本镜动作起点：场景为废弃东街；画内人物为陈默、老周；陈默停在亭边，右手握拳；随后只执行陈默压低声音开口。',
      '人物位置、视线、动作方向、服装、关键物品和光线保持连续；本镜直接执行自己的主动作。',
      '本镜结束时保留清晰的结束姿态、视线落点和物件状态，供下一镜真实尾帧直接承接。',
      '本镜所在场次的最终出场状态：老周转身离开。',
    ].join('\n')
    expect(cleanShotContinuityNote(note, 'continue')).toBe('开场：陈默停在亭边，右手握拳')
    expect(cleanShotContinuityNote(note, 'independent')).toBe('')
    expect(cleanShotContinuityNote('陈默右手仍拿着旧铁盒。', 'continue')).toBe('陈默右手仍拿着旧铁盒。')
  })

  it('uses the same cleaned text in provider requests and preserves tail-frame reference offsets', () => {
    const result = compileStoryboardVideoPrompt({
      project: { aspectRatio: '9:16', contentType: 'short-drama' },
      shot: { id: 's', duration: 10, prompt: LEGACY },
      continuityMode: 'continue',
      manualReferenceCount: 2,
    })
    expect(result).toContain(ACTION)
    expect(result.match(/陈默压低声音开口/gu)).toHaveLength(1)
    expect(result).toContain('人物外形参考【图2】，场景参考【图3】。')
    expect(result).toContain('输入图1（上一镜尾帧）')
    expect(result).not.toMatch(/本镜叙事目的|本镜只推进|每 2 到 3 秒|只完成一个主动作/u)
    expect(result.length).toBeLessThan(800)
  })
})
