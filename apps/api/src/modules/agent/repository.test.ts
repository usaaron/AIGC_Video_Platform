import type { AgentPlan, Principal } from '@seqora/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { AgentRunRepository } from './repository.js'

const principal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

describe('AgentRunRepository in-memory fallback', () => {
  let store: AppStore
  let repository: AgentRunRepository

  beforeEach(async () => {
    store = new AppStore(null)
    await store.initialize()
    repository = new AgentRunRepository(null, store)
  })

  it('confirms idempotently and creates exactly one project', async () => {
    const draft = await repository.savePlan({ originalPrompt: '完整要求', plan: completePlan(), principal })
    const confirmed = await repository.confirm(draft.id, 'confirm-1', principal)
    const replayed = await repository.confirm(draft.id, 'confirm-1', principal)

    expect(replayed.projectId).toBe(confirmed.projectId)
    expect(
      store.read((state) => state.projects.filter((project) => project.id === confirmed.projectId)),
    ).toHaveLength(1)
  })

  it('does not expose runs across users', async () => {
    const draft = await repository.savePlan({ originalPrompt: '完整要求', plan: completePlan(), principal })
    const stranger = { ...principal, userId: 'user-owner', roles: ['owner'] as const }
    await expect(repository.find(draft.id, stranger)).resolves.toBeNull()
    await expect(repository.list(stranger)).resolves.toEqual([])
  })

  it('pauses, resumes, and retries only the current failed stage', async () => {
    const draft = await repository.savePlan({ originalPrompt: '完整要求', plan: completePlan(), principal })
    const confirmed = await repository.confirm(draft.id, 'confirm-control', principal)
    const paused = await repository.requestPause(confirmed.id, principal)
    expect(paused.status).toBe('paused')
    const resumed = await repository.resume(confirmed.id, principal)
    expect(resumed.status).toBe('queued')

    resumed.status = 'failed'
    resumed.currentStage = 'asset-generation'
    const failedStage = resumed.stages.find((stage) => stage.key === 'asset-generation')!
    failedStage.status = 'failed'
    failedStage.error = 'upstream failed'
    await repository.claimNext('test-owner')
    await repository.saveClaimed(resumed, 'test-owner')
    const retried = await repository.retry(resumed.id, principal)
    expect(retried.status).toBe('queued')
    expect(retried.stages.find((stage) => stage.key === 'asset-generation')).toMatchObject({
      status: 'pending',
      attempt: 1,
      error: null,
    })
  })

  it('only permits a failed, degradable current stage to be skipped', async () => {
    const draft = await repository.savePlan({ originalPrompt: '完整要求', plan: completePlan(), principal })
    const confirmed = await repository.confirm(draft.id, 'confirm-skip', principal)
    await expect(repository.skip(confirmed.id, 'video-generation', principal)).rejects.toMatchObject({
      code: 'AGENT_STAGE_REQUIRED',
    })
    await expect(repository.skip(confirmed.id, 'asset-analysis', principal)).rejects.toMatchObject({
      code: 'AGENT_STAGE_NOT_SKIPPABLE',
    })

    confirmed.status = 'failed'
    confirmed.currentStage = 'asset-generation'
    const failedStage = confirmed.stages.find((stage) => stage.key === 'asset-generation')!
    failedStage.status = 'failed'
    failedStage.error = 'provider failed'
    await repository.claimNext('skip-owner')
    await repository.saveClaimed(confirmed, 'skip-owner')

    const skipped = await repository.skip(confirmed.id, 'asset-generation', principal)
    expect(skipped.stages.find((stage) => stage.key === 'asset-generation')?.status).toBe('skipped')
    expect(skipped.status).toBe('queued')
    expect(skipped.currentStage).toBe('identity-baseline')
  })
})

function completePlan(): AgentPlan {
  return {
    contentType: 'web-series',
    durationSeconds: 60,
    episodeDurationSeconds: 60,
    episodeCount: 1,
    aspectRatio: '9:16',
    visualStyle: 'cinematic-cg',
    storyBrief: '女孩在末班地铁醒来并发现时间循环。',
    projectName: '末班循环',
    missingFields: [],
    estimate: {
      scriptCredits: 4,
      assetCredits: 20,
      videoCredits: 270,
      totalCredits: 294,
      estimatedShots: 15,
      estimatedAssets: 4,
      estimatedEpisodes: 1,
      minMinutes: 30,
      maxMinutes: 90,
    },
  }
}
