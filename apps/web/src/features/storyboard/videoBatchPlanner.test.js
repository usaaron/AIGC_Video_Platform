import { describe, expect, it } from 'vitest'
import { activeVideoTasksForShots, isCompatibleCompletedVideoTask, planVideoBatch } from './videoBatchPlanner'

describe('planVideoBatch', () => {
  it('never splits one continuation chain just to fill concurrency', () => {
    const plan = planVideoBatch(shots(6), 'parallel', 3)

    expect(plan.lanes.map((lane) => lane.map((shot) => shot.id))).toEqual([
      ['shot-1', 'shot-2', 'shot-3', 'shot-4', 'shot-5', 'shot-6'],
    ])
    expect(plan.continuityUpdates).toEqual([])
    expect(plan.immediateLaneCount).toBe(1)
  })

  it('preserves scene boundaries that already form three independent lanes', () => {
    const source = shots(6).map((shot, index) => ({
      ...shot,
      continuityMode: index % 2 === 0 ? 'independent' : 'continue',
    }))

    const plan = planVideoBatch(source, 'parallel', 3)

    expect(plan.lanes.map((lane) => lane.map((shot) => shot.id))).toEqual([
      ['shot-1', 'shot-2'],
      ['shot-3', 'shot-4'],
      ['shot-5', 'shot-6'],
    ])
    expect(plan.continuityUpdates).toEqual([])
  })

  it('starts a separate serial lane at every episode boundary', () => {
    const source = shots(4).map((shot, index) => ({
      ...shot,
      episodeNumber: index < 2 ? 1 : 2,
    }))

    const plan = planVideoBatch(source, 'parallel', 3)

    expect(plan.lanes.map((lane) => lane.map((shot) => shot.id))).toEqual([
      ['shot-1', 'shot-2'],
      ['shot-3', 'shot-4'],
    ])
    expect(plan.continuityUpdates).toEqual([{ shotId: 'shot-3', continuityMode: 'independent' }])
  })

  it('turns continuity mode into one explicit full-film chain', () => {
    const source = shots(4).map((shot) => ({ ...shot, continuityMode: 'independent' }))
    const plan = planVideoBatch(source, 'continuity', 3)

    expect(plan.lanes).toHaveLength(1)
    expect(plan.lanes[0].map((shot) => shot.continuityMode)).toEqual([
      'independent',
      'continue',
      'continue',
      'continue',
    ])
    expect(plan.continuityUpdates).toEqual([
      { shotId: 'shot-2', continuityMode: 'continue' },
      { shotId: 'shot-3', continuityMode: 'continue' },
      { shotId: 'shot-4', continuityMode: 'continue' },
    ])
    expect(plan.immediateLaneCount).toBe(1)
  })

  it('turns every shot into its own lane for explicit independent generation', () => {
    const plan = planVideoBatch(shots(4), 'independent', 100)

    expect(plan.lanes.map((lane) => lane.map((shot) => shot.id))).toEqual([
      ['shot-1'],
      ['shot-2'],
      ['shot-3'],
      ['shot-4'],
    ])
    expect(plan.lanes.flat().map((shot) => shot.continuityMode)).toEqual([
      'independent',
      'independent',
      'independent',
      'independent',
    ])
    expect(plan.continuityUpdates).toEqual([
      { shotId: 'shot-2', continuityMode: 'independent' },
      { shotId: 'shot-3', continuityMode: 'independent' },
      { shotId: 'shot-4', continuityMode: 'independent' },
    ])
    expect(plan.immediateLaneCount).toBe(4)
  })

  it('respects the free-plan single lane limit', () => {
    const plan = planVideoBatch(shots(4), 'parallel', 1)

    expect(plan.lanes).toHaveLength(1)
    expect(plan.immediateLaneCount).toBe(1)
  })

  it('locks a storyboard while any visible video task is active', () => {
    const source = shots(2)
    const tasks = [
      { kind: 'video', status: 'queued', metadata: { shotId: 'shot-1' } },
      { kind: 'video', status: 'paused', metadata: { shotId: 'shot-2' } },
      { kind: 'video', status: 'cancelled', metadata: { shotId: 'shot-3' } },
      { kind: 'video', status: 'running', metadata: { shotId: 'shot-1', queueHiddenAt: 'deleted' } },
    ]

    expect(activeVideoTasksForShots(tasks, source)).toHaveLength(2)
  })

  it('only reuses a completed task when its batch inputs still match', () => {
    const task = {
      kind: 'video',
      status: 'completed',
      metadata: {
        shotId: 'shot-1',
        referenceAssetIds: ['character-1'],
        resolution: '720p',
        continuityMode: 'continue',
        continuitySourceTaskId: 'shot-0-task',
      },
    }

    expect(
      isCompatibleCompletedVideoTask(task, {
        shotId: 'shot-1',
        referenceAssetIds: ['character-1'],
        resolution: '720p',
        continuityMode: 'continue',
        previousTaskId: 'shot-0-task',
      }),
    ).toBe(true)
    expect(
      isCompatibleCompletedVideoTask(task, {
        shotId: 'shot-1',
        referenceAssetIds: ['character-1'],
        resolution: '720p',
        continuityMode: 'independent',
      }),
    ).toBe(false)
  })
})

function shots(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `shot-${index + 1}`,
    order: index + 1,
    continuityMode: index === 0 ? 'independent' : 'continue',
  }))
}
