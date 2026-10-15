import Fastify, { type FastifyInstance } from 'fastify'
import { textCompletionSnapshotSchema, type GenerationTask, type Principal } from '@seqora/contracts'
import { afterEach, assert, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../core/errors.js'
import { claimGenerationTaskLease, releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { buildTextCompletionReceipt, createTextCompletionRecorder } from '../../core/jobs/textCompletion.js'
import { captureTextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { queuedTextTask } from '../../testing/generationTaskFixtures.js'
import { GenerationTaskRepository } from './repository.js'
import type { GenerationTaskRow } from './repositoryData.js'
import { registerGenerationRoutes } from './routes.js'
import { GenerationService } from './service.js'

const principal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}
const completedAt = '2026-10-15T03:00:00.000Z'
const privateResult = '合成历史正文，不应随来源回执接口返回。'
const privateResponse = '合成适配器候选，不应随来源回执接口返回。'
const apps: FastifyInstance[] = []

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  vi.restoreAllMocks()
})

async function completedTask() {
  const task = queuedTextTask('text-completion-http')
  claimGenerationTaskLease(task, 'synthetic-worker', 60_000)
  const guard = captureTextTaskWriteGuard(task)
  const recorder = createTextCompletionRecorder(
    { generate: async () => privateResponse },
    { taskWriteGuard: guard },
  )
  await recorder.provider!.generate({
    systemPrompt: 'synthetic-system-prompt',
    userPrompt: 'synthetic-user-prompt',
    model: task.model!,
    timingLabel: 'rewrite',
  })
  const result = recorder.finish({ script: privateResult, warnings: [] }, 'mixed')
  const receipt = buildTextCompletionReceipt(task, result, guard, completedAt)
  assert(receipt)
  task.status = 'completed'
  task.progress = 100
  task.updatedAt = completedAt
  task.metadata = {
    ...task.metadata,
    localTaskCompletedAt: completedAt,
    textResult: result,
    textCompletionReceipt: receipt,
    unrelatedSecret: 'synthetic-private-metadata',
  }
  releaseGenerationTaskLease(task)
  return task
}

async function fixture(
  options: {
    task?: GenerationTask
    transform?: (task: GenerationTask) => void
    database?: AccountDatabase
  } = {},
) {
  const task = options.task ?? (await completedTask())
  options.transform?.(task)
  const store = new AppStore(null)
  await store.initialize()
  await store.mutate((state) => {
    state.tasks = [task]
    const project = state.projects.find((entry) => entry.id === task.projectId)
    if (project) project.script = '用户后来编辑的项目正文，与历史任务结果不同。'
  })
  const initial = store.read((state) => state)
  const mutate = vi.spyOn(store, 'mutate')
  const transaction = vi.spyOn(store, 'transaction')
  const dispatch = vi.fn(async () => {})
  const generate = vi.fn(async () => 'must not generate')
  const storage = { put: vi.fn(), get: vi.fn(), getStream: vi.fn(), getSignedUrl: vi.fn(), delete: vi.fn() }
  const repository = new GenerationTaskRepository(store, null, options.database)
  const service = new GenerationService(repository, { dispatch }, null, 'stringx-seedance', storage, null, {
    generate,
  })
  const app = Fastify({ routerOptions: { maxParamLength: 4_096 } })
  apps.push(app)
  app.addHook('onRequest', async (request) => {
    const actor = request.headers['x-test-actor']
    if (actor === 'auth-gate')
      throw new AppError(
        403,
        'EMAIL_VERIFICATION_REQUIRED',
        'Email verification is required before continuing',
      )
    const actors: Record<string, Principal> = {
      member: principal,
      other: { ...principal, userId: 'another-user' },
      foreign: { ...principal, tenantId: 'another-tenant' },
      manager: { ...principal, userId: 'tenant-manager', roles: ['organization_admin'] },
      'foreign-manager': { ...principal, tenantId: 'another-tenant', roles: ['organization_admin'] },
      forbidden: { ...principal, roles: [] },
    }
    if (typeof actor === 'string' && actors[actor]) request.principal = actors[actor]
  })
  await registerGenerationRoutes(app, service)
  const query = async (actor = 'member', id = task.id) => {
    const response = await app.inject({
      method: 'GET',
      url: `/generation/tasks/${id}/text-completion`,
      headers: actor ? { 'x-test-actor': actor } : {},
    })
    expect(response.headers['cache-control']).toBe('private, no-store')
    return response
  }
  const assertReadOnly = () => {
    expect(store.read((state) => state)).toEqual(initial)
    for (const method of [mutate, transaction, dispatch, generate, ...Object.values(storage)])
      expect(method).not.toHaveBeenCalled()
  }
  return { app, task, store, query, assertReadOnly }
}

describe('GET text completion provenance', () => {
  it('returns a verified historical task snapshot without exposing text or doing work', async () => {
    const f = await fixture()
    const response = await f.query()
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    const snapshot = textCompletionSnapshotSchema.parse(response.json())
    expect(snapshot).toMatchObject({
      version: 'seqora.text-completion-query.v1',
      taskId: f.task.id,
      tenantId: f.task.tenantId,
      projectId: f.task.projectId,
      taskUpdatedAt: completedAt,
      checkedAt: expect.any(String),
      taskStatus: 'completed',
      reason: 'verified',
      receipt: f.task.metadata.textCompletionReceipt,
    })
    expect(Object.keys(response.json()).sort()).toEqual([
      'checkedAt',
      'projectId',
      'reason',
      'receipt',
      'taskId',
      'taskStatus',
      'taskUpdatedAt',
      'tenantId',
      'version',
    ])
    for (const privateValue of [privateResult, privateResponse, f.task.prompt, 'synthetic-private-metadata'])
      expect(response.body).not.toContain(privateValue)
    expect(response.body).not.toContain('leaseToken')
    expect(response.body).not.toContain('providerCompletionReceipt')
    f.assertReadOnly()
  })

  it.each([
    ['', 401],
    ['forbidden', 403],
    ['auth-gate', 403],
    ['other', 404],
    ['foreign', 404],
    ['foreign-manager', 404],
  ] as const)('rejects inaccessible requests for actor %s with %s', async (actor, status) => {
    const f = await fixture()
    const response = await f.query(actor)
    expect(response.statusCode).toBe(status)
    expect(response.body).not.toContain('receipt')
    expect(response.body).not.toContain(privateResult)
    f.assertReadOnly()
  })

  it('allows an organization manager to inspect another member within the same organization', async () => {
    const f = await fixture()
    const response = await f.query('manager')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ reason: 'verified', taskId: f.task.id })
    f.assertReadOnly()
  })

  it('returns an indistinguishable 404 for a missing task and a standalone project task', async () => {
    const f = await fixture({
      transform: (task) => {
        task.projectId = 'sm-standalone-hidden'
      },
    })
    const hidden = await f.query()
    const missing = await f.query('member', 'missing-task')
    expect(hidden.statusCode).toBe(404)
    expect(missing.statusCode).toBe(404)
    expect(hidden.json()).toEqual(missing.json())
    f.assertReadOnly()
  })

  it.each([
    ['image', 'img2'],
    ['video', 'text'],
    ['text', 'local'],
  ] as const)('rejects unsupported %s/%s tasks without revealing a receipt', async (kind, provider) => {
    const f = await fixture({
      transform: (task) => {
        task.kind = kind
        task.provider = provider
      },
    })
    const response = await f.query()
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'TEXT_COMPLETION_UNSUPPORTED' })
    expect(response.body).not.toContain('seqora.text-completion.v1')
    f.assertReadOnly()
  })

  it('rejects an overlength task parameter before looking up its provenance', async () => {
    const f = await fixture()
    const response = await f.query('member', 'a'.repeat(129))
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    f.assertReadOnly()
  })

  it.each(['queued', 'paused', 'running', 'failed', 'cancelled'] as const)(
    'withholds stale receipts when the current task is %s',
    async (status) => {
      const f = await fixture({
        transform: (task) => {
          task.status = status
        },
      })
      const response = await f.query()
      expect(response.statusCode).toBe(200)
      expect(textCompletionSnapshotSchema.parse(response.json())).toMatchObject({
        reason: 'task-not-completed',
        taskStatus: status,
        receipt: null,
      })
      expect(response.body).not.toContain('seqora.text-completion.v1')
      f.assertReadOnly()
    },
  )

  it.each(['missing-receipt', 'invalid-receipt', 'receipt-mismatch'] as const)(
    'returns %s without exposing unverified receipt data',
    async (reason) => {
      const f = await fixture({
        transform: (task) => {
          if (reason === 'missing-receipt') delete task.metadata.textCompletionReceipt
          if (reason === 'invalid-receipt') task.metadata.textCompletionReceipt = { private: privateResponse }
          if (reason === 'receipt-mismatch') task.metadata.textResult = { script: '已篡改的历史结果' }
        },
      })
      const response = await f.query()
      expect(response.statusCode).toBe(200)
      expect(textCompletionSnapshotSchema.parse(response.json())).toMatchObject({
        reason,
        taskStatus: 'completed',
        receipt: null,
      })
      expect(response.body).not.toContain(privateResponse)
      f.assertReadOnly()
    },
  )

  it('reports current bookkeeping version while preserving valid historical completion evidence', async () => {
    const updatedAt = '2026-10-15T04:00:00.000Z'
    const f = await fixture({
      transform: (task) => {
        task.updatedAt = updatedAt
        task.metadata.queueHiddenAt = updatedAt
      },
    })
    const response = await f.query()
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      taskUpdatedAt: updatedAt,
      reason: 'verified',
      receipt: { completedAt },
    })
    f.assertReadOnly()
  })

  it('uses the scoped database row instead of a stale completed runtime cache', async () => {
    const stale = await completedTask()
    const current = structuredClone(stale)
    current.status = 'running'
    current.updatedAt = '2026-10-15T04:00:00.000Z'
    current.attempts = 2
    delete current.metadata.textCompletionReceipt
    const query = vi.fn(async () => ({ rows: [taskRow(current)] }))
    const f = await fixture({ task: stale, database: { query } as unknown as AccountDatabase })
    const response = await f.query()
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      taskUpdatedAt: current.updatedAt,
      taskStatus: 'running',
      reason: 'task-not-completed',
      receipt: null,
    })
    expect(query).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith(expect.stringContaining('AND tenant_id = $2'), [
      stale.id,
      principal.tenantId,
      false,
      principal.userId,
    ])
    f.assertReadOnly()
  })

  it.each(['missing', 'unavailable'] as const)(
    'does not fall back to a cached receipt when the database is %s',
    async (mode) => {
      const query = vi.fn(async () => {
        if (mode === 'unavailable') throw new Error('Synthetic database unavailable')
        return { rows: [] }
      })
      const f = await fixture({ database: { query } as unknown as AccountDatabase })
      const response = await f.query()
      expect(response.statusCode).toBe(mode === 'missing' ? 404 : 500)
      expect(response.body).not.toContain('seqora.text-completion.v1')
      expect(query).toHaveBeenCalledOnce()
      f.assertReadOnly()
    },
  )
})

function taskRow(task: GenerationTask): GenerationTaskRow {
  return {
    id: task.id,
    client_request_id: task.clientRequestId,
    project_id: task.projectId,
    tenant_id: task.tenantId,
    user_id: task.userId,
    kind: task.kind,
    label: task.label,
    prompt: task.prompt,
    negative_prompt: task.negativePrompt,
    provider: task.provider,
    model: task.model,
    tier: task.tier ?? null,
    metadata: structuredClone(task.metadata),
    status: task.status,
    progress: task.progress,
    estimated_credits: task.estimatedCredits,
    attempts: task.attempts ?? 0,
    max_attempts: task.maxAttempts ?? null,
    lease_owner_id: task.leaseOwnerId ?? null,
    lease_token: task.leaseToken ?? null,
    lease_acquired_at: task.leaseAcquiredAt ?? null,
    lease_heartbeat_at: task.leaseHeartbeatAt ?? null,
    lease_expires_at: task.leaseExpiresAt ?? null,
    result_url: task.resultUrl,
    outputs: task.outputs,
    error: task.error,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  }
}
