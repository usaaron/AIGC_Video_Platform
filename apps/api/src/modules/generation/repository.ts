import type { Asset, CreateGenerationTask, GenerationTask, Principal, Project, Shot } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import { AppError } from '../../core/errors.js'
import type { OutboxRepository } from '../../core/jobs/outbox.js'
import { normalizeGenerationTaskLifecycle, releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { cancellationResourceLockForTask } from '../../core/jobs/taskResourceLock.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppState, AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { traceMetadata } from '../../core/observability/trace.js'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

type TaskBillingTarget = {
  id: string
  credits: number | null
  billingScope: 'membership' | 'organization'
}

type GenerationTaskRow = QueryResultRow & {
  id: string
  client_request_id: string
  project_id: string
  tenant_id: string
  user_id: string
  kind: GenerationTask['kind']
  label: string
  prompt: string
  negative_prompt: string
  provider: string
  model: string | null
  tier: GenerationTask['tier'] | null
  metadata: unknown
  status: GenerationTask['status']
  progress: number | string
  estimated_credits: number | string
  attempts: number | string
  max_attempts: number | string | null
  lease_owner_id: string | null
  lease_token: string | null
  lease_acquired_at: Date | string | null
  lease_heartbeat_at: Date | string | null
  lease_expires_at: Date | string | null
  result_url: string | null
  outputs: unknown
  error: string | null
  created_at: Date | string
  updated_at: Date | string
}

type GenerationTaskImportResult = {
  tasks: { inserted: number; skipped: number }
}

type GenerationProjectRow = QueryResultRow & {
  id: string
  tenant_id: string
  owner_user_id: string
  name: string
  content_type: Project['contentType']
  visual_style: NonNullable<Project['visualStyle']>
  episode_duration_seconds: number | string
  aspect_ratio: Project['aspectRatio']
  status: Project['status']
  synopsis: string
  script: string
  version: number | string
  created_at: Date | string
  updated_at: Date | string
}

type GenerationShotRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  shot_order: number | string
  title: string
  framing: string
  duration_seconds: number | string
  prompt: string
  negative_prompt: string
  image_url: string | null
  selected_image_task_id: string | null
  selected_video_task_id: string | null
  continuity_mode: Shot['continuityMode']
  continuity_note: string
  episode_break_before: boolean
  episode_number: number | string
  episode_title: string
  episode_kind: Shot['episodeKind']
  created_at: Date | string
  updated_at: Date | string
}

type GenerationAssetRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  kind: Asset['kind']
  source_mode: Asset['sourceMode']
  name: string
  description: string
  prompt: string
  prompt_mode: Asset['promptMode']
  custom_prompt_mode: Asset['customPromptMode']
  custom_prompt: string
  negative_prompt: string
  reference_items: unknown
  attributes: unknown
  image_url: string | null
  status: Asset['status']
  created_at: Date | string
  updated_at: Date | string
}

type AssetNameRow = QueryResultRow & {
  name: string
}

const generationTaskColumns = `
  id,
  client_request_id,
  project_id,
  tenant_id,
  user_id,
  kind,
  label,
  prompt,
  negative_prompt,
  provider,
  model,
  tier,
  metadata,
  status,
  progress,
  estimated_credits,
  attempts,
  max_attempts,
  lease_owner_id,
  lease_token,
  lease_acquired_at,
  lease_heartbeat_at,
  lease_expires_at,
  result_url,
  outputs,
  error,
  created_at,
  updated_at
`

export class GenerationTaskRepository {
  constructor(
    private readonly store: AppStore | null,
    private readonly creditLedger: CreditLedger | null = null,
    private readonly database: AccountDatabase | null = null,
    private readonly outbox: OutboxRepository | null = null,
  ) {}

  async importFromStore(): Promise<GenerationTaskImportResult> {
    const result: GenerationTaskImportResult = { tasks: { inserted: 0, skipped: 0 } }
    if (!this.database || !this.store) return result

    const tasks = this.store.read((state) => state.tasks)
    if (!tasks.length) return result

    await this.database.transaction(async (client) => {
      for (const task of tasks) {
        if (await insertTaskFromStore(client, task)) {
          result.tasks.inserted += 1
        } else {
          result.tasks.skipped += 1
        }
      }
    })
    await this.refreshRuntimeCacheFromDatabase()
    return result
  }

  async refreshRuntimeCacheFromDatabase(): Promise<void> {
    if (!this.database || !this.store) return
    const result = await this.database.query<GenerationTaskRow>(
      `
      SELECT ${generationTaskColumns}
      FROM generation_tasks
      ORDER BY created_at DESC, id DESC
      `,
    )
    this.store.replaceGenerationTaskRuntimeCache(result.rows.map(taskFromRow))
  }

  async refreshRuntimeTaskFromDatabase(taskId: string): Promise<boolean> {
    if (!this.database || !this.store) return false
    const result = await this.database.query<GenerationTaskRow>(
      `
      SELECT ${generationTaskColumns}
      FROM generation_tasks
      WHERE id = $1
      LIMIT 1
      `,
      [taskId],
    )
    const task = result.rows[0] ? taskFromRow(result.rows[0]) : null
    if (!task) return false
    this.mirrorTasks([task])
    return true
  }

  async flushRuntimeCacheToDatabase(): Promise<number> {
    if (!this.database || !this.store) return 0

    const taskIds = this.store.read((state) => state.tasks.map((task) => task.id))
    return this.flushRuntimeTasksToDatabase(taskIds)
  }

  async flushRuntimeTasksToDatabase(taskIds: Iterable<string>): Promise<number> {
    if (!this.database || !this.store) return 0

    const ids = new Set(taskIds)
    if (!ids.size) return 0
    const snapshot = this.store.read((state) => ({
      tasks: state.tasks.filter((task) => ids.has(task.id)).map(normalizeGenerationTaskLifecycle),
      shotSelections: new Map(
        state.shots.map((shot) => [
          shot.id,
          {
            imageTaskId: shot.selectedImageTaskId ?? null,
            videoTaskId: shot.selectedVideoTaskId ?? null,
          },
        ]),
      ),
    }))
    if (!snapshot.tasks.length) return 0

    return this.database.transaction(async (client) => {
      let updated = 0
      for (const task of snapshot.tasks) {
        const persisted = await updateGenerationTaskLifecycle(client, task)
        if (!persisted) continue
        updated += 1
        const shotId = metadataString(task.metadata, 'shotId')
        await updateTaskResultTargets(
          client,
          persisted,
          shotId ? snapshot.shotSelections.get(shotId) : undefined,
        )
      }
      return updated
    })
  }

  async flushRuntimeTaskToDatabase(taskId: string): Promise<boolean> {
    if (!this.database || !this.store) return false
    const snapshot = this.store.read((state) => {
      const current = state.tasks.find((item) => item.id === taskId)
      if (!current) return null
      const task = normalizeGenerationTaskLifecycle(current)
      const shotId = metadataString(task.metadata, 'shotId')
      const shot = shotId ? state.shots.find((item) => item.id === shotId) : null
      return {
        task,
        shotId,
        shotSelection: shot
          ? {
              imageTaskId: shot.selectedImageTaskId ?? null,
              videoTaskId: shot.selectedVideoTaskId ?? null,
            }
          : undefined,
      }
    })
    if (!snapshot) return false
    return this.database.transaction(async (client) => {
      const persisted = await updateGenerationTaskLifecycle(client, snapshot.task)
      if (!persisted) return false
      await updateTaskResultTargets(client, persisted, snapshot.shotId ? snapshot.shotSelection : undefined)
      return true
    })
  }

  async flushRuntimeTextPreviewToDatabase(taskId: string): Promise<boolean> {
    if (!this.database || !this.store) return false
    const snapshot = this.store.read((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.kind !== 'text' || task.status !== 'running' || !task.leaseToken) return null
      return {
        id: task.id,
        metadata: task.metadata,
        progress: task.progress,
        updatedAt: task.updatedAt,
        leaseToken: task.leaseToken,
      }
    })
    if (!snapshot) return false
    const result = await this.database.query<{ id: string }>(
      `
      UPDATE generation_tasks
      SET metadata = $2::jsonb,
          progress = $3,
          updated_at = $4::timestamptz
      WHERE id = $1
        AND kind = 'text'
        AND status = 'running'
        AND lease_token = $5
        AND updated_at <= $4::timestamptz
      RETURNING id
      `,
      [
        snapshot.id,
        JSON.stringify(snapshot.metadata),
        snapshot.progress,
        snapshot.updatedAt,
        snapshot.leaseToken,
      ],
    )
    return result.rows.length > 0
  }

  async canCreate(projectId: string, principal: Principal): Promise<boolean> {
    if (this.database) {
      const result = await this.database.query<{ id: string }>(
        `
        SELECT id
        FROM projects
        WHERE id = $1
          AND tenant_id = $2
          AND ($3::boolean OR owner_user_id = $4)
          AND status <> 'archived'
        LIMIT 1
        `,
        [projectId, principal.tenantId, canReadAllTenantContent(principal), principal.userId],
      )
      return result.rows.length > 0
    }
    return this.requireStore().read((state) =>
      state.projects.some(
        (project) =>
          project.id === projectId &&
          project.tenantId === principal.tenantId &&
          project.status !== 'archived' &&
          (project.ownerId === principal.userId || canReadAllTenantContent(principal)),
      ),
    )
  }

  async storyboardVideoContext(input: CreateGenerationTask, principal: Principal) {
    if (
      input.kind !== 'video' ||
      input.provider !== 'seedance' ||
      typeof input.metadata?.shotId !== 'string'
    ) {
      return null
    }
    if (this.database) {
      const [projectResult, shotsResult, assetsResult] = await Promise.all([
        this.database.query<GenerationProjectRow>(
          `
          SELECT
            id, tenant_id, owner_user_id, name, content_type, visual_style,
            episode_duration_seconds, aspect_ratio, status,
            synopsis, script, version, created_at, updated_at
          FROM projects
          WHERE id = $1
            AND tenant_id = $2
            AND owner_user_id = $3
            AND status <> 'archived'
          LIMIT 1
          `,
          [input.projectId, principal.tenantId, principal.userId],
        ),
        this.database.query<GenerationShotRow>(
          `
          SELECT
            id, project_id, tenant_id, shot_order, title, framing, duration_seconds,
            prompt, negative_prompt, image_url, selected_image_task_id, selected_video_task_id,
            continuity_mode, continuity_note,
            episode_break_before, episode_number, episode_title, episode_kind,
            created_at, updated_at
          FROM shots
          WHERE project_id = $1 AND tenant_id = $2
          ORDER BY shot_order ASC
          `,
          [input.projectId, principal.tenantId],
        ),
        this.database.query<GenerationAssetRow>(
          `
          SELECT
            id, project_id, tenant_id, kind, source_mode, name, description, prompt,
            prompt_mode, custom_prompt_mode, custom_prompt, negative_prompt,
            reference_items, attributes, image_url, status, created_at, updated_at
          FROM assets
          WHERE project_id = $1 AND tenant_id = $2
          ORDER BY created_at ASC, id ASC
          `,
          [input.projectId, principal.tenantId],
        ),
      ])
      const project = projectResult.rows[0] ? projectFromRow(projectResult.rows[0]) : null
      const shots = shotsResult.rows.map(shotFromRow)
      const shot = shots.find((item) => item.id === input.metadata?.shotId)
      if (!project || !shot) return null
      return {
        project,
        shot,
        shots,
        assets: assetsResult.rows.map(assetFromRow),
      }
    }
    return this.requireStore().read((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === input.projectId &&
          item.tenantId === principal.tenantId &&
          item.ownerId === principal.userId,
      )
      const shot = state.shots.find(
        (item) =>
          item.id === input.metadata?.shotId &&
          item.projectId === input.projectId &&
          item.tenantId === principal.tenantId,
      )
      if (!project || !shot) return null
      return {
        project,
        shot,
        shots: state.shots
          .filter((item) => item.projectId === input.projectId && item.tenantId === principal.tenantId)
          .sort((left, right) => left.order - right.order),
        assets: state.assets.filter(
          (item) => item.projectId === input.projectId && item.tenantId === principal.tenantId,
        ),
      }
    })
  }

  async blockedPortraitNames(input: CreateGenerationTask, principal: Principal): Promise<string[]> {
    if (input.kind !== 'video' || !Array.isArray(input.metadata?.referenceAssetIds)) return []
    const referenceIds = input.metadata.referenceAssetIds.filter(
      (value): value is string => typeof value === 'string',
    )
    if (!referenceIds.length) return []
    if (this.database) {
      const result = await this.database.query<AssetNameRow>(
        `
        SELECT name
        FROM assets
        WHERE id = ANY($1::text[])
          AND project_id = $2
          AND tenant_id = $3
          AND attributes->>'type' = 'character'
          AND attributes->>'subjectType' = 'human'
          AND (
            attributes->>'portraitSource' = 'authorized-real'
            OR attributes->>'visualStyle' = 'photorealistic'
          )
          AND COALESCE(attributes#>>'{trustedPortrait,status}', '') <> 'active'
        ORDER BY name ASC
        `,
        [referenceIds, input.projectId, principal.tenantId],
      )
      return result.rows.map((row) => row.name)
    }
    return this.requireStore().read((state) =>
      state.assets
        .filter(
          (asset) =>
            referenceIds.includes(asset.id) &&
            asset.projectId === input.projectId &&
            asset.tenantId === principal.tenantId &&
            asset.attributes.type === 'character' &&
            asset.attributes.subjectType === 'human' &&
            (asset.attributes.portraitSource === 'authorized-real' ||
              asset.attributes.visualStyle === 'photorealistic') &&
            asset.attributes.trustedPortrait?.status !== 'active',
        )
        .map((asset) => asset.name),
    )
  }

  async stringXPortraitNames(input: CreateGenerationTask, principal: Principal): Promise<string[]> {
    if (input.kind !== 'video' || !Array.isArray(input.metadata?.referenceAssetIds)) return []
    const referenceIds = input.metadata.referenceAssetIds.filter(
      (value): value is string => typeof value === 'string',
    )
    if (!referenceIds.length) return []
    if (this.database) {
      const result = await this.database.query<AssetNameRow>(
        `
        SELECT name
        FROM assets
        WHERE id = ANY($1::text[])
          AND project_id = $2
          AND tenant_id = $3
          AND attributes->>'type' = 'character'
          AND attributes#>>'{trustedPortrait,status}' = 'active'
          AND attributes#>>'{trustedPortrait,assetId}' LIKE 'maas-%'
        ORDER BY name ASC
        `,
        [referenceIds, input.projectId, principal.tenantId],
      )
      return result.rows.map((row) => row.name)
    }
    return this.requireStore().read((state) =>
      state.assets
        .filter(
          (asset) =>
            referenceIds.includes(asset.id) &&
            asset.projectId === input.projectId &&
            asset.tenantId === principal.tenantId &&
            asset.attributes.type === 'character' &&
            asset.attributes.trustedPortrait?.status === 'active' &&
            asset.attributes.trustedPortrait.assetId.startsWith('maas-'),
        )
        .map((asset) => asset.name),
    )
  }

  async create(
    input: CreateGenerationTask,
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask> {
    if (this.database) return this.createInDatabase(input, principal, false, options)
    return this.createInStore(input, principal, options)
  }

  async createWithCharge(
    input: CreateGenerationTask,
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask> {
    if (this.database) return this.createInDatabase(input, principal, true, options)
    return this.createWithChargeInStore(input, principal, options)
  }

  async createBatchWithCharge(
    inputs: CreateGenerationTask[],
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask[]> {
    assertUniqueClientRequestIds(inputs)
    if (this.database) return this.createBatchWithChargeInDatabase(inputs, principal, options)
    return this.createBatchWithChargeInStore(inputs, principal, options)
  }

  async listByProject(projectId: string, principal: Principal): Promise<GenerationTask[]> {
    await this.recoverExpiredFilmPreviewTasks(principal, projectId)
    if (!this.database) return this.listByProjectFromStore(projectId, principal)

    const canReadAll = canReadAllTenantContent(principal)
    const result = await this.database.query<GenerationTaskRow>(
      `
      SELECT ${generationTaskColumns}
      FROM generation_tasks
      WHERE project_id = $1
        AND tenant_id = $2
        AND ($3::boolean OR user_id = $4)
        AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
      ORDER BY created_at DESC, id DESC
      `,
      [projectId, principal.tenantId, canReadAll, principal.userId],
    )
    const tasks = result.rows.map(taskFromRow)
    this.mirrorTasks(tasks)
    return tasks
  }

  async listRecent(principal: Principal, limit = 100): Promise<GenerationTask[]> {
    await this.recoverExpiredFilmPreviewTasks(principal)
    if (this.database) {
      const canReadAll = canReadAllTenantContent(principal)
      const result = await this.database.query<GenerationTaskRow>(
        `
        SELECT ${generationTaskColumns}
        FROM generation_tasks
        WHERE tenant_id = $1
          AND ($2::boolean OR user_id = $3)
          AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
        ORDER BY updated_at DESC, id DESC
        LIMIT $4
        `,
        [principal.tenantId, canReadAll, principal.userId, Math.max(1, Math.min(500, limit))],
      )
      const tasks = result.rows.map(taskFromRow)
      this.mirrorTasks(tasks)
      return tasks
    }
    const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
    return this.requireStore().read((state) =>
      state.tasks
        .filter(
          (task) =>
            task.tenantId === principal.tenantId &&
            (canReadAll || task.userId === principal.userId) &&
            typeof task.metadata.queueHiddenAt !== 'string',
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit),
    )
  }

  async filmPreviewPlan(projectId: string, principal: Principal, episodeNumber: number | null = null) {
    if (this.database) return this.filmPreviewPlanFromDatabase(projectId, principal, episodeNumber)
    return this.requireStore().read((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          (item.ownerId === principal.userId || canReadAllTenantContent(principal)),
      )
      if (!project) return null
      const shots = state.shots
        .filter((shot) => shot.projectId === projectId && shot.tenantId === principal.tenantId)
        .filter((shot) => episodeNumber === null || shot.episodeNumber === episodeNumber)
        .sort((left, right) => left.order - right.order)
      const completedVideoTasks = state.tasks.filter(
        (task) =>
          task.projectId === projectId &&
          task.tenantId === principal.tenantId &&
          task.kind === 'video' &&
          task.provider === 'seedance' &&
          task.status === 'completed' &&
          typeof task.metadata.providerTaskId === 'string',
      )
      const sources = shots.map((shot) => {
        const selectedTask = shot.selectedVideoTaskId
          ? completedVideoTasks.find((task) => task.id === shot.selectedVideoTaskId)
          : undefined
        const completedTasks = completedVideoTasks.filter((task) => task.metadata.shotId === shot.id)
        return {
          shot,
          // A retained version can belong to the prior shot ID after a user re-splits a script.
          // It remains safe to compose because it is still scoped to this project and tenant.
          task: selectedTask ?? completedTasks[0],
        }
      })
      return { project, shots, sources }
    })
  }

  async findById(taskId: string, principal: Principal): Promise<GenerationTask | null> {
    if (!this.database) return this.findByIdFromStore(taskId, principal)

    const canReadAll = canReadAllTenantContent(principal)
    const result = await this.database.query<GenerationTaskRow>(
      `
      SELECT ${generationTaskColumns}
      FROM generation_tasks
      WHERE id = $1
        AND tenant_id = $2
        AND ($3::boolean OR user_id = $4)
      LIMIT 1
      `,
      [taskId, principal.tenantId, canReadAll, principal.userId],
    )
    return result.rows[0] ? taskFromRow(result.rows[0]) : null
  }

  async clearCompleted(projectId: string, principal: Principal): Promise<number> {
    if (this.database) {
      const now = new Date().toISOString()
      const result = await this.database.query<GenerationTaskRow>(
        `
        UPDATE generation_tasks
        SET metadata = metadata || jsonb_build_object('queueHiddenAt', $4::text),
            updated_at = $4::timestamptz
        WHERE project_id = $1
          AND tenant_id = $2
          AND user_id = $3
          AND status IN ('completed', 'failed', 'cancelled')
          AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
        RETURNING ${generationTaskColumns}
        `,
        [projectId, principal.tenantId, principal.userId, now],
      )
      const tasks = result.rows.map(taskFromRow)
      for (const task of tasks) {
        await this.mirrorTask(task, null)
      }
      return tasks.length
    }

    return this.requireStore().mutate((state) => {
      const now = new Date().toISOString()
      const terminalTasks = state.tasks.filter(
        (task) =>
          task.projectId === projectId &&
          task.userId === principal.userId &&
          (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') &&
          typeof task.metadata.queueHiddenAt !== 'string',
      )
      terminalTasks.forEach((task) => {
        task.metadata = { ...task.metadata, queueHiddenAt: now }
        task.updatedAt = now
      })
      return terminalTasks.length
    })
  }

  async pause(
    taskId: string,
    principal: Principal,
  ): Promise<{
    outcome: 'not_found' | 'paused' | 'already_paused' | 'not_pausable'
    task: GenerationTask | null
  }> {
    if (this.database) {
      const result = await this.database.transaction(async (client) => {
        const task = await findControlledTaskInDatabase(client, taskId, principal)
        if (!task) return { outcome: 'not_found' as const, task: null }
        if (task.status === 'paused') return { outcome: 'already_paused' as const, task }
        if (task.status !== 'queued' || typeof task.metadata.queueHiddenAt === 'string') {
          return { outcome: 'not_pausable' as const, task }
        }
        const now = new Date().toISOString()
        task.status = 'paused'
        task.metadata = { ...task.metadata, pausedAt: now }
        releaseGenerationTaskLease(task)
        task.updatedAt = now
        const updated = await updateGenerationTaskLifecycle(client, task)
        return { outcome: 'paused' as const, task: updated ?? task }
      })
      if (result.task) await this.mirrorTask(result.task, null)
      return result
    }

    return this.requireStore().mutate((state) => {
      const task = findControlledTask(state.tasks, taskId, principal)
      if (!task) return { outcome: 'not_found' as const, task: null }
      if (task.status === 'paused') return { outcome: 'already_paused' as const, task }
      if (task.status !== 'queued' || typeof task.metadata.queueHiddenAt === 'string') {
        return { outcome: 'not_pausable' as const, task }
      }
      const now = new Date().toISOString()
      task.status = 'paused'
      task.metadata = { ...task.metadata, pausedAt: now }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      return { outcome: 'paused' as const, task }
    })
  }

  async resume(
    taskId: string,
    principal: Principal,
  ): Promise<{ outcome: 'not_found' | 'resumed' | 'not_resumable'; task: GenerationTask | null }> {
    if (this.database) {
      const result = await this.database.transaction(async (client) => {
        const task = await findControlledTaskInDatabase(client, taskId, principal)
        if (!task) return { outcome: 'not_found' as const, task: null }
        if (task.status !== 'paused' || typeof task.metadata.queueHiddenAt === 'string') {
          return { outcome: 'not_resumable' as const, task }
        }
        await assertNoDraftScriptEpisode(client, task, principal)
        const now = new Date().toISOString()
        const { pausedAt: _pausedAt, ...metadata } = task.metadata
        task.status = 'queued'
        task.progress = 0
        task.error = null
        task.metadata = { ...metadata, resumedAt: now }
        releaseGenerationTaskLease(task)
        task.updatedAt = now
        const updated = await updateGenerationTaskLifecycle(client, task)
        await this.outbox?.enqueueGenerationTaskDispatch(client, updated ?? task)
        return { outcome: 'resumed' as const, task: updated ?? task }
      })
      if (result.task) await this.mirrorTask(result.task, null)
      return result
    }

    return this.requireStore().mutate((state) => {
      const task = findControlledTask(state.tasks, taskId, principal)
      if (!task) return { outcome: 'not_found' as const, task: null }
      if (task.status !== 'paused' || typeof task.metadata.queueHiddenAt === 'string') {
        return { outcome: 'not_resumable' as const, task }
      }
      assertNoDraftScriptEpisodeInState(state, task, principal)
      const now = new Date().toISOString()
      const { pausedAt: _pausedAt, ...metadata } = task.metadata
      task.status = 'queued'
      task.progress = 0
      task.error = null
      task.metadata = { ...metadata, resumedAt: now }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      return { outcome: 'resumed' as const, task }
    })
  }

  async deleteFromQueue(
    taskId: string,
    principal: Principal,
  ): Promise<{
    outcome: 'not_found' | 'deleted' | 'already_deleted' | 'not_deletable'
    task: GenerationTask | null
    refund: boolean
  }> {
    if (this.database) {
      const result = await this.database.transaction(async (client) => {
        const task = await findControlledTaskInDatabase(client, taskId, principal)
        if (!task) return { outcome: 'not_found' as const, task: null, refund: false }
        if (typeof task.metadata.queueHiddenAt === 'string') {
          return { outcome: 'already_deleted' as const, task, refund: false }
        }

        const now = new Date().toISOString()
        if (task.status === 'running') {
          const lock = cancellationResourceLockForTask(task)
          task.status = 'cancelled'
          task.progress = 100
          task.error = null
          task.metadata = {
            ...task.metadata,
            cancelResourceLockKind: lock.kind,
            cancelResourceLockKey: lock.key,
            providerCancelRequestedAt: now,
            cancelledAt: now,
            deletedAt: now,
            queueHiddenAt: now,
          }
          releaseGenerationTaskLease(task)
          task.updatedAt = now
          const updated = await updateGenerationTaskLifecycle(client, task)
          return { outcome: 'deleted' as const, task: updated ?? task, refund: false }
        }

        const refund = task.status === 'queued' || task.status === 'paused'
        if (task.status === 'queued') {
          task.status = 'paused'
          task.progress = 0
          task.metadata = { ...task.metadata, pausedAt: now }
        }
        task.metadata = { ...task.metadata, queueHiddenAt: now, deletedAt: now }
        releaseGenerationTaskLease(task)
        task.updatedAt = now
        const updated = await updateGenerationTaskLifecycle(client, task)
        return { outcome: 'deleted' as const, task: updated ?? task, refund }
      })
      if (result.task) await this.mirrorTask(result.task, null)
      return result
    }

    return this.requireStore().mutate((state) => {
      const task = findControlledTask(state.tasks, taskId, principal)
      if (!task) return { outcome: 'not_found' as const, task: null, refund: false }
      if (typeof task.metadata.queueHiddenAt === 'string') {
        return { outcome: 'already_deleted' as const, task, refund: false }
      }
      if (task.status === 'running') {
        const now = new Date().toISOString()
        const lock = cancellationResourceLockForTask(task)
        task.status = 'cancelled'
        task.progress = 100
        task.error = null
        task.metadata = {
          ...task.metadata,
          cancelResourceLockKind: lock.kind,
          cancelResourceLockKey: lock.key,
          providerCancelRequestedAt: now,
          cancelledAt: now,
          deletedAt: now,
          queueHiddenAt: now,
        }
        releaseGenerationTaskLease(task)
        task.updatedAt = now
        return { outcome: 'deleted' as const, task, refund: false }
      }
      const now = new Date().toISOString()
      const refund = task.status === 'queued' || task.status === 'paused'
      if (task.status === 'queued') {
        task.status = 'paused'
        task.progress = 0
        task.metadata = { ...task.metadata, pausedAt: now }
      }
      task.metadata = { ...task.metadata, queueHiddenAt: now, deletedAt: now }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      return { outcome: 'deleted' as const, task, refund }
    })
  }

  async cancelRunning(taskId: string, principal: Principal): Promise<GenerationTask | null> {
    return this.deleteFromQueue(taskId, principal).then((result) => result.task)
  }

  private async filmPreviewPlanFromDatabase(
    projectId: string,
    principal: Principal,
    episodeNumber: number | null,
  ): Promise<{
    project: Project
    shots: Shot[]
    sources: Array<{ shot: Shot; task: GenerationTask | undefined }>
  } | null> {
    const projectResult = await this.database!.query<GenerationProjectRow>(
      `
      SELECT
        id,
        tenant_id,
        owner_user_id,
        name,
        content_type,
        visual_style,
        episode_duration_seconds,
        aspect_ratio,
        status,
        synopsis,
        script,
        version,
        created_at,
        updated_at
      FROM projects
      WHERE id = $1
        AND tenant_id = $2
        AND ($3::boolean OR owner_user_id = $4)
      LIMIT 1
      `,
      [projectId, principal.tenantId, canReadAllTenantContent(principal), principal.userId],
    )
    const project = projectResult.rows[0] ? projectFromRow(projectResult.rows[0]) : null
    if (!project) return null

    const [shotsResult, taskResult] = await Promise.all([
      this.database!.query<GenerationShotRow>(
        `
        SELECT
          id,
          project_id,
          tenant_id,
          shot_order,
          title,
          framing,
          duration_seconds,
          prompt,
          negative_prompt,
          image_url,
          selected_image_task_id,
          selected_video_task_id,
          continuity_mode,
          continuity_note,
          episode_break_before,
          episode_number,
          episode_title,
          episode_kind,
          created_at,
          updated_at
        FROM shots
        WHERE project_id = $1
          AND tenant_id = $2
          AND ($3::int IS NULL OR episode_number = $3)
        ORDER BY shot_order ASC
        `,
        [projectId, principal.tenantId, episodeNumber],
      ),
      this.database!.query<GenerationTaskRow>(
        `
        SELECT ${generationTaskColumns}
        FROM generation_tasks
        WHERE project_id = $1
          AND tenant_id = $2
          AND kind = 'video'
          AND provider = 'seedance'
          AND status = 'completed'
          AND metadata ? 'shotId'
          AND jsonb_typeof(metadata->'providerTaskId') = 'string'
        ORDER BY updated_at DESC, id DESC
        `,
        [projectId, principal.tenantId],
      ),
    ])
    const shots = shotsResult.rows.map(shotFromRow)
    const tasks = taskResult.rows.map(taskFromRow)
    const sources = shots.map((shot) => ({
      shot,
      task:
        (shot.selectedVideoTaskId ? tasks.find((task) => task.id === shot.selectedVideoTaskId) : undefined) ??
        tasks.find((task) => task.metadata.shotId === shot.id),
    }))
    return { project, shots, sources }
  }

  private async createInDatabase(
    input: CreateGenerationTask,
    principal: Principal,
    chargeCredits: boolean,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask> {
    const preemptedScriptTasks: GenerationTask[] = []
    const created = await this.database!.transaction(async (client) => {
      const replayed = await findTaskByClientRequest(client, input.clientRequestId, principal)
      if (replayed) {
        await this.outbox?.enqueueGenerationTaskDispatch(client, replayed)
        return { task: replayed, credits: null }
      }

      preemptedScriptTasks.push(...(await preemptActiveScriptTasksInDatabase(client, input, principal)))
      const replayedAfterScriptLock = isScriptGenerationTask(input)
        ? await findTaskByClientRequest(client, input.clientRequestId, principal)
        : null
      if (replayedAfterScriptLock) {
        await this.outbox?.enqueueGenerationTaskDispatch(client, replayedAfterScriptLock)
        return { task: replayedAfterScriptLock, credits: null }
      }

      await assertNoActiveShotTask(client, input, principal)
      const membership = await resolveMembershipForTask(client, principal, chargeCredits)
      if (!membership) {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
      }

      const now = new Date().toISOString()
      const task = buildQueuedGenerationTask(input, principal, now, options)
      const inserted = await insertCreatedTask(client, task, membership.id)
      if (!inserted) {
        const existing = await findTaskByClientRequest(client, input.clientRequestId, principal)
        if (existing) {
          await this.outbox?.enqueueGenerationTaskDispatch(client, existing)
          return { task: existing, credits: null }
        }
        throw new AppError(409, 'TASK_CONFLICT', 'Generation task already exists')
      }

      if (!chargeCredits || input.estimatedCredits <= 0) {
        await this.outbox?.enqueueGenerationTaskDispatch(client, inserted)
        return { task: inserted, credits: null }
      }
      if (membership.credits === null || membership.credits < input.estimatedCredits) {
        throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
      }

      const nextCredits = membership.credits - input.estimatedCredits
      if (membership.billingScope === 'organization') {
        await client.query(
          `
          UPDATE organization_billing_accounts
          SET credits = $2,
              updated_at = now()
          WHERE tenant_id = $1
          `,
          [principal.tenantId, nextCredits],
        )
        await client.query(
          `
          INSERT INTO organization_billing_ledger_entries (
            id,
            tenant_id,
            user_id,
            membership_id,
            reference_id,
            related_entry_id,
            entry_type,
            amount,
            balance,
            description,
            created_by_user_id,
            created_at,
            updated_at,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, NULL, 'generation', $6, $7, $8, $3, $9, $9, '{}'::jsonb)
          `,
          [
            `generation-${input.clientRequestId}`,
            principal.tenantId,
            principal.userId,
            membership.id,
            input.clientRequestId,
            -input.estimatedCredits,
            nextCredits,
            input.label,
            now,
          ],
        )
      } else {
        await client.query(
          `
          UPDATE billing_accounts
          SET credits = $2,
              updated_at = now()
          WHERE membership_id = $1
          `,
          [membership.id, nextCredits],
        )
        await client.query(
          `
          INSERT INTO billing_ledger_entries (
            id,
            tenant_id,
            user_id,
            membership_id,
            reference_id,
            related_entry_id,
            entry_type,
            amount,
            balance,
            description,
            created_by_user_id,
            created_at,
            updated_at,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, NULL, 'generation', $6, $7, $8, $3, $9, $9, '{}'::jsonb)
          `,
          [
            `generation-${input.clientRequestId}`,
            principal.tenantId,
            principal.userId,
            membership.id,
            input.clientRequestId,
            -input.estimatedCredits,
            nextCredits,
            input.label,
            now,
          ],
        )
      }
      await this.outbox?.enqueueGenerationTaskDispatch(client, inserted)
      return { task: inserted, credits: membership.billingScope === 'organization' ? null : nextCredits }
    })

    for (const task of preemptedScriptTasks) await this.mirrorTask(task, null)
    await this.mirrorTask(created.task, created.credits)
    return created.task
  }

  private async createInStore(
    input: CreateGenerationTask,
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask> {
    return this.requireStore().mutate((state) => {
      const existing = state.tasks.find(
        (item) => item.clientRequestId === input.clientRequestId && item.userId === principal.userId,
      )
      if (existing) return existing

      preemptActiveScriptTasksInState(state, input, principal)

      assertNoActiveShotTaskInState(state, input, principal)
      const now = new Date().toISOString()
      const task = buildQueuedGenerationTask(input, principal, now, options)
      state.tasks.unshift(task)
      return task
    })
  }

  private async createBatchWithChargeInDatabase(
    inputs: CreateGenerationTask[],
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask[]> {
    if (!inputs.length) return []
    const created = await this.database!.transaction(async (client) => {
      const tasksByClientRequest = new Map<string, GenerationTask>()
      const newInputs: CreateGenerationTask[] = []

      for (const input of inputs) {
        await assertNoActiveShotTask(client, input, principal)
        const replayed = await findTaskByClientRequest(client, input.clientRequestId, principal)
        if (replayed) {
          tasksByClientRequest.set(input.clientRequestId, replayed)
          await this.outbox?.enqueueGenerationTaskDispatch(client, replayed)
        } else {
          newInputs.push(input)
        }
      }

      assertSingleScriptTaskInput(newInputs)
      const preemptedScriptTasks = newInputs.some(isScriptGenerationTask)
        ? await preemptActiveScriptTasksInDatabase(client, newInputs.find(isScriptGenerationTask)!, principal)
        : []
      const scriptInput = newInputs.find(isScriptGenerationTask)
      if (scriptInput) {
        const replayedAfterScriptLock = await findTaskByClientRequest(
          client,
          scriptInput.clientRequestId,
          principal,
        )
        if (replayedAfterScriptLock) {
          tasksByClientRequest.set(scriptInput.clientRequestId, replayedAfterScriptLock)
          newInputs.splice(newInputs.indexOf(scriptInput), 1)
        }
      }
      const totalCredits = newInputs.reduce((total, input) => total + Math.max(0, input.estimatedCredits), 0)

      const membership = await resolveMembershipForTask(client, principal, newInputs.length > 0)
      if (!membership) {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
      }

      if (totalCredits > 0 && (membership.credits === null || membership.credits < totalCredits)) {
        throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
      }

      let nextCredits = membership.credits
      const now = new Date().toISOString()
      for (const input of newInputs) {
        const task = buildQueuedGenerationTask(input, principal, now, options)
        const inserted = await insertCreatedTask(client, task, membership.id)
        const selected = inserted ?? (await findTaskByClientRequest(client, input.clientRequestId, principal))
        if (!selected) throw new AppError(409, 'TASK_CONFLICT', 'Generation task already exists')
        tasksByClientRequest.set(input.clientRequestId, selected)

        if (inserted && input.estimatedCredits > 0) {
          if (nextCredits === null) throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
          nextCredits -= input.estimatedCredits
          await updateBillingBalanceForTask(
            client,
            principal,
            membership,
            nextCredits,
            input.clientRequestId,
            input.estimatedCredits,
            input.label,
            now,
          )
        }
        await this.outbox?.enqueueGenerationTaskDispatch(client, selected)
      }

      return {
        tasks: inputs.map((input) => tasksByClientRequest.get(input.clientRequestId)!),
        credits: membership.billingScope === 'organization' ? null : nextCredits,
        preemptedScriptTasks,
      }
    })

    for (const task of created.preemptedScriptTasks) await this.mirrorTask(task, null)
    await this.mirrorTaskBatch(created.tasks, created.credits)
    return created.tasks
  }

  private async createBatchWithChargeInStore(
    inputs: CreateGenerationTask[],
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask[]> {
    if (!inputs.length) return []
    const creditLedger = this.creditLedger
    return this.requireStore().transaction(async (state) => {
      const tasksByClientRequest = new Map<string, GenerationTask>()
      const newInputs: CreateGenerationTask[] = []
      for (const input of inputs) {
        const existing = state.tasks.find(
          (item) => item.clientRequestId === input.clientRequestId && item.userId === principal.userId,
        )
        if (existing) {
          tasksByClientRequest.set(input.clientRequestId, existing)
          continue
        }
        assertNoActiveShotTaskInState(state, input, principal)
        newInputs.push(input)
      }

      const totalCredits = newInputs.reduce((total, input) => total + Math.max(0, input.estimatedCredits), 0)
      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
      if (user.credits < totalCredits) throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')

      assertSingleScriptTaskInput(newInputs)
      const scriptInput = newInputs.find(isScriptGenerationTask)
      if (scriptInput) preemptActiveScriptTasksInState(state, scriptInput, principal)

      const now = new Date().toISOString()
      for (const input of newInputs) {
        const task = buildQueuedGenerationTask(input, principal, now, options)
        if (creditLedger) {
          await creditLedger.reserveCreditsInState(
            state,
            principal,
            input.estimatedCredits,
            input.clientRequestId,
            input.label,
          )
        } else {
          user.credits -= input.estimatedCredits
          state.ledger.unshift({
            id: `generation-${input.clientRequestId}`,
            userId: user.id,
            tenantId: user.tenantId,
            amount: -input.estimatedCredits,
            balance: user.credits,
            type: 'generation',
            description: input.label,
            createdAt: now,
          })
        }
        state.tasks.unshift(task)
        tasksByClientRequest.set(input.clientRequestId, task)
      }
      return inputs.map((input) => tasksByClientRequest.get(input.clientRequestId)!)
    })
  }

  private async createWithChargeInStore(
    input: CreateGenerationTask,
    principal: Principal,
    options: { traceId?: string | null } = {},
  ): Promise<GenerationTask> {
    const creditLedger = this.creditLedger
    return this.requireStore().transaction(async (state) => {
      const existing = state.tasks.find(
        (item) => item.clientRequestId === input.clientRequestId && item.userId === principal.userId,
      )
      if (existing) return existing

      preemptActiveScriptTasksInState(state, input, principal)

      assertNoActiveShotTaskInState(state, input, principal)
      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist')

      const now = new Date().toISOString()
      const task = buildQueuedGenerationTask(input, principal, now, options)
      if (creditLedger) {
        await creditLedger.reserveCreditsInState(
          state,
          principal,
          input.estimatedCredits,
          input.clientRequestId,
          input.label,
        )
      } else {
        if (user.credits < input.estimatedCredits) {
          throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
        }
        user.credits -= input.estimatedCredits
        state.ledger.unshift({
          id: `generation-${input.clientRequestId}`,
          userId: user.id,
          tenantId: user.tenantId,
          amount: -input.estimatedCredits,
          balance: user.credits,
          type: 'generation',
          description: input.label,
          createdAt: now,
        })
      }
      state.tasks.unshift(task)
      return task
    })
  }

  private listByProjectFromStore(projectId: string, principal: Principal): GenerationTask[] {
    const canReadAll = canReadAllTenantContent(principal)
    return this.requireStore().read((state) =>
      state.tasks.filter(
        (task) =>
          task.projectId === projectId &&
          task.tenantId === principal.tenantId &&
          (canReadAll || task.userId === principal.userId) &&
          typeof task.metadata.queueHiddenAt !== 'string',
      ),
    )
  }

  private async recoverExpiredFilmPreviewTasks(
    principal: Principal,
    projectId: string | null = null,
  ): Promise<void> {
    const recoveredAt = new Date().toISOString()
    const recoveryCutoff = new Date(Date.parse(recoveredAt) - 5 * 60_000).toISOString()
    const error = '成片预览合成进程已中断，请重新合成'
    const canReadAll = canReadAllTenantContent(principal)

    if (this.database) {
      const result = await this.database.query<GenerationTaskRow>(
        `
        UPDATE generation_tasks
        SET status = 'failed',
            progress = 100,
            error = $5,
            metadata = metadata || jsonb_build_object(
              'providerState', 'failed',
              'compositionStage', 'failed',
              'compositionRecoveredAt', $6::text
            ),
            lease_owner_id = NULL,
            lease_token = NULL,
            lease_acquired_at = NULL,
            lease_heartbeat_at = NULL,
            lease_expires_at = NULL,
            updated_at = $6::timestamptz
        WHERE provider = 'local-compose'
          AND status = 'running'
          AND tenant_id = $1
          AND ($2::boolean OR user_id = $3)
          AND ($4::text IS NULL OR project_id = $4)
          AND (lease_expires_at IS NULL OR lease_expires_at <= $6::timestamptz)
          AND updated_at <= $7::timestamptz
        RETURNING ${generationTaskColumns}
        `,
        [principal.tenantId, canReadAll, principal.userId, projectId, error, recoveredAt, recoveryCutoff],
      )
      this.mirrorTasks(result.rows.map(taskFromRow))
      return
    }

    await this.requireStore().mutate((state) => {
      for (const task of state.tasks) {
        if (
          task.provider !== 'local-compose' ||
          task.status !== 'running' ||
          task.tenantId !== principal.tenantId ||
          (!canReadAll && task.userId !== principal.userId) ||
          (projectId !== null && task.projectId !== projectId)
        ) {
          continue
        }
        const expiresAt = task.leaseExpiresAt ? Date.parse(task.leaseExpiresAt) : Number.NaN
        if (Number.isFinite(expiresAt) && expiresAt > Date.parse(recoveredAt)) continue
        if (Date.parse(task.updatedAt) > Date.parse(recoveryCutoff)) continue
        task.status = 'failed'
        task.progress = 100
        task.error = error
        task.metadata = {
          ...task.metadata,
          providerState: 'failed',
          compositionStage: 'failed',
          compositionRecoveredAt: recoveredAt,
        }
        releaseGenerationTaskLease(task)
        task.updatedAt = recoveredAt
      }
    })
  }

  private findByIdFromStore(taskId: string, principal: Principal): GenerationTask | null {
    const canReadAll = canReadAllTenantContent(principal)
    return this.requireStore().read(
      (state) =>
        state.tasks.find(
          (task) =>
            task.id === taskId &&
            task.tenantId === principal.tenantId &&
            (canReadAll || task.userId === principal.userId),
        ) ?? null,
    )
  }

  private async mirrorTask(task: GenerationTask, credits: number | null): Promise<void> {
    if (!this.store) return
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      upsertTaskInState(state, task)
      if (credits === null) return
      const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
      if (user) user.credits = credits
    })
  }

  private mirrorTasks(tasks: GenerationTask[]): void {
    if (!tasks.length) return
    if (!this.store) return
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      for (const task of tasks) upsertTaskInState(state, task)
    })
  }

  private async mirrorTaskBatch(tasks: GenerationTask[], credits: number | null): Promise<void> {
    if (!this.store) return
    await this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      for (const task of tasks) upsertTaskInState(state, task)
      if (credits === null || !tasks[0]) return
      const user = state.users.find(
        (item) => item.id === tasks[0]!.userId && item.tenantId === tasks[0]!.tenantId,
      )
      if (user) user.credits = credits
    })
  }

  private requireStore(): AppStore {
    if (!this.store) {
      throw new Error('JSON AppStore is unavailable; GenerationTaskRepository must use Postgres in runtime')
    }
    return this.store
  }
}

async function findTaskByClientRequest(
  queryable: Queryable,
  clientRequestId: string,
  principal: Principal,
): Promise<GenerationTask | null> {
  const result = await queryable.query<GenerationTaskRow>(
    `
    SELECT ${generationTaskColumns}
    FROM generation_tasks
    WHERE tenant_id = $1
      AND user_id = $2
      AND client_request_id = $3
    LIMIT 1
    `,
    [principal.tenantId, principal.userId, clientRequestId],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

async function preemptActiveScriptTasksInDatabase(
  queryable: Queryable,
  input: CreateGenerationTask,
  principal: Principal,
): Promise<GenerationTask[]> {
  if (!isScriptGenerationTask(input)) return []

  // Serialize script creation per account so a new project cannot be blocked by an old script task.
  await queryable.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    scriptAccountLockKey(principal.userId, principal.tenantId),
  ])
  const replayed = await findTaskByClientRequest(queryable, input.clientRequestId, principal)
  if (replayed) return []
  await assertNoDraftScriptEpisode(queryable, input, principal)
  const result = await queryable.query<GenerationTaskRow>(
    `
    UPDATE generation_tasks
    SET status = 'cancelled',
        progress = 100,
        error = $3,
        metadata = metadata || jsonb_build_object(
          'providerState', 'cancelled',
          'accountPreemptedAt', $4::text,
          'cancelReason', 'new_script_task',
          'cancelledAt', $4::text,
          'queueHiddenAt', $4::text
        ),
        lease_owner_id = NULL,
        lease_token = NULL,
        lease_acquired_at = NULL,
        lease_heartbeat_at = NULL,
        lease_expires_at = NULL,
        updated_at = $4::timestamptz
    WHERE tenant_id = $1
      AND user_id = $2
      AND kind = 'text'
      AND provider = 'text'
      AND metadata->>'generationStage' LIKE 'script-%'
      AND metadata->>'scriptOperation' IN ('generate', 'enrich', 'suggest-assets')
      AND status IN ('queued', 'paused', 'running')
      AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
    RETURNING ${generationTaskColumns}
    `,
    [principal.tenantId, principal.userId, SCRIPT_TASK_PREEMPT_ERROR, new Date().toISOString()],
  )
  return result.rows.map(taskFromRow)
}

async function assertNoDraftScriptEpisode(
  queryable: Queryable,
  input: CreateGenerationTask | GenerationTask,
  principal: Principal,
): Promise<void> {
  if (!isNextEpisodeScriptTask(input)) return
  const result = await queryable.query<{ id: string }>(
    `
    SELECT id
    FROM script_episodes
    WHERE project_id = $1
      AND tenant_id = $2
      AND status = 'draft'
      AND btrim(draft_content) <> ''
    ORDER BY episode_number DESC
    LIMIT 1
    `,
    [input.projectId, principal.tenantId],
  )
  if (result.rows[0]) throw scriptEpisodeDraftConflict()
}

function isScriptGenerationTask(input: CreateGenerationTask | GenerationTask): boolean {
  return (
    input.kind === 'text' &&
    input.provider === 'text' &&
    String(input.metadata?.generationStage || '').startsWith('script-') &&
    (input.metadata?.scriptOperation === 'generate' || input.metadata?.scriptOperation === 'enrich')
  )
}

function isPreemptibleScriptTask(input: CreateGenerationTask | GenerationTask): boolean {
  return (
    isScriptGenerationTask(input) ||
    (input.kind === 'text' &&
      input.provider === 'text' &&
      String(input.metadata?.generationStage || '').startsWith('script-') &&
      input.metadata?.scriptOperation === 'suggest-assets')
  )
}

function isNextEpisodeScriptTask(input: CreateGenerationTask | GenerationTask): boolean {
  return isScriptGenerationTask(input) && input.metadata?.mode === 'segment'
}

function scriptAccountLockKey(userId: string, tenantId: string): string {
  return `seqora:script-account:${tenantId}:${userId}`
}

function preemptActiveScriptTasksInState(
  state: AppState,
  input: CreateGenerationTask,
  principal: Principal,
): GenerationTask[] {
  if (!isScriptGenerationTask(input)) return []
  assertNoDraftScriptEpisodeInState(state, input, principal)
  const now = new Date().toISOString()
  return state.tasks
    .filter(
      (task) =>
        task.tenantId === principal.tenantId &&
        task.userId === principal.userId &&
        isPreemptibleScriptTask(task) &&
        ['queued', 'paused', 'running'].includes(task.status) &&
        typeof task.metadata.queueHiddenAt !== 'string',
    )
    .map((task) => {
      task.status = 'cancelled'
      task.progress = 100
      task.error = SCRIPT_TASK_PREEMPT_ERROR
      task.metadata = {
        ...task.metadata,
        providerState: 'cancelled',
        accountPreemptedAt: now,
        cancelReason: 'new_script_task',
        cancelledAt: now,
        queueHiddenAt: now,
      }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      return task
    })
}

function assertSingleScriptTaskInput(inputs: CreateGenerationTask[]): void {
  const count = inputs.filter(isScriptGenerationTask).length
  if (count > 1) {
    throw new AppError(409, 'SCRIPT_TASK_BATCH_CONFLICT', '一次只能提交一个剧本生成任务')
  }
}

const SCRIPT_TASK_PREEMPT_ERROR = '同一账号已启动新的剧本任务，本任务已自动停止'

function assertNoDraftScriptEpisodeInState(
  state: AppState,
  input: CreateGenerationTask | GenerationTask,
  principal: Principal,
): void {
  if (!isNextEpisodeScriptTask(input)) return
  const hasDraft = state.scriptEpisodes.some(
    (episode) =>
      episode.projectId === input.projectId &&
      episode.tenantId === principal.tenantId &&
      episode.status === 'draft' &&
      episode.draftContent.trim().length > 0,
  )
  if (hasDraft) throw scriptEpisodeDraftConflict()
}

function scriptEpisodeDraftConflict(): AppError {
  return new AppError(
    409,
    'SCRIPT_EPISODE_DRAFT_EXISTS',
    '当前项目已有未保存的剧集草稿，请先保存本集后再继续生成',
  )
}

async function findControlledTaskInDatabase(
  queryable: Queryable,
  taskId: string,
  principal: Principal,
): Promise<GenerationTask | null> {
  const result = await queryable.query<GenerationTaskRow>(
    `
    SELECT ${generationTaskColumns}
    FROM generation_tasks
    WHERE id = $1
      AND tenant_id = $2
      AND ($3::boolean OR user_id = $4)
    LIMIT 1
    FOR UPDATE
    `,
    [taskId, principal.tenantId, canReadAllTenantContent(principal), principal.userId],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

async function updateGenerationTaskLifecycle(
  queryable: Queryable,
  task: GenerationTask,
): Promise<GenerationTask | null> {
  const result = await queryable.query<GenerationTaskRow>(
    `
    UPDATE generation_tasks
    SET metadata = $2::jsonb,
        status = $3,
        progress = $4,
        attempts = $5,
        max_attempts = $6,
        lease_owner_id = $7,
        lease_token = $8,
        lease_acquired_at = $9,
        lease_heartbeat_at = $10,
        lease_expires_at = $11,
        result_url = $12,
        outputs = $13::jsonb,
        error = $14,
        updated_at = $15
    WHERE id = $1
      AND updated_at <= $15::timestamptz
    RETURNING ${generationTaskColumns}
    `,
    [
      task.id,
      JSON.stringify(task.metadata),
      task.status,
      task.progress,
      task.attempts ?? 0,
      task.maxAttempts ?? null,
      task.leaseOwnerId ?? null,
      task.leaseToken ?? null,
      task.leaseAcquiredAt ?? null,
      task.leaseHeartbeatAt ?? null,
      task.leaseExpiresAt ?? null,
      task.resultUrl,
      JSON.stringify(task.outputs),
      task.error,
      task.updatedAt,
    ],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

async function updateTaskResultTargets(
  queryable: Queryable,
  task: GenerationTask,
  selectedVersions?: { imageTaskId: string | null; videoTaskId: string | null },
): Promise<void> {
  if (task.status !== 'completed') return
  const updatedAt = task.updatedAt
  const assetId = metadataString(task.metadata, 'assetId')
  if (task.kind === 'image' && task.resultUrl && assetId) {
    await queryable.query(
      `
      UPDATE assets
      SET image_url = $4,
          updated_at = GREATEST(updated_at, $5::timestamptz)
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
      `,
      [assetId, task.projectId, task.tenantId, task.resultUrl, updatedAt],
    )
  }
  const shotId = metadataString(task.metadata, 'shotId')
  if (
    task.kind === 'image' &&
    task.resultUrl &&
    shotId &&
    (!selectedVersions?.imageTaskId || selectedVersions.imageTaskId === task.id)
  ) {
    await queryable.query(
      `
      UPDATE shots
      SET image_url = $4,
          selected_image_task_id = $5,
          updated_at = GREATEST(updated_at, $6::timestamptz)
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
      `,
      [shotId, task.projectId, task.tenantId, task.resultUrl, task.id, updatedAt],
    )
  }
  if (
    task.kind === 'video' &&
    shotId &&
    (!selectedVersions?.videoTaskId || selectedVersions.videoTaskId === task.id)
  ) {
    await queryable.query(
      `
      UPDATE shots
      SET selected_video_task_id = $4,
          updated_at = $5
      WHERE id = $1
        AND project_id = $2
        AND tenant_id = $3
      `,
      [shotId, task.projectId, task.tenantId, task.id, updatedAt],
    )
  }
}

async function assertNoActiveShotTask(
  queryable: Queryable,
  input: CreateGenerationTask,
  principal: Principal,
): Promise<void> {
  const shotId = metadataString(input.metadata, 'shotId')
  if (input.kind !== 'video' || !shotId) return
  const activeTask = await queryable.query<{ id: string }>(
    `
    SELECT id
    FROM generation_tasks
    WHERE project_id = $1
      AND tenant_id = $2
      AND kind = 'video'
      AND metadata->>'shotId' = $3
      AND status IN ('queued', 'paused', 'running')
      AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
    LIMIT 1
    `,
    [input.projectId, principal.tenantId, shotId],
  )
  if (activeTask.rows[0]) throw videoShotConflict()
}

function assertNoActiveShotTaskInState(
  state: AppState,
  input: CreateGenerationTask,
  principal: Principal,
): void {
  const shotId = metadataString(input.metadata, 'shotId')
  if (input.kind !== 'video' || !shotId) return
  const activeTask = state.tasks.find(
    (item) =>
      item.projectId === input.projectId &&
      item.tenantId === principal.tenantId &&
      item.kind === 'video' &&
      item.metadata.shotId === shotId &&
      ['queued', 'paused', 'running'].includes(item.status) &&
      typeof item.metadata.queueHiddenAt !== 'string',
  )
  if (activeTask) throw videoShotConflict()
}

function videoShotConflict(): AppError {
  return new AppError(
    409,
    'VIDEO_SHOT_BATCH_CONFLICT',
    'This shot already has an active video generation task. Pause or delete it before creating another one.',
  )
}

async function resolveMembershipForTask(
  queryable: Queryable,
  principal: Principal,
  forUpdate: boolean,
): Promise<TaskBillingTarget | null> {
  const result = await queryable.query<{
    id: string
    credits: number | null
    organization_type: string | null
    roles: string[]
  }>(
    `
    SELECT
      m.id,
      ${forUpdate ? 'b.credits' : 'NULL::integer'} AS credits,
      t.organization_type,
      m.roles
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
    JOIN billing_accounts b ON b.membership_id = m.id
    WHERE m.user_id = $1
      AND m.tenant_id = $2
      AND m.status = 'active'
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF b' : ''}
    `,
    [principal.userId, principal.tenantId],
  )
  const row = result.rows[0]
  if (!row) return null

  const usesOrganizationPool =
    row.organization_type === 'enterprise' &&
    (row.roles.includes('organization_admin') || row.roles.includes('organization_member'))
  if (!forUpdate || !usesOrganizationPool) {
    return {
      id: row.id,
      credits: row.credits === null ? null : Number(row.credits),
      billingScope: 'membership',
    }
  }

  await queryable.query(
    `
    INSERT INTO organization_billing_accounts (tenant_id, credits, created_at, updated_at)
    VALUES ($1, 0, now(), now())
    ON CONFLICT (tenant_id) DO NOTHING
    `,
    [principal.tenantId],
  )
  const organizationAccount = await queryable.query<{ credits: number | string }>(
    `
    SELECT credits
    FROM organization_billing_accounts
    WHERE tenant_id = $1
    LIMIT 1
    FOR UPDATE
    `,
    [principal.tenantId],
  )
  const organizationCredits = organizationAccount.rows[0]?.credits
  if (organizationCredits === undefined) return null
  return {
    id: row.id,
    credits: Number(organizationCredits),
    billingScope: 'organization',
  }
}

async function updateBillingBalanceForTask(
  queryable: Queryable,
  principal: Principal,
  membership: TaskBillingTarget,
  nextCredits: number,
  clientRequestId: string,
  credits: number,
  description: string,
  now: string,
): Promise<void> {
  if (membership.billingScope === 'organization') {
    await queryable.query(
      `
      UPDATE organization_billing_accounts
      SET credits = $2,
          updated_at = now()
      WHERE tenant_id = $1
      `,
      [principal.tenantId, nextCredits],
    )
    await queryable.query(
      `
      INSERT INTO organization_billing_ledger_entries (
        id,
        tenant_id,
        user_id,
        membership_id,
        reference_id,
        related_entry_id,
        entry_type,
        amount,
        balance,
        description,
        created_by_user_id,
        created_at,
        updated_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, NULL, 'generation', $6, $7, $8, $3, $9, $9, '{}'::jsonb)
      `,
      [
        `generation-${clientRequestId}`,
        principal.tenantId,
        principal.userId,
        membership.id,
        clientRequestId,
        -credits,
        nextCredits,
        description,
        now,
      ],
    )
    return
  }

  await queryable.query(
    `
    UPDATE billing_accounts
    SET credits = $2,
        updated_at = now()
    WHERE membership_id = $1
    `,
    [membership.id, nextCredits],
  )
  await queryable.query(
    `
    INSERT INTO billing_ledger_entries (
      id,
      tenant_id,
      user_id,
      membership_id,
      reference_id,
      related_entry_id,
      entry_type,
      amount,
      balance,
      description,
      created_by_user_id,
      created_at,
      updated_at,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, NULL, 'generation', $6, $7, $8, $3, $9, $9, '{}'::jsonb)
    `,
    [
      `generation-${clientRequestId}`,
      principal.tenantId,
      principal.userId,
      membership.id,
      clientRequestId,
      -credits,
      nextCredits,
      description,
      now,
    ],
  )
}

function assertUniqueClientRequestIds(inputs: CreateGenerationTask[]): void {
  const seen = new Set<string>()
  for (const input of inputs) {
    if (seen.has(input.clientRequestId)) {
      throw new AppError(400, 'DUPLICATE_CLIENT_REQUEST_ID', 'Batch task client request ids must be unique')
    }
    seen.add(input.clientRequestId)
  }
}

async function insertCreatedTask(
  client: PoolClient,
  task: GenerationTask,
  membershipId: string | null,
): Promise<GenerationTask | null> {
  const inserted = await client.query<GenerationTaskRow>(
    `
    INSERT INTO generation_tasks (
      id,
      client_request_id,
      project_id,
      tenant_id,
      user_id,
      membership_id,
      kind,
      label,
      prompt,
      negative_prompt,
      provider,
      model,
      tier,
      metadata,
      status,
      progress,
      estimated_credits,
      attempts,
      max_attempts,
      lease_owner_id,
      lease_token,
      lease_acquired_at,
      lease_heartbeat_at,
      lease_expires_at,
      result_url,
      outputs,
      error,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19,
      $20, $21, $22, $23, $24, $25, $26::jsonb, $27, $28, $29
    )
    ON CONFLICT (tenant_id, user_id, client_request_id) DO NOTHING
    RETURNING ${generationTaskColumns}
    `,
    taskInsertParams(task, membershipId),
  )
  return inserted.rows[0] ? taskFromRow(inserted.rows[0]) : null
}

async function insertTaskFromStore(client: PoolClient, task: GenerationTask): Promise<boolean> {
  const membership = await resolveMembershipForTask(
    client,
    { userId: task.userId, tenantId: task.tenantId, roles: [] },
    false,
  )
  const result = await client.query(
    `
    INSERT INTO generation_tasks (
      id,
      client_request_id,
      project_id,
      tenant_id,
      user_id,
      membership_id,
      kind,
      label,
      prompt,
      negative_prompt,
      provider,
      model,
      tier,
      metadata,
      status,
      progress,
      estimated_credits,
      attempts,
      max_attempts,
      lease_owner_id,
      lease_token,
      lease_acquired_at,
      lease_heartbeat_at,
      lease_expires_at,
      result_url,
      outputs,
      error,
      created_at,
      updated_at
    )
    SELECT
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19,
      $20, $21, $22, $23, $24, $25, $26::jsonb, $27, $28, $29
    WHERE EXISTS (SELECT 1 FROM projects WHERE id = $3 AND tenant_id = $4)
      AND EXISTS (SELECT 1 FROM users WHERE id = $5)
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    taskInsertParams(normalizeGenerationTaskLifecycle(task), membership?.id ?? null),
  )
  return (result.rowCount ?? 0) > 0
}

function taskInsertParams(task: GenerationTask, membershipId: string | null): unknown[] {
  return [
    task.id,
    task.clientRequestId,
    task.projectId,
    task.tenantId,
    task.userId,
    membershipId,
    task.kind,
    task.label,
    task.prompt,
    task.negativePrompt,
    task.provider,
    task.model,
    task.tier ?? null,
    JSON.stringify(task.metadata),
    task.status,
    task.progress,
    task.estimatedCredits,
    task.attempts ?? 0,
    task.maxAttempts ?? null,
    task.leaseOwnerId ?? null,
    task.leaseToken ?? null,
    task.leaseAcquiredAt ?? null,
    task.leaseHeartbeatAt ?? null,
    task.leaseExpiresAt ?? null,
    task.resultUrl,
    JSON.stringify(task.outputs),
    task.error,
    task.createdAt,
    task.updatedAt,
  ]
}

function buildQueuedGenerationTask(
  input: CreateGenerationTask,
  principal: Principal,
  now: string,
  options: { traceId?: string | null } = {},
): GenerationTask {
  return normalizeGenerationTaskLifecycle({
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
    tier: input.tier ?? null,
    metadata: traceMetadata(input.metadata, options.traceId),
    status: 'queued',
    progress: 0,
    estimatedCredits: input.estimatedCredits,
    maxAttempts: input.maxAttempts,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  })
}

function taskFromRow(row: GenerationTaskRow): GenerationTask {
  return normalizeGenerationTaskLifecycle({
    id: row.id,
    clientRequestId: row.client_request_id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    kind: row.kind,
    label: row.label,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    provider: row.provider,
    model: row.model,
    tier: row.tier ?? null,
    metadata: jsonValue(row.metadata, {}),
    status: row.status,
    progress: Number(row.progress),
    estimatedCredits: Number(row.estimated_credits),
    attempts: Number(row.attempts),
    maxAttempts: row.max_attempts === null ? undefined : Number(row.max_attempts),
    leaseOwnerId: row.lease_owner_id,
    leaseToken: row.lease_token,
    leaseAcquiredAt: nullableIsoString(row.lease_acquired_at),
    leaseHeartbeatAt: nullableIsoString(row.lease_heartbeat_at),
    leaseExpiresAt: nullableIsoString(row.lease_expires_at),
    resultUrl: row.result_url,
    outputs: jsonValue(row.outputs, []),
    error: row.error,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  })
}

function upsertTaskInState(state: AppState, task: GenerationTask): void {
  const index = state.tasks.findIndex((item) => item.id === task.id)
  if (index >= 0) {
    if (Date.parse(state.tasks[index]!.updatedAt) > Date.parse(task.updatedAt)) return
    state.tasks[index] = task
  } else {
    state.tasks.unshift(task)
  }
}

function projectFromRow(row: GenerationProjectRow): Project {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerId: row.owner_user_id,
    name: row.name,
    contentType: row.content_type,
    visualStyle: row.visual_style,
    episodeDurationSeconds: Number(row.episode_duration_seconds),
    aspectRatio: row.aspect_ratio,
    status: row.status,
    synopsis: row.synopsis,
    script: row.script,
    version: Number(row.version),
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

function shotFromRow(row: GenerationShotRow): Shot {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    scriptEpisodeId: null,
    order: Number(row.shot_order),
    title: row.title,
    framing: row.framing,
    duration: Number(row.duration_seconds),
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    imageUrl: row.image_url,
    selectedImageTaskId: row.selected_image_task_id,
    continuityMode: row.continuity_mode,
    continuityNote: row.continuity_note,
    episodeBreakBefore: row.episode_break_before,
    episodeNumber: Number(row.episode_number),
    episodeTitle: row.episode_title,
    episodeKind: row.episode_kind,
    selectedVideoTaskId: row.selected_video_task_id,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

function assetFromRow(row: GenerationAssetRow): Asset {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    kind: row.kind,
    sourceMode: row.source_mode,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    promptMode: row.prompt_mode,
    customPromptMode: row.custom_prompt_mode,
    customPrompt: row.custom_prompt,
    negativePrompt: row.negative_prompt,
    references: jsonValue(row.reference_items, []),
    attributes: jsonValue(row.attributes, { type: row.kind }) as Asset['attributes'],
    imageUrl: row.image_url,
    status: row.status,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

function findControlledTask(
  tasks: GenerationTask[],
  taskId: string,
  principal: Principal,
): GenerationTask | undefined {
  const canControlAll = canReadAllTenantContent(principal)
  return tasks.find(
    (task) =>
      task.id === taskId &&
      task.tenantId === principal.tenantId &&
      (canControlAll || task.userId === principal.userId),
  )
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return structuredClone(value) as T
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function nullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : isoString(value)
}
