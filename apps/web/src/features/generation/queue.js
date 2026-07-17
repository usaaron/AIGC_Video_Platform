export const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
})

export function advanceQueue(jobs, concurrency, progressIncrement = () => 15) {
  const runningCount = jobs.filter((job) => job.status === JOB_STATUS.RUNNING).length
  let availableSlots = Math.max(0, concurrency - runningCount)

  return jobs.map((job) => {
    if (job.status === JOB_STATUS.QUEUED && availableSlots > 0) {
      availableSlots -= 1
      return { ...job, status: JOB_STATUS.RUNNING, progress: 8 }
    }

    if (job.status !== JOB_STATUS.RUNNING) return job

    const progress = Math.min(100, job.progress + progressIncrement())
    return {
      ...job,
      progress,
      status: progress >= 100 ? JOB_STATUS.COMPLETED : JOB_STATUS.RUNNING,
    }
  })
}
