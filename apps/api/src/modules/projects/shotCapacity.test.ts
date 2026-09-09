import type { Principal } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { ProjectService } from './service.js'
import { splitScriptIntoBeatShots, splitScriptParagraphs } from './shotPlanning.js'

const principal: Principal = { userId: 'test-user', tenantId: 'test-tenant', roles: ['creator'] }
const script = Array.from(
  { length: 4 },
  (_, index) => `场次：S0${index + 1}｜场景：车站${index + 1}｜动作：林夏打开第${index + 1}个信封。`,
).join('\n\n')

describe('storyboard capacity', () => {
  it.each(['scene', 'beat'] as const)(
    'preserves existing shots when %s planning exceeds capacity',
    async (mode) => {
      const repository = {
        workspace: vi.fn(async () => ({ project: { contentType: 'animation', script }, assets: [] })),
        replaceShots: vi.fn(),
      }
      const service = new ProjectService(repository as never)

      await expect(
        service.generateShots('test-project', { mode, maxShots: 3, episodeDurationSeconds: 60 }, principal),
      ).rejects.toMatchObject({ code: 'SHOT_LIMIT_EXCEEDED' })
      expect(repository.replaceShots).not.toHaveBeenCalled()
    },
  )

  it('checks all saved episodes before replacing any episode shots', async () => {
    const repository = {
      workspace: vi.fn(async () => ({
        project: { contentType: 'short-drama', script },
        assets: [],
        scriptEpisodes: [
          { id: 'episode-1', episodeNumber: 1, status: 'saved', content: script.split('\n\n')[0] },
          { id: 'episode-2', episodeNumber: 2, status: 'saved', content: script },
        ],
      })),
      replaceShots: vi.fn(),
      replaceEpisodeShots: vi.fn(),
    }
    const service = new ProjectService(repository as never)

    await expect(
      service.generateShots(
        'test-project',
        { mode: 'scene', maxShots: 3, episodeDurationSeconds: 60 },
        principal,
      ),
    ).rejects.toMatchObject({ code: 'SHOT_LIMIT_EXCEEDED' })
    expect(repository.replaceShots).not.toHaveBeenCalled()
    expect(repository.replaceEpisodeShots).not.toHaveBeenCalled()
  })

  it('keeps action beats after the fourth beat and every remaining dialogue cue', () => {
    const actions = Array.from(
      { length: 5 },
      (_, index) => `动作${index + 1}：林夏打开第${index + 1}个信封`,
    ).join('；')
    const dialogue = Array.from({ length: 7 }, (_, index) => `林夏：线索${index + 1}`).join('；')
    const shots = splitScriptIntoBeatShots(
      splitScriptParagraphs(`场次：S01｜场景：车站｜动作：${actions}｜对白：${dialogue}`),
      120,
      true,
    )

    expect(shots).toHaveLength(5)
    expect(shots[4]?.prompt).toContain('第5个信封')
    expect(shots[4]?.prompt).toContain('线索7')
  })
})
