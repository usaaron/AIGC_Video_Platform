import type { Asset, GenerationTask } from '@seqora/contracts'
import type { PoolClient } from 'pg'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import {
  ASSET_COLUMNS,
  assetFromRow,
  TASK_COLUMNS,
  taskFromRow,
  type AssetRow,
  type TaskRow,
} from '../../infra/postgresRows.js'
import type { AppState, StateStore, StoredMedia, StoredUser } from '../../infra/store.js'
import { completeTaskWithOutputs } from './taskCompletionWriter.js'
import type { MaterializedGenerationOutputs } from './generatedAssetWriter.js'
import { localOutputsFor } from './taskRequestFactory.js'
import {
  AUDIO_PROVIDER_NAME,
  IMG2_PROVIDER_NAME,
  numberValue,
  REMOTE_PROVIDER_NAMES,
  SEEDANCE_PROVIDER_NAME,
} from './providerMetadata.js'

export interface RemoteTaskCapability {
  usesRemoteProvider(task: GenerationTask): boolean
  usesRemoteVideoProvider(task: GenerationTask): boolean
  usesRemoteImageProvider(task: GenerationTask): boolean
  usesRemoteAudioProvider(task: GenerationTask): boolean
}

export interface TaskDispatchPlan {
  video: GenerationTask[]
  image: GenerationTask[]
  audio: GenerationTask[]
  film: GenerationTask[]
}

export type ProviderSubmission = {
  status: GenerationTask['status']
  progress: number
  providerTaskId: string
}

export type ProviderStatusUpdate = {
  status: GenerationTask['status']
  progress: number
  error: string | null
}

export interface TaskRuntimeStore {
  hasActiveTasks(): Promise<boolean>
  claimQueuedTasks(remoteTasks: RemoteTaskCapability, canExportFilm: boolean): Promise<TaskDispatchPlan>
  advanceLocalTasks(): Promise<void>
  isTaskRunning(taskId: string): Promise<boolean>
  applyProviderSubmission(
    taskId: string,
    submission: ProviderSubmission,
    materialized: MaterializedGenerationOutputs | null,
  ): Promise<void>
  providerTasksDueForPoll(
    providerName: string,
    now: number,
    providerPollIntervalMs: number,
  ): Promise<GenerationTask[]>
  markPolled(taskId: string, now: number): Promise<void>
  applyProviderStatus(
    taskId: string,
    status: ProviderStatusUpdate,
    materialized: MaterializedGenerationOutputs | null,
  ): Promise<void>
  recordPollFailure(taskId: string, error: string): Promise<void>
  failTask(taskId: string, error: string): Promise<void>
  markFilmExportStarted(taskId: string): Promise<void>
  completeFilmExport(taskId: string, materialized: MaterializedGenerationOutputs): Promise<void>
}

export class StoreTaskRuntimeStore implements TaskRuntimeStore {
  constructor(private readonly store: StateStore) {}

  async hasActiveTasks(): Promise<boolean> {
    return this.store.read((state) =>
      state.tasks.some((task) => task.status === 'queued' || task.status === 'running'),
    )
  }

  async claimQueuedTasks(
    remoteTasks: RemoteTaskCapability,
    canExportFilm: boolean,
  ): Promise<TaskDispatchPlan> {
    return this.store.mutate((state) => {
      const now = new Date().toISOString()
      const selectedVideoTasks: GenerationTask[] = []
      const selectedImageTasks: GenerationTask[] = []
      const selectedAudioTasks: GenerationTask[] = []
      const selectedFilmExportTasks: GenerationTask[] = []

      state.tasks
        .filter(
          (task) =>
            task.status === 'running' &&
            REMOTE_PROVIDER_NAMES.has(stringValue(task.metadata.providerName, '')) &&
            task.metadata.providerState === 'submitting' &&
            !task.metadata.providerTaskId,
        )
        .forEach((task) => {
          task.status = 'failed'
          task.progress = 100
          task.error = '远程生成提交过程被中断，请重试此任务'
          task.updatedAt = now
        })

      for (const user of state.users) {
        const userTasks = state.tasks.filter((task) => task.userId === user.id)
        const running = userTasks.filter((task) => task.status === 'running')
        const available = Math.max(0, concurrencyFor(user) - running.length)
        userTasks
          .filter((task) => task.status === 'queued')
          .slice(0, available)
          .forEach((task) => {
            claimTaskForProvider(task, remoteTasks, canExportFilm, now)
            if (remoteTasks.usesRemoteVideoProvider(task)) selectedVideoTasks.push(task)
            if (remoteTasks.usesRemoteImageProvider(task)) selectedImageTasks.push(task)
            if (remoteTasks.usesRemoteAudioProvider(task)) selectedAudioTasks.push(task)
            if (isFilmExportTask(task, canExportFilm)) selectedFilmExportTasks.push(task)
          })
      }

      return {
        video: selectedVideoTasks,
        image: selectedImageTasks,
        audio: selectedAudioTasks,
        film: selectedFilmExportTasks,
      }
    })
  }

  async advanceLocalTasks(): Promise<void> {
    await this.store.mutate((state) => {
      const now = new Date().toISOString()
      state.tasks
        .filter(
          (task) =>
            task.status === 'running' &&
            !MANAGED_PROVIDER_NAMES.has(stringValue(task.metadata.providerName, '')),
        )
        .forEach((task) => {
          task.progress = Math.min(100, task.progress + 12)
          task.updatedAt = now
          if (task.progress >= 100) {
            completeTaskWithOutputs(state, task, localOutputsFor(task), now)
          }
        })
    })
  }

  async isTaskRunning(taskId: string): Promise<boolean> {
    return this.store.read((state) =>
      state.tasks.some((task) => task.id === taskId && task.status === 'running'),
    )
  }

  async applyProviderSubmission(
    taskId: string,
    submission: ProviderSubmission,
    materialized: MaterializedGenerationOutputs | null,
  ): Promise<void> {
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === taskId)
      if (!stored || stored.status !== 'running') return
      stored.progress = Math.max(1, submission.progress)
      stored.metadata = {
        ...stored.metadata,
        providerState: submission.status,
        providerTaskId: submission.providerTaskId,
        providerPolledAt: Date.now(),
        providerPollErrors: 0,
      }
      stored.updatedAt = new Date().toISOString()
      if (submission.status === 'completed' && materialized) {
        addGeneratedMedia(state, materialized.media)
        completeTaskWithOutputs(state, stored, materialized.outputs, stored.updatedAt)
      }
    })
  }

  providerTasksDueForPoll(
    providerName: string,
    now: number,
    providerPollIntervalMs: number,
  ): Promise<GenerationTask[]> {
    return this.store.read((state) =>
      state.tasks.filter(
        (task) =>
          task.status === 'running' &&
          task.metadata.providerName === providerName &&
          typeof task.metadata.providerTaskId === 'string' &&
          now - numberValue(task.metadata.providerPolledAt, 0) >= providerPollIntervalMs,
      ),
    )
  }

  async markPolled(taskId: string, now: number): Promise<void> {
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === taskId)
      if (stored) stored.metadata = { ...stored.metadata, providerPolledAt: now }
    })
  }

  async applyProviderStatus(
    taskId: string,
    status: ProviderStatusUpdate,
    materialized: MaterializedGenerationOutputs | null,
  ): Promise<void> {
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === taskId)
      if (!stored || stored.status !== 'running') return
      stored.status = status.status
      stored.progress = status.progress
      stored.error = status.error
      stored.metadata = { ...stored.metadata, providerState: status.status, providerPollErrors: 0 }
      stored.updatedAt = new Date().toISOString()
      if (status.status === 'completed' && materialized) {
        addGeneratedMedia(state, materialized.media)
        completeTaskWithOutputs(state, stored, materialized.outputs, stored.updatedAt)
      }
    })
  }

  async recordPollFailure(taskId: string, error: string): Promise<void> {
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === taskId)
      if (!stored) return
      const attempts = numberValue(stored.metadata.providerPollErrors, 0) + 1
      if (attempts >= 3) {
        stored.status = 'failed'
        stored.progress = 100
        stored.error = error.slice(0, 1_000)
        stored.updatedAt = new Date().toISOString()
        return
      }
      stored.metadata = { ...stored.metadata, providerPollErrors: attempts }
    })
  }

  async failTask(taskId: string, error: string): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return
      task.status = 'failed'
      task.progress = 100
      task.error = error.slice(0, 1_000)
      task.updatedAt = new Date().toISOString()
    })
  }

  async markFilmExportStarted(taskId: string): Promise<void> {
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === taskId)
      if (!stored || stored.status !== 'running') return
      stored.progress = Math.max(5, stored.progress)
      stored.updatedAt = new Date().toISOString()
    })
  }

  async completeFilmExport(taskId: string, materialized: MaterializedGenerationOutputs): Promise<void> {
    await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === taskId)
      if (!stored || stored.status !== 'running') return
      addGeneratedMedia(state, materialized.media)
      stored.metadata = { ...stored.metadata, providerState: 'completed' }
      completeTaskWithOutputs(state, stored, materialized.outputs, new Date().toISOString())
    })
  }
}

export class PostgresTaskRuntimeStore implements TaskRuntimeStore {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async hasActiveTasks(): Promise<boolean> {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query<{ exists: boolean }>(
        `
          select exists (
            select 1
            from generation_tasks
            where status in ('queued', 'running')
          ) as "exists"
        `,
      )
      return Boolean(result.rows[0]?.exists)
    })
  }

  async claimQueuedTasks(
    remoteTasks: RemoteTaskCapability,
    canExportFilm: boolean,
  ): Promise<TaskDispatchPlan> {
    return this.transactions.withTransaction(async (client) => {
      const now = new Date().toISOString()
      await failInterruptedProviderSubmissions(client, now)

      const plan: TaskDispatchPlan = { video: [], image: [], audio: [], film: [] }
      const users = await client.query<Pick<StoredUser, 'id' | 'tenantId' | 'plan'>>(
        `
          select id, tenant_id as "tenantId", plan
          from users
          where exists (
            select 1
            from generation_tasks
            where generation_tasks.user_id = users.id
              and generation_tasks.tenant_id = users.tenant_id
              and generation_tasks.status = 'queued'
          )
          order by tenant_id, id
          for update skip locked
        `,
      )

      for (const user of users.rows) {
        const running = await runningTaskCount(client, user)
        const available = Math.max(0, concurrencyFor(user) - running)
        if (available === 0) continue

        const queued = await client.query<TaskRow>(
          `
            select ${TASK_COLUMNS}
            from generation_tasks
            where user_id = $1
              and tenant_id = $2
              and status = 'queued'
            order by created_at, id
            for update skip locked
            limit $3
          `,
          [user.id, user.tenantId, available],
        )

        for (const row of queued.rows) {
          const task = taskFromRow(row)
          claimTaskForProvider(task, remoteTasks, canExportFilm, now)
          const claimed = await updateClaimedTask(client, task)
          if (!claimed) continue
          if (remoteTasks.usesRemoteVideoProvider(claimed)) plan.video.push(claimed)
          if (remoteTasks.usesRemoteImageProvider(claimed)) plan.image.push(claimed)
          if (remoteTasks.usesRemoteAudioProvider(claimed)) plan.audio.push(claimed)
          if (isFilmExportTask(claimed, canExportFilm)) plan.film.push(claimed)
        }
      }

      return plan
    })
  }

  async advanceLocalTasks(): Promise<void> {
    const storageKeysToDelete: string[] = []
    try {
      await this.transactions.withTransaction(async (client) => {
        const result = await client.query<TaskRow>(
          `
            select ${TASK_COLUMNS}
            from generation_tasks
            where status = 'running'
              and coalesce(metadata->>'providerName', '') <> all($1::text[])
            order by updated_at, id
            for update skip locked
          `,
          [[...MANAGED_PROVIDER_NAMES]],
        )

        for (const row of result.rows) {
          const task = taskFromRow(row)
          const now = new Date().toISOString()
          const progress = Math.min(100, task.progress + 12)
          if (progress >= 100) {
            const materialized = { outputs: localOutputsFor(task), media: [] }
            await completeTaskWithMaterializedOutputs(client, task, materialized, {
              now,
              metadata: task.metadata,
            })
            continue
          }

          await updateTaskRuntimeFields(client, task.id, {
            progress,
            updatedAt: now,
          })
        }
      })
    } catch (error) {
      await cleanupStorageKeys(storageKeysToDelete)
      throw error
    }
  }

  async isTaskRunning(taskId: string): Promise<boolean> {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query<{ exists: boolean }>(
        `
          select exists (
            select 1
            from generation_tasks
            where id = $1 and status = 'running'
          ) as "exists"
        `,
        [taskId],
      )
      return Boolean(result.rows[0]?.exists)
    })
  }

  async applyProviderSubmission(
    taskId: string,
    submission: ProviderSubmission,
    materialized: MaterializedGenerationOutputs | null,
  ): Promise<void> {
    await this.withMaterializedCleanup(
      materialized,
      async (client, task) => {
        const now = new Date().toISOString()
        const metadata = {
          ...task.metadata,
          providerState: submission.status,
          providerTaskId: submission.providerTaskId,
          providerPolledAt: Date.now(),
          providerPollErrors: 0,
        }
        if (submission.status === 'completed' && materialized) {
          await completeTaskWithMaterializedOutputs(client, task, materialized, { now, metadata })
          return
        }

        await updateTaskRuntimeFields(client, task.id, {
          progress: Math.max(1, submission.progress),
          metadata,
          updatedAt: now,
        })
      },
      taskId,
    )
  }

  providerTasksDueForPoll(
    providerName: string,
    now: number,
    providerPollIntervalMs: number,
  ): Promise<GenerationTask[]> {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query<TaskRow>(
        `
          select ${TASK_COLUMNS}
          from generation_tasks
          where status = 'running'
            and metadata->>'providerName' = $1
            and metadata->>'providerTaskId' is not null
            and $2 - coalesce((metadata->>'providerPolledAt')::bigint, 0) >= $3
          order by updated_at, id
        `,
        [providerName, now, providerPollIntervalMs],
      )
      return result.rows.map(taskFromRow)
    })
  }

  async markPolled(taskId: string, now: number): Promise<void> {
    await this.transactions.withTransaction(async (client) => {
      const task = await lockedTask(client, taskId)
      if (!task) return
      await updateTaskRuntimeFields(client, task.id, {
        metadata: { ...task.metadata, providerPolledAt: now },
      })
    })
  }

  async applyProviderStatus(
    taskId: string,
    status: ProviderStatusUpdate,
    materialized: MaterializedGenerationOutputs | null,
  ): Promise<void> {
    await this.withMaterializedCleanup(
      materialized,
      async (client, task) => {
        const now = new Date().toISOString()
        const metadata = { ...task.metadata, providerState: status.status, providerPollErrors: 0 }
        if (status.status === 'completed' && materialized) {
          await completeTaskWithMaterializedOutputs(client, task, materialized, { now, metadata })
          return
        }

        await updateTaskRuntimeFields(client, task.id, {
          status: status.status,
          progress: status.progress,
          error: status.error,
          metadata,
          updatedAt: now,
        })
      },
      taskId,
    )
  }

  async recordPollFailure(taskId: string, error: string): Promise<void> {
    await this.transactions.withTransaction(async (client) => {
      const task = await lockedTask(client, taskId)
      if (!task) return
      const attempts = numberValue(task.metadata.providerPollErrors, 0) + 1
      if (attempts >= 3) {
        await failTaskRow(client, task.id, error)
        return
      }
      await updateTaskRuntimeFields(client, task.id, {
        metadata: { ...task.metadata, providerPollErrors: attempts },
      })
    })
  }

  async failTask(taskId: string, error: string): Promise<void> {
    await this.transactions.withTransaction(async (client) => {
      await failTaskRow(client, taskId, error)
    })
  }

  async markFilmExportStarted(taskId: string): Promise<void> {
    await this.transactions.withTransaction(async (client) => {
      const task = await lockedTask(client, taskId)
      if (!task || task.status !== 'running') return
      await updateTaskRuntimeFields(client, task.id, {
        progress: Math.max(5, task.progress),
        updatedAt: new Date().toISOString(),
      })
    })
  }

  async completeFilmExport(taskId: string, materialized: MaterializedGenerationOutputs): Promise<void> {
    await this.withMaterializedCleanup(
      materialized,
      async (client, task) => {
        await completeTaskWithMaterializedOutputs(client, task, materialized, {
          now: new Date().toISOString(),
          metadata: { ...task.metadata, providerState: 'completed' },
        })
      },
      taskId,
    )
  }

  private async withMaterializedCleanup(
    materialized: MaterializedGenerationOutputs | null,
    operation: (client: PoolClient, task: GenerationTask) => Promise<void>,
    taskId: string,
  ): Promise<void> {
    try {
      await this.transactions.withTransaction(async (client) => {
        const task = await lockedTask(client, taskId)
        if (!task || task.status !== 'running') return
        await operation(client, task)
      })
    } catch (error) {
      await cleanupStorageKeys(materialized?.media.map((item) => item.storageKey) ?? [])
      throw error
    }
  }
}

function addGeneratedMedia(state: AppState, media: StoredMedia[]): void {
  for (const item of media) {
    if (!state.media.some((stored) => stored.id === item.id)) state.media.unshift(item)
  }
}

function claimTaskForProvider(
  task: GenerationTask,
  remoteTasks: RemoteTaskCapability,
  canExportFilm: boolean,
  now: string,
): void {
  task.status = 'running'
  task.progress = remoteTasks.usesRemoteProvider(task) ? 1 : 8
  task.updatedAt = now
  if (remoteTasks.usesRemoteVideoProvider(task)) {
    task.metadata = {
      ...task.metadata,
      providerName: SEEDANCE_PROVIDER_NAME,
      providerState: 'submitting',
    }
  }
  if (remoteTasks.usesRemoteImageProvider(task)) {
    task.metadata = {
      ...task.metadata,
      providerName: IMG2_PROVIDER_NAME,
      providerState: 'submitting',
    }
  }
  if (remoteTasks.usesRemoteAudioProvider(task)) {
    task.metadata = {
      ...task.metadata,
      providerName: AUDIO_PROVIDER_NAME,
      providerState: 'submitting',
    }
  }
  if (isFilmExportTask(task, canExportFilm)) {
    task.progress = 1
    task.metadata = {
      ...task.metadata,
      providerName: FILM_EXPORT_PROVIDER_NAME,
      providerState: 'exporting',
    }
  }
}

async function failInterruptedProviderSubmissions(client: PoolClient, now: string): Promise<void> {
  await client.query(
    `
      update generation_tasks
      set status = 'failed',
        progress = 100,
        error = '远程生成提交过程被中断，请重试此任务',
        updated_at = $1
      where status = 'running'
        and metadata->>'providerName' = any($2::text[])
        and metadata->>'providerState' = 'submitting'
        and metadata->>'providerTaskId' is null
    `,
    [now, [...REMOTE_PROVIDER_NAMES]],
  )
}

async function runningTaskCount(
  client: PoolClient,
  user: Pick<StoredUser, 'id' | 'tenantId'>,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `
      select count(*) as "count"
      from generation_tasks
      where user_id = $1 and tenant_id = $2 and status = 'running'
    `,
    [user.id, user.tenantId],
  )
  return Number.parseInt(result.rows[0]?.count ?? '0', 10)
}

async function updateClaimedTask(client: PoolClient, task: GenerationTask): Promise<GenerationTask | null> {
  const result = await client.query<TaskRow>(
    `
      update generation_tasks
      set status = $2,
        progress = $3,
        metadata = $4::jsonb,
        updated_at = $5
      where id = $1 and status = 'queued'
      returning ${TASK_COLUMNS}
    `,
    [task.id, task.status, task.progress, JSON.stringify(task.metadata), task.updatedAt],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

async function lockedTask(client: PoolClient, taskId: string): Promise<GenerationTask | null> {
  const result = await client.query<TaskRow>(
    `
      select ${TASK_COLUMNS}
      from generation_tasks
      where id = $1
      for update
    `,
    [taskId],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

async function updateTaskRuntimeFields(
  client: PoolClient,
  taskId: string,
  input: {
    status?: GenerationTask['status']
    progress?: number
    error?: string | null
    metadata?: Record<string, unknown>
    resultUrl?: string | null
    outputs?: GenerationTask['outputs']
    updatedAt?: string
  },
): Promise<void> {
  await client.query(
    `
      update generation_tasks
      set status = coalesce($2::text, status),
        progress = coalesce($3::integer, progress),
        error = case when $4::boolean then $5::text else error end,
        metadata = coalesce($6::jsonb, metadata),
        result_url = case when $7::boolean then $8::text else result_url end,
        outputs = coalesce($9::jsonb, outputs),
        updated_at = coalesce($10::timestamptz, updated_at)
      where id = $1
    `,
    [
      taskId,
      input.status ?? null,
      input.progress ?? null,
      Object.hasOwn(input, 'error'),
      input.error ?? null,
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
      Object.hasOwn(input, 'resultUrl'),
      input.resultUrl ?? null,
      input.outputs === undefined ? null : JSON.stringify(input.outputs),
      input.updatedAt ?? null,
    ],
  )
}

async function completeTaskWithMaterializedOutputs(
  client: PoolClient,
  task: GenerationTask,
  materialized: MaterializedGenerationOutputs,
  options: { now: string; metadata: Record<string, unknown> },
): Promise<void> {
  await insertGeneratedMedia(client, materialized.media)
  await updateTaskRuntimeFields(client, task.id, {
    status: 'completed',
    progress: 100,
    error: null,
    metadata: options.metadata,
    resultUrl: materialized.outputs[0]?.url ?? null,
    outputs: materialized.outputs,
    updatedAt: options.now,
  })

  if (task.kind === 'image') {
    await writeImageOutputsToAsset(client, task, materialized.outputs, options.now)
  }
  if (task.kind === 'audio') {
    await writeAudioOutputsToAsset(client, task, materialized.outputs, options.now)
  }
}

async function insertGeneratedMedia(client: PoolClient, media: StoredMedia[]): Promise<void> {
  for (const item of media) {
    await client.query(
      `
        insert into media (
          id, project_id, tenant_id, kind, name, content_type, size, storage_key, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (id) do nothing
      `,
      [
        item.id,
        item.projectId,
        item.tenantId,
        item.kind,
        item.name,
        item.contentType,
        item.size,
        item.storageKey,
        item.createdAt,
      ],
    )
  }
}

async function writeImageOutputsToAsset(
  client: PoolClient,
  task: GenerationTask,
  outputs: GenerationTask['outputs'],
  now: string,
): Promise<void> {
  const assetId = stringValue(task.metadata.assetId, '')
  const imageOutputs = outputs.filter((output) => output.mediaType === 'image' && output.url)
  if (!assetId || imageOutputs.length === 0) return

  const asset = await lockedAsset(client, task, assetId)
  if (!asset) return

  const stage = characterGenerationStageFor(task.metadata.generationStage, task.metadata.turnaround)
  const primaryOutput = primaryImageOutputFor(stage, imageOutputs)
  const nextAsset: Asset = {
    ...asset,
    imageUrl: primaryOutput.url,
    status: 'confirmed',
    updatedAt: now,
  }

  if (asset.kind === 'character' && asset.attributes.type === 'character' && stage) {
    if (stage === 'face') {
      nextAsset.attributes = {
        ...asset.attributes,
        faceStatus: 'approved',
        faceReference: mediaReferenceForOutput(asset, primaryOutput, 'face'),
        bodyStatus: 'pending',
        bodyReference: null,
        turnaround: false,
        turnaroundReferences: [],
      }
    }
    if (stage === 'body') {
      nextAsset.attributes = {
        ...asset.attributes,
        bodyStatus: 'approved',
        bodyReference: mediaReferenceForOutput(asset, primaryOutput, 'body'),
        turnaround: false,
        turnaroundReferences: [],
      }
    }
    if (stage === 'turnaround') {
      nextAsset.attributes = {
        ...asset.attributes,
        turnaround: true,
        turnaroundReferences: mergeTurnaroundOutputs(asset.attributes.turnaroundReferences, imageOutputs),
      }
    }
  }

  await updateAssetCompletion(client, nextAsset)
}

async function writeAudioOutputsToAsset(
  client: PoolClient,
  task: GenerationTask,
  outputs: GenerationTask['outputs'],
  now: string,
): Promise<void> {
  const assetId = stringValue(task.metadata.assetId, '')
  const audioOutputs = outputs.filter((output) => output.mediaType === 'audio' && output.url)
  if (!assetId || audioOutputs.length === 0) return

  const asset = await lockedAsset(client, task, assetId)
  if (!asset || asset.kind !== 'audio') return

  await updateAssetCompletion(client, {
    ...asset,
    references: audioOutputs.slice(0, 3).map((output) => ({
      id: output.id,
      url: output.url,
      name: `${asset.name}-audio`,
    })),
    status: 'confirmed',
    updatedAt: now,
  })
}

async function lockedAsset(client: PoolClient, task: GenerationTask, assetId: string): Promise<Asset | null> {
  const result = await client.query<AssetRow>(
    `
      select ${ASSET_COLUMNS}
      from assets
      where id = $1 and project_id = $2 and tenant_id = $3
      for update
    `,
    [assetId, task.projectId, task.tenantId],
  )
  return result.rows[0] ? assetFromRow(result.rows[0]) : null
}

async function updateAssetCompletion(client: PoolClient, asset: Asset): Promise<void> {
  await client.query(
    `
      update assets
      set references = $4::jsonb,
        attributes = $5::jsonb,
        image_url = $6,
        status = $7,
        updated_at = $8
      where id = $1 and project_id = $2 and tenant_id = $3
    `,
    [
      asset.id,
      asset.projectId,
      asset.tenantId,
      JSON.stringify(asset.references),
      JSON.stringify(asset.attributes),
      asset.imageUrl,
      asset.status,
      asset.updatedAt,
    ],
  )
}

async function failTaskRow(client: PoolClient, taskId: string, error: string): Promise<void> {
  await client.query(
    `
      update generation_tasks
      set status = 'failed',
        progress = 100,
        error = $2,
        updated_at = $3
      where id = $1
    `,
    [taskId, error.slice(0, 1_000), new Date().toISOString()],
  )
}

async function cleanupStorageKeys(_keys: string[]): Promise<void> {
  // Object cleanup is owned by GeneratedAssetWriter/FilmExporter today; SQL rollback keeps DB consistent.
}

function concurrencyFor(user: Pick<StoredUser, 'plan'>): number {
  return user.plan === 'member' ? 3 : 1
}

function isFilmExportTask(task: GenerationTask, canExportFilm: boolean): boolean {
  return canExportFilm && task.kind === 'video' && task.provider === 'film-export'
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

type ImageOutput = GenerationTask['outputs'][number]
type CharacterGenerationStage = 'face' | 'body' | 'turnaround'

function primaryImageOutputFor(
  stage: CharacterGenerationStage | null,
  outputs: GenerationTask['outputs'],
): ImageOutput {
  if (stage === 'turnaround') return outputs.find((output) => output.view === 'front') ?? outputs[0]!
  return outputs.find((output) => output.view === 'single') ?? outputs[0]!
}

function mediaReferenceForOutput(
  asset: Asset,
  output: ImageOutput,
  stage: CharacterGenerationStage,
): Asset['references'][number] {
  return {
    id: output.id,
    url: output.url,
    name: `${asset.name}-${stage}`,
  }
}

function mergeTurnaroundOutputs(
  currentOutputs: GenerationTask['outputs'],
  nextOutputs: GenerationTask['outputs'],
): GenerationTask['outputs'] {
  const orderedViews = ['front', 'side', 'back'] as const
  return orderedViews
    .map(
      (view) =>
        nextOutputs.find((output) => output.view === view) ??
        currentOutputs.find((output) => output.view === view),
    )
    .filter((output): output is ImageOutput => Boolean(output))
    .slice(0, 3)
}

function characterGenerationStageFor(value: unknown, turnaround: unknown): CharacterGenerationStage | null {
  if (value === 'face' || value === 'body' || value === 'turnaround') return value
  return turnaround === true ? 'turnaround' : null
}

const FILM_EXPORT_PROVIDER_NAME = 'film-export'
const MANAGED_PROVIDER_NAMES = new Set([...REMOTE_PROVIDER_NAMES, FILM_EXPORT_PROVIDER_NAME])
