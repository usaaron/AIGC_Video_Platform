import type { CreateGenerationTask, Principal } from '@seqora/contracts'
import type { QueryResult, QueryResultRow } from 'pg'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import { AppError } from '../../core/errors.js'
import type { AppState } from '../../infra/store.js'
import { metadataString } from './taskStateHelpers.js'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

// Importing a script revision holds the same project lock until its storyboard and
// receipt are committed. Acquire it before checking targets or reserving credits.
export async function lockStoryboardTaskProjects(
  client: Queryable,
  inputs: readonly CreateGenerationTask[],
  principal: Principal,
): Promise<void> {
  const projectIds = [...new Set(inputs.filter(hasStoryboardTarget).map((input) => input.projectId))].sort()
  for (const projectId of projectIds) {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM projects
       WHERE id = $1 AND tenant_id = $2
         AND ($3::boolean OR owner_user_id = $4) AND status <> 'archived'
       FOR UPDATE`,
      [projectId, principal.tenantId, canReadAllTenantContent(principal), principal.userId],
    )
    if (!result.rows[0]) throw missingShot()
  }
}

export async function assertStoryboardTaskTarget(
  client: Queryable,
  input: CreateGenerationTask,
  principal: Principal,
): Promise<void> {
  const shotId = metadataString(input.metadata, 'shotId')
  if (shotId) {
    const result = await client.query<{ updated_at: Date | string }>(
      `SELECT updated_at FROM shots WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
      [shotId, input.projectId, principal.tenantId],
    )
    if (!result.rows[0]) throw missingShot()
    assertUnchanged(input, result.rows[0].updated_at)
  }
  const sourceShotIds = filmSourceShotIds(input)
  if (sourceShotIds.length) {
    const result = await client.query<{ id: string; selected_video_task_id: string | null }>(
      `SELECT id, selected_video_task_id FROM shots
       WHERE id = ANY($1::text[]) AND project_id = $2 AND tenant_id = $3`,
      [sourceShotIds, input.projectId, principal.tenantId],
    )
    assertFilmSources(
      input,
      sourceShotIds,
      new Map(result.rows.map((row) => [row.id, row.selected_video_task_id])),
    )
  }
}

export function assertStoryboardTaskTargetInState(
  state: AppState,
  input: CreateGenerationTask,
  principal: Principal,
): void {
  const shotId = metadataString(input.metadata, 'shotId')
  const sourceShotIds = filmSourceShotIds(input)
  if (!shotId && !sourceShotIds.length) return
  const project = state.projects.find(
    (item) =>
      item.id === input.projectId &&
      item.tenantId === principal.tenantId &&
      item.status !== 'archived' &&
      (item.ownerId === principal.userId || canReadAllTenantContent(principal)),
  )
  if (!project) throw missingShot()
  if (shotId) {
    const shot = state.shots.find(
      (item) =>
        item.id === shotId && item.projectId === input.projectId && item.tenantId === principal.tenantId,
    )
    if (!shot) throw missingShot()
    assertUnchanged(input, shot.updatedAt)
  }
  if (sourceShotIds.length) {
    const shots = state.shots.filter(
      (item) => item.projectId === input.projectId && item.tenantId === principal.tenantId,
    )
    assertFilmSources(input, sourceShotIds, new Map(shots.map((shot) => [shot.id, shot.selectedVideoTaskId])))
  }
}

export function hasStoryboardTarget(input: CreateGenerationTask): boolean {
  return Boolean(metadataString(input.metadata, 'shotId')) || filmSourceShotIds(input).length > 0
}

function filmSourceShotIds(input: CreateGenerationTask): string[] {
  if (input.provider !== 'local-compose' || input.metadata?.generationStage !== 'film-preview') return []
  const sourceIds = input.metadata.sourceShotIds
  return Array.isArray(sourceIds)
    ? sourceIds.filter((value): value is string => typeof value === 'string')
    : []
}

function assertFilmSources(
  input: CreateGenerationTask,
  sourceShotIds: string[],
  selectedVideos: Map<string, string | null | undefined>,
): void {
  const sourceVideoIds = input.metadata?.sourceVideoTaskIds
  for (const [index, shotId] of sourceShotIds.entries()) {
    const selectedVideo = selectedVideos.get(shotId)
    if (
      !selectedVideos.has(shotId) ||
      (selectedVideo && Array.isArray(sourceVideoIds) && sourceVideoIds[index] !== selectedVideo)
    ) {
      throw new AppError(409, 'FILM_STORYBOARD_CHANGED', '分镜或已选视频已更新，请刷新后重新生成成片预览')
    }
    // With no explicit selection the preview planner intentionally uses a completed
    // task fallback. Retain that behavior instead of requiring a selected task ID.
  }
}

function assertUnchanged(input: CreateGenerationTask, updatedAt: Date | string): void {
  const expected = metadataString(input.metadata, 'sourceShotUpdatedAt')
  if (expected && new Date(expected).getTime() !== new Date(updatedAt).getTime()) {
    throw new AppError(409, 'SHOT_CHANGED', '分镜已更新，请刷新后重新生成；本次未扣费')
  }
}

function missingShot(): AppError {
  return new AppError(404, 'SHOT_NOT_FOUND', '分镜已移除或无权生成，请刷新后重试；本次未扣费')
}
