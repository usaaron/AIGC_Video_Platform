import { findTaskByClientRequest } from './taskCreation.js'
import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import { releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import type { AppState } from '../../infra/store.js'
import { generationTaskColumns, type GenerationTaskRow, taskFromRow } from './repositoryData.js'
import type { QueryResult, QueryResultRow } from 'pg'
type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}
export async function preemptActiveScriptTasksInDatabase(
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
      AND project_id NOT LIKE 'sm-standalone-%'
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

export async function assertNoDraftScriptEpisode(
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
      AND project_id NOT LIKE 'sm-standalone-%'
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

export function isScriptGenerationTask(input: CreateGenerationTask | GenerationTask): boolean {
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

export function preemptActiveScriptTasksInState(
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

export function assertSingleScriptTaskInput(inputs: CreateGenerationTask[]): void {
  const count = inputs.filter(isScriptGenerationTask).length
  if (count > 1) {
    throw new AppError(409, 'SCRIPT_TASK_BATCH_CONFLICT', '一次只能提交一个剧本生成任务')
  }
}

const SCRIPT_TASK_PREEMPT_ERROR = '同一账号已启动新的剧本任务，本任务已自动停止'

export function assertNoDraftScriptEpisodeInState(
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
