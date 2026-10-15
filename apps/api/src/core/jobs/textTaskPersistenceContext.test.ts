import type { GenerationTask } from '@seqora/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { releaseGenerationTaskLease } from './taskLease.js'
import { captureTextTaskWriteGuard } from './textTaskExecutionGuard.js'
import {
  clearTextTaskPersistenceContext,
  findTextTaskPersistenceContext,
  registerTextTaskControlPersistenceContext,
  registerTextTaskPersistenceContext,
} from './textTaskPersistenceContext.js'

function source(id = 'text-context'): GenerationTask {
  return {
    id,
    clientRequestId: id,
    tenantId: 'tenant',
    projectId: 'project',
    userId: 'user',
    kind: 'text',
    provider: 'text',
    model: null,
    label: 'Text',
    prompt: 'Synthetic',
    negativePrompt: '',
    metadata: { scriptOperation: 'generate' },
    status: 'running',
    progress: 20,
    attempts: 1,
    maxAttempts: 3,
    estimatedCredits: 1,
    outputs: [],
    resultUrl: null,
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    leaseOwnerId: 'worker',
    leaseToken: 'private-source-token',
    leaseAcquiredAt: '2026-01-01T00:00:00.000Z',
    leaseHeartbeatAt: '2026-01-01T00:00:00.000Z',
    leaseExpiresAt: '2030-01-01T00:00:00.000Z',
  }
}

function completed(original: GenerationTask): GenerationTask {
  const next = structuredClone(original)
  next.status = 'completed'
  next.progress = 100
  next.metadata.textResult = { script: 'Synthetic result' }
  next.updatedAt = '2026-01-01T00:00:02.000Z'
  releaseGenerationTaskLease(next)
  return next
}

afterEach(() => vi.useRealTimers())

describe('private text task persistence context', () => {
  it('survives normalized task clones without exposing the original lease', () => {
    const original = source('text-clone')
    const next = completed(original)
    const guard = captureTextTaskWriteGuard(original)
    registerTextTaskPersistenceContext(next, guard)
    expect(findTextTaskPersistenceContext(structuredClone(next))).toMatchObject({ kind: 'worker', guard })
    expect(JSON.stringify(next)).not.toContain('private-source-token')
    clearTextTaskPersistenceContext(next)
    expect(findTextTaskPersistenceContext(next)).toBeNull()
  })

  it.each(['scope', 'result', 'timestamp', 'attempt', 'operation', 'model', 'status'])(
    'binds the exact outgoing %s',
    (change) => {
      const original = source(`text-binding-${change}`)
      const next = completed(original)
      registerTextTaskPersistenceContext(next, captureTextTaskWriteGuard(original))
      const altered = structuredClone(next)
      if (change === 'scope') altered.projectId = 'another-project'
      if (change === 'result') altered.metadata.textResult = { script: 'Altered' }
      if (change === 'timestamp') altered.updatedAt = '2026-01-01T00:00:03.000Z'
      if (change === 'attempt') altered.attempts = 2
      if (change === 'operation') altered.metadata.scriptOperation = 'enrich'
      if (change === 'model') altered.model = 'different-model'
      if (change === 'status') altered.status = 'failed'
      expect(findTextTaskPersistenceContext(altered)).toBeNull()
      clearTextTaskPersistenceContext(next)
    },
  )

  it('compares values without depending on metadata property order', () => {
    const original = source('text-canonical')
    const next = completed(original)
    registerTextTaskPersistenceContext(next, captureTextTaskWriteGuard(original))
    const clone = { ...next, metadata: { textResult: next.metadata.textResult, scriptOperation: 'generate' } }
    expect(findTextTaskPersistenceContext(clone)?.kind).toBe('worker')
    clearTextTaskPersistenceContext(next)
  })

  it('rejects mismatched execution identity and unsupported task kinds', () => {
    const original = source('text-invalid')
    const next = completed(original)
    const guard = captureTextTaskWriteGuard(original)
    for (const altered of [
      { ...guard, taskId: 'other' },
      { ...guard, tenantId: 'other' },
      { ...guard, userId: 'other' },
      { ...guard, clientRequestId: 'other' },
      { ...guard, attempts: 2 },
      { ...guard, leaseToken: '' },
    ]) {
      registerTextTaskPersistenceContext(next, altered)
      expect(findTextTaskPersistenceContext(next)).toBeNull()
    }
    const other = { ...next, kind: 'image' as const }
    registerTextTaskPersistenceContext(other, guard)
    expect(findTextTaskPersistenceContext(other)).toBeNull()
    const standalone = { ...next, projectId: 'sm-standalone-fixture' }
    registerTextTaskPersistenceContext(standalone, { ...guard, projectId: standalone.projectId })
    expect(findTextTaskPersistenceContext(standalone)).toBeNull()
  })

  it('expires execution authority after five minutes', () => {
    vi.useFakeTimers()
    const original = source('text-expiry')
    const next = completed(original)
    registerTextTaskPersistenceContext(next, captureTextTaskWriteGuard(original))
    vi.advanceTimersByTime(5 * 60_000)
    expect(findTextTaskPersistenceContext(next)).toBeNull()
  })

  it('bounds retained context memory and fails closed after eviction', () => {
    const originals = Array.from({ length: 1_025 }, (_, i) => source(`text-capacity-${i}`))
    const snapshots = originals.map(completed)
    for (let index = 0; index < originals.length; index++)
      registerTextTaskPersistenceContext(snapshots[index]!, captureTextTaskWriteGuard(originals[index]!))
    expect(findTextTaskPersistenceContext(snapshots[0]!)).toBeNull()
    expect(findTextTaskPersistenceContext(snapshots.at(-1)!)?.kind).toBe('worker')
    for (const snapshot of snapshots) clearTextTaskPersistenceContext(snapshot)
  })

  it('retains an immutable control baseline and never overrides execution authority', () => {
    const original = source('text-control')
    const next = completed(original)
    registerTextTaskControlPersistenceContext(next, original)
    const expected = structuredClone(original)
    original.metadata.scriptOperation = 'enrich'
    const found = findTextTaskPersistenceContext(next)
    expect(found).toMatchObject({ kind: 'control', previous: expected })
    if (found?.kind === 'control') found.previous.metadata.scriptOperation = 'changed-return-value'
    expect(findTextTaskPersistenceContext(next)).toMatchObject({ kind: 'control', previous: expected })
    registerTextTaskPersistenceContext(next, captureTextTaskWriteGuard(expected))
    registerTextTaskControlPersistenceContext(next, expected)
    expect(findTextTaskPersistenceContext(next)?.kind).toBe('worker')
    clearTextTaskPersistenceContext(next)
  })
})
