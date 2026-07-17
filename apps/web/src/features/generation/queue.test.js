import { describe, expect, it } from 'vitest'
import { advanceQueue, JOB_STATUS } from './queue'

const queuedJobs = Array.from({ length: 4 }, (_, index) => ({
  id: String(index),
  status: JOB_STATUS.QUEUED,
  progress: 0,
}))

describe('advanceQueue', () => {
  it('starts one task for a free account', () => {
    const result = advanceQueue(queuedJobs, 1)

    expect(result.filter((job) => job.status === JOB_STATUS.RUNNING)).toHaveLength(1)
    expect(result.filter((job) => job.status === JOB_STATUS.QUEUED)).toHaveLength(3)
  })

  it('starts three tasks for a member account', () => {
    const result = advanceQueue(queuedJobs, 3)

    expect(result.filter((job) => job.status === JOB_STATUS.RUNNING)).toHaveLength(3)
    expect(result.filter((job) => job.status === JOB_STATUS.QUEUED)).toHaveLength(1)
  })

  it('marks a running task complete at 100 percent', () => {
    const jobs = [{ id: 'active', status: JOB_STATUS.RUNNING, progress: 95 }]
    const result = advanceQueue(jobs, 1, () => 10)

    expect(result[0]).toMatchObject({ status: JOB_STATUS.COMPLETED, progress: 100 })
  })
})
