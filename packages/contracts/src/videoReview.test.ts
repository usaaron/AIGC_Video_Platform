import { describe, expect, it } from 'vitest'
import { canUseVideoContinuity, reviewVideoSchema, videoReviewState, videoReviewVersion } from './videoReview.js'
describe('video review version boundary', () => {
  it('does not equate provider success or legacy output with approval', () => {
    const task = {id:'v1',kind:'video',provider:'seedance',status:'completed',metadata:{}}
    expect(canUseVideoContinuity(task)).toBe(false)
    task.metadata = {contentReview:{decision:'approved'}}
    expect(videoReviewState(task)).toBe('pending')
  })
  it('invalidates approval after media replacement and does not pass it to a reroll', () => {
    const task = {id:'v1',kind:'video',provider:'seedance',status:'completed',metadata:{videoStorageKey:'v1.mp4'} as Record<string,unknown>}
    task.metadata.contentReview={decision:'approved',mediaVersion:videoReviewVersion(task)}
    expect(canUseVideoContinuity(task)).toBe(true)
    expect(canUseVideoContinuity({...task,id:'v2'})).toBe(false)
    task.metadata.videoStorageKey='fixed.mp4'
    expect(canUseVideoContinuity(task)).toBe(false)
  })
  it('requires a problem description and optimistic version on review', () => {
    expect(reviewVideoSchema.safeParse({decision:'rejected',note:'',expectedUpdatedAt:new Date().toISOString()}).success).toBe(false)
    expect(reviewVideoSchema.safeParse({decision:'approved'}).success).toBe(false)
  })
})
