import type { Principal, Project, UpdateProject } from '@seqora/contracts'
import type { QueryResult, QueryResultRow } from 'pg'
import type { TextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import { projectColumns, projectFromRow, type ProjectRow } from './repositoryData.js'
import { lockTextTaskWriteGuard } from './textTaskWriteGuard.js'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>
}

export async function updateProjectInDatabase(
  database: AccountDatabase,
  projectId: string,
  input: UpdateProject,
  principal: Principal,
  taskWriteGuard?: TextTaskWriteGuard,
): Promise<Project | null> {
  const update = async (client: Queryable): Promise<Project | null> => {
    const assertActive = await lockTextTaskWriteGuard(client, projectId, principal, taskWriteGuard)
    const current = await client.query<ProjectRow>(
      `SELECT ${projectColumns} FROM projects
       WHERE id = $1 AND tenant_id = $2 AND owner_user_id = $3
       ${taskWriteGuard ? 'FOR UPDATE' : ''}`,
      [projectId, principal.tenantId, principal.userId],
    )
    if (!current.rows[0]) return null
    const existing = projectFromRow(current.rows[0])
    assertActive()
    const result = await client.query<ProjectRow>(
      `UPDATE projects
       SET name = $4, status = $5, visual_style = $6, episode_duration_seconds = $7,
           synopsis = $8, script = $9, updated_at = $10
       WHERE id = $1 AND tenant_id = $2 AND owner_user_id = $3
       RETURNING ${projectColumns}`,
      [
        projectId,
        principal.tenantId,
        principal.userId,
        input.name ?? existing.name,
        input.status ?? existing.status,
        input.visualStyle ?? existing.visualStyle,
        input.episodeDurationSeconds ?? existing.episodeDurationSeconds,
        input.synopsis ?? existing.synopsis,
        input.script ?? existing.script,
        new Date().toISOString(),
      ],
    )
    assertActive()
    return result.rows[0] ? projectFromRow(result.rows[0]) : null
  }
  return taskWriteGuard ? database.transaction(update) : update(database)
}
