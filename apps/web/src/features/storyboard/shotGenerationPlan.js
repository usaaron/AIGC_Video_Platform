import { completedVideoTaskForShot, latestVideoTaskForShot } from '../generation/taskResults'

export const SHOT_VIDEO_CREDITS = 18

export function batchGenerationPlan(shots, tasks, credits = 0) {
  const items = shots
    .map((shot) => {
      const task = latestVideoTaskForShot(tasks, shot.id)
      const completed = completedVideoTaskForShot(tasks, shot.id)
      if (completed || task?.status === 'queued' || task?.status === 'running') return null
      return {
        shot,
        action: task?.status === 'failed' || task?.status === 'cancelled' ? 'retry' : 'create',
      }
    })
    .filter(Boolean)
  const estimatedCredits = items.length * SHOT_VIDEO_CREDITS
  return {
    items,
    estimatedCredits,
    canSubmit: items.length > 0 && credits >= estimatedCredits,
    skippedCount: shots.length - items.length,
  }
}
