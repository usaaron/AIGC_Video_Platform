import { createHash } from 'node:crypto'
import type { GenerationTask } from '@seqora/contracts'
import { normalizeGenerationTaskLifecycle } from './taskLease.js'
import { textTaskOperation, type TextTaskWriteGuard } from './textTaskExecutionGuard.js'

export type TextTaskPersistenceContext =
  | { kind: 'worker'; guard: TextTaskWriteGuard; expiresAt: number }
  | { kind: 'control'; previous: GenerationTask; expiresAt: number }

const contexts = new Map<string, TextTaskPersistenceContext>()
const CONTEXT_TTL_MS = 5 * 60_000
const MAX_CONTEXTS = 1_024

function isMainTextTask(task: GenerationTask): boolean {
  return task.kind === 'text' && task.provider === 'text' && !task.projectId.startsWith('sm-standalone-')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

function contextKey(task: GenerationTask): string | null {
  if (!isMainTextTask(task)) return null
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(normalizeGenerationTaskLifecycle(task))))
    .digest('hex')
}

function saveContext(key: string, context: TextTaskPersistenceContext): void {
  const now = Date.now()
  for (const [existingKey, existing] of contexts) {
    if (existing.expiresAt <= now) contexts.delete(existingKey)
  }
  contexts.delete(key)
  while (contexts.size >= MAX_CONTEXTS) contexts.delete(contexts.keys().next().value!)
  contexts.set(key, context)
}

/** Bind the exact outgoing snapshot to its original execution lease without public metadata. */
export function registerTextTaskPersistenceContext(task: GenerationTask, guard: TextTaskWriteGuard): void {
  const key = contextKey(task)
  if (
    !key ||
    !guard.leaseOwnerId ||
    !guard.leaseToken ||
    task.id !== guard.taskId ||
    task.tenantId !== guard.tenantId ||
    task.projectId !== guard.projectId ||
    task.userId !== guard.userId ||
    task.clientRequestId !== guard.clientRequestId ||
    (task.attempts ?? 0) !== guard.attempts ||
    textTaskOperation(task) !== guard.operation ||
    (task.model ?? null) !== guard.model ||
    !['running', 'completed', 'failed'].includes(task.status) ||
    (task.status === 'running' &&
      (task.leaseOwnerId !== guard.leaseOwnerId || task.leaseToken !== guard.leaseToken))
  )
    return
  saveContext(key, { kind: 'worker', guard: { ...guard }, expiresAt: Date.now() + CONTEXT_TTL_MS })
}

/** Claim/recovery/maintenance transitions compare the exact row observed before the mutation. */
export function registerTextTaskControlPersistenceContext(
  next: GenerationTask,
  previous: GenerationTask,
): void {
  const key = contextKey(next)
  if (
    !key ||
    !isMainTextTask(previous) ||
    next.id !== previous.id ||
    next.tenantId !== previous.tenantId ||
    next.projectId !== previous.projectId ||
    next.userId !== previous.userId ||
    next.clientRequestId !== previous.clientRequestId ||
    (next.model ?? null) !== (previous.model ?? null) ||
    textTaskOperation(next) !== textTaskOperation(previous) ||
    findTextTaskPersistenceContext(next)?.kind === 'worker'
  )
    return
  saveContext(key, {
    kind: 'control',
    previous: structuredClone(normalizeGenerationTaskLifecycle(previous)),
    expiresAt: Date.now() + CONTEXT_TTL_MS,
  })
}

export function findTextTaskPersistenceContext(task: GenerationTask): TextTaskPersistenceContext | null {
  const key = contextKey(task)
  if (!key) return null
  const context = contexts.get(key)
  if (!context) return null
  if (context.expiresAt <= Date.now()) {
    contexts.delete(key)
    return null
  }
  return structuredClone(context)
}

/** Only clear after a successful transaction; rollback must retain retry authority. */
export function clearTextTaskPersistenceContext(task: GenerationTask): void {
  const key = contextKey(task)
  if (key) contexts.delete(key)
}
