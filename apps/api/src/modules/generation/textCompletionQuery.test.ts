import {
  textCompletionSnapshotSchema,
  type GenerationTask,
  type Principal,
  type TextCompletionReceipt,
  type TextCompletionSource,
} from '@seqora/contracts'
import { afterEach, assert, describe, expect, it, vi } from 'vitest'
import { claimGenerationTaskLease, releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import {
  buildTextCompletionReceipt,
  createTextCompletionRecorder,
  finishTextCompletionBatch,
  markReusedTextEpisode,
} from '../../core/jobs/textCompletion.js'
import { captureTextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import { queuedTextTask } from '../../testing/generationTaskFixtures.js'
import type { GenerationTaskRepository } from './repository.js'
import { GenerationService } from './service.js'
import { readTextCompletionQuery } from './textCompletionQuery.js'

const principal: Principal = {
  tenantId: 'tenant-seqora-demo',
  userId: 'user-member',
  roles: ['member'],
}
const completedAt = '2026-10-15T03:00:00.000Z'
const checkedAt = '2026-10-15T05:00:00.000Z'
const privateResult = 'Synthetic historical result 汉字🙂'
const privateResponse = 'Synthetic adapter candidate must remain private'
const privatePrompt = 'Synthetic task prompt must remain private'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function episode(id: string) {
  return {
    id,
    projectId: 'project-midnight-film',
    tenantId: principal.tenantId,
    draftContent: privateResult + id,
    content: 'Synthetic saved body ' + id,
    revision: 2,
  }
}

function running(operation: TextCompletionReceipt['operation'] = 'generate') {
  const task = queuedTextTask('text-completion-query')
  task.prompt = privatePrompt
  task.metadata.scriptOperation = operation
  claimGenerationTaskLease(task, 'synthetic-worker', 60_000)
  return task
}

function complete(task: GenerationTask, result: Record<string, unknown>) {
  const receipt = buildTextCompletionReceipt(task, result, captureTextTaskWriteGuard(task), completedAt)
  assert(receipt)
  task.status = 'completed'
  task.progress = 100
  task.updatedAt = completedAt
  task.metadata = {
    ...task.metadata,
    textResult: result,
    textCompletionReceipt: receipt,
    localTaskCompletedAt: completedAt,
    privateMetadata: 'Synthetic private metadata must remain private',
    providerTaskId: 'synthetic-unverified-upstream-id',
    storageKey: 'synthetic-private-storage-location',
  }
  releaseGenerationTaskLease(task)
  return { task, result, receipt }
}

async function completed(
  source: TextCompletionSource = 'provider-derived',
  operation: TextCompletionReceipt['operation'] = 'generate',
  response = privateResponse,
) {
  const task = running(operation)
  const recorder = createTextCompletionRecorder(
    source === 'reused-episode' ? null : { generate: async () => response },
    { taskWriteGuard: captureTextTaskWriteGuard(task) },
  )
  if (recorder.provider)
    await recorder.provider.generate({
      systemPrompt: 'Synthetic system prompt',
      userPrompt: 'Synthetic user prompt',
      model: task.model!,
      timingLabel: 'first-draft',
    })
  let value: Record<string, unknown>
  if (source === 'reused-episode') {
    const stored = markReusedTextEpisode(episode('reused'))
    value = { script: stored.draftContent, episode: stored, warnings: [] }
  } else
    value =
      operation === 'suggest-assets'
        ? { assets: [{ name: privateResult, description: 'Synthetic asset suggestion' }], warnings: [] }
        : { script: privateResult, warnings: [] }
  return complete(task, recorder.finish(value, source))
}

async function completedBatch() {
  const task = running()
  const guard = captureTextTaskWriteGuard(task)
  const fresh = episode('fresh')
  const reused = markReusedTextEpisode(episode('reused'))
  const recorder = createTextCompletionRecorder(
    { generate: async () => privateResponse },
    { taskWriteGuard: guard },
  )
  await recorder.provider!.generate({
    systemPrompt: 'Synthetic',
    userPrompt: 'Synthetic',
    model: task.model!,
  })
  const child = recorder.finish({ script: fresh.draftContent, episode: fresh, warnings: [] }, 'mixed')
  const result = finishTextCompletionBatch(
    { script: reused.draftContent, episode: reused, episodes: [fresh, reused], warnings: [] as string[] },
    [
      { result: child, reused: false },
      { result: { episode: reused }, reused: true },
    ],
    { taskWriteGuard: guard },
  )
  return { ...complete(task, result), episodes: result.episodes }
}

function repository(task: GenerationTask | null) {
  return { findById: vi.fn<GenerationTaskRepository['findById']>().mockResolvedValue(task) }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

describe('read-only text completion query', () => {
  it('uses one authorized task lookup and returns a detached timestamped snapshot', async () => {
    const f = await completed()
    const original = structuredClone(f.task)
    freeze(f.task)
    const read = repository(f.task)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(checkedAt)
    const snapshot = await readTextCompletionQuery(read, f.task.id, principal)
    expect(read.findById).toHaveBeenCalledExactlyOnceWith(f.task.id, principal)
    expect(snapshot).toEqual({
      version: 'seqora.text-completion-query.v1',
      taskId: f.task.id,
      projectId: f.task.projectId,
      tenantId: f.task.tenantId,
      taskUpdatedAt: completedAt,
      checkedAt,
      taskStatus: 'completed',
      reason: 'verified',
      receipt: f.receipt,
    })
    expect(textCompletionSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    snapshot.receipt!.units[0]!.source = 'local-derived'
    expect(f.task).toEqual(original)
  })

  it.each(['generate', 'enrich', 'suggest-assets'] as const)(
    'preserves the recorded operation %s',
    async (operation) => {
      const f = await completed('provider-derived', operation)
      const snapshot = await readTextCompletionQuery(repository(f.task), f.task.id, principal)
      expect(snapshot.reason).toBe('verified')
      expect(snapshot.receipt?.operation).toBe(operation)
      expect(snapshot).not.toHaveProperty('textResult')
    },
  )

  it.each(['provider-derived', 'mixed', 'retained-input', 'local-derived', 'reused-episode'] as const)(
    'reports %s without upgrading its provenance',
    async (source) => {
      const f = await completed(source)
      const snapshot = await readTextCompletionQuery(repository(f.task), f.task.id, principal)
      expect(snapshot.reason).toBe('verified')
      expect(snapshot.receipt?.units[0]?.source).toBe(source)
      expect(snapshot.receipt?.units[0]?.providerCalls).toHaveLength(source === 'reused-episode' ? 0 : 1)
      expect(snapshot.receipt?.attestation).toBe('server-observed-text-result')
      for (const call of snapshot.receipt!.units[0]!.providerCalls)
        expect(call.observation).toBe('adapter-returned')
    },
  )

  it('preserves a successful empty adapter response in a local asset suggestion fallback', async () => {
    const f = await completed('local-derived', 'suggest-assets', '')
    const snapshot = await readTextCompletionQuery(repository(f.task), f.task.id, principal)
    expect(snapshot).toMatchObject({
      reason: 'verified',
      receipt: {
        units: [
          {
            source: 'local-derived',
            providerCalls: [
              {
                responseBytes: 0,
                responseSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                observation: 'adapter-returned',
              },
            ],
          },
        ],
      },
    })
  })

  it('preserves every batch unit and separates fresh calls from reused episode history', async () => {
    const f = await completedBatch()
    const snapshot = await readTextCompletionQuery(repository(f.task), f.task.id, principal)
    expect(snapshot.reason).toBe('verified')
    expect(
      snapshot.receipt?.units.map((unit) => ({
        unitId: unit.unitId,
        source: unit.source,
        calls: unit.providerCalls.length,
      })),
    ).toEqual([
      { unitId: 'episode:fresh', source: 'mixed', calls: 1 },
      { unitId: 'episode:reused', source: 'reused-episode', calls: 0 },
    ])
  })

  it('keeps historical proof valid while exposing the latest task bookkeeping version', async () => {
    const f = await completed()
    f.task.updatedAt = '2026-10-15T04:00:00.000Z'
    f.task.metadata.queueHiddenAt = f.task.updatedAt
    f.task.metadata.scriptPreview = 'Synthetic later editable project text'
    f.task.metadata.currentEpisodeRevision = 99
    const snapshot = await readTextCompletionQuery(repository(f.task), f.task.id, principal)
    expect(snapshot).toMatchObject({
      taskUpdatedAt: f.task.updatedAt,
      reason: 'verified',
      receipt: { completedAt, resultSha256: f.receipt.resultSha256 },
    })
  })

  it('never returns raw task content, private metadata, or execution internals', async () => {
    const f = await completed()
    f.task.leaseToken = 'synthetic-private-lease-token'
    f.task.leaseOwnerId = 'synthetic-private-owner'
    const snapshot = await readTextCompletionQuery(repository(f.task), f.task.id, principal)
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'version',
        'taskId',
        'projectId',
        'tenantId',
        'taskUpdatedAt',
        'checkedAt',
        'taskStatus',
        'reason',
        'receipt',
      ].sort(),
    )
    const encoded = JSON.stringify(snapshot)
    for (const secret of [
      privateResult,
      privateResponse,
      privatePrompt,
      'synthetic-private-lease-token',
      'synthetic-private-owner',
      'Synthetic private metadata',
      'synthetic-unverified-upstream-id',
      'synthetic-private-storage-location',
    ])
      expect(encoded).not.toContain(secret)
    expect(encoded).not.toMatch(
      /"(?:textResult|prompt|negativePrompt|metadata|leaseToken|leaseOwnerId|providerTaskId|storageKey)":/,
    )
  })

  it.each(['queued', 'paused', 'running', 'failed', 'cancelled'] as const)(
    'does not treat retained receipt data as proof for status %s',
    async (status) => {
      const f = await completed()
      f.task.status = status
      const snapshot = await readTextCompletionQuery(repository(f.task), f.task.id, principal)
      expect(snapshot).toMatchObject({ taskStatus: status, reason: 'task-not-completed', receipt: null })
    },
  )

  it.each([undefined, null])('does not fabricate missing historical evidence: %s', async (value) => {
    const f = await completed()
    f.task.metadata.textCompletionReceipt = value
    expect(await readTextCompletionQuery(repository(f.task), f.task.id, principal)).toMatchObject({
      reason: 'missing-receipt',
      receipt: null,
    })
    expect(f.task.metadata.textCompletionReceipt).toBe(value)
  })

  it.each([
    { version: 'old' },
    { attestation: 'provider-completed' },
    { resultSha256: 'wrong' },
    { leaseToken: 'synthetic-private-token' },
    { units: [] },
  ])('returns no trusted receipt for malformed evidence %#', async (change) => {
    const f = await completed()
    f.task.metadata.textCompletionReceipt = { ...f.receipt, ...change }
    const before = structuredClone(f.task)
    expect(await readTextCompletionQuery(repository(f.task), f.task.id, principal)).toMatchObject({
      reason: 'invalid-receipt',
      receipt: null,
    })
    expect(f.task).toEqual(before)
  })

  it.each([
    ['tenantId', 'another-tenant'],
    ['projectId', 'another-project'],
    ['taskId', 'another-task'],
    ['userId', 'another-user'],
    ['clientRequestId', 'another-request'],
    ['attempts', 2],
    ['model', 'another-model'],
    ['operation', 'enrich'],
    ['completedAt', '2026-10-15T03:00:01.000Z'],
    ['resultSha256', 'f'.repeat(64)],
    ['resultBytes', 1],
  ] as const)('does not return evidence with mismatched receipt %s', async (field, value) => {
    const f = await completed()
    f.task.metadata.textCompletionReceipt = { ...f.receipt, [field]: value }
    expect(await readTextCompletionQuery(repository(f.task), f.task.id, principal)).toMatchObject({
      reason: 'receipt-mismatch',
      receipt: null,
    })
  })

  it.each(['body', 'result', 'operation', 'completed-at', 'attempt', 'model'] as const)(
    'rechecks changed task fact %s rather than trusting stored receipt presence',
    async (change) => {
      const f = await completed()
      if (change === 'body') f.result.script = 'Synthetic replaced body'
      if (change === 'result') f.task.metadata.textResult = null
      if (change === 'operation') f.task.metadata.scriptOperation = 'enrich'
      if (change === 'completed-at') f.task.metadata.localTaskCompletedAt = '2026-10-15T03:00:01.000Z'
      if (change === 'attempt') f.task.attempts = 2
      if (change === 'model') f.task.model = 'another-model'
      expect(await readTextCompletionQuery(repository(f.task), f.task.id, principal)).toMatchObject({
        reason: 'receipt-mismatch',
        receipt: null,
      })
    },
  )

  it.each(['body', 'revision', 'missing-unit', 'unit-order', 'unit-hash'] as const)(
    'does not partially expose a batch with changed %s',
    async (change) => {
      const f = await completedBatch()
      if (change === 'body') f.episodes[0]!.draftContent = 'Changed synthetic episode'
      if (change === 'revision') f.episodes[0]!.revision += 1
      if (change === 'missing-unit') f.receipt.units.pop()
      if (change === 'unit-order') f.receipt.units.reverse()
      if (change === 'unit-hash') f.receipt.units[0]!.resultSha256 = 'f'.repeat(64)
      expect(await readTextCompletionQuery(repository(f.task), f.task.id, principal)).toMatchObject({
        reason: 'receipt-mismatch',
        receipt: null,
      })
    },
  )

  it('maps a missing authorized lookup to the task-not-found error', async () => {
    const read = repository(null)
    await expect(readTextCompletionQuery(read, 'missing', principal)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TASK_NOT_FOUND',
    })
    expect(read.findById).toHaveBeenCalledExactlyOnceWith('missing', principal)
  })

  it('does not turn a repository failure into missing or verified proof', async () => {
    const error = new Error('Synthetic database read failed')
    const read = repository(null)
    read.findById.mockRejectedValue(error)
    await expect(readTextCompletionQuery(read, 'task', principal)).rejects.toBe(error)
  })

  it.each(['image', 'video', 'audio'] as const)('rejects unsupported task kind %s', async (kind) => {
    const f = await completed()
    f.task.kind = kind
    await expect(readTextCompletionQuery(repository(f.task), f.task.id, principal)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TEXT_COMPLETION_UNSUPPORTED',
    })
  })

  it('rejects a foreign provider and hides standalone script tasks', async () => {
    const f = await completed()
    f.task.provider = 'other'
    await expect(readTextCompletionQuery(repository(f.task), f.task.id, principal)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TEXT_COMPLETION_UNSUPPORTED',
    })
    f.task.projectId = 'sm-standalone-project'
    await expect(readTextCompletionQuery(repository(f.task), f.task.id, principal)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TASK_NOT_FOUND',
    })
  })

  it('maps the service read without provider, media, project, or mutation side effects', async () => {
    const f = await completed()
    const before = structuredClone(f.task)
    const read = {
      ...repository(f.task),
      create: vi.fn(),
      freezeDeliveryContract: vi.fn(),
      listByProject: vi.fn(),
      recordDeliveryDownload: vi.fn(),
    }
    const dispatch = vi.fn(async () => {})
    const generate = vi.fn(async () => 'must not generate')
    const storage = { put: vi.fn(), get: vi.fn(), getStream: vi.fn(), getSignedUrl: vi.fn(), delete: vi.fn() }
    const service = new GenerationService(
      read as unknown as GenerationTaskRepository,
      { dispatch },
      null,
      'stringx-seedance',
      storage,
      null,
      { generate },
    )
    const snapshot = await service.textCompletion(f.task.id, principal)
    expect(snapshot.reason).toBe('verified')
    expect(read.findById).toHaveBeenCalledExactlyOnceWith(f.task.id, principal)
    for (const operation of [
      read.create,
      read.freezeDeliveryContract,
      read.listByProject,
      read.recordDeliveryDownload,
      dispatch,
      generate,
      ...Object.values(storage),
    ])
      expect(operation).not.toHaveBeenCalled()
    expect(f.task).toEqual(before)
  })
})
