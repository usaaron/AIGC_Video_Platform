import { describe, expect, it } from 'vitest'
import {
  classifyEpisodeContentRelationship,
  disambiguateEpisodeTitle,
  findDuplicateEpisodeContent,
  normalizeEpisodeContent,
} from './episodeTitle.js'

describe('episode title and content safeguards', () => {
  it('normalizes headings and whitespace when checking exact duplicate bodies', () => {
    expect(normalizeEpisodeContent('第 33 集\n白宫地下核对封锁圈数字并确认审核权限。')).toBe(
      '白宫地下核对封锁圈数字并确认审核权限。',
    )
    expect(
      findDuplicateEpisodeContent('第34集 白宫地下 核对封锁圈数字并确认审核权限。', [
        { id: 'episode-33', episodeNumber: 33, content: '第33集\n白宫地下核对封锁圈数字并确认审核权限。' },
      ]),
    ).toMatchObject({ id: 'episode-33' })
  })

  it('adds a numeric suffix when a distinct episode reuses a title', () => {
    const existing = [{ id: 'episode-33', title: 'THE NUMBERS SHE RAN｜她经手的数字' }]
    expect(disambiguateEpisodeTitle('THE NUMBERS SHE RAN｜她经手的数字', 34, existing)).toBe(
      'THE NUMBERS SHE RAN｜她经手的数字（2）',
    )
  })

  it('rejects paraphrased copies but keeps a visible state transition as an upper/lower continuation', () => {
    const first =
      'Maya与Nadia已经决定把封锁圈内的数字记录公开。材料准备完毕但尚未发布。指挥道要求审查权限，Maya没有发言，Nadia接管调度。目标是让Nadia公开完整调度记录。冲突是公开清单的条件尚未满足。'
    const paraphrase =
      'Maya和Nadia决定向城市频道公布封锁区数字档案。资料已经备妥却还没有发布。指挥道提出审核授权，Maya保持沉默，Nadia控制现场调度。目标仍是公开完整调度记录，公开条件依旧没有完成。'
    expect(classifyEpisodeContentRelationship(first, paraphrase)).toBe('duplicate')

    const lower =
      'Nadia公开的现场数字卡已经进入城市频道，公开后调度记录显示频道开始核对现场人数。Maya改为整理公开版本，Nadia继续控制调度。下一步是按频道核对来源。'
    expect(classifyEpisodeContentRelationship(first, lower)).toBe('continuation')
  })

  it('keeps long-form continuation imports while still rejecting exact repeats', () => {
    const first = `${'Maya and Owen hold the underground communications floor. '.repeat(40)}The command center remains sealed.`
    const continuation = `${'Maya and Owen hold the underground communications floor. '.repeat(39)}Maya sends the decoded signal upstairs and the command center opens one channel.`
    expect(findDuplicateEpisodeContent(continuation, [{ id: 'episode-1', content: first }], undefined, {
      longFormExactOnly: true,
    })).toBeUndefined()
    expect(findDuplicateEpisodeContent(first, [{ id: 'episode-1', content: first }], undefined, {
      longFormExactOnly: true,
    })).toMatchObject({ id: 'episode-1' })
  })

  it('does not keep stacking suffixes when the candidate already has one', () => {
    const existing = [{ id: 'episode-33', title: '公开前的核验（1）' }]
    expect(disambiguateEpisodeTitle('公开前的核验（2）', 34, existing)).toBe('公开前的核验（2）')
  })
})
