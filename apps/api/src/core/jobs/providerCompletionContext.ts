import { createHash } from 'node:crypto'
import type { GenerationTask } from '@seqora/contracts'

type CompletionContext = { leaseOwnerId: string; leaseToken: string; expiresAt: number }
const contexts = new Map<string, CompletionContext>()
const CONTEXT_TTL_MS = 5 * 60_000
const MAX_CONTEXTS = 1_024

function contextKey(task: GenerationTask): string | null {
  const receipt = task.metadata.providerCompletionReceipt
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null
  return createHash('sha256').update(JSON.stringify(receipt)).digest('hex')
}

/** Survives runtime task cloning without exposing worker lease credentials in metadata. */
export function registerProviderCompletionContext(
  task: GenerationTask,
  leaseOwnerId: string,
  leaseToken: string,
): void {
  const key = contextKey(task)
  if (!key || !leaseOwnerId || !leaseToken) return
  const now = Date.now()
  for (const [existingKey, context] of contexts) {
    if (context.expiresAt <= now) contexts.delete(existingKey)
  }
  contexts.delete(key)
  while (contexts.size >= MAX_CONTEXTS) contexts.delete(contexts.keys().next().value!)
  contexts.set(key, { leaseOwnerId, leaseToken, expiresAt: now + CONTEXT_TTL_MS })
}

export function findProviderCompletionContext(task: GenerationTask): CompletionContext | null {
  const key = contextKey(task)
  if (!key) return null
  const context = contexts.get(key)
  if (!context) return null
  if (context.expiresAt <= Date.now()) {
    contexts.delete(key)
    return null
  }
  return { ...context }
}

/** Call after commit, so a rolled-back completion can retry with the same source lease. */
export function clearProviderCompletionContext(task: GenerationTask): void {
  const key = contextKey(task)
  if (key) contexts.delete(key)
}
