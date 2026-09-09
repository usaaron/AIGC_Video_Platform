import { describe, expect, it } from 'vitest'
import { extractScriptAssetNameIndex } from './assetSuggestions.js'
import { splitScriptIntoSmartSceneShots } from './directorShotPlanning.js'
import {
  completeWebSeriesSpokenContent,
  quickScriptIssues,
  webSeriesDialoguePlan,
  webSeriesDialogueRequirement,
  webSeriesSceneBudget,
} from './scriptWriting.js'
import {
  expandLongScriptParagraphs,
  parseShotFields,
  splitScriptParagraphs,
  spokenDialogueCues,
} from './shotPlanning.js'

const READABLE_SCRIPT = `资产：
人物：林晚｜性别：女｜年龄段：青年｜年龄：28岁｜身份：急诊医生｜固定外形：黑色齐肩短发、清瘦
场景：废弃药店｜空间：室内｜时代：现代｜固定布局：南侧卷帘门、北侧后门、西侧药柜
物品：旧铁盒｜分类：容器｜材质：金属｜颜色：暗灰｜固定结构：暗扣盒盖
正文：

场次：S01｜废弃药店｜深夜｜内景｜20秒

卷帘门外十余只丧尸连续撞门。林晚站在南侧门内，右手把铁棍横卡进门框，左手按住震动的门板。程野靠在西侧药柜旁，双手压住腹部伤口。
程野：“后门能走吗？”
林晚先回头看向北侧窄门，再沿中央过道快跑过去，用左手连续下压门把两次，确认锁舌没有退开。
林晚：“锁死了。”
[音效]门锁发出两次短促金属响声。
林晚转身跑回西侧药柜，停在程野右侧半蹲下来。

场次：S02｜废弃药店储物间｜深夜｜内景｜20秒

林晚扶着程野从东侧小门进入储物间，两人停在北墙货架前。
画外音：“他们只剩一条路。”
程野：“灯要灭了。”`

const SINGLE_SCENE_WITH_ORDERED_DIALOGUE = `场次：S01｜药店后巷｜傍晚｜外景｜20秒
雨刚停，巷子里积着浅水。林晚小步快走从南口进入，水声随脚步溅起，她停在积水边，侧头望向药店后门方向，那里传来低沉撞击声及模糊呼救声。她握紧左手的铁棍，沿右墙向前探，在巷口拐角停止，看见翻倒货架斜靠墙边，程野侧躺在货架空隙间，胸前夹克有深色湿痕。远处东侧街口隐约有密集挪动身影，缓慢朝巷里聚拢。林晚压低身，快速扫视后门，确认门体半掩、没有锁栓，先伸手试一试，门微微晃动，确认能推开。她快步跨到程野身侧，弯腰将铁棍插进后腰，双手拽住程野腋下，用力向后拖。程野皱眉睁眼，抬起满是血污的手指向后门。
林晚：“门能进，跟我走。”
程野：“它们来了……”
林晚回头瞥向东侧路口，黑影数量已近二十，距离约四十米。
林晚：“先进去再说。”`

const SINGLE_SCENE_WITH_DENSE_DIALOGUE = `场次：S01｜药店后巷｜傍晚｜外景｜20秒
雨刚停，林晚从南口进入窄巷，沿右墙快步靠近药店后门。东侧街口传来连续脚步声，程野在翻倒货架后抬头看她。
程野：“你从南口来？”
林晚：“东街已经封死。”
程野：“后门能进去吗？”
林晚：“我先确认。”
林晚按住左手铁棍，贴着右墙走到北侧后门，先用右手试压门把，再低头看锁舌没有退开。
林晚：“门没有锁栓。”
程野：“那就快拖我。”
林晚回头看见东侧黑影逼近，俯身抓住程野腋下向后拖。
程野：“别松手，林晚。”
林晚：“抓紧我的肩。”`

describe('readable screenplay workflow', () => {
  it('parses scene metadata, action, dialogue, and sound without visible production fields', () => {
    const paragraphs = splitScriptParagraphs(READABLE_SCRIPT)
    const first = parseShotFields(paragraphs[0]!.text)

    expect(paragraphs).toHaveLength(2)
    expect(first).toMatchObject({
      场次: 'S01',
      时长: '20秒',
      场景: '废弃药店，深夜，内景',
      角色: '程野、林晚',
    })
    expect(first.动作).toContain('用左手连续下压门把两次')
    expect(first.对白).toContain('[对白]程野：后门能走吗？')
    expect(first.对白).toContain('[对白]林晚：锁死了。')
    expect(first.声音).toContain('[音效]门锁发出两次短促金属响声。')
  })

  it('turns a readable 20-second scene into two semantic director shots', () => {
    const [scene] = splitScriptParagraphs(READABLE_SCRIPT)
    const shots = splitScriptIntoSmartSceneShots([scene!], 120, true)

    expect(shots).toHaveLength(2)
    expect(shots.map((shot) => shot.duration)).toEqual([10, 10])
    expect(shots[0]?.prompt).toContain('卷帘门外十余只丧尸连续撞门')
    expect(shots[0]?.prompt).toContain('程野：后门能走吗？')
    expect(shots[0]?.prompt).not.toContain('林晚：先进去再说')
    expect(shots[0]?.prompt).not.toContain('用左手连续下压门把两次')
    expect(shots[1]?.prompt).toContain('用左手连续下压门把两次')
    expect(shots[1]?.prompt).toContain('林晚：锁死了。')
    expect(shots[1]?.prompt).not.toContain('卷帘门外十余只丧尸连续撞门')
    expect(shots[1]?.prompt).not.toContain('林晚：门能进，跟我走。')
    expect(shots[1]?.prompt).not.toContain('程野：后门能走吗？')
    expect(shots[0]?.prompt).toContain('镜头隔离：只执行本镜的镜头内容和对白')
  })

  it('keeps each natural scene shot and its dialogue cues disjoint', () => {
    const [scene] = splitScriptParagraphs(SINGLE_SCENE_WITH_ORDERED_DIALOGUE)
    const shots = splitScriptIntoSmartSceneShots([scene!], 120, true)

    expect(shots).toHaveLength(2)
    expect(shots[0]?.prompt).toContain('雨刚停，巷子里积着浅水')
    expect(shots[0]?.prompt).not.toContain('林晚：门能进，跟我走。')
    expect(shots[0]?.prompt).not.toContain('程野：它们来了……')
    expect(shots[0]?.prompt).not.toContain('她快步跨到程野身侧')
    expect(shots[0]?.prompt).not.toContain('林晚：先进去再说')

    expect(shots[1]?.prompt).toContain('她快步跨到程野身侧')
    expect(shots[1]?.prompt).toContain('林晚回头瞥向东侧路口')
    expect(shots[1]?.prompt).toContain('林晚：先进去再说')
    expect(shots[1]?.prompt).not.toContain('雨刚停，巷子里积着浅水')
    expect(shots[1]?.prompt).toContain('林晚：门能进，跟我走。')
    expect(shots[1]?.prompt).toContain('程野：它们来了……')
  })

  it('keeps dialogue at the action that prompted it without a fixed per-shot quota', () => {
    const [scene] = splitScriptParagraphs(SINGLE_SCENE_WITH_DENSE_DIALOGUE)
    const shots = splitScriptIntoSmartSceneShots([scene!], 120, true)

    expect(webSeriesDialoguePlan(20)).toMatchObject({ shotCount: 2, minimum: 0, target: 3, maximum: 6 })
    expect(webSeriesDialogueRequirement(20)).toContain('给动作和反应留出时间')
    expect(shots).toHaveLength(2)
    expect(shots[0]?.prompt.match(/\[对白\]/gu) || []).toHaveLength(4)
    expect(shots[1]?.prompt.match(/\[对白\]/gu) || []).toHaveLength(4)
    expect(shots[0]?.prompt).toContain('程野：你从南口来？')
    expect(shots[0]?.prompt).toContain('林晚：我先确认。')
    expect(shots[0]?.prompt).not.toContain('程野：别松手，林晚。')
    expect(shots[1]?.prompt).toContain('林晚：门没有锁栓。')
    expect(shots[1]?.prompt).toContain('程野：别松手，林晚。')
    expect(shots[1]?.prompt).toContain('林晚：抓紧我的肩。')
    expect(shots[1]?.prompt).not.toContain('程野：你从南口来？')
  })

  it('reports repeated dialogue without manufacturing extra lines', () => {
    const script =
      '场次：S01｜时长：20秒｜剧情：林晚确认药店后门状态。｜场景：废弃药店。｜角色：林晚、程野｜动作：林晚观察后门。｜对白：[对白]林晚：我先确认。；[对白]林晚：我先确认。'

    expect(quickScriptIssues(script, 'web-series', 20)).toEqual(
      expect.arrayContaining([expect.stringContaining('S01 存在重复对白')]),
    )
  })

  it('keeps the camera on evidence when dialogue accompanies a detail shot', () => {
    const scene =
      '场次：S01｜候车室｜深夜｜内景｜10秒\n陈默翻过照片，露出背面今天的日期。\n陈默：这是今天拍的。'
    const [shot] = splitScriptIntoSmartSceneShots(splitScriptParagraphs(scene), 120, true)
    expect(shot?.framing).toBe('特写')
    expect(shot?.prompt).toContain('不因说话而移开关键细节')
    expect(shot?.prompt).not.toContain('推近说话者面部')
  })

  it('keeps action, dialogue, and sound ownership together across a scene', () => {
    const scene = `场次：S01｜控制室｜深夜｜内景｜24秒
林晚刷卡，读卡器亮起红灯。
林晚：“权限被取消了。”
[音效]读卡器报警。
程野指向屏幕，屏幕显示有人远程锁门。
程野：“是里面的人。”
[音效]机械锁落下。
林晚拔出电源，屏幕熄灭，她转向通风口。
林晚：“换条路。”`
    const shots = splitScriptIntoSmartSceneShots(splitScriptParagraphs(scene), 120, true)
    const fields = shots.map((shot) => parseShotFields(shot.prompt))
    const allCues = fields.flatMap((field) => spokenDialogueCues(field.对白))
    expect(allCues).toEqual(spokenDialogueCues(parseShotFields(scene).对白))
    for (const [action, dialogue, sound] of [
      ['读卡器亮起红灯', '权限被取消了', '读卡器报警'],
      ['有人远程锁门', '是里面的人', '机械锁落下'],
      ['拔出电源', '换条路', ''],
    ]) {
      const owners = shots.filter((shot) => shot.prompt.includes(action!))
      expect(owners).toHaveLength(1)
      expect(owners[0]?.prompt).toContain(dialogue!)
      if (sound) expect(owners[0]?.prompt).toContain(sound)
    }
  })

  it('does not cap a 50-second scene at three shots or lose its final event', () => {
    const scene = `场次：S01｜控制室｜深夜｜内景｜50秒\n${Array.from({ length: 8 }, (_, index) => `林晚检查第${index + 1}号信号，记录新的坐标。`).join('\n')}`
    const shots = splitScriptIntoSmartSceneShots(splitScriptParagraphs(scene), 120, true)
    expect(shots).toHaveLength(4)
    expect(shots.reduce((sum, shot) => sum + shot.duration, 0)).toBe(50)
    expect(shots.every((shot) => shot.duration >= 3 && shot.duration <= 15)).toBe(true)
    for (let index = 1; index <= 8; index += 1) {
      expect(shots.filter((shot) => shot.prompt.includes(`第${index}号信号`))).toHaveLength(1)
    }
    expect(shots[0]?.continuityMode).toBe('independent')
    expect(shots.slice(1).every((shot) => shot.continuityMode === 'continue')).toBe(true)
  })

  it('honors short scene durations instead of replacing every scene with a generic five seconds', () => {
    const script = `场次：S01｜控制室｜深夜｜内景｜7秒\n林晚按下按钮。\n[音效]屏幕轻响。
场次：S02｜走廊｜深夜｜内景｜12秒\n程野推开窗，停在窗边。\n[音效]风吹动窗框。`
    const shots = splitScriptIntoSmartSceneShots(splitScriptParagraphs(script), 120, true)
    expect(shots.map((shot) => shot.duration)).toEqual([7, 12])
    expect(shots.map((shot) => shot.continuityMode)).toEqual(['independent', 'independent'])
  })

  it('does not expand one under-specified action into two invented versions', () => {
    const scene = '场次：S01｜控制室｜深夜｜内景｜20秒\n林晚关上门。'
    const shots = splitScriptIntoSmartSceneShots(splitScriptParagraphs(scene), 120, true)
    expect(shots).toHaveLength(1)
    expect(shots[0]?.prompt).not.toContain('本场后半段行动')
  })

  it('preserves long natural scenes before director planning without copying dialogue into chunks', () => {
    const source = `场次：S01｜控制室｜深夜｜内景｜50秒\n${'林晚检查信号，程野记录坐标。\n'.repeat(75)}林晚：“现在出发。”`
    const paragraphs = splitScriptParagraphs(source)
    expect(expandLongScriptParagraphs(paragraphs)).toEqual(paragraphs)
    const shots = splitScriptIntoSmartSceneShots(paragraphs, 120, true)
    expect(shots.filter((shot) => shot.prompt.includes('现在出发'))).toHaveLength(1)
  })

  it('uses a duration-based range for episodes and accepts deliberate nonverbal scenes', () => {
    expect(webSeriesSceneBudget(60)).toEqual({ minimum: 3, target: 5, maximum: 8 })
    expect(webSeriesSceneBudget(120).target).toBeGreaterThan(webSeriesSceneBudget(60).target)
    const source = '场次：S01｜控制室｜深夜｜内景｜8秒\n林晚屏住呼吸，门把缓慢转动。\n[音效]门锁轻响。'
    expect(completeWebSeriesSpokenContent(source, 'web-series')).toBe(source)
    expect(quickScriptIssues(source, 'web-series', 30).join('')).not.toContain('缺少“对白”')
    const withoutSound = source.split('\n[音效]')[0]!
    const completed = completeWebSeriesSpokenContent(withoutSound, 'web-series')
    expect(completed).not.toContain('不能在这里停下')
    expect(completed).not.toContain('[内心独白]')
    expect(completed).toContain('[音效]')
  })

  it('keeps temporary prop states out of reusable asset names', () => {
    const script =
      '场次：S01｜场景：废弃药店｜角色：林晚｜关键物件：旧铁盒、盒盖暗扣扣紧、已露出半截、盒盖敞开｜动作：林晚打开旧铁盒。'

    expect(extractScriptAssetNameIndex(script).prop).toEqual(['旧铁盒'])
  })

  it('does not turn visible actions into a redundant voiceover', () => {
    const scene = `场次：S01｜废弃药店｜深夜｜内景｜20秒
林晚站在南侧门内，右手握紧铁棍。
程野：“后门能走吗？”
林晚：“我先去确认。”`

    const completed = completeWebSeriesSpokenContent(scene, 'web-series')

    expect(completed).not.toContain('画外音：“')
    expect(completed.match(/程野：“后门能走吗？”/gu)).toHaveLength(1)
    expect(completed.match(/林晚：“我先去确认。”/gu)).toHaveLength(1)
  })
})
