import { describe, expect, it } from 'vitest'
import { extractScriptAssetNameIndex } from './assetSuggestions.js'
import { splitScriptIntoSmartSceneShots } from './directorShotPlanning.js'
import {
  completeWebSeriesSpokenContent,
  quickScriptIssues,
  webSeriesDialoguePlan,
  webSeriesDialogueRequirement,
} from './scriptWriting.js'
import { parseShotFields, splitScriptParagraphs } from './shotPlanning.js'

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
    expect(shots[0]?.prompt).toContain('林晚：门能进，跟我走。')
    expect(shots[0]?.prompt).toContain('程野：它们来了……')
    expect(shots[0]?.prompt).not.toContain('她快步跨到程野身侧')
    expect(shots[0]?.prompt).not.toContain('林晚：先进去再说')

    expect(shots[1]?.prompt).toContain('她快步跨到程野身侧')
    expect(shots[1]?.prompt).toContain('林晚回头瞥向东侧路口')
    expect(shots[1]?.prompt).toContain('林晚：先进去再说')
    expect(shots[1]?.prompt).not.toContain('雨刚停，巷子里积着浅水')
    expect(shots[1]?.prompt).not.toContain('林晚：门能进，跟我走。')
    expect(shots[1]?.prompt).not.toContain('程野：它们来了……')
  })

  it('allocates about four ordered dialogue cues to each director shot', () => {
    const [scene] = splitScriptParagraphs(SINGLE_SCENE_WITH_DENSE_DIALOGUE)
    const shots = splitScriptIntoSmartSceneShots([scene!], 120, true)

    expect(webSeriesDialoguePlan(20)).toMatchObject({ shotCount: 2, minimum: 6, target: 8, maximum: 10 })
    expect(webSeriesDialogueRequirement(20)).toContain('8 句左右')
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

  it('reports dialogue density gaps without manufacturing repeated lines', () => {
    const script =
      '场次：S01｜时长：20秒｜剧情：林晚确认药店后门状态。｜场景：废弃药店。｜角色：林晚、程野｜动作：林晚观察后门。｜对白：[对白]林晚：我先确认。'

    expect(quickScriptIssues(script, 'web-series', 20)).toEqual(
      expect.arrayContaining([expect.stringContaining('S01 当前仅有 1 句可听对白')]),
    )
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
