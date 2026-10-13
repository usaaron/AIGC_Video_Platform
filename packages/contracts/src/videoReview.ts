import { z } from 'zod'

export const reviewVideoSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'pending']),
  note: z.string().trim().max(1000).default(''),
  expectedUpdatedAt: z.string().datetime(),
}).refine(input => input.decision !== 'rejected' || input.note.length > 0, {
  message: '请填写画面问题，便于修复', path: ['note'],
})
export type ReviewVideo = z.infer<typeof reviewVideoSchema>

type ReviewableVideo = {
  id: string
  kind: string
  status: string
  provider: string
  resultUrl?: string | null
  metadata?: Record<string, unknown>
}

export function needsVideoReview(task: ReviewableVideo | null | undefined): boolean {
  return Boolean(task?.kind === 'video' && task.provider === 'seedance')
}

/** Approval belongs to this media version, not to a shot or a provider success flag. */
export function videoReviewVersion(task: ReviewableVideo): string {
  const meta = task.metadata ?? {}
  const post = meta.localPostprocess as { outputSha256?: string; tailSha256?: string } | undefined
  return JSON.stringify([task.id, meta.videoStorageKey, meta.lastFrameStorageKey,
    meta.compiledPromptHash, post?.outputSha256, post?.tailSha256, task.resultUrl])
}

export function videoReviewState(task: ReviewableVideo | null | undefined): 'pending' | 'approved' | 'rejected' {
  if (!task || task.status !== 'completed') return 'pending'
  const review = task.metadata?.contentReview as { decision?: string; mediaVersion?: string } | undefined
  if (review?.mediaVersion !== videoReviewVersion(task)) return 'pending'
  return review?.decision === 'approved' || review?.decision === 'rejected' ? review.decision : 'pending'
}

export function canUseVideoContinuity(task: ReviewableVideo | null | undefined): boolean {
  return Boolean(
    task &&
      task.status === 'completed' &&
      (!needsVideoReview(task) || videoReviewState(task) === 'approved') &&
      ['none', 'passed'].includes(physicalAuditState(task)),
  )
}

export type PhysicalAuditState = 'none' | 'pending-evidence' | 'needs-evidence' | 'failed' | 'passed'

/** Physical continuity is a separate gate from human content review. Legacy videos without a contract remain usable. */
export function physicalAuditState(task: ReviewableVideo | null | undefined): PhysicalAuditState {
  if (!task?.metadata || typeof task.metadata !== 'object') return 'none'
  const metadata = task.metadata
  const contract = metadata.rigidPhysicsContract
  const audit = metadata.rigidPhysicsAudit as { status?: unknown } | undefined
  if (!contract && !audit) return 'none'
  const status = audit?.status
  if (status === 'passed' || status === 'failed' || status === 'needs-evidence' || status === 'pending-evidence') return status
  return 'pending-evidence'
}
