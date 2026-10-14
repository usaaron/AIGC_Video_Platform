import type { Asset, Project, ScriptEpisode, Shot } from '@seqora/contracts'
import type { PoolClient } from 'pg'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'
import {
  assetInsertParams,
  shotInsertParams,
  shotInsertColumns,
  shotInsertValues,
} from './workspaceSqlParams.js'
import { isStandaloneProjectId } from './projectSurface.js'
import { refreshProjectWorkspaceRuntimeCache } from './runtimeCache.js'

export type ProjectJsonImportResult = {
  projects: { inserted: number; skipped: number }
  assets: { inserted: number; skipped: number }
  shots: { inserted: number; skipped: number }
}

async function insertProjectFromStore(client: PoolClient, project: Project): Promise<boolean> {
  const result = await client.query(
    `
    INSERT INTO projects (
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
    )
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
    WHERE EXISTS (SELECT 1 FROM tenants WHERE id = $2)
      AND EXISTS (SELECT 1 FROM users WHERE id = $3)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
    `,
    [
      project.id,
      project.tenantId,
      project.ownerId,
      project.name,
      project.contentType,
      project.visualStyle ?? 'cinematic-cg',
      project.episodeDurationSeconds ?? 60,
      project.aspectRatio,
      project.status,
      project.synopsis,
      project.script,
      project.version,
      project.createdAt,
      project.updatedAt,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

async function insertAssetFromStore(client: PoolClient, asset: Asset): Promise<boolean> {
  const result = await client.query(
    `
    INSERT INTO assets (
      id,
      project_id,
      tenant_id,
      kind,
      source_mode,
      name,
      description,
      prompt,
      prompt_mode,
      custom_prompt_mode,
      custom_prompt,
      negative_prompt,
      reference_items,
      attributes,
      image_url,
      status,
      created_at,
      updated_at
    )
    SELECT
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
      $13::jsonb, $14::jsonb, $15, $16, $17, $18
    WHERE EXISTS (SELECT 1 FROM projects WHERE id = $2 AND tenant_id = $3)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
    `,
    assetInsertParams(asset),
  )
  return (result.rowCount ?? 0) > 0
}

async function insertScriptEpisodeFromStore(client: PoolClient, episode: ScriptEpisode): Promise<boolean> {
  const result = await client.query(
    `
    INSERT INTO script_episodes (
      id, project_id, tenant_id, episode_number, title, content, draft_content,
      status, summary, continuity_state, revision, last_edited_by, created_at, updated_at
    )
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14
    WHERE EXISTS (SELECT 1 FROM projects WHERE id = $2 AND tenant_id = $3)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
    `,
    [
      episode.id,
      episode.projectId,
      episode.tenantId,
      episode.episodeNumber,
      episode.title,
      episode.content,
      episode.draftContent,
      episode.status,
      episode.summary,
      JSON.stringify(episode.continuityState),
      episode.revision,
      episode.lastEditedBy,
      episode.createdAt,
      episode.updatedAt,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

async function insertShotFromStore(client: PoolClient, shot: Shot): Promise<boolean> {
  const result = await client.query(
    `
    INSERT INTO shots (${shotInsertColumns}) SELECT ${shotInsertValues}
    WHERE EXISTS (SELECT 1 FROM projects WHERE id = $2 AND tenant_id = $3)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
    `,
    shotInsertParams(shot),
  )
  return (result.rowCount ?? 0) > 0
}

export async function importProjectsFromStore(
  store: AppStore | null,
  database: AccountDatabase | null,
): Promise<ProjectJsonImportResult> {
  if (!database || !store) {
    return {
      projects: { inserted: 0, skipped: 0 },
      assets: { inserted: 0, skipped: 0 },
      shots: { inserted: 0, skipped: 0 },
    }
  }
  const snapshot = store.read((state) => {
    const projects = state.projects.filter((project) => !isStandaloneProjectId(project.id))
    const projectIds = new Set(projects.map((project) => project.id))
    return {
      projects,
      scriptEpisodes: state.scriptEpisodes.filter((episode) => projectIds.has(episode.projectId)),
      assets: state.assets.filter((asset) => projectIds.has(asset.projectId)),
      shots: state.shots.filter((shot) => projectIds.has(shot.projectId)),
    }
  })
  const result: ProjectJsonImportResult = {
    projects: { inserted: 0, skipped: 0 },
    assets: { inserted: 0, skipped: 0 },
    shots: { inserted: 0, skipped: 0 },
  }
  await database.transaction(async (client) => {
    for (const project of snapshot.projects) {
      if (await insertProjectFromStore(client, project)) {
        result.projects.inserted += 1
      } else {
        result.projects.skipped += 1
      }
    }
    for (const asset of snapshot.assets) {
      if (await insertAssetFromStore(client, asset)) {
        result.assets.inserted += 1
      } else {
        result.assets.skipped += 1
      }
    }
    for (const episode of snapshot.scriptEpisodes) {
      await insertScriptEpisodeFromStore(client, episode)
    }
    for (const shot of snapshot.shots) {
      if (await insertShotFromStore(client, shot)) {
        result.shots.inserted += 1
      } else {
        result.shots.skipped += 1
      }
    }
  })
  await refreshProjectWorkspaceRuntimeCache(database, store)
  return result
}
