import type { Principal } from '@seqora/contracts'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'

type Queryable = Pick<AccountDatabase, 'query'>

type WorkspaceVersionRow = {
  project_version: number | string
  project_updated_at: Date | string
  episode_count: number | string
  episode_updated_at: Date | string
  asset_count: number | string
  asset_updated_at: Date | string
  shot_count: number | string
  shot_updated_at: Date | string
}

export async function readWorkspaceVersion(
  database: Queryable,
  projectId: string,
  principal: Principal,
): Promise<string | null> {
  const canReadAll = canReadAllTenantContent(principal)
  const result = await database.query<WorkspaceVersionRow>(
    `
    SELECT
      project.version AS project_version,
      project.updated_at AS project_updated_at,
      (SELECT count(*) FROM script_episodes episode
       WHERE episode.project_id = project.id AND episode.tenant_id = project.tenant_id) AS episode_count,
      (SELECT COALESCE(max(episode.updated_at), 'epoch'::timestamptz)
       FROM script_episodes episode
       WHERE episode.project_id = project.id AND episode.tenant_id = project.tenant_id) AS episode_updated_at,
      (SELECT count(*) FROM assets asset
       WHERE asset.project_id = project.id AND asset.tenant_id = project.tenant_id) AS asset_count,
      (SELECT COALESCE(max(asset.updated_at), 'epoch'::timestamptz)
       FROM assets asset
       WHERE asset.project_id = project.id AND asset.tenant_id = project.tenant_id) AS asset_updated_at,
      (SELECT count(*) FROM shots shot
       WHERE shot.project_id = project.id AND shot.tenant_id = project.tenant_id) AS shot_count,
      (SELECT COALESCE(max(shot.updated_at), 'epoch'::timestamptz)
       FROM shots shot
       WHERE shot.project_id = project.id AND shot.tenant_id = project.tenant_id) AS shot_updated_at
    FROM projects project
    WHERE project.id = $1
      AND project.tenant_id = $2
      AND ($3::boolean OR project.owner_user_id = $4)
    `,
    [projectId, principal.tenantId, canReadAll, principal.userId],
  )
  const row = result.rows[0]
  return row ? versionFromRow(row) : null
}

export function readWorkspaceVersionFromStore(
  store: AppStore,
  projectId: string,
  principal: Principal,
): string | null {
  return store.read((state) => {
    const canReadAll = canReadAllTenantContent(principal)
    const project = state.projects.find(
      (item) =>
        item.id === projectId &&
        item.tenantId === principal.tenantId &&
        (canReadAll || item.ownerId === principal.userId),
    )
    if (!project) return null
    return [
      project.version,
      project.updatedAt,
      collectionVersion(state.scriptEpisodes, projectId, principal.tenantId),
      collectionVersion(state.assets, projectId, principal.tenantId),
      collectionVersion(state.shots, projectId, principal.tenantId),
    ].join(':')
  })
}

function collectionVersion(
  items: Array<{ projectId: string; tenantId: string; updatedAt: string }>,
  projectId: string,
  tenantId: string,
) {
  const visible = items.filter((item) => item.projectId === projectId && item.tenantId === tenantId)
  return `${visible.length}:${visible.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), '1970-01-01T00:00:00.000Z')}`
}

function versionFromRow(row: WorkspaceVersionRow): string {
  return [
    row.project_version,
    isoString(row.project_updated_at),
    row.episode_count,
    isoString(row.episode_updated_at),
    row.asset_count,
    isoString(row.asset_updated_at),
    row.shot_count,
    isoString(row.shot_updated_at),
  ].join(':')
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
