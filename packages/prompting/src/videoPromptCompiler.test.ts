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

    expect(VIDEO_PROMPT_VERSION).toBe('seedance-storyboard-v11')
    expect(prompt).toContain('连续4秒、9:16画幅')
    expect(prompt).toContain('【当前镜头】镜头，特写')
    expect(prompt).not.toContain('上一镜结束：场景：雨夜旧火车站。')
    expect(prompt).not.toContain('下一镜开始：周野将旧铁盒放在长椅上。')
    expect(prompt).not.toContain('【前后镜头】')
    expect(prompt).not.toContain('【剧本上下文】')
    expect(prompt).toContain('人物“林夏”保持参考图中的脸')
    expect(prompt).toContain('场景“三号站台”保持结构')
    expect(prompt).toContain('自然眨眼、呼吸、转头')
    expect(prompt).toContain('【群像表演】')
    expect(prompt).toContain('【声音执行】')
    expect(prompt).toContain('不要输出静音视频')
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
    expect(prompt).toContain('第一张是唯一的上一镜真实尾帧')
    expect(prompt).toContain('不得用后续参考图重构首帧')
    expect(prompt).toContain('【场景衔接上下文】上一场人物右手握住门把手')
  })

  it('does not leak continuity text into an independent shot', () => {
    const prompt = compileStoryboardVideoPrompt({
      project: { aspectRatio: '9:16' },
      shot: {
        ...shot('episode-2-shot-1', '新一集：岚星走入观景桥。'),
        continuityNote: '上一集结尾：岚星被守卫按倒在地，导航环掉入积水。',
      },
      continuityMode: 'independent',
    })

    expect(prompt).toContain('【独立镜头】')
    expect(prompt).not.toContain('上一集结尾')
    expect(prompt).not.toContain('【场景衔接上下文】')
  })

  it('keeps one executable primary action and bounds a production prompt', () => {
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
    expect(prompt).toContain('【主动作】必须完整拍完这一项')
    expect(prompt.length).toBeLessThan(4_000)
  })

  it('passes scene objectives, pressure and entry or exit state to the video model', () => {
    const prompt = compileStoryboardVideoPrompt({
      project: { aspectRatio: '9:16', contentType: 'short-drama' },
      shot: shot(
        'director-shot',
        '目标：岚星确认异常来源｜阻力：巡逻守卫正在接近｜变化：坐标指向导航环｜入场状态：岚星停在左侧护栏旁｜动作：岚星抬眼看向异常光点｜出场状态：岚星右手握住导航环，视线锁定坐标',
        '中景',
        4,
      ),
    })

    expect(prompt).toContain('场次目标：岚星确认异常来源')
    expect(prompt).toContain('场次阻力：巡逻守卫正在接近')
    expect(prompt).toContain('场次变化：坐标指向导航环')
    expect(prompt).toContain('入场状态：岚星停在左侧护栏旁')
    expect(prompt).toContain('出场状态：岚星右手握住导航环')
  })

  it('lets a linked costume override only the character clothing', () => {
    const prompt = compileStoryboardVideoPrompt({
      project: { aspectRatio: '16:9' },
      shot: shot('battle', '角色：侠客｜动作：侠客握刀起身'),
      assets: [
        { id: 'hero', kind: 'character', name: '侠客', prompt: '灰色常服，黑色长靴' },
        {
          id: 'damaged-costume',
          kind: 'costume',
          name: '轻度战损变体',
          prompt: '黑色古装，肩部破损',
          attributes: { type: 'costume', characterAssetId: 'hero' },
        },
      ],
      references: [{ id: 'hero' }, { id: 'damaged-costume' }],
    })

    expect(prompt).toContain('服装造型以服装资产“轻度战损变体”为唯一准则')
    expect(prompt).toContain('不得退回人物参考图中的旧服装')
  })

  it('preserves an explicit director timeline without conflicting single-action rules', () => {
    const source = [
      '场次：S02｜时长：5秒｜场景：废弃戏楼屋顶｜战斗前基础状态。',
      '',
      '侠客位于画面左侧，雷霆人位于画面右侧。',
      '',
      '0-1.5秒：低机位拍摄中央积水，细窄电流贴着水面爬行。',
      '1.5-2.5秒：镜头沿水面抬升，侠客摘下斗笠并掷出。',
      '2.5-4秒：镜头跟随斗笠，雷霆人抬起左前臂挡中边缘。',
      '4-5秒：碎片离开画面，双方保持结束姿态。',
    ].join('\n')
    const prompt = compileStoryboardVideoPrompt({
      project: { aspectRatio: '16:9', contentType: 'short-drama' },
      shot: shot('timeline', source, '低机位', 5),
    })

    expect(prompt).toContain('【导演时间轴（最高优先级）】')
    expect(prompt).toContain(source)
    expect(prompt).toContain('严格逐段执行导演时间轴')
    expect(prompt).not.toContain('本镜只完成一个主动作')
    expect(prompt).not.toContain('【主动作】')
    expect(prompt).not.toContain('【时间推进】0-1秒')
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
