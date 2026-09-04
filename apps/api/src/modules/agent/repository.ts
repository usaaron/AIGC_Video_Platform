import {
  AGENT_STAGE_KEYS,
  agentRunSchema,
  type AgentPlan,
  type AgentRun,
  type AgentRunStage,
  type AgentStageKey,
  type Principal,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'
import { AppError } from '../../core/errors.js'

type AgentRunRow = QueryResultRow & {
  id: string
  client_request_id: string
  tenant_id: string
  user_id: string
  project_id: string | null
  original_prompt: string
  plan: unknown
  status: AgentRun['status']
  pause_requested: boolean
  current_stage: AgentRun['currentStage']
  stages: unknown
  deliveries: unknown
  last_error: string | null
  lease_owner_id: string | null
  lease_expires_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
  confirmed_at: Date | string | null
  completed_at: Date | string | null
}

const runColumnNames = [
  'id',
  'client_request_id',
  'tenant_id',
  'user_id',
  'project_id',
  'original_prompt',
  'plan',
  'status',
  'pause_requested',
  'current_stage',
  'stages',
  'deliveries',
  'last_error',
  'lease_owner_id',
  'lease_expires_at',
  'created_at',
  'updated_at',
  'confirmed_at',
  'completed_at',
] as const
const runColumns = runColumnNames.join(', ')

function qualifiedRunColumns(alias: string): string {
  return runColumnNames.map((column) => `${alias}.${column}`).join(', ')
}

export class AgentRunRepository {
  private readonly memoryRuns: AgentRun[] = []

  constructor(
    private readonly database: AccountDatabase | null,
    private readonly store: AppStore | null = null,
  ) {}

  async savePlan(input: {
    runId?: string
    originalPrompt: string
    plan: AgentPlan
    principal: Principal
  }): Promise<AgentRun> {
    if (!this.database) return this.savePlanInMemory(input)
    if (input.runId) {
      const result = await this.database.query<AgentRunRow>(
        `
        UPDATE agent_runs
        SET original_prompt = $4, plan = $5::jsonb, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND status = 'draft'
        RETURNING ${runColumns}
        `,
        [
          input.runId,
          input.principal.tenantId,
          input.principal.userId,
          input.originalPrompt,
          JSON.stringify(input.plan),
        ],
      )
      if (!result.rows[0]) throw new AppError(404, 'AGENT_RUN_NOT_FOUND', 'Agent 会话不存在或已经确认')
      return runFromRow(result.rows[0])
    }

    const now = new Date().toISOString()
    const run = newDraftRun(input.originalPrompt, input.plan, input.principal, now)
    const result = await this.database.query<AgentRunRow>(
      `
      INSERT INTO agent_runs (
        id, client_request_id, tenant_id, user_id, original_prompt, plan, status, pause_requested,
        current_stage, stages, deliveries, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'draft', false, NULL, $7::jsonb, '[]'::jsonb, $8, $8)
      RETURNING ${runColumns}
      `,
      [
        run.id,
        run.clientRequestId,
        run.tenantId,
        run.userId,
        run.originalPrompt,
        JSON.stringify(run.plan),
        JSON.stringify(run.stages),
        now,
      ],
    )
    return runFromRow(result.rows[0]!)
  }

  async list(principal: Principal): Promise<AgentRun[]> {
    if (!this.database) {
      return this.memoryRuns
        .filter((run) => run.tenantId === principal.tenantId && run.userId === principal.userId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(cloneRun)
    }
    const result = await this.database.query<AgentRunRow>(
      `SELECT ${runColumns} FROM agent_runs WHERE tenant_id = $1 AND user_id = $2 ORDER BY updated_at DESC LIMIT 50`,
      [principal.tenantId, principal.userId],
    )
    return result.rows.map(runFromRow)
  }

  async find(runId: string, principal: Principal): Promise<AgentRun | null> {
    if (!this.database) {
      const run = this.memoryRuns.find(
        (item) =>
          item.id === runId && item.tenantId === principal.tenantId && item.userId === principal.userId,
      )
      return run ? cloneRun(run) : null
    }
    const result = await this.database.query<AgentRunRow>(
      `SELECT ${runColumns} FROM agent_runs WHERE id = $1 AND tenant_id = $2 AND user_id = $3 LIMIT 1`,
      [runId, principal.tenantId, principal.userId],
    )
    return result.rows[0] ? runFromRow(result.rows[0]) : null
  }

  async principalFor(run: AgentRun): Promise<Principal> {
    if (!this.database) {
      const user = this.store?.read((state) =>
        state.users.find((item) => item.id === run.userId && item.tenantId === run.tenantId),
      )
      if (!user) throw new Error('Agent account no longer exists')
      return { userId: run.userId, tenantId: run.tenantId, roles: user.roles }
    }
    const result = await this.database.query<{ roles: Principal['roles'] }>(
      `
      SELECT roles
      FROM tenant_memberships
      WHERE user_id = $1 AND tenant_id = $2 AND status = 'active'
      LIMIT 1
      `,
      [run.userId, run.tenantId],
    )
    const membership = result.rows[0]
    if (!membership) throw new Error('Agent account membership no longer exists')
    return { userId: run.userId, tenantId: run.tenantId, roles: membership.roles }
  }

  async confirm(runId: string, clientRequestId: string, principal: Principal): Promise<AgentRun> {
    if (!this.database) return this.confirmInMemory(runId, clientRequestId, principal)
    return this.database.transaction(async (client) => {
      const selected = await client.query<AgentRunRow>(
        `SELECT ${runColumns} FROM agent_runs WHERE id = $1 AND tenant_id = $2 AND user_id = $3 FOR UPDATE`,
        [runId, principal.tenantId, principal.userId],
      )
      const current = selected.rows[0] ? runFromRow(selected.rows[0]) : null
      if (!current) throw new AppError(404, 'AGENT_RUN_NOT_FOUND', 'Agent 会话不存在或无权访问')
      if (current.projectId) return current
      assertConfirmable(current)
      const project = projectInput(current.plan, principal)
      await client.query(
        `
        INSERT INTO projects (
          id, tenant_id, owner_user_id, name, content_type, visual_style, episode_duration_seconds,
          aspect_ratio, status, synopsis, script, version, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'producing', $9, '', 1, now(), now())
        `,
        [
          project.id,
          principal.tenantId,
          principal.userId,
          project.name,
          project.contentType,
          project.visualStyle,
          project.episodeDurationSeconds,
          project.aspectRatio,
          project.synopsis,
        ],
      )
      const updated = await client.query<AgentRunRow>(
        `
        UPDATE agent_runs
        SET client_request_id = $4, project_id = $5, status = 'queued', current_stage = 'script',
            confirmed_at = now(), updated_at = now(), version = version + 1
        WHERE id = $1 AND tenant_id = $2 AND user_id = $3
        RETURNING ${runColumns}
        `,
        [runId, principal.tenantId, principal.userId, clientRequestId, project.id],
      )
      return runFromRow(updated.rows[0]!)
    })
  }

  async requestPause(runId: string, principal: Principal): Promise<AgentRun> {
    return this.control(runId, principal, (run) => {
      if (['completed', 'cancelled', 'failed'].includes(run.status)) return run
      run.pauseRequested = true
      run.status = run.status === 'queued' ? 'paused' : 'pausing'
      return run
    })
  }

  async resume(runId: string, principal: Principal): Promise<AgentRun> {
    return this.control(runId, principal, (run) => {
      if (!['paused', 'pausing'].includes(run.status)) {
        throw new AppError(409, 'AGENT_RUN_NOT_PAUSED', '只有已暂停或暂停中的任务可以继续')
      }
      run.pauseRequested = false
      run.status = 'queued'
      return run
    })
  }

  async retry(runId: string, principal: Principal): Promise<AgentRun> {
    return this.control(runId, principal, (run) => {
      if (run.status !== 'failed' || !run.currentStage) {
        throw new AppError(409, 'AGENT_RUN_NOT_FAILED', '当前没有可重试的失败阶段')
      }
      const stage = run.stages.find((item) => item.key === run.currentStage)!
      stage.status = 'pending'
      stage.error = null
      stage.attempt += 1
      stage.startedAt = null
      stage.completedAt = null
      run.status = 'queued'
      run.pauseRequested = false
      run.lastError = null
      return run
    })
  }

  async skip(runId: string, stageKey: AgentStageKey, principal: Principal): Promise<AgentRun> {
    return this.control(runId, principal, (run) => {
      const skippable =
        run.plan.visualStyle !== 'photorealistic' &&
        (stageKey === 'asset-analysis' || stageKey === 'asset-generation')
      if (!skippable) {
        throw new AppError(409, 'AGENT_STAGE_REQUIRED', '该阶段是交付成片的必要步骤，不能跳过')
      }
      const stage = run.stages.find((item) => item.key === stageKey)!
      if (run.currentStage !== stageKey || stage.status !== 'failed') {
        throw new AppError(409, 'AGENT_STAGE_NOT_SKIPPABLE', '只能跳过当前失败的可降级阶段')
      }
      stage.status = 'skipped'
      stage.error = null
      stage.completedAt = new Date().toISOString()
      const index = run.stages.findIndex((item) => item.key === stageKey)
      run.currentStage = run.stages[index + 1]?.key ?? null
      run.status = 'queued'
      run.lastError = null
      return run
    })
  }

  async claimNext(ownerId: string, leaseMs = 30_000): Promise<AgentRun | null> {
    if (!this.database) {
      const run = this.memoryRuns.find((item) => ['queued', 'running', 'pausing'].includes(item.status))
      if (!run) return null
      run.status = run.status === 'queued' ? 'running' : run.status
      return cloneRun(run)
    }
    return this.database.transaction(async (client) => {
      const result = await client.query<AgentRunRow>(
        `
        WITH next_run AS (
          SELECT id FROM agent_runs
          WHERE status IN ('queued', 'running', 'pausing')
            AND (lease_expires_at IS NULL OR lease_expires_at <= now())
          ORDER BY updated_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE agent_runs r
        SET lease_owner_id = $1, lease_expires_at = now() + ($2 * interval '1 millisecond'),
            status = CASE WHEN r.status = 'queued' THEN 'running' ELSE r.status END,
            updated_at = now()
        FROM next_run
        WHERE r.id = next_run.id
        RETURNING ${qualifiedRunColumns('r')}
        `,
        [ownerId, leaseMs],
      )
      return result.rows[0] ? runFromRow(result.rows[0]) : null
    })
  }

  async activeProjectIds(): Promise<string[]> {
    if (!this.database) {
      return [
        ...new Set(
          this.memoryRuns
            .filter((run) => ['queued', 'running', 'pausing'].includes(run.status) && run.projectId)
            .map((run) => run.projectId!),
        ),
      ]
    }
    const result = await this.database.query<{ project_id: string }>(
      `
      SELECT DISTINCT project_id
      FROM agent_runs
      WHERE status IN ('queued', 'running', 'pausing')
        AND project_id IS NOT NULL
      `,
    )
    return result.rows.map((row) => row.project_id)
  }

  async saveClaimed(run: AgentRun, ownerId: string): Promise<AgentRun> {
    const normalized = agentRunSchema.parse(run)
    if (!this.database) {
      const index = this.memoryRuns.findIndex((item) => item.id === run.id)
      if (index >= 0) this.memoryRuns[index] = cloneRun(normalized)
      return cloneRun(normalized)
    }
    const result = await this.database.query<AgentRunRow>(
      `
      UPDATE agent_runs
      SET status = $3, pause_requested = $4, current_stage = $5, stages = $6::jsonb,
          deliveries = $7::jsonb, last_error = $8, updated_at = $9,
          completed_at = $10, lease_owner_id = NULL, lease_expires_at = NULL, version = version + 1
      WHERE id = $1 AND lease_owner_id = $2
      RETURNING ${runColumns}
      `,
      [
        run.id,
        ownerId,
        run.status,
        run.pauseRequested,
        run.currentStage,
        JSON.stringify(run.stages),
        JSON.stringify(run.deliveries),
        run.lastError,
        run.updatedAt,
        run.completedAt,
      ],
    )
    if (!result.rows[0]) throw new Error('Agent run lease was lost')
    return runFromRow(result.rows[0])
  }

  private async control(
    runId: string,
    principal: Principal,
    operation: (run: AgentRun) => AgentRun,
  ): Promise<AgentRun> {
    if (!this.database) {
      const current = await this.find(runId, principal)
      if (!current) throw new AppError(404, 'AGENT_RUN_NOT_FOUND', 'Agent 任务不存在或无权访问')
      const next = operation(current)
      next.updatedAt = new Date().toISOString()
      const index = this.memoryRuns.findIndex((item) => item.id === runId)
      this.memoryRuns[index] = cloneRun(next)
      return cloneRun(next)
    }
    return this.database.transaction(async (client) => {
      const selected = await client.query<AgentRunRow>(
        `SELECT ${runColumns} FROM agent_runs WHERE id = $1 AND tenant_id = $2 AND user_id = $3 FOR UPDATE`,
        [runId, principal.tenantId, principal.userId],
      )
      if (!selected.rows[0]) {
        throw new AppError(404, 'AGENT_RUN_NOT_FOUND', 'Agent 任务不存在或无权访问')
      }
      const next = operation(runFromRow(selected.rows[0]))
      next.updatedAt = new Date().toISOString()
      const result = await client.query<AgentRunRow>(
        `
        UPDATE agent_runs
        SET status = $4, pause_requested = $5, current_stage = $6, stages = $7::jsonb,
            last_error = $8, updated_at = $9, lease_owner_id = NULL, lease_expires_at = NULL,
            version = version + 1
        WHERE id = $1 AND tenant_id = $2 AND user_id = $3
        RETURNING ${runColumns}
        `,
        [
          runId,
          principal.tenantId,
          principal.userId,
          next.status,
          next.pauseRequested,
          next.currentStage,
          JSON.stringify(next.stages),
          next.lastError,
          next.updatedAt,
        ],
      )
      return runFromRow(result.rows[0]!)
    })
  }

  private savePlanInMemory(input: {
    runId?: string
    originalPrompt: string
    plan: AgentPlan
    principal: Principal
  }): AgentRun {
    if (input.runId) {
      const run = this.memoryRuns.find(
        (item) =>
          item.id === input.runId &&
          item.tenantId === input.principal.tenantId &&
          item.userId === input.principal.userId,
      )
      if (!run || run.status !== 'draft')
        throw new AppError(404, 'AGENT_RUN_NOT_FOUND', 'Agent 会话不存在或已经确认')
      run.originalPrompt = input.originalPrompt
      run.plan = input.plan
      run.updatedAt = new Date().toISOString()
      return cloneRun(run)
    }
    const run = newDraftRun(input.originalPrompt, input.plan, input.principal, new Date().toISOString())
    this.memoryRuns.unshift(run)
    return cloneRun(run)
  }

  private async confirmInMemory(
    runId: string,
    clientRequestId: string,
    principal: Principal,
  ): Promise<AgentRun> {
    const run = this.memoryRuns.find(
      (item) => item.id === runId && item.tenantId === principal.tenantId && item.userId === principal.userId,
    )
    if (!run) throw new AppError(404, 'AGENT_RUN_NOT_FOUND', 'Agent 会话不存在或无权访问')
    if (run.projectId) return cloneRun(run)
    assertConfirmable(run)
    if (!this.store) throw new Error('Agent repository requires AppStore without PostgreSQL')
    const project = projectInput(run.plan, principal)
    await this.store.mutate((state) => state.projects.push(project))
    run.clientRequestId = clientRequestId
    run.projectId = project.id
    run.status = 'queued'
    run.currentStage = 'script'
    run.confirmedAt = new Date().toISOString()
    run.updatedAt = run.confirmedAt
    return cloneRun(run)
  }
}

function newDraftRun(originalPrompt: string, plan: AgentPlan, principal: Principal, now: string): AgentRun {
  return agentRunSchema.parse({
    id: randomUUID(),
    clientRequestId: `draft-${randomUUID()}`,
    tenantId: principal.tenantId,
    userId: principal.userId,
    projectId: null,
    originalPrompt,
    plan,
    status: 'draft',
    pauseRequested: false,
    currentStage: null,
    stages: AGENT_STAGE_KEYS.map((key): AgentRunStage => ({
      key,
      status: 'pending',
      taskIds: [],
      attempt: 0,
      output: {},
      error: null,
      startedAt: null,
      completedAt: null,
    })),
    deliveries: [],
    lastError: null,
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
    completedAt: null,
  })
}

function assertConfirmable(run: AgentRun): void {
  if (run.status !== 'draft') throw new AppError(409, 'AGENT_RUN_ALREADY_CONFIRMED', '该方案已经确认')
  if (run.plan.missingFields.length || !run.plan.estimate) {
    throw new AppError(409, 'AGENT_PLAN_INCOMPLETE', '请先补齐制作信息，再确认开始')
  }
}

function projectInput(plan: AgentPlan, principal: Principal) {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    tenantId: principal.tenantId,
    ownerId: principal.userId,
    name: plan.projectName,
    contentType:
      plan.contentType === 'web-series'
        ? ('short-drama' as const)
        : plan.contentType === 'advertisement'
          ? ('advertisement' as const)
          : ('animation' as const),
    visualStyle: plan.visualStyle!,
    episodeDurationSeconds: plan.episodeDurationSeconds!,
    aspectRatio: plan.aspectRatio!,
    status: 'producing' as const,
    synopsis: plan.storyBrief.slice(0, 1_000),
    script: '',
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function runFromRow(row: AgentRunRow): AgentRun {
  return agentRunSchema.parse({
    id: row.id,
    clientRequestId: row.client_request_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    projectId: row.project_id,
    originalPrompt: row.original_prompt,
    plan: json(row.plan),
    status: row.status,
    pauseRequested: row.pause_requested,
    currentStage: row.current_stage,
    stages: json(row.stages),
    deliveries: json(row.deliveries),
    lastError: row.last_error,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    confirmedAt: row.confirmed_at ? iso(row.confirmed_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
  })
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return JSON.parse(value)
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function cloneRun(run: AgentRun): AgentRun {
  return structuredClone(run)
}
