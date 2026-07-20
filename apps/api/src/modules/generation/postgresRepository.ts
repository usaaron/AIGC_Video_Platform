import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import { taskFromRow, type TaskRow } from '../../infra/postgresState.js'
import type { CreateReservedTaskResult, GenerationTaskStore } from './repository.js'

const PROVIDER_RETRY_METADATA_KEYS = new Set([
  'providerName',
  'providerState',
  'providerTaskId',
  'providerPolledAt',
  'providerPollErrors',
])

const TASK_COLUMNS = `
  id, client_request_id as "clientRequestId", project_id as "projectId",
  tenant_id as "tenantId", user_id as "userId", kind, label, prompt,
  negative_prompt as "negativePrompt", provider, model, metadata, status,
  progress, estimated_credits as "estimatedCredits", result_url as "resultUrl",
  outputs, error, created_at as "createdAt", updated_at as "updatedAt"
`

export class PostgresGenerationTaskRepository implements GenerationTaskStore {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async createWithCredit(
    input: CreateGenerationTask,
    principal: Principal,
  ): Promise<CreateReservedTaskResult> {
    return this.transactions.withTransaction(async (client) => {
      const existingBeforeLock = await findByClientRequestId(client, input.clientRequestId, principal)
      if (existingBeforeLock) return { task: existingBeforeLock }

      const project = await client.query<{ id: string }>(
        `
          select id
          from projects
          where id = $1 and tenant_id = $2 and owner_id = $3
          for key share
        `,
        [input.projectId, principal.tenantId, principal.userId],
      )
      if (!project.rows[0]) return { error: 'project-not-found' }

      const user = await client.query<{ id: string; tenantId: string; credits: number }>(
        `
          select id, tenant_id as "tenantId", credits
          from users
          where id = $1 and tenant_id = $2
          for update
        `,
        [principal.userId, principal.tenantId],
      )
      const lockedUser = user.rows[0]
      if (!lockedUser) return { error: 'account-not-found' }

      const existingAfterLock = await findByClientRequestId(client, input.clientRequestId, principal)
      if (existingAfterLock) return { task: existingAfterLock }

      const now = new Date().toISOString()
      const ledgerId = `generation-${input.clientRequestId}`
      const ledger = await client.query<{ id: string }>(
        `
          select id
          from ledger_entries
          where id = $1 and user_id = $2 and tenant_id = $3
          for update
        `,
        [ledgerId, lockedUser.id, lockedUser.tenantId],
      )
      const hasReservedCredits = Boolean(ledger.rows[0])
      const nextCredits = lockedUser.credits - input.estimatedCredits
      if (!hasReservedCredits && nextCredits < 0) return { error: 'insufficient-credits' }

      if (!hasReservedCredits) {
        await client.query(
          `
            update users
            set credits = $1, updated_at = $2
            where id = $3 and tenant_id = $4
          `,
          [nextCredits, now, lockedUser.id, lockedUser.tenantId],
        )
        await client.query(
          `
            insert into ledger_entries (
              id, user_id, tenant_id, amount, balance, type, description, created_at
            )
            values ($1, $2, $3, $4, $5, 'generation', $6, $7)
          `,
          [
            ledgerId,
            lockedUser.id,
            lockedUser.tenantId,
            -input.estimatedCredits,
            nextCredits,
            input.label,
            now,
          ],
        )
      }

      const task = taskFor(input, principal, now)
      const inserted = await insertTask(client, task)
      if (inserted) return { task: inserted }

      const existing = await findByClientRequestId(client, input.clientRequestId, principal)
      return existing ? { task: existing } : { error: 'project-not-found' }
    })
  }

  async listByProject(projectId: string, principal: Principal): Promise<GenerationTask[]> {
    return this.transactions.withTransaction(async (client) => {
      const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
      const result = await client.query<TaskRow>(
        `
          select ${TASK_COLUMNS}
          from generation_tasks
          where project_id = $1
            and tenant_id = $2
            and ($3::boolean or user_id = $4)
          order by created_at desc, id
        `,
        [projectId, principal.tenantId, canReadAll, principal.userId],
      )
      return result.rows.map(taskFromRow)
    })
  }

  async findById(taskId: string, principal: Principal): Promise<GenerationTask | null> {
    return this.transactions.withTransaction(async (client) => findById(client, taskId, principal))
  }

  async retry(taskId: string, principal: Principal): Promise<GenerationTask | null> {
    return this.transactions.withTransaction(async (client) => {
      const task = await findById(client, taskId, principal, { lock: true })
      if (!task) return null

      const metadata = Object.fromEntries(
        Object.entries(task.metadata).filter(([key]) => !PROVIDER_RETRY_METADATA_KEYS.has(key)),
      )
      const now = new Date().toISOString()
      const result = await client.query<TaskRow>(
        `
          update generation_tasks
          set metadata = $1::jsonb,
            status = 'queued',
            progress = 0,
            error = null,
            result_url = null,
            outputs = '[]'::jsonb,
            updated_at = $2
          where id = $3
          returning ${TASK_COLUMNS}
        `,
        [JSON.stringify(metadata), now, task.id],
      )
      return result.rows[0] ? taskFromRow(result.rows[0]) : null
    })
  }

  async clearCompleted(projectId: string, principal: Principal): Promise<number> {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `
          delete from generation_tasks
          where project_id = $1
            and tenant_id = $2
            and user_id = $3
            and status in ('completed', 'failed', 'cancelled')
          returning id
        `,
        [projectId, principal.tenantId, principal.userId],
      )
      return result.rowCount ?? result.rows.length
    })
  }
}

async function findByClientRequestId(
  client: PoolClient,
  clientRequestId: string,
  principal: Principal,
): Promise<GenerationTask | null> {
  const result = await client.query<TaskRow>(
    `
      select ${TASK_COLUMNS}
      from generation_tasks
      where client_request_id = $1 and user_id = $2 and tenant_id = $3
      for update
    `,
    [clientRequestId, principal.userId, principal.tenantId],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

async function findById(
  client: PoolClient,
  taskId: string,
  principal: Principal,
  options: { lock?: boolean } = {},
): Promise<GenerationTask | null> {
  const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
  const result = await client.query<TaskRow>(
    `
      select ${TASK_COLUMNS}
      from generation_tasks
      where id = $1
        and tenant_id = $2
        and ($3::boolean or user_id = $4)
      ${options.lock ? 'for update' : ''}
    `,
    [taskId, principal.tenantId, canReadAll, principal.userId],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

async function insertTask(client: PoolClient, task: GenerationTask): Promise<GenerationTask | null> {
  const result = await client.query<TaskRow>(
    `
      insert into generation_tasks (
        id, client_request_id, project_id, tenant_id, user_id, kind, label,
        prompt, negative_prompt, provider, model, metadata, status, progress,
        estimated_credits, result_url, outputs, error, created_at, updated_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12::jsonb, $13, $14, $15, $16, $17::jsonb, $18, $19, $20
      )
      on conflict (user_id, client_request_id) do nothing
      returning ${TASK_COLUMNS}
    `,
    [
      task.id,
      task.clientRequestId,
      task.projectId,
      task.tenantId,
      task.userId,
      task.kind,
      task.label,
      task.prompt,
      task.negativePrompt,
      task.provider,
      task.model,
      JSON.stringify(task.metadata),
      task.status,
      task.progress,
      task.estimatedCredits,
      task.resultUrl,
      JSON.stringify(task.outputs),
      task.error,
      task.createdAt,
      task.updatedAt,
    ],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

function taskFor(input: CreateGenerationTask, principal: Principal, now: string): GenerationTask {
  return {
    id: randomUUID(),
    clientRequestId: input.clientRequestId,
    projectId: input.projectId,
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: input.kind,
    label: input.label,
    prompt: input.prompt ?? '',
    negativePrompt: input.negativePrompt ?? '',
    provider: input.provider,
    model: input.model ?? null,
    metadata: input.metadata ?? {},
    status: 'queued',
    progress: 0,
    estimatedCredits: input.estimatedCredits,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
}
