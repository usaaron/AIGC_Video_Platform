import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canInspectTextCompletion,
  createTextCompletionInspection,
  isTextCompletionDialogCurrent,
  parseTextCompletionSnapshot,
} from './textCompletionInspection'

const job = {
  id: 'task-1',
  projectId: 'project-1',
  tenantId: 'tenant-1',
  kind: 'text',
  provider: 'text',
  status: 'completed',
  updatedAt: '2026-10-15T02:00:01.000Z',
  label: '文本任务',
  metadata: {},
}
const scope = {
  taskId: job.id,
  projectId: job.projectId,
  tenantId: job.tenantId,
  taskStatus: job.status,
  taskUpdatedAt: job.updatedAt,
}
const snapshot = {
  version: 'seqora.text-completion-query.v1',
  ...scope,
  checkedAt: '2026-10-15T02:00:02.000Z',
  reason: 'missing-receipt',
  receipt: null,
}
const receipt = {
  version: 'seqora.text-completion.v1',
  attestation: 'server-observed-text-result',
  tenantId: job.tenantId,
  projectId: job.projectId,
  taskId: job.id,
  userId: 'user-1',
  clientRequestId: 'request-1',
  attempts: 1,
  model: null,
  operation: 'generate',
  completedAt: '2026-10-15T02:00:00.000Z',
  resultSha256: 'a'.repeat(64),
  resultBytes: 100,
  units: [
    {
      unitId: 'script',
      source: 'local-derived',
      resultSha256: 'b'.repeat(64),
      resultBytes: 80,
      providerCalls: [],
    },
  ],
}
const verified = { ...snapshot, reason: 'verified', receipt }
const input = { job, projectId: job.projectId, tenantId: job.tenantId }

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function state() {
  const values = []
  return { values, onState: (value) => values.push(value), read: () => values.at(-1) }
}

afterEach(() => vi.useRealTimers())

describe('text completion scoped snapshots', () => {
  it('accepts a verified receipt only when all snapshot and task scope fields match', () => {
    expect(parseTextCompletionSnapshot(verified, scope)).toEqual(verified)
  })

  it.each(['taskId', 'projectId', 'tenantId', 'taskStatus', 'taskUpdatedAt'])(
    'rejects a valid server snapshot belonging to another %s',
    (field) => {
      const changed = {
        ...scope,
        [field]:
          field === 'taskStatus'
            ? 'running'
            : field === 'taskUpdatedAt'
              ? '2026-10-15T02:00:03.000Z'
              : 'another',
      }
      expect(() => parseTextCompletionSnapshot(snapshot, changed)).toThrow('任务范围或版本已变化')
    },
  )

  it.each([
    undefined,
    null,
    {},
    [],
    { ...scope, tenantId: '' },
    { ...scope, tenantId: ' ' },
    { ...scope, taskUpdatedAt: 'invalid' },
    { ...scope, taskStatus: 'invented' },
    { ...scope, extra: 'ignored' },
  ])('rejects an incomplete or malformed local scope without trusting a passing response', (invalid) => {
    expect(() => parseTextCompletionSnapshot(verified, invalid)).toThrow('任务范围或版本已变化')
  })

  it.each(['taskId', 'projectId', 'tenantId', 'taskStatus', 'taskUpdatedAt'])(
    'requires the local %s field',
    (field) => {
      const incomplete = { ...scope }
      delete incomplete[field]
      expect(() => parseTextCompletionSnapshot(verified, incomplete)).toThrow('任务范围或版本已变化')
    },
  )

  it.each([
    { ...snapshot, version: 'unknown' },
    { ...snapshot, reason: 'passed' },
    { ...snapshot, extra: 'untrusted' },
    { ...snapshot, checkedAt: 'invalid' },
    { ...snapshot, reason: 'verified' },
    { ...snapshot, receipt },
    { ...verified, taskStatus: 'running' },
    { ...verified, receipt: { ...receipt, taskId: 'another' } },
    { ...verified, receipt: { ...receipt, resultSha256: 'forged' } },
    { ...snapshot, taskStatus: 'running' },
    { ...snapshot, reason: 'task-not-completed' },
  ])('rejects malformed or contradictory server responses', (invalid) => {
    expect(() => parseTextCompletionSnapshot(invalid, scope)).toThrow('格式无效')
  })

  it.each(['missing-receipt', 'invalid-receipt', 'receipt-mismatch'])(
    'preserves conservative server reason %s',
    (reason) => {
      expect(parseTextCompletionSnapshot({ ...snapshot, reason }, scope).receipt).toBeNull()
    },
  )

  it.each(['queued', 'paused', 'running', 'failed', 'cancelled'])(
    'retains non-completed status %s without displaying a receipt',
    (taskStatus) => {
      const currentScope = { ...scope, taskStatus }
      expect(
        parseTextCompletionSnapshot({ ...snapshot, taskStatus, reason: 'task-not-completed' }, currentScope)
          .receipt,
      ).toBeNull()
    },
  )
})

describe('text completion source entry and current row', () => {
  it('offers the source query for host text tasks without requiring a media URL or metadata receipt', () => {
    expect(canInspectTextCompletion(job)).toBe(true)
  })
  it.each([
    null,
    {},
    { ...job, kind: 'image' },
    { ...job, provider: 'other' },
    { ...job, projectId: '' },
    { ...job, projectId: ' ' },
    { ...job, projectId: 'sm-standalone-project-1' },
  ])('rejects unsupported tasks', (value) => {
    expect(canInspectTextCompletion(value)).toBe(false)
  })

  const dialog = { scope, projectId: job.projectId, tenantId: job.tenantId }
  it('keeps a receipt current through unrelated label and progress refreshes', () => {
    expect(
      isTextCompletionDialogCurrent(
        dialog,
        [{ ...job, label: '新标签', progress: 100 }],
        job.projectId,
        job.tenantId,
      ),
    ).toBe(true)
  })
  it.each([
    { id: 'another' },
    { tenantId: 'another' },
    { projectId: 'another' },
    { status: 'running' },
    { updatedAt: '2026-10-15T02:00:03.000Z' },
    { kind: 'video' },
    { provider: 'other' },
    { metadata: { queueHiddenAt: '2026-10-15T02:00:03.000Z' } },
  ])('invalidates an opened receipt on row changes %j', (change) => {
    expect(isTextCompletionDialogCurrent(dialog, [{ ...job, ...change }], job.projectId, job.tenantId)).toBe(
      false,
    )
  })
  it('invalidates missing rows, missing scope, and project or tenant switches', () => {
    expect(isTextCompletionDialogCurrent(dialog, [], job.projectId, job.tenantId)).toBe(false)
    expect(isTextCompletionDialogCurrent({ ...dialog, scope: {} }, [job], job.projectId, job.tenantId)).toBe(
      false,
    )
    expect(isTextCompletionDialogCurrent(dialog, [job], 'new-project', job.tenantId)).toBe(false)
    expect(isTextCompletionDialogCurrent(dialog, [job], job.projectId, 'new-tenant')).toBe(false)
  })
})

describe('text completion request identity and cancellation', () => {
  it('forwards a fresh abort signal and only returns parsed server data', async () => {
    const current = state()
    const inspect = vi.fn().mockResolvedValue(snapshot)
    const action = createTextCompletionInspection(current)
    await action.run({ ...input, job: { ...job, metadata: { textCompletionReceipt: receipt } }, inspect })
    expect(current.values.map((value) => value.status)).toEqual(['loading', 'ready'])
    expect(inspect.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(current.read().snapshot).toEqual(snapshot)
    expect(current.read().job).not.toHaveProperty('metadata')
  })

  it.each(['success', 'failure'])('suppresses a late %s after closing or unmounting', async (outcome) => {
    const current = state()
    const response = deferred()
    const action = createTextCompletionInspection(current)
    const pending = action.run({ ...input, inspect: () => response.promise })
    const signal = current.read().controller.signal
    action.cancel()
    await pending
    if (outcome === 'success') response.resolve(snapshot)
    else response.reject(new Error('late'))
    await Promise.resolve()
    expect(signal.aborted).toBe(true)
    expect(current.values.map((value) => value.status)).toEqual(['loading'])
  })

  it.each(['task-1', 'task-2'])('keeps only the latest request for %s', async (taskId) => {
    const current = state()
    const oldResponse = deferred()
    const newResponse = deferred()
    const action = createTextCompletionInspection(current)
    const older = action.run({ ...input, inspect: () => oldResponse.promise })
    const oldSignal = current.read().controller.signal
    const newer = action.run({ ...input, job: { ...job, id: taskId }, inspect: () => newResponse.promise })
    newResponse.resolve({ ...snapshot, taskId })
    await newer
    const newest = current.read()
    oldResponse.resolve(snapshot)
    await older
    expect(oldSignal.aborted).toBe(true)
    expect(current.read()).toBe(newest)
    expect(newest).toMatchObject({ status: 'ready', snapshot: { taskId } })
  })

  it('does not let an earlier error replace a newer successful query', async () => {
    const current = state()
    const oldResponse = deferred()
    const action = createTextCompletionInspection(current)
    const older = action.run({ ...input, inspect: () => oldResponse.promise })
    await action.run({ ...input, inspect: async () => snapshot })
    oldResponse.reject(new Error('旧请求失败'))
    await older
    expect(current.read()).toMatchObject({ status: 'ready', snapshot })
  })

  it.each([
    { projectId: 'another' },
    { tenantId: 'another' },
    { job: { ...job, tenantId: undefined } },
    { job: { ...job, id: '' } },
    { job: { ...job, updatedAt: 'invalid' } },
    { job: { ...job, metadata: { queueHiddenAt: 'archived' } } },
    { job: null },
  ])('does not query with an incomplete or changed task scope', async (change) => {
    const current = state()
    const inspect = vi.fn()
    await createTextCompletionInspection(current).run({ ...input, inspect, ...change })
    expect(inspect).not.toHaveBeenCalled()
    expect(current.read()).toMatchObject({ status: 'error', snapshot: null })
  })

  it('supports retry after a network or malformed-response failure', async () => {
    const current = state()
    const action = createTextCompletionInspection(current)
    await action.run({
      ...input,
      inspect: async () => {
        throw new Error('读取失败')
      },
    })
    expect(current.read()).toMatchObject({ status: 'error', error: '读取失败', snapshot: null })
    await action.run({ ...input, inspect: async () => ({ ...snapshot, extra: true }) })
    expect(current.read()).toMatchObject({ status: 'error', snapshot: null })
    await action.run({ ...input, inspect: async () => snapshot })
    expect(current.read()).toMatchObject({ status: 'ready', snapshot })
  })

  it('times out a stalled fetch even when it ignores abort and suppresses its late result', async () => {
    vi.useFakeTimers()
    const current = state()
    const response = deferred()
    const action = createTextCompletionInspection({ ...current, timeoutMs: 10 })
    const pending = action.run({ ...input, inspect: () => response.promise })
    const signal = current.read().controller.signal
    await vi.advanceTimersByTimeAsync(10)
    await pending
    expect(signal.aborted).toBe(true)
    expect(current.read()).toMatchObject({
      status: 'error',
      snapshot: null,
      error: '来源查询已超时，请重试。',
    })
    const timedOut = current.read()
    response.resolve(snapshot)
    await Promise.resolve()
    expect(current.read()).toBe(timedOut)
    await action.run({ ...input, inspect: async () => snapshot })
    expect(current.read().status).toBe('ready')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timeout after cancellation', async () => {
    vi.useFakeTimers()
    const current = state()
    const action = createTextCompletionInspection(current)
    const pending = action.run({ ...input, inspect: () => new Promise(() => {}) })
    action.cancel()
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })
})
