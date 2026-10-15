import { isDeepStrictEqual } from 'node:util'
import type { GenerationTask } from '@seqora/contracts'
import { registerTextTaskControlPersistenceContext } from './textTaskPersistenceContext.js'

/** Refund bookkeeping owns only this field on the exact snapshot it refunded. */
export function markRefundedTask(current: GenerationTask, refunded: GenerationTask, now: string): boolean {
  if (!isDeepStrictEqual(current, refunded)) return false
  const before = structuredClone(current)
  current.metadata = {
    ...current.metadata,
    creditsRefundedAt:
      typeof current.metadata.creditsRefundedAt === 'string' ? current.metadata.creditsRefundedAt : now,
  }
  if (current.kind === 'text' && current.provider === 'text')
    registerTextTaskControlPersistenceContext(current, before)
  return true
}
