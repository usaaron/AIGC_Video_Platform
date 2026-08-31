import type {
  Asset,
  CreateAsset,
  CreateProject,
  CreateShot,
  GenerationTask,
  Principal,
  Plan,
  Project,
  ProjectGenerationSummary,
  ProjectWorkspace,
  ScriptEpisode,
  Shot,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import { insertAuditLog, type AuditLogInput } from '../../core/audit/auditLog.js'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppState, AppStore } from '../../infra/store.js'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>
}

type ProjectRow = QueryResultRow & {
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

type AssetRow = QueryResultRow & {
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

type ShotRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  script_episode_id: string | null
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

type ScriptEpisodeRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  episode_number: number | string
  title: string
  content: string
  draft_content: string
  status: ScriptEpisode['status']
  summary: string
  continuity_state: unknown
  revision: number | string
  last_edited_by: string
  created_at: Date | string
  updated_at: Date | string
}

type ProjectTaskPreviewRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  kind: GenerationTask['kind']
  label: string
  status: GenerationTask['status']
  progress: number | string
  metadata: unknown
  outputs: unknown
  updated_at: Date | string
}

type ProjectListAssetRow = QueryResultRow & {
  project_id: string
  kind: Asset['kind']
  reference_items: unknown
  attributes: unknown
  image_url: string | null
  updated_at: Date | string
}

type ProjectListShotRow = QueryResultRow & {
  project_id: string
  shot_order: number | string
  image_url: string | null
}

type ProjectPreviewTask = Pick<
  GenerationTask,
  'id' | 'projectId' | 'label' | 'kind' | 'status' | 'progress' | 'metadata' | 'outputs' | 'updatedAt'
>
type ProjectPreviewAsset = Pick<
  Asset,
  'projectId' | 'kind' | 'references' | 'attributes' | 'imageUrl' | 'updatedAt'
>
type ProjectPreviewShot = Pick<Shot, 'projectId' | 'order' | 'imageUrl'>
type ProjectPreviewState = {
  tasks: ProjectPreviewTask[]
  assets: ProjectPreviewAsset[]
  shots: ProjectPreviewShot[]
}

const projectColumns = `
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
`

const assetColumns = `
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
`

const shotColumns = `
  id,
  project_id,
  tenant_id,
  script_episode_id,
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
`

const scriptEpisodeColumns = `
  id,
  project_id,
  tenant_id,
  episode_number,
  title,
  content,
  draft_content,
  status,
  summary,
  continuity_state,
  revision,
  last_edited_by,
  created_at,
  updated_at
`

export type ProjectJsonImportResult = {
  projects: { inserted: number; skipped: number }
  assets: { inserted: number; skipped: number }
  shots: { inserted: number; skipped: number }
}

export class ProjectRepository {
  constructor(
    private readonly store: AppStore | null,
    private readonly database: AccountDatabase | null = null,
  ) {}

  async importFromStore(): Promise<ProjectJsonImportResult> {
    if (!this.database || !this.store) {
      return {
        projects: { inserted: 0, skipped: 0 },
        assets: { inserted: 0, skipped: 0 },
        shots: { inserted: 0, skipped: 0 },
      }
    }
    const snapshot = this.store.read((state) => ({
      projects: state.projects,
      scriptEpisodes: state.scriptEpisodes,
      assets: state.assets,
      shots: state.shots,
    }))
    const result: ProjectJsonImportResult = {
      projects: { inserted: 0, skipped: 0 },
      assets: { inserted: 0, skipped: 0 },
      shots: { inserted: 0, skipped: 0 },
    }
    await this.database.transaction(async (client) => {
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
    await this.refreshRuntimeCacheFromDatabase()
    return result
  }

  async bootstrapFromStore(): Promise<void> {
    await this.importFromStore()
  }

  planFor(principal: Principal): Plan | null {
    if (this.database) {
      return null
    }
    return this.requireStore().read(
      (state) =>
        state.users.find((user) => user.id === principal.userId && user.tenantId === principal.tenantId)
          ?.plan ?? null,
    )
  }

  async list(principal: Principal): Promise<Project[]> {
    if (!this.database) return this.listFromStore(principal)

    const canReadAll = canReadAllTenantContent(principal)
    const result = await this.database.query<ProjectRow>(
      `
      SELECT ${projectColumns}
      FROM projects
      WHERE tenant_id = $1
        AND status <> 'archived'
        AND ($2::boolean OR owner_user_id = $3)
      ORDER BY updated_at DESC
      `,
      [principal.tenantId, canReadAll, principal.userId],
    )
    const projects = result.rows.map(projectFromRow)
    if (!projects.length) return projects

    const projectIds = projects.map((project) => project.id)
    const [tasks, assets, shots] = await Promise.all([
      this.database.query<ProjectTaskPreviewRow>(
        `
        WITH candidate_tasks AS (
          SELECT
            id,
            project_id,
            tenant_id,
            kind,
            label,
            status,
            progress,
            metadata,
            outputs,
            updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY project_id, kind, (status = 'completed')
              ORDER BY updated_at DESC, id DESC
            ) AS preview_rank
          FROM generation_tasks
          WHERE tenant_id = $1
            AND project_id = ANY($2::text[])
            AND (
              status IN ('queued', 'paused', 'running', 'failed')
              OR (status = 'completed' AND kind IN ('image', 'video'))
            )
        )
        SELECT id, project_id, tenant_id, kind, label, status, progress, metadata, outputs, updated_at
        FROM candidate_tasks
        WHERE status <> 'completed' OR preview_rank = 1
        ORDER BY updated_at DESC, id DESC
        `,
        [principal.tenantId, projectIds],
      ),
      this.database.query<ProjectListAssetRow>(
        `
        SELECT project_id, kind, reference_items, attributes, image_url, updated_at
        FROM assets
        WHERE tenant_id = $1
          AND project_id = ANY($2::text[])
          AND kind <> 'audio'
        ORDER BY updated_at DESC
        `,
        [principal.tenantId, projectIds],
      ),
      this.database.query<ProjectListShotRow>(
        `
        SELECT project_id, shot_order, image_url
        FROM shots
        WHERE tenant_id = $1
          AND project_id = ANY($2::text[])
          AND image_url IS NOT NULL
        ORDER BY project_id, shot_order ASC
        `,
        [principal.tenantId, projectIds],
      ),
    ])

    const stateByProject = new Map<string, ProjectPreviewState>()
    for (const project of projects) {
      stateByProject.set(project.id, { tasks: [], assets: [], shots: [] })
    }
    for (const row of tasks.rows) {
      stateByProject.get(row.project_id)?.tasks.push(projectPreviewTaskFromRow(row))
    }
    for (const row of assets.rows) {
      stateByProject.get(row.project_id)?.assets.push({
        projectId: row.project_id,
        kind: row.kind,
        references: jsonValue(row.reference_items, []),
        attributes: jsonValue(row.attributes, { type: row.kind }) as Asset['attributes'],
        imageUrl: row.image_url,
        updatedAt: isoString(row.updated_at),
      })
    }
    for (const row of shots.rows) {
      stateByProject.get(row.project_id)?.shots.push({
        projectId: row.project_id,
        order: Number(row.shot_order),
        imageUrl: row.image_url,
      })
    }

    return projects.map((project) => {
      const state = stateByProject.get(project.id)!
      return {
        ...project,
        previewUrl: projectPreviewUrl(project.id, state),
        generationSummary: projectGenerationSummary(project.id, state),
      }
    })
  }

  async workspace(projectId: string, principal: Principal): Promise<ProjectWorkspace | null> {
    if (!this.database) return this.workspaceFromStore(projectId, principal)

    const project = await this.findReadableProject(this.database, projectId, principal)
    if (!project) return null

    const [scriptEpisodes, assets, shots] = await Promise.all([
      this.database.query<ScriptEpisodeRow>(
        `
        SELECT ${scriptEpisodeColumns}
        FROM script_episodes
        WHERE project_id = $1 AND tenant_id = $2
        ORDER BY episode_number ASC
        `,
        [projectId, principal.tenantId],
      ),
      this.database.query<AssetRow>(
        `
        SELECT ${assetColumns}
        FROM assets
        WHERE project_id = $1 AND tenant_id = $2
        ORDER BY updated_at DESC, created_at DESC
        `,
        [projectId, principal.tenantId],
      ),
      this.database.query<ShotRow>(
        `
        SELECT ${shotColumns}
        FROM shots
        WHERE project_id = $1 AND tenant_id = $2
        ORDER BY shot_order ASC
        `,
        [projectId, principal.tenantId],
      ),
    ])

    return {
      project,
      scriptEpisodes: scriptEpisodes.rows.map(scriptEpisodeFromRow),
      assets: assets.rows.map(assetFromRow),
      shots: shots.rows.map(shotFromRow),
    }
  }

  async findOwnedAsset(projectId: string, assetId: string, principal: Principal): Promise<Asset | null> {
    if (!this.database) {
      return this.requireStore().read((state) => {
        const ownsProject = state.projects.some(
          (project) =>
            project.id === projectId &&
            project.tenantId === principal.tenantId &&
            project.ownerId === principal.userId,
        )
        if (!ownsProject) return null
        return (
          state.assets.find(
            (asset) =>
              asset.id === assetId && asset.projectId === projectId && asset.tenantId === principal.tenantId,
          ) ?? null
        )
      })
    }

    const result = await this.database.query<AssetRow>(
      `
      SELECT ${prefixedAssetColumns('asset')}
      FROM assets asset
      INNER JOIN projects project
        ON project.id = asset.project_id AND project.tenant_id = asset.tenant_id
      WHERE asset.id = $1
        AND asset.project_id = $2
        AND asset.tenant_id = $3
        AND project.owner_user_id = $4
      `,
      [assetId, projectId, principal.tenantId, principal.userId],
    )
    return result.rows[0] ? assetFromRow(result.rows[0]) : null
  }

  async listOwnedAssets(principal: Principal): Promise<Asset[]> {
    if (!this.database) {
      return this.requireStore().read((state) => {
        const projectIds = new Set(
          state.projects
            .filter(
              (project) => project.tenantId === principal.tenantId && project.ownerId === principal.userId,
            )
            .map((project) => project.id),
        )
        return state.assets.filter(
          (asset) => asset.tenantId === principal.tenantId && projectIds.has(asset.projectId),
        )
      })
    }

    const result = await this.database.query<AssetRow>(
      `
      SELECT ${prefixedAssetColumns('asset')}
      FROM assets asset
      INNER JOIN projects project
        ON project.id = asset.project_id AND project.tenant_id = asset.tenant_id
      WHERE asset.tenant_id = $1 AND project.owner_user_id = $2
      ORDER BY asset.updated_at DESC, asset.created_at DESC
      `,
      [principal.tenantId, principal.userId],
    )
    return result.rows.map(assetFromRow)
  }

  async create(input: CreateProject, principal: Principal): Promise<Project> {
    if (!this.database) return this.createInStore(input, principal)

    const now = new Date().toISOString()
    const project: Project = {
      id: randomUUID(),
      tenantId: principal.tenantId,
      ownerId: principal.userId,
      name: input.name,
      contentType: input.contentType,
      visualStyle: input.visualStyle,
      episodeDurationSeconds: input.episodeDurationSeconds,
      aspectRatio: input.aspectRatio,
      status: 'draft',
      synopsis: '',
      script: '',
      version: 1,
      createdAt: now,
      updatedAt: now,
    }

    await this.database.query(
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        project.id,
        project.tenantId,
        project.ownerId,
        project.name,
        project.contentType,
        project.visualStyle,
        project.episodeDurationSeconds,
        project.aspectRatio,
        project.status,
        project.synopsis,
        project.script,
        project.version,
        project.createdAt,
        project.updatedAt,
      ],
    )
    await this.mirrorProject(project)
    return project
  }

  async update(projectId: string, input: UpdateProject, principal: Principal): Promise<Project | null> {
    if (!this.database) return this.updateInStore(projectId, input, principal)

    const existing = await this.findWritableProject(this.database, projectId, principal)
    if (!existing) return null

    const updated: Project = {
      ...existing,
      name: input.name ?? existing.name,
      status: input.status ?? existing.status,
      visualStyle: input.visualStyle ?? existing.visualStyle,
      episodeDurationSeconds: input.episodeDurationSeconds ?? existing.episodeDurationSeconds,
      synopsis: input.synopsis ?? existing.synopsis,
      script: input.script ?? existing.script,
      updatedAt: new Date().toISOString(),
    }
    const result = await this.database.query<ProjectRow>(
      `
      UPDATE projects
      SET
        name = $4,
        status = $5,
        visual_style = $6,
        episode_duration_seconds = $7,
        synopsis = $8,
        script = $9,
        updated_at = $10
      WHERE id = $1 AND tenant_id = $2 AND owner_user_id = $3
      RETURNING ${projectColumns}
      `,
      [
        projectId,
        principal.tenantId,
        principal.userId,
        updated.name,
        updated.status,
        updated.visualStyle,
        updated.episodeDurationSeconds,
        updated.synopsis,
        updated.script,
        updated.updatedAt,
      ],
    )
    const project = result.rows[0] ? projectFromRow(result.rows[0]) : null
    if (project) await this.mirrorProject(project)
    return project
  }

  async writeScriptEpisodeDraft(
    projectId: string,
    episodeId: string | null,
    content: string,
    principal: Principal,
    options: { createNext?: boolean; title?: string; generationClientRequestId?: string } = {},
  ): Promise<ScriptEpisode | null> {
    if (!this.database) {
      return this.requireStore().mutate((state) => {
        const project = state.projects.find(
          (item) =>
            item.id === projectId &&
            item.tenantId === principal.tenantId &&
            item.ownerId === principal.userId,
        )
        if (!project) return null
        const episodes = state.scriptEpisodes
          .filter((item) => item.projectId === projectId && item.tenantId === principal.tenantId)
          .sort((left, right) => left.episodeNumber - right.episodeNumber)
        let episode = episodeId ? episodes.find((item) => item.id === episodeId) : undefined
        if (!episode && !episodeId && !options.createNext) {
          episode = [...episodes].reverse().find((item) => item.status === 'draft')
        }
        const now = new Date().toISOString()
        const continuityState = draftContinuityState(
          episode?.continuityState,
          options.generationClientRequestId,
          now,
        )
        if (!episode) {
          const episodeNumber = (episodes.at(-1)?.episodeNumber ?? 0) + 1
          episode = {
            id: randomUUID(),
            projectId,
            tenantId: principal.tenantId,
            episodeNumber,
            title: options.title?.trim() || `第 ${episodeNumber} 集`,
            content: '',
            draftContent: content,
            status: 'draft',
            summary: '',
            continuityState,
            revision: 1,
            lastEditedBy: principal.userId,
            createdAt: now,
            updatedAt: now,
          }
          state.scriptEpisodes.push(episode)
        } else {
          episode.draftContent = content
          episode.status = 'draft'
          episode.title = options.title?.trim() || episode.title
          episode.continuityState = continuityState
          episode.lastEditedBy = principal.userId
          episode.revision += 1
          episode.updatedAt = now
        }
        project.updatedAt = now
        return episode
      })
    }

    const episode = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return null
      const result = await client.query<ScriptEpisodeRow>(
        `SELECT ${scriptEpisodeColumns} FROM script_episodes
         WHERE project_id = $1 AND tenant_id = $2 ORDER BY episode_number ASC FOR UPDATE`,
        [projectId, principal.tenantId],
      )
      const episodes = result.rows.map(scriptEpisodeFromRow)
      let current = episodeId ? episodes.find((item) => item.id === episodeId) : undefined
      if (!current && episodeId) return null
      if (!current && !options.createNext) {
        current = [...episodes].reverse().find((item) => item.status === 'draft')
      }
      const now = new Date().toISOString()
      const continuityState = draftContinuityState(
        current?.continuityState,
        options.generationClientRequestId,
        now,
      )
      if (current) {
        const updated = await client.query<ScriptEpisodeRow>(
          `UPDATE script_episodes
           SET draft_content = $4, status = 'draft', title = $5, continuity_state = $6::jsonb,
               revision = revision + 1, last_edited_by = $7, updated_at = $8
           WHERE id = $1 AND project_id = $2 AND tenant_id = $3
           RETURNING ${scriptEpisodeColumns}`,
          [
            current.id,
            projectId,
            principal.tenantId,
            content,
            options.title?.trim() || current.title,
            JSON.stringify(continuityState),
            principal.userId,
            now,
          ],
        )
        await touchProject(client, projectId, principal.tenantId, now)
        return updated.rows[0] ? scriptEpisodeFromRow(updated.rows[0]) : null
      }
      const episodeNumber = (episodes.at(-1)?.episodeNumber ?? 0) + 1
      const inserted = await client.query<ScriptEpisodeRow>(
        `INSERT INTO script_episodes (
           id, project_id, tenant_id, episode_number, title, content, draft_content,
           status, summary, continuity_state, revision, last_edited_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, '', $6, 'draft', '', $7::jsonb, 1, $8, $9, $9)
         RETURNING ${scriptEpisodeColumns}`,
        [
          randomUUID(),
          projectId,
          principal.tenantId,
          episodeNumber,
          options.title?.trim() || `第 ${episodeNumber} 集`,
          content,
          JSON.stringify(continuityState),
          principal.userId,
          now,
        ],
      )
      await touchProject(client, projectId, principal.tenantId, now)
      return inserted.rows[0] ? scriptEpisodeFromRow(inserted.rows[0]) : null
    })
    if (episode) await this.mirrorScriptEpisode(episode)
    return episode
  }

  async saveScriptEpisode(
    projectId: string,
    episodeId: string | null,
    content: string,
    principal: Principal,
    title?: string,
  ): Promise<ScriptEpisode | null> {
    if (!this.database) {
      return this.requireStore().mutate((state) => {
        const project = state.projects.find(
          (item) =>
            item.id === projectId &&
            item.tenantId === principal.tenantId &&
            item.ownerId === principal.userId,
        )
        if (!project) return null
        const episodes = state.scriptEpisodes
          .filter((item) => item.projectId === projectId && item.tenantId === principal.tenantId)
          .sort((left, right) => left.episodeNumber - right.episodeNumber)
        let episode = episodeId ? episodes.find((item) => item.id === episodeId) : undefined
        const now = new Date().toISOString()
        if (!episode) {
          if (episodeId) return null
          const episodeNumber = (episodes.at(-1)?.episodeNumber ?? 0) + 1
          episode = {
            id: randomUUID(),
            projectId,
            tenantId: principal.tenantId,
            episodeNumber,
            title: title?.trim() || `第 ${episodeNumber} 集`,
            content,
            draftContent: '',
            status: 'saved',
            summary: summarizeEpisodeContent(content),
            continuityState: {},
            revision: 1,
            lastEditedBy: principal.userId,
            createdAt: now,
            updatedAt: now,
          }
          state.scriptEpisodes.push(episode)
        } else {
          episode.content = content
          episode.draftContent = ''
          episode.status = 'saved'
          episode.continuityState = {}
          episode.title = title?.trim() || episode.title
          episode.summary = summarizeEpisodeContent(content)
          episode.lastEditedBy = principal.userId
          episode.revision += 1
          episode.updatedAt = now
        }
        project.script = aggregateSavedEpisodes(state.scriptEpisodes, projectId, principal.tenantId)
        project.updatedAt = now
        return episode
      })
    }

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return null
      const rows = await client.query<ScriptEpisodeRow>(
        `SELECT ${scriptEpisodeColumns} FROM script_episodes
         WHERE project_id = $1 AND tenant_id = $2 ORDER BY episode_number ASC FOR UPDATE`,
        [projectId, principal.tenantId],
      )
      const episodes = rows.rows.map(scriptEpisodeFromRow)
      const current = episodeId ? episodes.find((item) => item.id === episodeId) : undefined
      if (episodeId && !current) return null
      const now = new Date().toISOString()
      let savedRow: ScriptEpisodeRow | undefined
      if (current) {
        const updated = await client.query<ScriptEpisodeRow>(
          `UPDATE script_episodes
           SET content = $4, draft_content = '', status = 'saved', title = $5, summary = $6,
               continuity_state = '{}'::jsonb, revision = revision + 1, last_edited_by = $7, updated_at = $8
           WHERE id = $1 AND project_id = $2 AND tenant_id = $3
           RETURNING ${scriptEpisodeColumns}`,
          [
            current.id,
            projectId,
            principal.tenantId,
            content,
            title?.trim() || current.title,
            summarizeEpisodeContent(content),
            principal.userId,
            now,
          ],
        )
        savedRow = updated.rows[0]
      } else {
        const episodeNumber = (episodes.at(-1)?.episodeNumber ?? 0) + 1
        const inserted = await client.query<ScriptEpisodeRow>(
          `INSERT INTO script_episodes (
             id, project_id, tenant_id, episode_number, title, content, draft_content,
             status, summary, continuity_state, revision, last_edited_by, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, '', 'saved', $7, '{}'::jsonb, 1, $8, $9, $9)
           RETURNING ${scriptEpisodeColumns}`,
          [
            randomUUID(),
            projectId,
            principal.tenantId,
            episodeNumber,
            title?.trim() || `第 ${episodeNumber} 集`,
            content,
            summarizeEpisodeContent(content),
            principal.userId,
            now,
          ],
        )
        savedRow = inserted.rows[0]
      }
      if (!savedRow) return null
      const aggregateRows = await client.query<ScriptEpisodeRow>(
        `SELECT ${scriptEpisodeColumns} FROM script_episodes
         WHERE project_id = $1 AND tenant_id = $2 AND status = 'saved' ORDER BY episode_number ASC`,
        [projectId, principal.tenantId],
      )
      const aggregate = aggregateEpisodeList(aggregateRows.rows.map(scriptEpisodeFromRow))
      const updatedProject = await client.query<ProjectRow>(
        `UPDATE projects SET script = $3, updated_at = $4
         WHERE id = $1 AND tenant_id = $2 RETURNING ${projectColumns}`,
        [projectId, principal.tenantId, aggregate, now],
      )
      return {
        episode: scriptEpisodeFromRow(savedRow),
        project: updatedProject.rows[0] ? projectFromRow(updatedProject.rows[0]) : project,
      }
    })
    if (!result) return null
    await this.mirrorProject(result.project)
    await this.mirrorScriptEpisode(result.episode)
    return result.episode
  }

  async deleteLastScriptEpisode(
    projectId: string,
    episodeId: string,
    principal: Principal,
  ): Promise<'deleted' | 'not_found' | 'not_last' | 'active'> {
    if (!this.database) {
      return this.requireStore().mutate((state) => {
        const project = state.projects.find(
          (item) =>
            item.id === projectId &&
            item.tenantId === principal.tenantId &&
            item.ownerId === principal.userId,
        )
        const episodes = state.scriptEpisodes
          .filter((item) => item.projectId === projectId && item.tenantId === principal.tenantId)
          .sort((left, right) => left.episodeNumber - right.episodeNumber)
        const episode = episodes.find((item) => item.id === episodeId)
        if (!project || !episode) return 'not_found'
        if (episodes.at(-1)?.id !== episodeId) return 'not_last'
        const shotIds = new Set(
          state.shots.filter((shot) => shot.scriptEpisodeId === episodeId).map((shot) => shot.id),
        )
        const active = state.tasks.some(
          (task) =>
            task.projectId === projectId &&
            ['queued', 'paused', 'running'].includes(task.status) &&
            (task.metadata.episodeId === episodeId || shotIds.has(String(task.metadata.shotId || ''))),
        )
        if (active) return 'active'
        state.scriptEpisodes = state.scriptEpisodes.filter((item) => item.id !== episodeId)
        state.shots = state.shots.filter((shot) => shot.scriptEpisodeId !== episodeId)
        renumberProjectShots(state.shots, projectId, principal.tenantId)
        project.script = aggregateSavedEpisodes(state.scriptEpisodes, projectId, principal.tenantId)
        project.updatedAt = new Date().toISOString()
        return 'deleted'
      })
    }

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return { outcome: 'not_found' as const }
      const rows = await client.query<ScriptEpisodeRow>(
        `SELECT ${scriptEpisodeColumns} FROM script_episodes
         WHERE project_id = $1 AND tenant_id = $2 ORDER BY episode_number ASC FOR UPDATE`,
        [projectId, principal.tenantId],
      )
      const episodes = rows.rows.map(scriptEpisodeFromRow)
      if (!episodes.some((item) => item.id === episodeId)) return { outcome: 'not_found' as const }
      if (episodes.at(-1)?.id !== episodeId) return { outcome: 'not_last' as const }
      const active = await client.query(
        `SELECT 1
         FROM generation_tasks task
         LEFT JOIN shots shot
           ON shot.id = task.metadata->>'shotId' AND shot.project_id = task.project_id
         WHERE task.project_id = $1 AND task.tenant_id = $2
           AND task.status IN ('queued', 'paused', 'running')
           AND (task.metadata->>'episodeId' = $3 OR shot.script_episode_id = $3)
         LIMIT 1`,
        [projectId, principal.tenantId, episodeId],
      )
      if (active.rowCount) return { outcome: 'active' as const }
      await client.query('DELETE FROM shots WHERE script_episode_id = $1 AND tenant_id = $2', [
        episodeId,
        principal.tenantId,
      ])
      await client.query('DELETE FROM script_episodes WHERE id = $1 AND tenant_id = $2', [
        episodeId,
        principal.tenantId,
      ])
      await renumberShotsInDatabase(client, projectId, principal.tenantId)
      const remaining = episodes.filter((item) => item.id !== episodeId && item.status === 'saved')
      const now = new Date().toISOString()
      const updated = await client.query<ProjectRow>(
        `UPDATE projects SET script = $3, updated_at = $4
         WHERE id = $1 AND tenant_id = $2 RETURNING ${projectColumns}`,
        [projectId, principal.tenantId, aggregateEpisodeList(remaining), now],
      )
      return {
        outcome: 'deleted' as const,
        project: updated.rows[0] ? projectFromRow(updated.rows[0]) : project,
      }
    })
    if (result.outcome === 'deleted') await this.refreshRuntimeCacheFromDatabase()
    return result.outcome
  }

  async clearScriptEpisodes(
    projectId: string,
    principal: Principal,
  ): Promise<'deleted' | 'not_found' | 'active'> {
    if (!this.database) {
      return this.requireStore().mutate((state) => {
        const project = state.projects.find(
          (item) =>
            item.id === projectId &&
            item.tenantId === principal.tenantId &&
            item.ownerId === principal.userId,
        )
        if (!project) return 'not_found'
        if (
          state.tasks.some(
            (task) => task.projectId === projectId && ['queued', 'paused', 'running'].includes(task.status),
          )
        ) {
          return 'active'
        }
        state.scriptEpisodes = state.scriptEpisodes.filter((item) => item.projectId !== projectId)
        state.shots = state.shots.filter((item) => item.projectId !== projectId)
        project.script = ''
        project.updatedAt = new Date().toISOString()
        return 'deleted'
      })
    }
    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return { outcome: 'not_found' as const }
      const active = await client.query(
        `SELECT 1 FROM generation_tasks
         WHERE project_id = $1 AND tenant_id = $2 AND status IN ('queued', 'paused', 'running') LIMIT 1`,
        [projectId, principal.tenantId],
      )
      if (active.rowCount) return { outcome: 'active' as const }
      await client.query('DELETE FROM shots WHERE project_id = $1 AND tenant_id = $2', [
        projectId,
        principal.tenantId,
      ])
      await client.query('DELETE FROM script_episodes WHERE project_id = $1 AND tenant_id = $2', [
        projectId,
        principal.tenantId,
      ])
      const now = new Date().toISOString()
      const updated = await client.query<ProjectRow>(
        `UPDATE projects SET script = '', updated_at = $3
         WHERE id = $1 AND tenant_id = $2 RETURNING ${projectColumns}`,
        [projectId, principal.tenantId, now],
      )
      return {
        outcome: 'deleted' as const,
        project: updated.rows[0] ? projectFromRow(updated.rows[0]) : project,
      }
    })
    if (result.outcome === 'deleted') await this.refreshRuntimeCacheFromDatabase()
    return result.outcome
  }

  async archive(projectId: string, principal: Principal): Promise<boolean> {
    const canArchiveAll = canReadAllTenantContent(principal)
    if (!this.database) {
      return this.requireStore().mutate((state) => {
        const project = state.projects.find(
          (item) =>
            item.id === projectId &&
            item.tenantId === principal.tenantId &&
            (canArchiveAll || item.ownerId === principal.userId),
        )
        if (!project) return false
        project.status = 'archived'
        project.updatedAt = new Date().toISOString()
        return true
      })
    }

    const updatedAt = new Date().toISOString()
    const result = await this.database.query(
      `
      UPDATE projects
      SET status = 'archived', updated_at = $5
      WHERE id = $1
        AND tenant_id = $2
        AND ($3::boolean OR owner_user_id = $4)
      `,
      [projectId, principal.tenantId, canArchiveAll, principal.userId, updatedAt],
    )
    if ((result.rowCount ?? 0) === 0) return false
    await this.refreshRuntimeCacheFromDatabase()
    return true
  }

  async recordAuditLog(input: AuditLogInput): Promise<void> {
    if (!this.database) return
    await insertAuditLog(this.database, input)
  }

  async saveVersion(projectId: string, principal: Principal): Promise<Project | null> {
    if (!this.database) return this.saveVersionInStore(projectId, principal)

    const project = await this.database.transaction(async (client) => {
      const projectResult = await client.query<ProjectRow>(
        `
        SELECT ${projectColumns}
        FROM projects
        WHERE id = $1 AND tenant_id = $2 AND owner_user_id = $3
        FOR UPDATE
        `,
        [projectId, principal.tenantId, principal.userId],
      )
      const current = projectResult.rows[0] ? projectFromRow(projectResult.rows[0]) : null
      if (!current) return null

      const assets = await client.query<AssetRow>(
        `
        SELECT ${assetColumns}
        FROM assets
        WHERE project_id = $1 AND tenant_id = $2
        ORDER BY updated_at DESC, created_at DESC
        `,
        [projectId, principal.tenantId],
      )
      const shots = await client.query<ShotRow>(
        `
        SELECT ${shotColumns}
        FROM shots
        WHERE project_id = $1 AND tenant_id = $2
        ORDER BY shot_order ASC
        `,
        [projectId, principal.tenantId],
      )

      await client.query(
        `
        INSERT INTO project_versions (
          id,
          project_id,
          tenant_id,
          version,
          name,
          synopsis,
          script,
          project_snapshot,
          assets_snapshot,
          shots_snapshot,
          created_by_user_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)
        `,
        [
          randomUUID(),
          current.id,
          current.tenantId,
          current.version,
          current.name,
          current.synopsis,
          current.script,
          JSON.stringify(current),
          JSON.stringify(assets.rows.map(assetFromRow)),
          JSON.stringify(shots.rows.map(shotFromRow)),
          principal.userId,
          new Date().toISOString(),
        ],
      )

      const updated = await client.query<ProjectRow>(
        `
        UPDATE projects
        SET version = version + 1, updated_at = $4
        WHERE id = $1 AND tenant_id = $2 AND owner_user_id = $3
        RETURNING ${projectColumns}
        `,
        [projectId, principal.tenantId, principal.userId, new Date().toISOString()],
      )
      return updated.rows[0] ? projectFromRow(updated.rows[0]) : null
    })

    if (project) await this.mirrorProject(project)
    return project
  }

  async createAsset(projectId: string, input: CreateAsset, principal: Principal): Promise<Asset | null> {
    if (!this.database) return this.createAssetInStore(projectId, input, principal)

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return null

      const now = new Date().toISOString()
      const asset: Asset = {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        ...input,
        status: input.sourceMode === 'import' ? 'confirmed' : 'draft',
        createdAt: now,
        updatedAt: now,
      }

      const inserted = await client.query<AssetRow>(
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
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13::jsonb, $14::jsonb, $15, $16, $17, $18
        )
        RETURNING ${assetColumns}
        `,
        assetInsertParams(asset),
      )
      await touchProject(client, projectId, principal.tenantId, now)
      return inserted.rows[0] ? assetFromRow(inserted.rows[0]) : null
    })

    if (result) await this.mirrorAsset(result)
    return result
  }

  async updateAsset(
    projectId: string,
    assetId: string,
    input: UpdateAsset,
    principal: Principal,
  ): Promise<Asset | null> {
    if (!this.database) return this.updateAssetInStore(projectId, assetId, input, principal)

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal)
      if (!project) return null

      const currentResult = await client.query<AssetRow>(
        `
        SELECT ${assetColumns}
        FROM assets
        WHERE id = $1 AND project_id = $2 AND tenant_id = $3
        FOR UPDATE
        `,
        [assetId, projectId, principal.tenantId],
      )
      const current = currentResult.rows[0] ? assetFromRow(currentResult.rows[0]) : null
      if (!current) return null
      if (input.attributes && input.attributes.type !== current.kind) return null

      const updated: Asset = {
        ...current,
        sourceMode: input.sourceMode ?? current.sourceMode,
        name: input.name ?? current.name,
        description: input.description ?? current.description,
        prompt: input.prompt ?? current.prompt,
        promptMode: input.promptMode ?? current.promptMode,
        customPromptMode: input.customPromptMode ?? current.customPromptMode,
        customPrompt: input.customPrompt ?? current.customPrompt,
        negativePrompt: input.negativePrompt ?? current.negativePrompt,
        references: input.references ?? current.references,
        attributes: mergeAssetAttributes(current, input.attributes),
        imageUrl: input.imageUrl === undefined ? current.imageUrl : input.imageUrl,
        status: input.status ?? current.status,
        updatedAt: new Date().toISOString(),
      }
      const updatedResult = await client.query<AssetRow>(
        `
        UPDATE assets
        SET
          source_mode = $4,
          name = $5,
          description = $6,
          prompt = $7,
          prompt_mode = $8,
          custom_prompt_mode = $9,
          custom_prompt = $10,
          negative_prompt = $11,
          reference_items = $12::jsonb,
          attributes = $13::jsonb,
          image_url = $14,
          status = $15,
          updated_at = $16
        WHERE id = $1 AND project_id = $2 AND tenant_id = $3
        RETURNING ${assetColumns}
        `,
        [
          assetId,
          projectId,
          principal.tenantId,
          updated.sourceMode,
          updated.name,
          updated.description,
          updated.prompt,
          updated.promptMode,
          updated.customPromptMode,
          updated.customPrompt,
          updated.negativePrompt,
          JSON.stringify(updated.references),
          JSON.stringify(updated.attributes),
          updated.imageUrl,
          updated.status,
          updated.updatedAt,
        ],
      )
      await touchProject(client, projectId, principal.tenantId, updated.updatedAt)
      return updatedResult.rows[0] ? assetFromRow(updatedResult.rows[0]) : null
    })

    if (result) await this.mirrorAsset(result)
    return result
  }

  async deleteAsset(projectId: string, assetId: string, principal: Principal): Promise<boolean> {
    if (!this.database) return this.deleteAssetInStore(projectId, assetId, principal)

    const deleted = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal)
      if (!project) return false

      const result = await client.query<{ id: string }>(
        `
        DELETE FROM assets
        WHERE id = $1 AND project_id = $2 AND tenant_id = $3
        RETURNING id
        `,
        [assetId, projectId, principal.tenantId],
      )
      if (!result.rows[0]) return false
      await touchProject(client, projectId, principal.tenantId, new Date().toISOString())
      return true
    })

    if (deleted) await this.mirrorDeletedAsset(projectId, assetId)
    return deleted
  }

  async createShot(projectId: string, input: CreateShot, principal: Principal): Promise<Shot | null> {
    if (!this.database) return this.createShotInStore(projectId, input, principal)

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return null

      await client.query('SET CONSTRAINTS shots_project_order_unique DEFERRED')
      const existingResult = await client.query<ShotRow>(
        `
        SELECT ${shotColumns}
        FROM shots
        WHERE project_id = $1 AND tenant_id = $2
        ORDER BY shot_order ASC
        FOR UPDATE
        `,
        [projectId, principal.tenantId],
      )
      const existing = existingResult.rows.map(shotFromRow)
      const insertionOrder = insertionOrderFor(existing, input.insertAfterShotId)
      if (insertionOrder === null) return null
      if (insertionOrder <= existing.length) {
        await client.query(
          `
          UPDATE shots
          SET shot_order = shot_order + 1
          WHERE project_id = $1 AND tenant_id = $2 AND shot_order >= $3
          `,
          [projectId, principal.tenantId, insertionOrder],
        )
      }
      const { insertAfterShotId: _insertAfterShotId, ...shotInput } = input
      const now = new Date().toISOString()
      const shot: Shot = {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        order: insertionOrder,
        ...shotInput,
        createdAt: now,
        updatedAt: now,
      }
      const inserted = await client.query<ShotRow>(
        `
        INSERT INTO shots (
          id,
          project_id,
          tenant_id,
          script_episode_id,
          shot_order,
          title,
          framing,
          duration_seconds,
          prompt,
          negative_prompt,
          image_url,
          continuity_mode,
          continuity_note,
          episode_break_before,
          episode_number,
          episode_title,
          episode_kind,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING ${shotColumns}
        `,
        shotInsertParams(shot),
      )
      await touchProject(client, projectId, principal.tenantId, now)
      if (!inserted.rows[0]) return null
      const shots = await client.query<ShotRow>(
        `SELECT ${shotColumns} FROM shots WHERE project_id = $1 AND tenant_id = $2 ORDER BY shot_order ASC`,
        [projectId, principal.tenantId],
      )
      return { created: shotFromRow(inserted.rows[0]), shots: shots.rows.map(shotFromRow) }
    })

    if (!result) return null
    await this.mirrorReplacedShots(projectId, result.shots, principal.tenantId)
    return result.created
  }

  async updateShot(
    projectId: string,
    shotId: string,
    input: UpdateShot,
    principal: Principal,
  ): Promise<Shot | null> {
    if (!this.database) return this.updateShotInStore(projectId, shotId, input, principal)

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal)
      if (!project) return null

      const currentResult = await client.query<ShotRow>(
        `
        SELECT ${shotColumns}
        FROM shots
        WHERE id = $1 AND project_id = $2 AND tenant_id = $3
        FOR UPDATE
        `,
        [shotId, projectId, principal.tenantId],
      )
      const current = currentResult.rows[0] ? shotFromRow(currentResult.rows[0]) : null
      if (!current) return null

      const updated: Shot = {
        ...current,
        scriptEpisodeId:
          input.scriptEpisodeId === undefined ? current.scriptEpisodeId : input.scriptEpisodeId,
        order: input.order ?? current.order,
        title: input.title ?? current.title,
        framing: input.framing ?? current.framing,
        duration: input.duration ?? current.duration,
        prompt: input.prompt ?? current.prompt,
        negativePrompt: input.negativePrompt ?? current.negativePrompt,
        imageUrl: input.imageUrl === undefined ? current.imageUrl : input.imageUrl,
        selectedImageTaskId:
          input.selectedImageTaskId === undefined ? current.selectedImageTaskId : input.selectedImageTaskId,
        selectedVideoTaskId:
          input.selectedVideoTaskId === undefined ? current.selectedVideoTaskId : input.selectedVideoTaskId,
        continuityMode: input.continuityMode ?? current.continuityMode,
        continuityNote: input.continuityNote ?? current.continuityNote,
        episodeBreakBefore: input.episodeBreakBefore ?? current.episodeBreakBefore,
        episodeNumber: input.episodeNumber ?? current.episodeNumber,
        episodeTitle: input.episodeTitle ?? current.episodeTitle,
        episodeKind: input.episodeKind ?? current.episodeKind,
        updatedAt: new Date().toISOString(),
      }
      const updatedResult = await client.query<ShotRow>(
        `
        UPDATE shots
        SET
          script_episode_id = $4,
          shot_order = $5,
          title = $6,
          framing = $7,
          duration_seconds = $8,
          prompt = $9,
          negative_prompt = $10,
           image_url = $11,
           selected_image_task_id = $12,
           selected_video_task_id = $13,
           continuity_mode = $14,
           continuity_note = $15,
           episode_break_before = $16,
           episode_number = $17,
           episode_title = $18,
           episode_kind = $19,
           updated_at = $20
        WHERE id = $1 AND project_id = $2 AND tenant_id = $3
        RETURNING ${shotColumns}
        `,
        [
          shotId,
          projectId,
          principal.tenantId,
          updated.scriptEpisodeId,
          updated.order,
          updated.title,
          updated.framing,
          updated.duration,
          updated.prompt,
          updated.negativePrompt,
          updated.imageUrl,
          updated.selectedImageTaskId ?? null,
          updated.selectedVideoTaskId ?? null,
          updated.continuityMode,
          updated.continuityNote,
          updated.episodeBreakBefore,
          updated.episodeNumber,
          updated.episodeTitle,
          updated.episodeKind,
          updated.updatedAt,
        ],
      )
      await touchProject(client, projectId, principal.tenantId, updated.updatedAt)
      return updatedResult.rows[0] ? shotFromRow(updatedResult.rows[0]) : null
    })

    if (result) await this.mirrorShot(result)
    return result
  }

  async deleteShot(
    projectId: string,
    shotId: string,
    principal: Principal,
  ): Promise<'deleted' | 'not_found' | 'active'> {
    if (!this.database) return this.deleteShotInStore(projectId, shotId, principal)

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return { outcome: 'not_found' as const, shots: [] as Shot[], updatedAt: '' }

      const currentResult = await client.query<ShotRow>(
        `
        SELECT ${shotColumns}
        FROM shots
        WHERE id = $1 AND project_id = $2 AND tenant_id = $3
        FOR UPDATE
        `,
        [shotId, projectId, principal.tenantId],
      )
      const current = currentResult.rows[0] ? shotFromRow(currentResult.rows[0]) : null
      if (!current) return { outcome: 'not_found' as const, shots: [] as Shot[], updatedAt: '' }

      const active = await client.query<{ id: string }>(
        `
        SELECT id
        FROM generation_tasks
        WHERE project_id = $1
          AND tenant_id = $2
          AND metadata->>'shotId' = $3
          AND status IN ('queued', 'paused', 'running')
          AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
        LIMIT 1
        `,
        [projectId, principal.tenantId, shotId],
      )
      if (active.rows[0]) return { outcome: 'active' as const, shots: [] as Shot[], updatedAt: '' }

      await client.query('SET CONSTRAINTS shots_project_order_unique DEFERRED')
      await client.query('DELETE FROM shots WHERE id = $1 AND project_id = $2 AND tenant_id = $3', [
        shotId,
        projectId,
        principal.tenantId,
      ])
      await client.query(
        `
        UPDATE shots
        SET shot_order = shot_order - 1
        WHERE project_id = $1 AND tenant_id = $2 AND shot_order > $3
        `,
        [projectId, principal.tenantId, current.order],
      )
      const now = new Date().toISOString()
      await touchProject(client, projectId, principal.tenantId, now)
      const shots = await client.query<ShotRow>(
        `SELECT ${shotColumns} FROM shots WHERE project_id = $1 AND tenant_id = $2 ORDER BY shot_order ASC`,
        [projectId, principal.tenantId],
      )
      return { outcome: 'deleted' as const, shots: shots.rows.map(shotFromRow), updatedAt: now }
    })

    if (result.outcome === 'deleted') {
      await this.mirrorReplacedShots(projectId, result.shots, principal.tenantId, result.updatedAt)
    }
    return result.outcome
  }

  async replaceShots(projectId: string, shots: CreateShot[], principal: Principal): Promise<Shot[] | null> {
    if (!this.database) return this.replaceShotsInStore(projectId, shots, principal)

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return null

      const now = new Date().toISOString()
      await client.query('DELETE FROM shots WHERE project_id = $1 AND tenant_id = $2', [
        projectId,
        principal.tenantId,
      ])

      const created: Shot[] = []
      for (const [index, input] of shots.entries()) {
        const shot: Shot = {
          id: randomUUID(),
          projectId,
          tenantId: principal.tenantId,
          order: index + 1,
          ...input,
          createdAt: now,
          updatedAt: now,
        }
        const inserted = await client.query<ShotRow>(
          `
          INSERT INTO shots (
            id,
            project_id,
            tenant_id,
            script_episode_id,
            shot_order,
            title,
            framing,
            duration_seconds,
            prompt,
            negative_prompt,
            image_url,
           continuity_mode,
           continuity_note,
           episode_break_before,
           episode_number,
           episode_title,
           episode_kind,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          RETURNING ${shotColumns}
          `,
          shotInsertParams(shot),
        )
        if (inserted.rows[0]) created.push(shotFromRow(inserted.rows[0]))
      }
      await touchProject(client, projectId, principal.tenantId, now)
      return created
    })

    if (result) await this.mirrorReplacedShots(projectId, result)
    return result
  }

  async replaceEpisodeShots(
    projectId: string,
    episode: ScriptEpisode,
    shots: CreateShot[],
    principal: Principal,
  ): Promise<Shot[] | null> {
    if (!this.database) {
      return this.requireStore().mutate((state) => {
        const project = state.projects.find(
          (item) =>
            item.id === projectId &&
            item.tenantId === principal.tenantId &&
            item.ownerId === principal.userId,
        )
        if (!project) return null
        const now = new Date().toISOString()
        state.shots = state.shots.filter((shot) => shot.scriptEpisodeId !== episode.id)
        const next = shots.map((input, index) => ({
          id: randomUUID(),
          projectId,
          tenantId: principal.tenantId,
          order: state.shots.length + index + 1,
          ...input,
          scriptEpisodeId: episode.id,
          episodeNumber: episode.episodeNumber,
          episodeTitle: episode.title,
          createdAt: now,
          updatedAt: now,
        }))
        state.shots.push(...next)
        state.shots
          .filter((shot) => shot.projectId === projectId && shot.tenantId === principal.tenantId)
          .sort((left, right) => left.episodeNumber - right.episodeNumber || left.order - right.order)
          .forEach((shot, index) => {
            shot.order = index + 1
          })
        project.updatedAt = now
        return next.sort((left, right) => left.order - right.order)
      })
    }

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return null
      const ownedEpisode = await client.query<ScriptEpisodeRow>(
        `SELECT ${scriptEpisodeColumns} FROM script_episodes
         WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
        [episode.id, projectId, principal.tenantId],
      )
      if (!ownedEpisode.rows[0]) return null
      await client.query('DELETE FROM shots WHERE script_episode_id = $1 AND tenant_id = $2', [
        episode.id,
        principal.tenantId,
      ])
      const maxOrder = await client.query<{ value: number | string }>(
        'SELECT COALESCE(MAX(shot_order), 0) AS value FROM shots WHERE project_id = $1 AND tenant_id = $2',
        [projectId, principal.tenantId],
      )
      const baseOrder = Number(maxOrder.rows[0]?.value ?? 0)
      const now = new Date().toISOString()
      for (const [index, input] of shots.entries()) {
        const shot: Shot = {
          id: randomUUID(),
          projectId,
          tenantId: principal.tenantId,
          order: baseOrder + index + 1,
          ...input,
          scriptEpisodeId: episode.id,
          episodeNumber: episode.episodeNumber,
          episodeTitle: episode.title,
          createdAt: now,
          updatedAt: now,
        }
        await client.query(
          `INSERT INTO shots (
             id, project_id, tenant_id, script_episode_id, shot_order, title, framing,
             duration_seconds, prompt, negative_prompt, image_url, continuity_mode,
             continuity_note, episode_break_before, episode_number, episode_title,
             episode_kind, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          shotInsertParams(shot),
        )
      }
      await client.query(
        `WITH ranked AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY episode_number ASC, shot_order ASC, created_at ASC) AS next_order
           FROM shots WHERE project_id = $1 AND tenant_id = $2
         )
         UPDATE shots shot SET shot_order = ranked.next_order
         FROM ranked WHERE shot.id = ranked.id`,
        [projectId, principal.tenantId],
      )
      await touchProject(client, projectId, principal.tenantId, now)
      const created = await client.query<ShotRow>(
        `SELECT ${shotColumns} FROM shots
         WHERE script_episode_id = $1 AND tenant_id = $2 ORDER BY shot_order ASC`,
        [episode.id, principal.tenantId],
      )
      return created.rows.map(shotFromRow)
    })
    if (result) await this.refreshRuntimeCacheFromDatabase()
    return result
  }

  async updateShotEpisodes(
    projectId: string,
    updates: Array<
      Pick<
        Shot,
        'id' | 'episodeNumber' | 'episodeTitle' | 'episodeKind' | 'continuityMode' | 'continuityNote'
      >
    >,
    principal: Principal,
  ): Promise<Shot[] | null> {
    if (!this.database) {
      const result = await this.updateShotEpisodesInStore(projectId, updates, principal)
      if (result) await this.mirrorReplacedShots(projectId, result)
      return result
    }

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return null
      const now = new Date().toISOString()
      for (const update of updates) {
        await client.query(
          `
          UPDATE shots
          SET episode_number = $4, episode_title = $5, episode_kind = $6, continuity_mode = $7, continuity_note = $8, updated_at = $9
          WHERE id = $1 AND project_id = $2 AND tenant_id = $3
          `,
          [
            update.id,
            projectId,
            principal.tenantId,
            update.episodeNumber,
            update.episodeTitle,
            update.episodeKind,
            update.continuityMode,
            update.continuityNote,
            now,
          ],
        )
      }
      await touchProject(client, projectId, principal.tenantId, now)
      const shots = await client.query<ShotRow>(
        `SELECT ${shotColumns} FROM shots WHERE project_id = $1 AND tenant_id = $2 ORDER BY shot_order ASC`,
        [projectId, principal.tenantId],
      )
      return shots.rows.map(shotFromRow)
    })
    if (result) await this.mirrorReplacedShots(projectId, result)
    return result
  }

  private listFromStore(principal: Principal): Project[] {
    const canReadAll = canReadAllTenantContent(principal)
    return this.requireStore().read((state) =>
      state.projects
        .filter((project) => project.tenantId === principal.tenantId)
        .filter((project) => project.status !== 'archived')
        .filter((project) => canReadAll || project.ownerId === principal.userId)
        .map((project) => ({
          ...project,
          previewUrl: projectPreviewUrl(project.id, state),
          generationSummary: projectGenerationSummary(project.id, state),
        }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    )
  }

  private workspaceFromStore(projectId: string, principal: Principal): ProjectWorkspace | null {
    const project = this.listFromStore(principal).find((item) => item.id === projectId)
    if (!project) return null
    return this.requireStore().read((state) => ({
      project,
      scriptEpisodes: state.scriptEpisodes
        .filter((episode) => episode.projectId === projectId && episode.tenantId === principal.tenantId)
        .sort((left, right) => left.episodeNumber - right.episodeNumber),
      assets: state.assets.filter(
        (asset) => asset.projectId === projectId && asset.tenantId === principal.tenantId,
      ),
      shots: state.shots
        .filter((shot) => shot.projectId === projectId && shot.tenantId === principal.tenantId)
        .sort((left, right) => left.order - right.order),
    }))
  }

  private async createInStore(input: CreateProject, principal: Principal): Promise<Project> {
    const now = new Date().toISOString()
    const project: Project = {
      id: randomUUID(),
      tenantId: principal.tenantId,
      ownerId: principal.userId,
      name: input.name,
      contentType: input.contentType,
      visualStyle: input.visualStyle,
      episodeDurationSeconds: input.episodeDurationSeconds,
      aspectRatio: input.aspectRatio,
      status: 'draft',
      synopsis: '',
      script: '',
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    return this.requireStore().mutate((state) => {
      state.projects.push(project)
      return project
    })
  }

  private async updateInStore(
    projectId: string,
    input: UpdateProject,
    principal: Principal,
  ): Promise<Project | null> {
    return this.requireStore().mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) return null
      Object.assign(project, input, { updatedAt: new Date().toISOString() })
      return project
    })
  }

  private async saveVersionInStore(projectId: string, principal: Principal): Promise<Project | null> {
    return this.requireStore().mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) return null
      project.version += 1
      project.updatedAt = new Date().toISOString()
      return project
    })
  }

  private async createAssetInStore(
    projectId: string,
    input: CreateAsset,
    principal: Principal,
  ): Promise<Asset | null> {
    return this.requireStore().mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) return null
      const now = new Date().toISOString()
      const asset: Asset = {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        ...input,
        status: input.sourceMode === 'import' ? 'confirmed' : 'draft',
        createdAt: now,
        updatedAt: now,
      }
      state.assets.push(asset)
      project.updatedAt = now
      return asset
    })
  }

  private async updateAssetInStore(
    projectId: string,
    assetId: string,
    input: UpdateAsset,
    principal: Principal,
  ): Promise<Asset | null> {
    return this.requireStore().mutate((state) => {
      const ownsProject = state.projects.some(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      const asset = state.assets.find((item) => item.id === assetId && item.projectId === projectId)
      if (!ownsProject || !asset) return null
      if (input.attributes && input.attributes.type !== asset.kind) return null
      Object.assign(asset, input, { updatedAt: new Date().toISOString() })
      return asset
    })
  }

  private async deleteAssetInStore(
    projectId: string,
    assetId: string,
    principal: Principal,
  ): Promise<boolean> {
    return this.requireStore().mutate((state) => {
      const ownsProject = state.projects.some(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      const index = state.assets.findIndex((item) => item.id === assetId && item.projectId === projectId)
      if (!ownsProject || index < 0) return false
      state.assets.splice(index, 1)
      return true
    })
  }

  private async createShotInStore(
    projectId: string,
    input: CreateShot,
    principal: Principal,
  ): Promise<Shot | null> {
    return this.requireStore().mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) return null
      const projectShots = state.shots
        .filter((shot) => shot.projectId === projectId && shot.tenantId === principal.tenantId)
        .sort((left, right) => left.order - right.order)
      const insertionOrder = insertionOrderFor(projectShots, input.insertAfterShotId)
      if (insertionOrder === null) return null
      projectShots.forEach((shot) => {
        if (shot.order >= insertionOrder) shot.order += 1
      })
      const { insertAfterShotId: _insertAfterShotId, ...shotInput } = input
      const now = new Date().toISOString()
      const shot: Shot = {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        order: insertionOrder,
        ...shotInput,
        createdAt: now,
        updatedAt: now,
      }
      state.shots.push(shot)
      project.updatedAt = now
      return shot
    })
  }

  private async deleteShotInStore(
    projectId: string,
    shotId: string,
    principal: Principal,
  ): Promise<'deleted' | 'not_found' | 'active'> {
    return this.requireStore().mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      const shot = state.shots.find(
        (item) => item.id === shotId && item.projectId === projectId && item.tenantId === principal.tenantId,
      )
      if (!project || !shot) return 'not_found'
      const active = state.tasks.some(
        (task) =>
          task.projectId === projectId &&
          task.tenantId === principal.tenantId &&
          task.metadata.shotId === shotId &&
          (task.status === 'queued' || task.status === 'paused' || task.status === 'running') &&
          typeof task.metadata.queueHiddenAt !== 'string',
      )
      if (active) return 'active'

      state.shots = state.shots.filter((item) => item !== shot)
      state.shots.forEach((item) => {
        if (item.projectId === projectId && item.tenantId === principal.tenantId && item.order > shot.order) {
          item.order -= 1
        }
      })
      project.updatedAt = new Date().toISOString()
      return 'deleted'
    })
  }

  private async updateShotInStore(
    projectId: string,
    shotId: string,
    input: UpdateShot,
    principal: Principal,
  ): Promise<Shot | null> {
    return this.requireStore().mutate((state) => {
      const ownsProject = state.projects.some(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      const shot = state.shots.find((item) => item.id === shotId && item.projectId === projectId)
      if (!ownsProject || !shot) return null
      Object.assign(shot, input, { updatedAt: new Date().toISOString() })
      return shot
    })
  }

  private async replaceShotsInStore(
    projectId: string,
    shots: CreateShot[],
    principal: Principal,
  ): Promise<Shot[] | null> {
    return this.requireStore().mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) return null
      const now = new Date().toISOString()
      state.shots = state.shots.filter((shot) => shot.projectId !== projectId)
      const created = shots.map((input, index) => ({
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        order: index + 1,
        ...input,
        createdAt: now,
        updatedAt: now,
      }))
      state.shots.push(...created)
      project.updatedAt = now
      return created
    })
  }

  private async updateShotEpisodesInStore(
    projectId: string,
    updates: Array<
      Pick<
        Shot,
        'id' | 'episodeNumber' | 'episodeTitle' | 'episodeKind' | 'continuityMode' | 'continuityNote'
      >
    >,
    principal: Principal,
  ): Promise<Shot[] | null> {
    return this.requireStore().mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) return null
      const changes = new Map(updates.map((update) => [update.id, update]))
      const now = new Date().toISOString()
      for (const shot of state.shots) {
        const update = changes.get(shot.id)
        if (!update || shot.projectId !== projectId || shot.tenantId !== principal.tenantId) continue
        shot.episodeNumber = update.episodeNumber
        shot.episodeTitle = update.episodeTitle
        shot.episodeKind = update.episodeKind
        shot.continuityMode = update.continuityMode
        if (update.continuityNote !== undefined) shot.continuityNote = update.continuityNote
        shot.updatedAt = now
      }
      project.updatedAt = now
      return state.shots
        .filter((shot) => shot.projectId === projectId && shot.tenantId === principal.tenantId)
        .sort((left, right) => left.order - right.order)
    })
  }

  private async findReadableProject(
    queryable: Queryable,
    projectId: string,
    principal: Principal,
  ): Promise<Project | null> {
    const result = await queryable.query<ProjectRow>(
      `
      SELECT ${projectColumns}
      FROM projects
      WHERE id = $1
        AND tenant_id = $2
        AND ($3::boolean OR owner_user_id = $4)
      `,
      [projectId, principal.tenantId, canReadAllTenantContent(principal), principal.userId],
    )
    return result.rows[0] ? projectFromRow(result.rows[0]) : null
  }

  private async findWritableProject(
    queryable: Queryable,
    projectId: string,
    principal: Principal,
    forUpdate = false,
  ): Promise<Project | null> {
    const result = await queryable.query<ProjectRow>(
      `
      SELECT ${projectColumns}
      FROM projects
      WHERE id = $1 AND tenant_id = $2 AND owner_user_id = $3
      ${forUpdate ? 'FOR UPDATE' : ''}
      `,
      [projectId, principal.tenantId, principal.userId],
    )
    return result.rows[0] ? projectFromRow(result.rows[0]) : null
  }

  private async decorateProject(project: Project): Promise<Project> {
    if (!this.database) return project
    const [tasks, assets, shots] = await Promise.all([
      this.database.query<ProjectTaskPreviewRow>(
        `
        SELECT id, project_id, tenant_id, kind, label, status, progress, metadata, outputs, updated_at
        FROM generation_tasks
        WHERE project_id = $1 AND tenant_id = $2
        ORDER BY updated_at DESC, id DESC
        `,
        [project.id, project.tenantId],
      ),
      this.database.query<AssetRow>(
        `
        SELECT ${assetColumns}
        FROM assets
        WHERE project_id = $1 AND tenant_id = $2
        ORDER BY updated_at DESC, created_at DESC
        `,
        [project.id, project.tenantId],
      ),
      this.database.query<ShotRow>(
        `
        SELECT ${shotColumns}
        FROM shots
        WHERE project_id = $1 AND tenant_id = $2
        ORDER BY shot_order ASC
        `,
        [project.id, project.tenantId],
      ),
    ])
    const state = {
      tasks: tasks.rows.map(projectPreviewTaskFromRow),
      assets: assets.rows.map(assetFromRow),
      shots: shots.rows.map(shotFromRow),
    }
    return {
      ...project,
      previewUrl: projectPreviewUrl(project.id, state),
      generationSummary: projectGenerationSummary(project.id, state),
    }
  }

  async refreshRuntimeCacheFromDatabase(): Promise<void> {
    if (!this.database || !this.store) return
    const [projects, scriptEpisodes, assets, shots] = await Promise.all([
      this.database.query<ProjectRow>(`SELECT ${projectColumns} FROM projects ORDER BY updated_at DESC`),
      this.database.query<ScriptEpisodeRow>(
        `SELECT ${scriptEpisodeColumns} FROM script_episodes ORDER BY project_id, episode_number ASC`,
      ),
      this.database.query<AssetRow>(
        `SELECT ${assetColumns} FROM assets ORDER BY updated_at DESC, created_at DESC`,
      ),
      this.database.query<ShotRow>(`SELECT ${shotColumns} FROM shots ORDER BY shot_order ASC`),
    ])
    this.store.replaceProjectWorkspaceRuntimeCache({
      projects: projects.rows.map(projectFromRow),
      scriptEpisodes: scriptEpisodes.rows.map(scriptEpisodeFromRow),
      assets: assets.rows.map(assetFromRow),
      shots: shots.rows.map(shotFromRow),
    })
  }

  private async mirrorProject(project: Project): Promise<void> {
    if (!this.store) return
    this.store.mutateProjectWorkspaceRuntimeCache((state) => upsertProject(state, project))
  }

  private async mirrorScriptEpisode(episode: ScriptEpisode): Promise<void> {
    if (!this.store) return
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      const index = state.scriptEpisodes.findIndex(
        (item) => item.id === episode.id && item.tenantId === episode.tenantId,
      )
      if (index >= 0) state.scriptEpisodes[index] = episode
      else state.scriptEpisodes.push(episode)
      const project = state.projects.find(
        (item) => item.id === episode.projectId && item.tenantId === episode.tenantId,
      )
      if (project && project.updatedAt < episode.updatedAt) project.updatedAt = episode.updatedAt
    })
  }

  private async mirrorAsset(asset: Asset): Promise<void> {
    if (!this.store) return
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      upsertAsset(state, asset)
      const project = state.projects.find(
        (item) => item.id === asset.projectId && item.tenantId === asset.tenantId,
      )
      if (project && project.updatedAt < asset.updatedAt) project.updatedAt = asset.updatedAt
    })
  }

  private async mirrorDeletedAsset(projectId: string, assetId: string): Promise<void> {
    if (!this.store) return
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      state.assets = state.assets.filter((asset) => asset.id !== assetId || asset.projectId !== projectId)
    })
  }

  private async mirrorShot(shot: Shot): Promise<void> {
    if (!this.store) return
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      upsertShot(state, shot)
      const project = state.projects.find(
        (item) => item.id === shot.projectId && item.tenantId === shot.tenantId,
      )
      if (project && project.updatedAt < shot.updatedAt) project.updatedAt = shot.updatedAt
    })
  }

  private async mirrorReplacedShots(
    projectId: string,
    shots: Shot[],
    tenantIdOverride?: string,
    updatedAtOverride?: string,
  ): Promise<void> {
    if (!this.store) return
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      const tenantId = shots[0]?.tenantId ?? tenantIdOverride
      state.shots = state.shots.filter(
        (shot) => shot.projectId !== projectId || (tenantId ? shot.tenantId !== tenantId : false),
      )
      state.shots.push(...shots)
      const project = state.projects.find(
        (item) => item.id === projectId && (!tenantId || item.tenantId === tenantId),
      )
      const latest = shots[0]?.updatedAt ?? updatedAtOverride
      if (project && latest && project.updatedAt < latest) project.updatedAt = latest
    })
  }

  private requireStore(): AppStore {
    if (!this.store) {
      throw new Error('JSON AppStore is unavailable; ProjectRepository must use Postgres in runtime')
    }
    return this.store
  }
}

function insertionOrderFor(shots: Shot[], insertAfterShotId: string | null | undefined): number | null {
  if (insertAfterShotId === undefined) return shots.length + 1
  if (insertAfterShotId === null) return 1
  const anchor = shots.find((shot) => shot.id === insertAfterShotId)
  return anchor ? anchor.order + 1 : null
}

function summarizeEpisodeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 500)
}

function draftContinuityState(
  current: unknown,
  generationClientRequestId: string | undefined,
  writtenAt: string,
): Record<string, unknown> {
  const existing =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {}
  if (!generationClientRequestId) return existing
  return {
    ...existing,
    generationClientRequestId,
    generationDraftWrittenAt: writtenAt,
  }
}

function aggregateEpisodeList(episodes: ScriptEpisode[]): string {
  return episodes
    .filter((episode) => episode.status === 'saved' && episode.content.trim())
    .sort((left, right) => left.episodeNumber - right.episodeNumber)
    .map((episode) => episode.content.trim())
    .join('\n\n【强制下一集】\n\n')
}

function aggregateSavedEpisodes(episodes: ScriptEpisode[], projectId: string, tenantId: string): string {
  return aggregateEpisodeList(
    episodes.filter((episode) => episode.projectId === projectId && episode.tenantId === tenantId),
  )
}

function renumberProjectShots(shots: Shot[], projectId: string, tenantId: string): void {
  shots
    .filter((shot) => shot.projectId === projectId && shot.tenantId === tenantId)
    .sort((left, right) => left.order - right.order)
    .forEach((shot, index) => {
      shot.order = index + 1
    })
}

async function renumberShotsInDatabase(
  queryable: Queryable,
  projectId: string,
  tenantId: string,
): Promise<void> {
  await queryable.query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY shot_order ASC, created_at ASC, id ASC) AS next_order
       FROM shots WHERE project_id = $1 AND tenant_id = $2
     )
     UPDATE shots shot SET shot_order = ranked.next_order
     FROM ranked WHERE shot.id = ranked.id`,
    [projectId, tenantId],
  )
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
    INSERT INTO shots (
      id,
      project_id,
      tenant_id,
      script_episode_id,
      shot_order,
      title,
      framing,
      duration_seconds,
      prompt,
      negative_prompt,
      image_url,
      continuity_mode,
      continuity_note,
      episode_break_before,
      episode_number,
      episode_title,
      episode_kind,
      created_at,
      updated_at
    )
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
    WHERE EXISTS (SELECT 1 FROM projects WHERE id = $2 AND tenant_id = $3)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
    `,
    shotInsertParams(shot),
  )
  return (result.rowCount ?? 0) > 0
}

async function touchProject(
  queryable: Queryable,
  projectId: string,
  tenantId: string,
  updatedAt: string,
): Promise<void> {
  await queryable.query('UPDATE projects SET updated_at = $3 WHERE id = $1 AND tenant_id = $2', [
    projectId,
    tenantId,
    updatedAt,
  ])
}

function assetInsertParams(asset: Asset): unknown[] {
  return [
    asset.id,
    asset.projectId,
    asset.tenantId,
    asset.kind,
    asset.sourceMode,
    asset.name,
    asset.description,
    asset.prompt,
    asset.promptMode,
    asset.customPromptMode,
    asset.customPrompt,
    asset.negativePrompt,
    JSON.stringify(asset.references),
    JSON.stringify(asset.attributes),
    asset.imageUrl,
    asset.status,
    asset.createdAt,
    asset.updatedAt,
  ]
}

function prefixedAssetColumns(alias: string): string {
  return assetColumns
    .split(',')
    .map((column) => `${alias}.${column.trim()}`)
    .join(',\n')
}

export function mergeAssetAttributes(
  current: Asset,
  incoming: Asset['attributes'] | undefined,
): Asset['attributes'] {
  if (!incoming || current.attributes.type !== 'character' || incoming.type !== 'character') {
    return incoming ?? current.attributes
  }

  const currentPortrait = current.attributes.trustedPortrait
  const incomingPortrait = incoming.trustedPortrait
  if (!currentPortrait) return incoming
  if (!incomingPortrait) {
    return {
      ...incoming,
      portraitSource: current.attributes.portraitSource,
      trustedPortrait: currentPortrait,
    }
  }

  const preserveCurrent =
    (currentPortrait.status === 'active' && incomingPortrait.status !== 'active') ||
    Date.parse(currentPortrait.checkedAt) > Date.parse(incomingPortrait.checkedAt)
  if (!preserveCurrent) return incoming
  return {
    ...incoming,
    portraitSource: current.attributes.portraitSource,
    trustedPortrait: currentPortrait,
  }
}

function shotInsertParams(shot: Shot): unknown[] {
  return [
    shot.id,
    shot.projectId,
    shot.tenantId,
    shot.scriptEpisodeId,
    shot.order,
    shot.title,
    shot.framing,
    shot.duration,
    shot.prompt,
    shot.negativePrompt,
    shot.imageUrl,
    shot.continuityMode,
    shot.continuityNote,
    shot.episodeBreakBefore,
    shot.episodeNumber,
    shot.episodeTitle,
    shot.episodeKind,
    shot.createdAt,
    shot.updatedAt,
  ]
}

function upsertProject(state: AppState, project: Project): void {
  const index = state.projects.findIndex(
    (item) => item.id === project.id && item.tenantId === project.tenantId,
  )
  if (index >= 0) {
    state.projects[index] = project
  } else {
    state.projects.push(project)
  }
}

function upsertAsset(state: AppState, asset: Asset): void {
  const index = state.assets.findIndex(
    (item) => item.id === asset.id && item.projectId === asset.projectId && item.tenantId === asset.tenantId,
  )
  if (index >= 0) {
    state.assets[index] = asset
  } else {
    state.assets.push(asset)
  }
}

function upsertShot(state: AppState, shot: Shot): void {
  const index = state.shots.findIndex(
    (item) => item.id === shot.id && item.projectId === shot.projectId && item.tenantId === shot.tenantId,
  )
  if (index >= 0) {
    state.shots[index] = shot
  } else {
    state.shots.push(shot)
  }
}

export function projectPreviewUrl(projectId: string, state: ProjectPreviewState): string | null {
  const completedVideoFrame = state.tasks
    .filter((task) => task.projectId === projectId && task.kind === 'video' && task.status === 'completed')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .flatMap((task) => task.outputs)
    .find((output) => output.mediaType === 'image' && output.view === 'last-frame')
  if (completedVideoFrame?.url) return completedVideoFrame.url

  const storyboardImage = state.tasks
    .filter((task) => task.projectId === projectId && task.kind === 'image' && task.status === 'completed')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .flatMap((task) => task.outputs)
    .find((output) => output.mediaType === 'image' && output.view === 'single')
  if (storyboardImage?.url) return storyboardImage.url

  const shotImage = state.shots
    .filter((shot) => shot.projectId === projectId && shot.imageUrl)
    .sort((left, right) => left.order - right.order)
    .find((shot) => shot.imageUrl)?.imageUrl
  if (shotImage) return shotImage

  const asset = state.assets
    .filter((item) => item.projectId === projectId && item.kind !== 'audio')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .find((item) => assetPreviewUrl(item))
  return asset ? assetPreviewUrl(asset) : null
}

export function projectGenerationSummary(
  projectId: string,
  state: Pick<ProjectPreviewState, 'tasks'>,
): ProjectGenerationSummary {
  const relevantStatuses = new Set(['queued', 'paused', 'running', 'failed'])
  const tasks = state.tasks
    .filter(
      (task) =>
        task.projectId === projectId &&
        relevantStatuses.has(task.status) &&
        typeof task.metadata?.queueHiddenAt !== 'string',
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  return {
    queued: tasks.filter((task) => task.status === 'queued').length,
    paused: tasks.filter((task) => task.status === 'paused').length,
    running: tasks.filter((task) => task.status === 'running').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    latest: tasks.slice(0, 3).map((task) => ({
      id: task.id,
      label: task.label,
      kind: task.kind,
      status: task.status as 'queued' | 'paused' | 'running' | 'failed',
      progress: task.progress,
      updatedAt: task.updatedAt,
    })),
  }
}

function assetPreviewUrl(asset: ProjectPreviewAsset): string | null {
  if (asset.imageUrl) return asset.imageUrl
  const attributes = asset.attributes as Record<string, unknown>
  const faceReference = attributes.faceReference as { url?: unknown } | null | undefined
  if (typeof faceReference?.url === 'string') return faceReference.url
  return asset.references?.[0]?.url ?? null
}

function projectFromRow(row: ProjectRow): Project {
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

function scriptEpisodeFromRow(row: ScriptEpisodeRow): ScriptEpisode {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    episodeNumber: Number(row.episode_number),
    title: row.title,
    content: row.content,
    draftContent: row.draft_content,
    status: row.status,
    summary: row.summary,
    continuityState: jsonValue(row.continuity_state, {}),
    revision: Number(row.revision),
    lastEditedBy: row.last_edited_by,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

function assetFromRow(row: AssetRow): Asset {
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

function shotFromRow(row: ShotRow): Shot {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    scriptEpisodeId: row.script_episode_id,
    order: Number(row.shot_order),
    title: row.title,
    framing: row.framing,
    duration: Number(row.duration_seconds),
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    imageUrl: row.image_url,
    selectedImageTaskId: row.selected_image_task_id,
    selectedVideoTaskId: row.selected_video_task_id,
    continuityMode: row.continuity_mode,
    continuityNote: row.continuity_note,
    episodeBreakBefore: row.episode_break_before,
    episodeNumber: Number(row.episode_number),
    episodeTitle: row.episode_title,
    episodeKind: row.episode_kind,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

function projectPreviewTaskFromRow(row: ProjectTaskPreviewRow): GenerationTask {
  return {
    id: row.id,
    clientRequestId: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    userId: '',
    kind: row.kind,
    label: row.label,
    prompt: '',
    negativePrompt: '',
    provider: '',
    model: null,
    tier: null,
    metadata: jsonValue(row.metadata, {}),
    status: row.status,
    progress: Number(row.progress),
    estimatedCredits: 0,
    createdAt: isoString(row.updated_at),
    updatedAt: isoString(row.updated_at),
    resultUrl: null,
    outputs: jsonValue(row.outputs, []),
    error: null,
  }
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
