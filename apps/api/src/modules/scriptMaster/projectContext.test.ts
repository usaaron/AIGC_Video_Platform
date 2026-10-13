import { describe, expect, it } from 'vitest'
import { normalizeScriptMasterProjectContext } from './projectContext.js'

const host = {
  name: '外星人攻打白宫',
  synopsis: '主项目已确认的故事方向。',
  episodeDurationSeconds: 90,
}

describe('Script Master project context', () => {
  it('keeps host title and duration authoritative while accepting a non-empty source synopsis', () => {
    expect(
      normalizeScriptMasterProjectContext(host, {
        title: ' 外星人攻打白宫 ',
        synopsis: '剧本大师整理后的完整故事梗概。',
        episodeDurationSeconds: 90,
      }),
    ).toEqual({
      name: '外星人攻打白宫',
      synopsis: '剧本大师整理后的完整故事梗概。',
      episodeDurationSeconds: 90,
    })
  })

  it('rejects title and duration drift before the import can write', () => {
    expect(() => normalizeScriptMasterProjectContext(host, { title: '另一部作品' })).toThrowError(
      expect.objectContaining({ code: 'IMPORT_PROJECT_TITLE_MISMATCH' }),
    )
    expect(() => normalizeScriptMasterProjectContext(host, { episodeDurationSeconds: 60 })).toThrowError(
      expect.objectContaining({ code: 'IMPORT_PROJECT_DURATION_MISMATCH' }),
    )
  })

  it('uses the host synopsis when source is blank and a body excerpt only when both are empty', () => {
    expect(normalizeScriptMasterProjectContext(host, { synopsis: '   ' }).synopsis).toBe(host.synopsis)
    expect(
      normalizeScriptMasterProjectContext(
        { ...host, synopsis: '' },
        undefined,
        '  第一集：白宫上空出现异象，城市进入封锁。\n第二拍继续追查。  ',
      ).synopsis,
    ).toBe('第一集：白宫上空出现异象，城市进入封锁。 第二拍继续追查。')
  })

  it('fills a missing host duration from a valid source context and otherwise uses the compatibility default', () => {
    expect(
      normalizeScriptMasterProjectContext(
        { ...host, episodeDurationSeconds: undefined },
        { episodeDurationSeconds: 75 },
      ).episodeDurationSeconds,
    ).toBe(75)
    expect(
      normalizeScriptMasterProjectContext({ ...host, episodeDurationSeconds: undefined }, undefined)
        .episodeDurationSeconds,
    ).toBe(60)
  })
})
