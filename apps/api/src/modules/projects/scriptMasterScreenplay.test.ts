import { describe, expect, it } from 'vitest'
import { FORCE_EPISODE_BREAK_MARKER } from '@seqora/contracts'
import { normalizeScriptMasterScreenplay } from './scriptMasterScreenplay.js'
import { parseShotFields, splitScriptParagraphs } from './shotPlanning.js'
import { splitScriptIntoSmartSceneShots } from './directorShotPlanning.js'

function exported(body: string, episode = 1) {
  return `第${episode}集《原件》\n\n预计时长：90秒\n\n本集信息\n\n剧情梗概：保留原件。\n\n场景清单：\n\n1. INT. 档案室 日\n\n正式正文\n\nFADE IN / 淡入：\n\n${body}\n\nFADE OUT / 淡出。\n`
}

describe('Script Master exported screenplay adaptation', () => {
  it('adapts revised exports without old generated information and preserves current scenes and dialogue', () => {
    const script = `第1集《复核》\n\n预计时长：90秒\n\n正式正文\n\nFADE IN / 淡入：\n\nINT. 阅览室 - 夜\n\n△ 顾砚将复核完成的资料整齐放回桌面。\n\n顾砚\n\n（低声）\n\n请按新编号保存。\n\nEXT. 旧码头 - 日\n\n△ 陆青接过资料。\n\n陆青\n\n全部编号已核对。\n\nFADE OUT / 淡出。\n`
    const paragraphs = splitScriptParagraphs(script)
    expect(paragraphs).toHaveLength(2)
    const first = parseShotFields(paragraphs[0]!.text)
    const second = parseShotFields(paragraphs[1]!.text)
    expect(first.场景).toBe('阅览室 - 夜，内景')
    expect(first.动作).toContain('顾砚将复核完成的资料整齐放回桌面。')
    expect(first.对白).toContain('顾砚：（低声）请按新编号保存。')
    expect(first.角色).toBe('顾砚')
    expect(second.场景).toBe('旧码头 - 日，外景')
    expect(second.动作).toContain('陆青接过资料。')
    expect(second.对白).toContain('陆青：全部编号已核对。')
    const shots = splitScriptIntoSmartSceneShots(paragraphs, 120, true)
    const prompts = shots.map((shot) => shot.prompt).join('\n')
    expect(prompts).toContain('顾砚将复核完成的资料整齐放回桌面。')
    expect(prompts).toContain('请按新编号保存。')
    expect(prompts).toContain('全部编号已核对。')
    expect(prompts).not.toMatch(/预计时长|正式正文|本集信息|FADE/)
  })

  it('groups the actual body into scenes without generating shots for export metadata', () => {
    const script = exported(
      'INT. 档案室 日\n\n△ 林岚打开信封。\n\n林岚\n\n（低声）\n\n请记录原件编号。\n\nEXT. 车站 夜\n\n△ 周原收好原件。',
    )
    const paragraphs = splitScriptParagraphs(script)
    expect(paragraphs).toHaveLength(2)
    const first = parseShotFields(paragraphs[0]!.text)
    expect(first.场景).toBe('档案室 日，内景')
    expect(first.动作).toContain('林岚打开信封。')
    expect(first.对白).toContain('林岚：（低声）请记录原件编号。')
    expect(first.角色).toBe('林岚')
    const shots = splitScriptIntoSmartSceneShots(paragraphs, 120, true)
    expect(shots).toHaveLength(2)
    expect(shots.map((shot) => shot.prompt).join('\n')).not.toMatch(/预计时长|本集信息|场景清单|FADE/)
    expect(script).toContain('本集信息')
  })

  it('retains English scene headings, long speaker names, voice cues and bilingual dialogue', () => {
    const script = exported(
      'INT. ARCHIVE ROOM - NIGHT\n\n△ The archivist opens the envelope.\n\nChristopher Morrison (V.O.)\n\n(quietly)\n\nKeep the original.\n\n中文：保留原件。\n\nEXT. STATION - DAY\n\n△ He leaves the station.',
    )
    const paragraphs = splitScriptParagraphs(script)
    expect(paragraphs).toHaveLength(2)
    const first = parseShotFields(paragraphs[0]!.text)
    expect(first.场景).toContain('ARCHIVE ROOM - NIGHT')
    expect(first.角色).toBe('Christopher Morrison')
    expect(first.对白).toContain('（V.O.）(quietly)Keep the original. 中文：保留原件。')
    expect(parseShotFields(paragraphs[1]!.text).场景).toContain('STATION - DAY')
  })

  it('preserves episode boundaries across multiple exported episodes', () => {
    const script = [
      exported('INT. 档案室 日\n\n△ 核对编号。'),
      exported('EXT. 车站 夜\n\n△ 交接原件。', 2),
    ].join(`\n${FORCE_EPISODE_BREAK_MARKER}\n`)
    const paragraphs = splitScriptParagraphs(script)
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[1]!.forceEpisodeBreakBefore).toBe(true)
    expect(parseShotFields(paragraphs[0]!.text).动作).toContain('核对编号')
    expect(parseShotFields(paragraphs[1]!.text).动作).toContain('交接原件')
  })

  it('keeps visible action with a colon out of character dialogue', () => {
    const script = exported('INT. 档案室 日\n\n△ 手机屏幕显示：原件已上传。\n\n林岚\n\n收到原件。')
    const fields = parseShotFields(splitScriptParagraphs(script)[0]!.text)
    expect(fields.动作).toContain('△ 手机屏幕显示：原件已上传。')
    expect(fields.对白).toContain('林岚：收到原件。')
    expect(fields.对白).not.toContain('手机屏幕')
    expect(fields.角色).toBe('林岚')
  })

  it('keeps every line of a single speaker dialogue in dialogue rather than action', () => {
    const script = exported(
      'INT. 档案室 日\n\n△ 林岚看向门口。\n\n林岚\n\n（低声）\n\n第一行台词。\n第二行台词。\n\n△ 她收起手机。',
    )
    const fields = parseShotFields(splitScriptParagraphs(script)[0]!.text)
    expect(fields.对白).toContain('林岚：（低声）第一行台词。 第二行台词。')
    expect(fields.动作).toContain('林岚看向门口')
    expect(fields.动作).toContain('她收起手机')
    expect(fields.动作).not.toMatch(/第一行台词|第二行台词/u)
    expect(fields.角色).toBe('林岚')
  })

  it('preserves combined interior and exterior scene locations', () => {
    for (const heading of ['INT./EXT.', 'INT. / EXT.', 'EXT./INT.']) {
      const script = exported(`${heading} 汽车 日\n\n△ 林岚打开车窗。`)
      const fields = parseShotFields(splitScriptParagraphs(script)[0]!.text)
      expect(fields.场景).toBe('汽车 日，内外景')
      expect(fields.动作).toContain('林岚打开车窗')
    }
  })

  it('keeps regular scene format, ordinary prose and incomplete wrappers untouched', () => {
    for (const script of [
      '场次：S01｜档案室｜深夜｜内景｜10秒\n林岚打开信封。\n林岚：“保留原件。”',
      '林岚写下正式正文四字。\nINT. 是她学习的场景标记。',
      exported('INT. 档案室 日\n\n△ 原稿。').replace('FADE OUT / 淡出。', '作者尚未写完'),
    ])
      expect(normalizeScriptMasterScreenplay(script)).toBe(script)
    const fields = parseShotFields(
      splitScriptParagraphs('场次：S01｜档案室｜深夜｜内景｜10秒\n林岚打开信封。\n林岚：“保留原件。”')[0]!
        .text,
    )
    expect(fields.时长).toBe('10秒')
    expect(fields.对白).toContain('保留原件')
  })

  it('does not consume an action or a new scene as a missing dialogue line', () => {
    const normalized = normalizeScriptMasterScreenplay(
      exported('INT. 档案室 日\n\n林岚\n\n△ 她没有开口。\n\nEXT. 车站 夜\n\n△ 她离开了。'),
    )
    expect(normalized).toContain('林岚\n△ 她没有开口。')
    expect(splitScriptParagraphs(normalized)).toHaveLength(2)
  })
})
