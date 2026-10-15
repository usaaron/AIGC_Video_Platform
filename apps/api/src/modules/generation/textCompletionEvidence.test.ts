import {
  deliveryContractRequiresProviderCompletion,
  type GenerationTask,
  type TextCompletionReceipt,
} from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import {
  buildTextCompletionReceipt,
  createTextCompletionRecorder,
  finishTextCompletionBatch,
  textResultDigest,
} from '../../core/jobs/textCompletion.js'
import { captureTextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import { releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { buildGenerationTaskDeliveryEvidence } from './deliveryEvidence.js'
import { providerCompletionEvidence } from './providerCompletionEvidence.js'
import { textCompletionEvidence } from './textCompletionEvidence.js'

const completedAt = '2026-10-15T03:00:00.000Z'
function task(): GenerationTask {
  return {
    id: 'text-evidence',
    clientRequestId: 'text-evidence-request',
    tenantId: 'tenant',
    projectId: 'project',
    userId: 'user',
    kind: 'text',
    provider: 'text',
    model: 'logical-model',
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
    leaseToken: 'private-text-token',
    leaseAcquiredAt: '2026-01-01T00:00:00.000Z',
    leaseHeartbeatAt: '2026-01-01T00:00:00.000Z',
    leaseExpiresAt: '2030-01-01T00:00:00.000Z',
  }
}
function episode(id: string) {
  return {
    id,
    tenantId: 'tenant',
    projectId: 'project',
    draftContent: '草稿 ' + id,
    content: '正文 ' + id,
    revision: 2,
  }
}
type Episode = ReturnType<typeof episode>
type Result = { script: string; episode?: Episode; episodes?: Episode[]; warnings: string[] }

async function completed(batch = false) {
  const original = task()
  const guard = captureTextTaskWriteGuard(original)
  const observe = async (result: Result) => {
    const recorder = createTextCompletionRecorder(
      { generate: async () => result.script },
      { taskWriteGuard: guard },
    )
    await recorder.provider!.generate({
      systemPrompt: 'Synthetic',
      userPrompt: 'Synthetic',
      model: 'logical-model',
    })
    return recorder.finish(result, 'provider-derived')
  }
  let result: Result
  if (batch) {
    const episodes = [episode('first'), episode('second')]
    const children = []
    for (const current of episodes)
      children.push({
        result: await observe({ script: current.draftContent, episode: current, warnings: [] }),
        reused: false,
      })
    const last = episodes.at(-1)!
    result = finishTextCompletionBatch(
      { script: last.draftContent, episode: last, episodes, warnings: [] },
      children,
      { taskWriteGuard: guard },
    )
  } else result = await observe({ script: '合成正文 汉字🙂', warnings: [] })
  const receipt = buildTextCompletionReceipt(original, result, guard, completedAt)!
  expect(receipt).not.toBeNull()
  original.status = 'completed'
  original.progress = 100
  original.updatedAt = completedAt
  original.metadata.localTaskCompletedAt = completedAt
  original.metadata.textResult = structuredClone(result)
  original.metadata.textCompletionReceipt = receipt
  releaseGenerationTaskLease(original)
  return { task: original, receipt, result: original.metadata.textResult as Result }
}

describe('text result completion evidence', () => {
  it.each([false, true])(
    'verifies the immutable task result and every unit without mutating it: batch=%s',
    async (batch) => {
      const f = await completed(batch)
      const before = structuredClone(f.task)
      expect(textCompletionEvidence(f.task)).toEqual({ reason: 'verified', receipt: f.receipt })
      expect(f.task).toEqual(before)
    },
  )

  it('does not turn adapter-return observations into media provider completion or a delivery requirement', async () => {
    const f = await completed()
    expect(providerCompletionEvidence(f.task).receipt).toBeNull()
    expect(deliveryContractRequiresProviderCompletion(f.task)).toBe(false)
    expect(buildGenerationTaskDeliveryEvidence(f.task).find((item) => item.kind === 'provider')?.status).toBe(
      'pending',
    )
    expect(buildGenerationTaskDeliveryEvidence(f.task).find((item) => item.kind === 'asset')?.status).toBe(
      'pending',
    )
    expect(f.task.metadata.providerCompletionReceipt).toBeUndefined()
  })

  it('keeps historical proof valid after unrelated bookkeeping changes', async () => {
    const f = await completed()
    f.task.updatedAt = '2026-10-15T04:00:00.000Z'
    f.task.metadata.queueHiddenAt = f.task.updatedAt
    f.task.metadata.scriptPreview = 'Editable project text is not the task result'
    expect(textCompletionEvidence(f.task).reason).toBe('verified')
  })

  it.each(['running', 'failed', 'cancelled'] as const)('rejects task status %s', async (status) => {
    const f = await completed()
    f.task.status = status
    expect(textCompletionEvidence(f.task)).toEqual({ reason: 'task-not-completed', receipt: null })
  })

  it.each(['kind', 'provider', 'standalone'] as const)('rejects an unsupported task %s', async (change) => {
    const f = await completed()
    if (change === 'kind') f.task.kind = 'image'
    if (change === 'provider') f.task.provider = 'img2'
    if (change === 'standalone') f.task.projectId = 'sm-standalone-project'
    expect(textCompletionEvidence(f.task).reason).toBe('task-not-completed')
  })

  it.each([undefined, null])('does not fabricate a missing receipt: %s', async (value) => {
    const f = await completed()
    f.task.metadata.textCompletionReceipt = value
    expect(textCompletionEvidence(f.task)).toEqual({ reason: 'missing-receipt', receipt: null })
  })

  it.each([
    { version: 'old' },
    { attestation: 'provider-completed' },
    { resultSha256: 'wrong' },
    { leaseToken: 'secret' },
    { units: [] },
  ])('rejects malformed or overclaiming receipt %#', async (change) => {
    const f = await completed()
    f.task.metadata.textCompletionReceipt = { ...f.receipt, ...change }
    expect(textCompletionEvidence(f.task)).toEqual({ reason: 'invalid-receipt', receipt: null })
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
  ] as const)('rejects another receipt binding %s', async (field, value) => {
    const f = await completed()
    f.task.metadata.textCompletionReceipt = { ...f.receipt, [field]: value }
    expect(textCompletionEvidence(f.task)).toEqual({ reason: 'receipt-mismatch', receipt: null })
  })

  it.each([
    ['tenantId', 'another-tenant'],
    ['projectId', 'another-project'],
    ['id', 'another-task'],
    ['userId', 'another-user'],
    ['clientRequestId', 'another-request'],
    ['attempts', 2],
    ['model', 'another-model'],
  ] as const)('rejects a changed task scope %s', async (field, value) => {
    const f = await completed()
    Object.assign(f.task, { [field]: value })
    expect(textCompletionEvidence(f.task).reason).toBe('receipt-mismatch')
  })

  it.each(['operation', 'completedAt', 'result', 'script', 'warnings', 'non-json'] as const)(
    'rejects changed result facts %s',
    async (change) => {
      const f = await completed()
      if (change === 'operation') f.task.metadata.scriptOperation = 'enrich'
      if (change === 'completedAt') f.task.metadata.localTaskCompletedAt = '2026-10-15T03:00:01.000Z'
      if (change === 'result') f.task.metadata.textResult = { script: 'New' }
      if (change === 'script') f.result.script = 'New'
      if (change === 'warnings') f.result.warnings.push('New')
      if (change === 'non-json') Object.assign(f.result, { extra: undefined })
      expect(textCompletionEvidence(f.task).reason).toBe('receipt-mismatch')
    },
  )

  it.each(['draftContent', 'content', 'revision', 'id', 'tenantId', 'projectId'] as const)(
    'binds every episode field %s independently of the overall digest',
    async (field) => {
      const f = await completed(true)
      const first = f.result.episodes![0]!
      Object.assign(first, { [field]: field === 'revision' ? 3 : 'Changed' })
      const digest = textResultDigest(f.result)!
      f.receipt.resultSha256 = digest.sha256
      f.receipt.resultBytes = digest.bytes
      expect(textCompletionEvidence(f.task).reason).toBe('receipt-mismatch')
    },
  )

  it.each(['missing', 'extra', 'unit-order', 'episode-order', 'unit-hash', 'unit-bytes', 'unit-id'] as const)(
    'rejects an inconsistent batch unit set: %s',
    async (change) => {
      const f = await completed(true)
      if (change === 'missing') f.receipt.units.pop()
      if (change === 'extra')
        f.receipt.units.push({
          ...f.receipt.units[0]!,
          unitId: 'episode:extra',
          source: 'reused-episode',
          providerCalls: [],
        })
      if (change === 'unit-order') {
        f.receipt.units.reverse()
        let sequence = 0
        for (const unit of f.receipt.units) for (const call of unit.providerCalls) call.sequence = ++sequence
      }
      if (change === 'episode-order') {
        f.result.episodes!.reverse()
        f.result.episode = f.result.episodes!.at(-1)!
        f.result.script = f.result.episode.draftContent
        const digest = textResultDigest(f.result)!
        f.receipt.resultSha256 = digest.sha256
        f.receipt.resultBytes = digest.bytes
      }
      if (change === 'unit-hash') f.receipt.units[0]!.resultSha256 = 'e'.repeat(64)
      if (change === 'unit-bytes') f.receipt.units[0]!.resultBytes += 1
      if (change === 'unit-id') f.receipt.units[0]!.unitId = 'episode:other'
      expect(textCompletionEvidence(f.task).reason).toBe('receipt-mismatch')
    },
  )

  it('returns a parsed receipt copy so consumers cannot mutate stored provenance', async () => {
    const f = await completed()
    const evidence = textCompletionEvidence(f.task)
    evidence.receipt!.units[0]!.source = 'local-derived'
    expect((f.task.metadata.textCompletionReceipt as TextCompletionReceipt).units[0]!.source).toBe(
      'provider-derived',
    )
  })

  it.each(['episode', 'episodes', 'body'] as const)(
    'rejects accessor-bearing task result %s without invoking its getter',
    async (field) => {
      const f = await completed(true)
      const read = vi.fn((): unknown => {
        throw new Error('Getter must not run')
      })
      if (field === 'body')
        Object.defineProperty(f.result.episodes![0]!, 'draftContent', { enumerable: true, get: read })
      else Object.defineProperty(f.result, field, { enumerable: true, get: read })
      expect(() => textCompletionEvidence(f.task)).not.toThrow()
      expect(textCompletionEvidence(f.task).reason).toBe('receipt-mismatch')
      expect(read).not.toHaveBeenCalled()
    },
  )
})
