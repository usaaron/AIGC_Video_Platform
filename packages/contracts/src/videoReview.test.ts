import { describe, expect, it } from 'vitest'
import {
  canUseVideoContinuity,
  reviewVideoSchema,
  videoReviewState,
  videoReviewVersion,
} from './videoReview.js'
describe('video review version boundary', () => {
  it('does not equate provider success or legacy output with approval', () => {
    const task = { id: 'v1', kind: 'video', provider: 'seedance', status: 'completed', metadata: {} }
    expect(canUseVideoContinuity(task)).toBe(false)
    task.metadata = { contentReview: { decision: 'approved' } }
    expect(videoReviewState(task)).toBe('pending')
  })
  it('invalidates approval after media replacement and does not pass it to a reroll', () => {
    const task = {
      id: 'v1',
      kind: 'video',
      provider: 'seedance',
      status: 'completed',
      metadata: { videoStorageKey: 'v1.mp4' } as Record<string, unknown>,
    }
    task.metadata.contentReview = { decision: 'approved', mediaVersion: videoReviewVersion(task) }
    expect(canUseVideoContinuity(task)).toBe(true)
    expect(canUseVideoContinuity({ ...task, id: 'v2' })).toBe(false)
    task.metadata.videoStorageKey = 'fixed.mp4'
    expect(canUseVideoContinuity(task)).toBe(false)
  })
  it('requires a problem description and optimistic version on review', () => {
    expect(
      reviewVideoSchema.safeParse({
        decision: 'rejected',
        note: '',
        expectedUpdatedAt: new Date().toISOString(),
      }).success,
    ).toBe(false)
    expect(reviewVideoSchema.safeParse({ decision: 'approved' }).success).toBe(false)
  })
})

describe('ingestion checksum review binding', () => {
  const videoKey = 'tenant/project/generated/v1-video.mp4'
  const tailKey = 'tenant/project/generated/v1-last-frame.jpg'
  const video = {
    view: 'single',
    storageKey: videoKey,
    contentType: 'video/mp4',
    size: 100,
    sha256: 'a'.repeat(64),
  }
  const tail = {
    view: 'last-frame',
    storageKey: tailKey,
    contentType: 'image/jpeg',
    size: 50,
    sha256: 'b'.repeat(64),
  }

  function reviewedTask(metadata: Record<string, unknown> = {}, provider = 'seedance') {
    const task = {
      id: 'v1',
      kind: 'video',
      provider,
      status: 'completed',
      resultUrl: '/api/v1/generation/tasks/v1/content',
      metadata: {
        videoStorageKey: videoKey,
        lastFrameStorageKey: tailKey,
        generatedOutputs: [{ ...video }, { ...tail }],
        ...metadata,
      } as Record<string, unknown>,
    }
    task.metadata.contentReview = { decision: 'approved', mediaVersion: videoReviewVersion(task) }
    return task
  }

  it('preserves the exact legacy version and approval when ingestion checksums are absent', () => {
    const task = reviewedTask({
      generatedOutputs: [
        { view: 'single', storageKey: videoKey, contentType: 'video/mp4', size: 100 },
        { view: 'last-frame', storageKey: tailKey, contentType: 'image/jpeg', size: 50, sha256: null },
      ],
      compiledPromptHash: 'prompt-hash',
      localPostprocess: { outputSha256: 'legacy-output', tailSha256: 'legacy-tail' },
    })
    expect(videoReviewVersion(task)).toBe(
      JSON.stringify([
        task.id,
        videoKey,
        tailKey,
        'prompt-hash',
        'legacy-output',
        'legacy-tail',
        task.resultUrl,
      ]),
    )
    expect(videoReviewState(task)).toBe('approved')
  })

  it.each([
    ['video checksum', { ...video, sha256: 'c'.repeat(64) }, tail],
    ['tail checksum', video, { ...tail, sha256: 'c'.repeat(64) }],
    ['size', { ...video, size: 101 }, tail],
    ['content type', { ...video, contentType: 'video/webm' }, tail],
    ['removed checksum', { ...video, sha256: undefined }, tail],
  ])('invalidates approval when the same object changes its %s', (_label, nextVideo, nextTail) => {
    const task = reviewedTask()
    expect(videoReviewState(task)).toBe('approved')
    task.metadata.generatedOutputs = [nextVideo, nextTail]
    expect(videoReviewState(task)).toBe('pending')
    expect(canUseVideoContinuity(task)).toBe(false)
  })

  it.each([
    ['mismatched key', [{ ...video, storageKey: 'another-video.mp4' }, tail]],
    ['duplicate descriptor', [video, { ...video }, tail]],
    ['shadow descriptor', [{ ...video, storageKey: 'another-video.mp4' }, video, tail]],
    ['malformed checksum', [{ ...video, sha256: 'not-a-checksum' }, tail]],
    ['invalid size', [{ ...video, size: 0 }, tail]],
  ])('keeps %s pending even if review metadata claims the current version', (_label, outputs) => {
    const task = reviewedTask()
    task.metadata.generatedOutputs = outputs
    expect(videoReviewState(task)).toBe('pending')
    task.metadata.contentReview = { decision: 'approved', mediaVersion: videoReviewVersion(task) }
    expect(videoReviewState(task)).toBe('pending')
    expect(canUseVideoContinuity(task)).toBe(false)
  })

  it('ignores unrelated image views and descriptor order when the current media stays the same', () => {
    const task = reviewedTask()
    const version = videoReviewVersion(task)
    task.metadata.generatedOutputs = [tail, { ...video, view: 'front', sha256: 'c'.repeat(64) }, video]
    expect(videoReviewVersion(task)).toBe(version)
    expect(videoReviewState(task)).toBe('approved')
  })

  it('binds a composed preview to its own stored checksum and descriptor', () => {
    const task = reviewedTask(
      {
        generatedOutputs: [],
        previewStorageKey: 'tenant/project/generated/v1-film-preview.mp4',
        previewContentType: 'video/mp4',
        previewSize: 200,
        previewSha256: 'd'.repeat(64),
      },
      'local-compose',
    )
    const previousVersion = videoReviewVersion(task)
    task.metadata.previewSha256 = 'e'.repeat(64)
    expect(videoReviewVersion(task)).not.toBe(previousVersion)
    expect(videoReviewState(task)).toBe('pending')
  })
})
