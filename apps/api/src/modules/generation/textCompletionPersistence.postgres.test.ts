import { randomUUID } from 'node:crypto'
import {
  createProjectSchema,
  type GenerationTask,
  type Principal,
  type TextCompletionReceipt,
} from '@seqora/contracts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { completeLocalTask } from '../../core/jobs/localTaskWriteback.js'
import { createTextCompletionRecorder, textResultDigest } from '../../core/jobs/textCompletion.js'
import { captureTextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import {
  clearTextTaskPersistenceContext,
  findTextTaskPersistenceContext,
  registerTextTaskControlPersistenceContext,
  registerTextTaskPersistenceContext,
} from '../../core/jobs/textTaskPersistenceContext.js'
import { releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { ProjectRepository } from '../projects/repository.js'
import { UserRepository } from '../users/repository.js'
import { GenerationTaskRepository } from './repository.js'
import { updateGenerationTaskLifecycle } from './taskLifecyclePersistence.js'
import { textCompletionEvidence } from './textCompletionEvidence.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
let fixture: PostgresAuthFixture
let database: AccountDatabase

beforeAll(async () => {
  fixture = await startPostgresAuthFixture()
  database = new AccountDatabase(fixture.connectionString)
}, 120_000)

afterAll(async () => {
  await database?.close()
  await fixture?.close()
})

async function setup() {
  const store = new AppStore(null)
  await store.initialize()
  await new UserRepository(store, database).bootstrapFromStore()
  const project = await new ProjectRepository(store, database).create(
    createProjectSchema.parse({
      name: 'Isolated text completion receipt',
      contentType: 'short-drama',
      aspectRatio: '9:16',
    }),
    principal,
  )
  const initial: GenerationTask = {
    id: randomUUID(),
    clientRequestId: randomUUID(),
    projectId: project.id,
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: 'text',
    provider: 'text',
    model: 'synthetic-model',
    tier: null,
    label: 'Text completion receipt',
    prompt: 'Synthetic',
    negativePrompt: '',
    metadata: { scriptOperation: 'generate', billingMode: 'prepaid' },
    status: 'running',
    progress: 30,
    estimatedCredits: 1,
    attempts: 1,
    maxAttempts: 3,
    leaseOwnerId: 'text-worker-1',
    leaseToken: 'text-token-1',
    leaseAcquiredAt: '2026-01-01T00:00:00.000Z',
    leaseHeartbeatAt: '2026-01-01T00:00:00.000Z',
    leaseExpiresAt: '2030-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    resultUrl: null,
    outputs: [],
    error: null,
  }
  await store.mutate((state) => {
    state.tasks = [structuredClone(initial)]
  })
  const repository = new GenerationTaskRepository(store, null, database)
  expect((await repository.importFromStore()).tasks.inserted).toBe(1)
  const task = (await repository.findById(initial.id, principal))!
  await store.replaceGenerationTaskRuntimeCacheAsync([task])
  return { task, store, repository }
}

type Fixture = Awaited<ReturnType<typeof setup>>
type WritePath = 'runtime' | 'control'

async function completedTask({ task, store }: Fixture, script = 'Synthetic generated script') {
  const guard = captureTextTaskWriteGuard(task)
  const recorder = createTextCompletionRecorder({ generate: async () => script }, { taskWriteGuard: guard })
  const generated = await recorder.provider!.generate({
    systemPrompt: 'Synthetic system prompt',
    userPrompt: 'Synthetic user prompt',
    model: task.model!,
  })
  const result = recorder.finish({ script: generated }, 'provider-derived')
  const completed = await completeLocalTask(
    store,
    guard.leaseOwnerId,
    task.id,
    guard.leaseToken,
    result,
    undefined,
    guard,
  )
  if (!completed) throw new Error('Synthetic completion was rejected')
  expect(textCompletionEvidence(completed).reason).toBe('verified')
  return completed
}

async function persist(fixture: Fixture, next: GenerationTask, path: WritePath) {
  if (path === 'control') return Boolean(await updateGenerationTaskLifecycle(database, next))
  await fixture.store.replaceGenerationTaskRuntimeCacheAsync([next])
  return fixture.repository.flushRuntimeTaskToDatabase(next.id)
}

const conflicts = [
  'cancelled',
  'new attempt',
  'new token',
  'new owner',
  'new operation',
  'new model',
  'new request',
  'expired lease',
] as const

async function changeCurrent(task: GenerationTask, conflict: (typeof conflicts)[number]) {
  const row = {
    status: 'running',
    attempts: 1,
    owner: task.leaseOwnerId,
    token: task.leaseToken,
    operation: 'generate',
    model: task.model,
    request: task.clientRequestId,
    expiry: task.leaseExpiresAt,
  }
  if (conflict === 'cancelled') Object.assign(row, { status: 'cancelled', owner: null, token: null })
  if (conflict === 'new attempt') row.attempts = 2
  if (conflict === 'new token') row.token = 'text-token-2'
  if (conflict === 'new owner') row.owner = 'text-worker-2'
  if (conflict === 'new operation') row.operation = 'enrich'
  if (conflict === 'new model') row.model = 'different-model'
  if (conflict === 'new request') row.request = randomUUID()
  if (conflict === 'expired lease') row.expiry = '2026-01-01T00:00:00.000Z'
  await database.query(
    "UPDATE generation_tasks SET status=$2, attempts=$3, lease_owner_id=$4, lease_token=$5, metadata=metadata || $6::jsonb, model=$7, client_request_id=$8, lease_expires_at=$9, updated_at='2026-01-01T00:00:02.000Z' WHERE id=$1",
    [
      task.id,
      row.status,
      row.attempts,
      row.owner,
      row.token,
      JSON.stringify({ scriptOperation: row.operation }),
      row.model,
      row.request,
      row.expiry,
    ],
  )
}

describe.each(['runtime', 'control'] as const)('text completion receipt %s persistence', (path) => {
  it('persists observed completion from the current original worker', async () => {
    const fixture = await setup()
    const completed = await completedTask(fixture)
    expect(await persist(fixture, completed, path)).toBe(true)
    const stored = await fixture.repository.findById(fixture.task.id, principal)
    expect(stored).toEqual(completed)
    expect(textCompletionEvidence(stored!).reason).toBe('verified')
    expect(JSON.stringify(stored!.metadata.textCompletionReceipt)).not.toContain(fixture.task.leaseToken)
  })

  it.each(conflicts)('rejects completion after %s', async (conflict) => {
    const fixture = await setup()
    const completed = await completedTask(fixture)
    await changeCurrent(fixture.task, conflict)
    expect(await persist(fixture, completed, path)).toBe(false)
    const stored = await fixture.repository.findById(fixture.task.id, principal)
    expect(stored!.metadata.textCompletionReceipt).toBeUndefined()
    expect(stored!.metadata.textResult).toBeUndefined()
    if (path === 'runtime') {
      expect(fixture.store.read((state) => state.tasks.find((item) => item.id === fixture.task.id))).toEqual(
        stored,
      )
    }
  })

  it.each(['missing', 'expired', 'control'] as const)(
    'rejects receipt insertion with %s worker authority',
    async (mode) => {
      const fixture = await setup()
      const completed = await completedTask(fixture)
      if (mode === 'expired') {
        const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60_000)
        try {
          expect(findTextTaskPersistenceContext(completed)).toBeNull()
        } finally {
          spy.mockRestore()
        }
      } else clearTextTaskPersistenceContext(completed)
      if (mode === 'control') registerTextTaskControlPersistenceContext(completed, fixture.task)
      expect(await persist(fixture, completed, path)).toBe(false)
      expect(await fixture.repository.findById(fixture.task.id, principal)).toEqual(fixture.task)
    },
  )

  it.each(['malformed receipt', 'changed result', 'changed scope'] as const)(
    'rejects %s even when the outgoing snapshot has a worker context',
    async (mode) => {
      const fixture = await setup()
      const completed = await completedTask(fixture)
      if (mode === 'malformed receipt') completed.metadata.textCompletionReceipt = { forged: true }
      if (mode === 'changed result') completed.metadata.textResult = { script: 'Different generated script' }
      if (mode === 'changed scope') {
        completed.metadata.textCompletionReceipt = {
          ...(completed.metadata.textCompletionReceipt as Record<string, unknown>),
          projectId: randomUUID(),
        }
      }
      registerTextTaskPersistenceContext(completed, captureTextTaskWriteGuard(fixture.task))
      expect(await persist(fixture, completed, path)).toBe(false)
      expect(await fixture.repository.findById(fixture.task.id, principal)).toEqual(fixture.task)
    },
  )

  it.each(['tenantId', 'projectId', 'userId'] as const)(
    'rejects a structurally valid receipt claiming a different %s',
    async (field) => {
      const fixture = await setup()
      const completed = await completedTask(fixture)
      const foreign = structuredClone(fixture.task)
      foreign[field] = randomUUID()
      completed[field] = foreign[field]
      const receipt = completed.metadata.textCompletionReceipt as TextCompletionReceipt
      receipt[field] = foreign[field]
      registerTextTaskPersistenceContext(completed, captureTextTaskWriteGuard(foreign))
      expect(textCompletionEvidence(completed).reason).toBe('verified')
      expect(await persist(fixture, completed, path)).toBe(false)
      expect(await fixture.repository.findById(fixture.task.id, principal)).toEqual(fixture.task)
    },
  )

  it.each(['remove receipt', 'replace receipt', 'change result', 'rebind result', 'reopen'] as const)(
    'rejects attempts to %s after completion through an authorized control context',
    async (change) => {
      const fixture = await setup()
      const completed = await completedTask(fixture)
      expect(await persist(fixture, completed, path)).toBe(true)
      const altered = structuredClone(completed)
      clearTextTaskPersistenceContext(altered)
      altered.updatedAt = new Date(Date.parse(completed.updatedAt) + 1_000).toISOString()
      if (change === 'remove receipt') delete altered.metadata.textCompletionReceipt
      if (change === 'replace receipt') {
        const receipt = altered.metadata.textCompletionReceipt as TextCompletionReceipt
        receipt.units[0]!.providerCalls[0]!.responseSha256 = 'f'.repeat(64)
        expect(textCompletionEvidence(altered).reason).toBe('verified')
      }
      if (change === 'change result') altered.metadata.textResult = { script: 'Replaced after completion' }
      if (change === 'rebind result') {
        altered.metadata.textResult = { script: 'Replaced after completion' }
        const digest = textResultDigest(altered.metadata.textResult)!
        const receipt = altered.metadata.textCompletionReceipt as TextCompletionReceipt
        receipt.resultSha256 = digest.sha256
        receipt.resultBytes = digest.bytes
        receipt.units[0]!.resultSha256 = digest.sha256
        receipt.units[0]!.resultBytes = digest.bytes
        expect(textCompletionEvidence(altered).reason).toBe('verified')
      }
      if (change === 'reopen') {
        altered.status = 'running'
        delete altered.metadata.textCompletionReceipt
      }
      registerTextTaskControlPersistenceContext(altered, completed)
      expect(await persist(fixture, altered, path)).toBe(false)
      expect(await fixture.repository.findById(fixture.task.id, principal)).toEqual(completed)
    },
  )

  it('allows idempotent completion and hiding while retaining the exact receipt and result', async () => {
    const fixture = await setup()
    const completed = await completedTask(fixture)
    expect(await persist(fixture, completed, path)).toBe(true)
    clearTextTaskPersistenceContext(completed)
    const duplicate = {
      ...completed,
      updatedAt: new Date(Date.parse(completed.updatedAt) + 1_000).toISOString(),
    }
    expect(await persist(fixture, duplicate, path)).toBe(true)
    const hidden = structuredClone(duplicate)
    hidden.updatedAt = new Date(Date.parse(duplicate.updatedAt) + 1_000).toISOString()
    hidden.metadata.queueHiddenAt = hidden.updatedAt
    registerTextTaskControlPersistenceContext(hidden, duplicate)
    expect(await persist(fixture, hidden, path)).toBe(true)
    expect(await fixture.repository.findById(fixture.task.id, principal)).toEqual(hidden)
  })

  it('keeps receipt-free draft recovery compatible without inventing completion evidence', async () => {
    const fixture = await setup()
    const recovered = structuredClone(fixture.task)
    recovered.status = 'completed'
    recovered.progress = 100
    recovered.updatedAt = new Date().toISOString()
    recovered.metadata.textResult = { script: 'Recovered durable draft' }
    recovered.metadata.scriptWritebackRecoveredAt = recovered.updatedAt
    releaseGenerationTaskLease(recovered)
    registerTextTaskControlPersistenceContext(recovered, fixture.task)
    expect(await persist(fixture, recovered, path)).toBe(true)
    expect(
      (await fixture.repository.findById(fixture.task.id, principal))?.metadata.textCompletionReceipt,
    ).toBeUndefined()
  })
})
