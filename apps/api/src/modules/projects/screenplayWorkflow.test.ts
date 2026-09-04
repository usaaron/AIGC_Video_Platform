import { describe, expect, it } from 'vitest'
import { extractScriptAssetNameIndex } from './assetSuggestions.js'
import { splitScriptIntoSmartSceneShots } from './directorShotPlanning.js'
import { completeWebSeriesSpokenContent } from './scriptWriting.js'
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
    expect(shots[1]?.prompt).toContain('用左手连续下压门把两次')
    expect(shots[1]?.prompt).toContain('林晚：锁死了。')
  })

  it('keeps temporary prop states out of reusable asset names', () => {
    const script =
      '场次：S01｜场景：废弃药店｜角色：林晚｜关键物件：旧铁盒、盒盖暗扣扣紧、已露出半截、盒盖敞开｜动作：林晚打开旧铁盒。'

    expect(extractScriptAssetNameIndex(script).prop).toEqual(['旧铁盒'])
  })

  it('adds a voiceover without duplicating existing natural dialogue', () => {
    const scene = `场次：S01｜废弃药店｜深夜｜内景｜20秒
林晚站在南侧门内，右手握紧铁棍。
程野：“后门能走吗？”
林晚：“我先去确认。”`

    const completed = completeWebSeriesSpokenContent(scene, 'web-series')

    expect(completed).toContain('画外音：“')
    expect(completed.match(/程野：“后门能走吗？”/gu)).toHaveLength(1)
    expect(completed.match(/林晚：“我先去确认。”/gu)).toHaveLength(1)
  })
})
