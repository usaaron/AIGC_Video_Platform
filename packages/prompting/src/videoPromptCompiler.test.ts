import { describe, expect, it } from 'vitest'
import {
  compileStoryboardVideoPrompt,
  normalizedVideoDuration,
  VIDEO_PROMPT_VERSION,
  type PromptShot,
} from './videoPromptCompiler.js'

describe('compileStoryboardVideoPrompt', () => {
  it('combines a focused shot beat, asset identity and continuity rules', () => {
    const shots = [
      shot('shot-1', '场景：雨夜旧火车站。'),
      shot('shot-2', '对白：（林夏）“胶片在哪里？”', '特写', 2),
      shot('shot-3', '动作：周野将旧铁盒放在长椅上。'),
    ]
    const assets = [
      {
        id: 'lin',
        kind: 'character',
        name: '林夏',
        description: '28岁短发女导演',
        prompt: '短发，深色风衣，透明雨伞，电影感',
      },
      {
        id: 'station',
        kind: 'scene',
        name: '三号站台',
        description: '废弃海边火车站',
        prompt: '雨夜，湿润铁轨，远处暖色信号灯',
      },
    ]

    const prompt = compileStoryboardVideoPrompt({
      project: {
        aspectRatio: '9:16',
        script: '场景：雨夜旧火车站。\n对白：（林夏）“胶片在哪里？”\n动作：周野将旧铁盒放在长椅上。',
      },
      shot: shots[1]!,
      shots,
      assets,
      references: [{ id: 'lin' }, { id: 'station' }],
    })

    expect(VIDEO_PROMPT_VERSION).toBe('seedance-storyboard-v5')
    expect(prompt).toContain('连续4秒、9:16画幅')
    expect(prompt).toContain('【当前镜头】镜头，特写')
    expect(prompt).toContain('上一镜结束：场景：雨夜旧火车站。')
    expect(prompt).toContain('下一镜开始：周野将旧铁盒放在长椅上。')
    expect(prompt).not.toContain('【剧本上下文】')
    expect(prompt).toContain('人物“林夏”保持参考图中的脸')
    expect(prompt).toContain('场景“三号站台”保持结构')
    expect(prompt).toContain('自然眨眼、呼吸、转头')
    expect(prompt).toContain('不是静止图片，不是幻灯片')
    expect(prompt).toContain('禁止突然切镜、跳时、回切和蒙太奇')
  })

  it('adds an explicit first-frame continuity rule for linked shots', () => {
    const linkedShot = {
      ...shot('shot-2', '人物转身向门口走去'),
      continuityNote: '上一场人物右手握住门把手，本场从向下压门把手继续。',
    }
    const prompt = compileStoryboardVideoPrompt({
      project: { aspectRatio: '16:9' },
      shot: linkedShot,
      shots: [shot('shot-1', '人物抬手开门'), linkedShot],
      continuityMode: 'continue',
    })

    expect(prompt).toContain('【镜头衔接】严格承接上一镜头尾帧')
    expect(prompt).toContain('【场景衔接上下文】上一场人物右手握住门把手')
  })

  it('keeps one action beat and bounds a production prompt', () => {
    const prompt = compileStoryboardVideoPrompt({
      project: { aspectRatio: '9:16', script: '很长的剧本'.repeat(1_000) },
      shot: shot(
        'shot-long',
        `场景：雨夜站台${'空间细节'.repeat(100)}｜角色：林夏${'人物设定'.repeat(100)}｜动作：林夏踏入积水；她举起信封；挂钟突然倒转｜风格：国漫二维｜构图：大全景｜光影：冷白顶光｜运镜：缓慢推进`,
        '大全景',
        8,
      ),
    })

    expect(prompt).toContain('动作：林夏踏入积水')
    expect(prompt).not.toContain('她举起信封')
    expect(prompt.length).toBeLessThan(2_000)
  })
})

describe('normalizedVideoDuration', () => {
  it('uses Seedance-safe durations', () => {
    expect(normalizedVideoDuration(2)).toBe(4)
    expect(normalizedVideoDuration(8)).toBe(8)
    expect(normalizedVideoDuration(30)).toBe(15)
    expect(normalizedVideoDuration('invalid')).toBe(5)
  })
})

function shot(id: string, prompt: string, framing = '中景', duration = 5): PromptShot {
  return { id, title: '镜头', prompt, framing, duration }
}
