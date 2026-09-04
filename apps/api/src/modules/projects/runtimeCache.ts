import type { QueryResultRow } from 'pg'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'
import {
  assetColumns,
  assetFromRow,
  projectColumns,
  projectFromRow,
  scriptEpisodeColumns,
  scriptEpisodeFromRow,
  shotColumns,
  shotFromRow,
  type AssetRow,
  type ProjectRow,
  type ScriptEpisodeRow,
  type ShotRow,
} from './repositoryData.js'

export type ProjectRuntimeCacheOptions = {
  projectIds?: readonly string[]
  merge?: boolean
}

type RuntimeProjectVersionRow = QueryResultRow & {
  id: string
  version: number | string
  updated_at: Date | string
}

type Queryable = Pick<AccountDatabase, 'query'>

export async function readRuntimeProjectVersions(
  database: Queryable,
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(projectIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const result = await database.query<RuntimeProjectVersionRow>(
    `
    SELECT id, version, updated_at
    FROM projects
    WHERE id = ANY($1::text[])
    `,
    [ids],
  )
  return new Map(result.rows.map((row) => [row.id, `${row.version}:${isoString(row.updated_at)}`]))
}

export async function refreshProjectWorkspaceRuntimeCache(
  database: AccountDatabase | null,
  store: AppStore | null,
  options: ProjectRuntimeCacheOptions = {},
): Promise<void> {
  if (!database || !store) return
  const projectIds =
    options.projectIds === undefined ? undefined : [...new Set(options.projectIds.filter(Boolean))]
  if (projectIds && !projectIds.length) {
    await store.replaceProjectWorkspaceRuntimeCacheAsync({
      projects: [],
      scriptEpisodes: [],
      assets: [],
      shots: [],
    })
    return
  }
  const projectFilter = projectIds ? ' WHERE id = ANY($1::text[])' : ''
  const workspaceFilter = projectIds ? ' WHERE project_id = ANY($1::text[])' : ''
  const params = projectIds ? [projectIds] : []
  const [projects, scriptEpisodes, assets, shots] = await Promise.all([
    database.query<ProjectRow>(
      `SELECT ${projectColumns} FROM projects${projectFilter} ORDER BY updated_at DESC`,
      params,
    ),
    database.query<ScriptEpisodeRow>(
      `SELECT ${scriptEpisodeColumns} FROM script_episodes${workspaceFilter} ORDER BY project_id, episode_number ASC`,
      params,
    ),
    database.query<AssetRow>(
      `SELECT ${assetColumns} FROM assets${workspaceFilter} ORDER BY updated_at DESC, created_at DESC`,
      params,
    ),
    database.query<ShotRow>(
      `SELECT ${shotColumns} FROM shots${workspaceFilter} ORDER BY shot_order ASC`,
      params,
    ),
  ])
  const workspace = {
    projects: projects.rows.map(projectFromRow),
    scriptEpisodes: scriptEpisodes.rows.map(scriptEpisodeFromRow),
    assets: assets.rows.map(assetFromRow),
    shots: shots.rows.map(shotFromRow),
  }
  if (!options.merge || !projectIds) {
    await store.replaceProjectWorkspaceRuntimeCacheAsync(workspace)
    return
  }
  const selectedProjectIds = new Set(projectIds)
  await store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
    state.projects = state.projects.filter((project) => !selectedProjectIds.has(project.id))
    state.scriptEpisodes = state.scriptEpisodes.filter(
      (episode) => !selectedProjectIds.has(episode.projectId),
    )
    state.assets = state.assets.filter((asset) => !selectedProjectIds.has(asset.projectId))
    state.shots = state.shots.filter((shot) => !selectedProjectIds.has(shot.projectId))
    state.projects.push(...workspace.projects)
    state.scriptEpisodes.push(...workspace.scriptEpisodes)
    state.assets.push(...workspace.assets)
    state.shots.push(...workspace.shots)
  })
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
