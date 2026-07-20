import { describe, expect, it } from 'vitest'
import { batchGenerationPlan } from './shotGenerationPlan'

const shot = (id) => ({ id, order: 1, title: id, duration: 4 })
const task = (shotId, status) => ({
  id: `${shotId}-${status}`,
  kind: 'video',
  status,
  metadata: { shotId },
  outputs: status === 'completed' ? [{ url: '/done.mp4', mediaType: 'video' }] : [],
})

describe('shot generation plan', () => {
  it('charges only shots that need a create or retry action', () => {
    const plan = batchGenerationPlan(
      [shot('a'), shot('b'), shot('c')],
      [task('b', 'completed'), task('c', 'failed')],
      36,
    )

    expect(plan.items.map((item) => [item.shot.id, item.action])).toEqual([
      ['a', 'create'],
      ['c', 'retry'],
    ])
    expect(plan.estimatedCredits).toBe(36)
    expect(plan.canSubmit).toBe(true)
  })

  it('blocks batch submit when credits are insufficient', () => {
    const plan = batchGenerationPlan([shot('a'), shot('b')], [], 18)

    expect(plan.estimatedCredits).toBe(36)
    expect(plan.canSubmit).toBe(false)
  })
})
