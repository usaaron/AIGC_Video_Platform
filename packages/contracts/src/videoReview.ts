import { z } from 'zod'

export const reviewVideoSchema = z
  .object({
    decision: z.enum(['approved', 'rejected', 'pending']),
    note: z.string().trim().max(1000).default(''),
    expectedUpdatedAt: z.string().datetime(),
  })
  .refine((input) => input.decision !== 'rejected' || input.note.length > 0, {
    message: '请填写画面问题，便于修复',
    path: ['note'],
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

type StoredMediaVersion =
  | {
      storageKey: string
      contentType: string
      size: number
      sha256: string
    }
  | 'invalid'
  | null

function storedMediaVersion(
  value: Record<string, unknown>,
  storageKey: unknown,
  kind: 'video' | 'image',
): StoredMediaVersion {
  if (value.sha256 === undefined || value.sha256 === null) return null
  if (
    typeof storageKey !== 'string' ||
    !storageKey ||
    value.storageKey !== storageKey ||
    typeof value.contentType !== 'string' ||
    !value.contentType.startsWith(`${kind}/`) ||
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  )
    return 'invalid'
  return { storageKey, contentType: value.contentType, size: value.size, sha256: value.sha256 }
}

function outputMediaVersion(
  meta: Record<string, unknown>,
  view: string,
  storageKey: unknown,
  kind: 'video' | 'image',
): StoredMediaVersion {
  if (!Array.isArray(meta.generatedOutputs)) return null
  const candidates = meta.generatedOutputs.filter((item): item is Record<string, unknown> =>
    Boolean(item && typeof item === 'object' && item.view === view),
  )
  if (!candidates.some((item) => item.sha256 !== undefined && item.sha256 !== null)) return null
  // Match the actual served view and key; duplicate or shadow descriptors cannot preserve approval.
  if (candidates.length !== 1) return 'invalid'
  return storedMediaVersion(candidates[0]!, storageKey, kind)
}

function storedMediaVersions(task: ReviewableVideo) {
  const meta = task.metadata ?? {}
  return {
    video:
      task.provider === 'seedance' ? outputMediaVersion(meta, 'single', meta.videoStorageKey, 'video') : null,
    tail: outputMediaVersion(meta, 'last-frame', meta.lastFrameStorageKey, 'image'),
    preview:
      task.provider === 'local-compose'
        ? storedMediaVersion(
            {
              storageKey: meta.previewStorageKey,
              contentType: meta.previewContentType,
              size: meta.previewSize,
              sha256: meta.previewSha256,
            },
            meta.previewStorageKey,
            'video',
          )
        : null,
  }
}

/** Approval belongs to this media version, not to a shot or a provider success flag. */
export function videoReviewVersion(task: ReviewableVideo): string {
  const meta = task.metadata ?? {}
  const post = meta.localPostprocess as { outputSha256?: string; tailSha256?: string } | undefined
  const version: unknown[] = [
    task.id,
    meta.videoStorageKey,
    meta.lastFrameStorageKey,
    meta.compiledPromptHash,
    post?.outputSha256,
    post?.tailSha256,
    task.resultUrl,
  ]
  const stored = storedMediaVersions(task)
  // Preserve the exact historical version string until an ingestion checksum is present.
  if (Object.values(stored).some((value) => value !== null)) version.push(stored)
  return JSON.stringify(version)
}

export function videoReviewState(
  task: ReviewableVideo | null | undefined,
): 'pending' | 'approved' | 'rejected' {
  if (!task || task.status !== 'completed') return 'pending'
  if (Object.values(storedMediaVersions(task)).includes('invalid')) return 'pending'
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
  if (
    status === 'passed' ||
    status === 'failed' ||
    status === 'needs-evidence' ||
    status === 'pending-evidence'
  )
    return status
  return 'pending-evidence'
}
