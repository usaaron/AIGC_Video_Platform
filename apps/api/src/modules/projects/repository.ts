import { importProjectsFromStore, type ProjectJsonImportResult } from './projectStoreImport.js'
export type { ProjectJsonImportResult } from './projectStoreImport.js'
import { listProjectsFromStore, readWorkspaceFromStore } from './projectStoreReads.js'
import {
  assetInsertParams,
  shotInsertParams,
  shotInsertColumns,
  shotInsertValues,
} from './workspaceSqlParams.js'
import {
  summarizeEpisodeContent,
  draftContinuityState,
  aggregateEpisodeList,
  aggregateSavedEpisodes,
} from './episodePersistence.js'
import { AppError } from '../../core/errors.js'
import { assetIdentityKey, mergeCharacterVariants } from '@seqora/contracts'
import { changeAssetInDatabase, type AssetChange } from './assetMutation.js'
import type {
  Asset,
  CreateAsset,
  CreateProject,
  CreateShot,
  Principal,
  Plan,
  Project,
  ProjectWorkspace,
  ScriptEpisode,
  Shot,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
  FaceConfirmationRequest,
  TrustedPortrait,
} from '@seqora/contracts'
import { createHash, randomUUID } from 'node:crypto'
import type { QueryResult, QueryResultRow } from 'pg'
import { insertAuditLog, type AuditLogInput } from '../../core/audit/auditLog.js'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'
import { mergeAssetAttributes } from './assetAttributesMerge.js'
import { confirmedFaceUpdate, trustedPortraitUpdate, type PortraitWriteIntent } from './faceConfirmation.js'
import { projectGenerationSummary, projectPreviewUrl, type ProjectPreviewState } from './projectPreview.js'
import {
  assetColumns,
  assetFromRow,
  type AssetRow,
  isoString,
  jsonValue,
  projectColumns,
  projectFromRow,
  projectListColumns,
  projectPreviewTaskFromRow,
  type ProjectListAssetRow,
  type ProjectListShotRow,
  type ProjectRow,
  type ProjectTaskPreviewRow,
  scriptEpisodeColumns,
  scriptEpisodeFromRow,
  type ScriptEpisodeRow,
  shotColumns,
  shotFromRow,
  type ShotRow,
  upsertAsset,
  upsertProject,
  upsertShot,
} from './repositoryData.js'
import { readWorkspaceVersion, readWorkspaceVersionFromStore } from './workspaceVersion.js'
import {
  refreshProjectWorkspaceRuntimeCache,
  type ProjectRuntimeCacheOptions,
  readRuntimeProjectVersions,
} from './runtimeCache.js'
import { isStandaloneProjectId } from './projectSurface.js'
import { disambiguateEpisodeTitle, findDuplicateEpisodeContent } from './episodeTitle.js'

export { mergeAssetAttributes } from './assetAttributesMerge.js'

export { projectGenerationSummary, projectPreviewUrl } from './projectPreview.js'

function hashProjectCreationInput(input: CreateProject): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>
}

export class ProjectRepository {
  private readonly projectCreationRequests = new Map<string, { requestHash: string; projectId: string }>()
  private readonly projectCreationInFlight = new Map<string, Promise<Project>>()

  constructor(
    private readonly store: AppStore | null,
    private readonly database: AccountDatabase | null = null,
  ) {}

  async importFromStore(): Promise<ProjectJsonImportResult> {
    return importProjectsFromStore(this.store, this.database)
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
    if (!this.database) return listProjectsFromStore(this.requireStore(), principal)

    const canReadAll = canReadAllTenantContent(principal)
    const result = await this.database.query<ProjectRow>(
      `
      SELECT ${projectListColumns}
      FROM projects
      WHERE tenant_id = $1
        AND status <> 'archived'
        AND id NOT LIKE 'sm-standalone-%'
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
        WITH active_tasks AS (
          SELECT
            id,
            project_id,
            tenant_id,
            kind,
            label,
            status,
            progress,
            '{}'::jsonb AS metadata,
            '[]'::jsonb AS outputs,
            updated_at
          FROM generation_tasks
          WHERE tenant_id = $1
            AND project_id = ANY($2::text[])
            AND status IN ('queued', 'paused', 'running', 'failed')
            AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
        ),
        candidate_completed_tasks AS (
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
            AND status = 'completed'
            AND kind IN ('image', 'video')
            AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
        )
        SELECT id, project_id, tenant_id, kind, label, status, progress, metadata, outputs, updated_at
        FROM active_tasks
        UNION ALL
        SELECT id, project_id, tenant_id, kind, label, status, progress, metadata, outputs, updated_at
        FROM candidate_completed_tasks
        WHERE preview_rank = 1
        ORDER BY updated_at DESC, id DESC
        `,
        [principal.tenantId, projectIds],
      ),
      this.database.query<ProjectListAssetRow>(
        `
        SELECT DISTINCT ON (project_id)
          project_id, kind, reference_items, attributes, image_url, updated_at
        FROM assets
        WHERE tenant_id = $1
          AND project_id = ANY($2::text[])
          AND kind <> 'audio'
          AND (
            image_url IS NOT NULL
            OR attributes#>>'{faceReference,url}' IS NOT NULL
            OR reference_items->0->>'url' IS NOT NULL
          )
        ORDER BY project_id, updated_at DESC, created_at DESC, id DESC
        `,
        [principal.tenantId, projectIds],
      ),
      this.database.query<ProjectListShotRow>(
        `
        SELECT DISTINCT ON (project_id)
          project_id, shot_order, image_url
        FROM shots
        WHERE tenant_id = $1
          AND project_id = ANY($2::text[])
          AND image_url IS NOT NULL
        ORDER BY project_id, shot_order ASC, id ASC
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
    if (isStandaloneProjectId(projectId)) return null
    if (!this.database) return readWorkspaceFromStore(this.requireStore(), projectId, principal)

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

  async workspaceVersion(projectId: string, principal: Principal): Promise<string | null> {
    if (isStandaloneProjectId(projectId)) return null
    return this.database
      ? readWorkspaceVersion(this.database, projectId, principal)
      : readWorkspaceVersionFromStore(this.requireStore(), projectId, principal)
  }

  async findOwnedAsset(projectId: string, assetId: string, principal: Principal): Promise<Asset | null> {
    if (isStandaloneProjectId(projectId)) return null
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
              (project) =>
                project.tenantId === principal.tenantId &&
                project.ownerId === principal.userId &&
                !isStandaloneProjectId(project.id),
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
        AND project.id NOT LIKE 'sm-standalone-%'
      ORDER BY asset.updated_at DESC, asset.created_at DESC
      `,
      [principal.tenantId, principal.userId],
    )
    return result.rows.map(assetFromRow)
  }

  async create(input: CreateProject, principal: Principal, idempotencyKey?: string): Promise<Project> {
    const requestHash = idempotencyKey ? hashProjectCreationInput(input) : null
    if (!this.database && idempotencyKey && requestHash) {
      const requestId = `${principal.tenantId}:${principal.userId}:${idempotencyKey}`
      const pending = this.projectCreationInFlight.get(requestId)
      if (pending) return pending
      const operation = this.createInStore(input, principal, idempotencyKey, requestHash)
      this.projectCreationInFlight.set(requestId, operation)
      try {
        return await operation
      } finally {
        if (this.projectCreationInFlight.get(requestId) === operation)
          this.projectCreationInFlight.delete(requestId)
      }
    }
    if (!this.database) return this.createInStore(input, principal, idempotencyKey, requestHash)

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

    if (idempotencyKey && requestHash) {
      return this.createInDatabaseIdempotently(principal, idempotencyKey, requestHash, project)
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
    if (isStandaloneProjectId(projectId)) return null
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
    if (isStandaloneProjectId(projectId)) return null
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
        const checkpoint =
          options.generationClientRequestId?.startsWith('episode-plan-') &&
          episodes.find(
            (item) => item.continuityState.batchGenerationKey === options.generationClientRequestId,
          )
        if (checkpoint) return checkpoint
        let episode = episodeId ? episodes.find((item) => item.id === episodeId) : undefined
        if (!episode && !episodeId && !options.createNext) {
          episode = [...episodes].reverse().find((item) => item.status === 'draft')
        }
        const duplicate = findDuplicateEpisodeContent(content, episodes, episode?.id, {
          longFormExactOnly: content.length >= 1_000,
        })
        if (duplicate) {
          throw new AppError(
            409,
            'SCRIPT_EPISODE_DUPLICATE_CONTENT',
            `当前正文的剧情行动、冲突和结果与第 ${duplicate.episodeNumber} 集重复，疑似批量生成或分集导入重复提交；已拦截，请检查分集边界后重试`,
          )
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
            title: disambiguateEpisodeTitle(options.title, episodeNumber, episodes),
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
          episode.title = options.title?.trim()
            ? disambiguateEpisodeTitle(options.title, episode.episodeNumber, episodes, episode.id)
            : episode.title
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
      const checkpoint =
        options.generationClientRequestId?.startsWith('episode-plan-') &&
        episodes.find((item) => item.continuityState.batchGenerationKey === options.generationClientRequestId)
      if (checkpoint) return checkpoint
      let current = episodeId ? episodes.find((item) => item.id === episodeId) : undefined
      if (!current && episodeId) return null
      if (!current && !options.createNext) {
        current = [...episodes].reverse().find((item) => item.status === 'draft')
      }
      const duplicate = findDuplicateEpisodeContent(content, episodes, current?.id, {
        longFormExactOnly: content.length >= 1_000,
      })
      if (duplicate) {
        throw new AppError(
          409,
          'SCRIPT_EPISODE_DUPLICATE_CONTENT',
          `当前正文的剧情行动、冲突和结果与第 ${duplicate.episodeNumber} 集重复，疑似批量生成或分集导入重复提交；已拦截，请检查分集边界后重试`,
        )
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
            options.title?.trim()
              ? disambiguateEpisodeTitle(options.title, current.episodeNumber, episodes, current.id)
              : current.title,
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
          disambiguateEpisodeTitle(options.title, episodeNumber, episodes),
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
    if (isStandaloneProjectId(projectId)) return null
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
        const duplicate = findDuplicateEpisodeContent(content, episodes, episode?.id, {
          longFormExactOnly: content.length >= 1_000,
        })
        if (duplicate) {
          throw new AppError(
            409,
            'SCRIPT_EPISODE_DUPLICATE_CONTENT',
            `当前正文的剧情行动、冲突和结果与第 ${duplicate.episodeNumber} 集重复，疑似批量生成或分集导入重复提交；已拦截，请检查分集边界后重试`,
          )
        }
        const now = new Date().toISOString()
        if (!episode) {
          if (episodeId) return null
          const episodeNumber = (episodes.at(-1)?.episodeNumber ?? 0) + 1
          episode = {
            id: randomUUID(),
            projectId,
            tenantId: principal.tenantId,
            episodeNumber,
            title: disambiguateEpisodeTitle(title, episodeNumber, episodes),
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
          episode.continuityState = {
            ...(episode.continuityState.batchGenerationKey
              ? { batchGenerationKey: episode.continuityState.batchGenerationKey }
              : {}),
            ...(Array.isArray(episode.continuityState.scriptProductionHistory)
              ? { scriptProductionHistory: episode.continuityState.scriptProductionHistory }
              : {}),
          }
          episode.title = title?.trim()
            ? disambiguateEpisodeTitle(title, episode.episodeNumber, episodes, episode.id)
            : episode.title
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
      const duplicate = findDuplicateEpisodeContent(content, episodes, current?.id, {
        longFormExactOnly: content.length >= 1_000,
      })
      if (duplicate) {
        throw new AppError(
          409,
          'SCRIPT_EPISODE_DUPLICATE_CONTENT',
          `当前正文的剧情行动、冲突和结果与第 ${duplicate.episodeNumber} 集重复，疑似批量生成或分集导入重复提交；已拦截，请检查分集边界后重试`,
        )
      }
      const now = new Date().toISOString()
      let savedRow: ScriptEpisodeRow | undefined
      if (current) {
        const updated = await client.query<ScriptEpisodeRow>(
          `UPDATE script_episodes
           SET content = $4, draft_content = '', status = 'saved', title = $5, summary = $6,
               continuity_state = (CASE WHEN continuity_state ? 'batchGenerationKey' THEN jsonb_build_object('batchGenerationKey', continuity_state->'batchGenerationKey') ELSE '{}'::jsonb END)
                 || (CASE WHEN jsonb_typeof(continuity_state->'scriptProductionHistory') = 'array' THEN jsonb_build_object('scriptProductionHistory', continuity_state->'scriptProductionHistory') ELSE '{}'::jsonb END),
               revision = revision + 1, last_edited_by = $7, updated_at = $8
           WHERE id = $1 AND project_id = $2 AND tenant_id = $3
           RETURNING ${scriptEpisodeColumns}`,
          [
            current.id,
            projectId,
            principal.tenantId,
            content,
            title?.trim()
              ? disambiguateEpisodeTitle(title, current.episodeNumber, episodes, current.id)
              : current.title,
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
            disambiguateEpisodeTitle(title, episodeNumber, episodes),
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
    if (isStandaloneProjectId(projectId)) return 'not_found'
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
    if (isStandaloneProjectId(projectId)) return 'not_found'
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
    if (isStandaloneProjectId(projectId)) return false
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
    if (isStandaloneProjectId(projectId)) return null
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
    if (isStandaloneProjectId(projectId)) return null
    if (!this.database) return this.createAssetInStore(projectId, input, principal)

    const result = await this.database.transaction(async (client) => {
      const project = await this.findWritableProject(client, projectId, principal, true)
      if (!project) return null

      if (input.reuseExisting) {
        const rows = await client.query<AssetRow>(
          `SELECT ${assetColumns} FROM assets WHERE project_id = $1 AND tenant_id = $2`,
          [projectId, principal.tenantId],
        )
        const current = rows.rows
          .map(assetFromRow)
          .find((asset) => assetIdentityKey(asset) === assetIdentityKey(input))
        if (current) {
          const merged = mergeCharacterVariants(current, input)
          if (merged.attributes.type === 'character' && merged.attributes.appearanceVariants.length > 100)
            throw new AppError(400, 'TOO_MANY_APPEARANCES', '每个人物最多保存 100 套造型')
          await client.query(
            'UPDATE assets SET attributes = $3::jsonb, updated_at = now() WHERE id = $1 AND tenant_id = $2',
            [current.id, principal.tenantId, JSON.stringify(merged.attributes)],
          )
          await touchProject(client, projectId, principal.tenantId, new Date().toISOString())
          return { ...merged, updatedAt: new Date().toISOString() }
        }
      }
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
    if (isStandaloneProjectId(projectId)) return null
    return this.changeAsset(projectId, assetId, input, principal)
  }

  async confirmFace(
    projectId: string,
    assetId: string,
    face: FaceConfirmationRequest['faceReference'],
    principal: Principal,
  ): Promise<Asset | null> {
    if (isStandaloneProjectId(projectId)) return null
    return this.changeAsset(projectId, assetId, (current) => confirmedFaceUpdate(current, face), principal)
  }

  async updateTrustedPortrait(
    observed: Asset,
    portrait: TrustedPortrait,
    source: 'ai-virtual' | 'authorized-real',
    principal: Principal,
    intent: PortraitWriteIntent = 'callback',
  ): Promise<Asset | null> {
    if (isStandaloneProjectId(observed.projectId)) return null
    return this.changeAsset(
      observed.projectId,
      observed.id,
      (current) => trustedPortraitUpdate(current, observed, portrait, source, intent),
      principal,
    )
  }

  private async changeAsset(
    projectId: string,
    assetId: string,
    change: AssetChange,
    principal: Principal,
  ): Promise<Asset | null> {
    if (isStandaloneProjectId(projectId)) return null
    if (!this.database) return this.updateAssetInStore(projectId, assetId, change, principal)
    const result = await changeAssetInDatabase(
      this.database,
      projectId,
      assetId,
      change,
      principal,
      (client, id, actor) => this.findWritableProject(client, id, actor),
      touchProject,
    )
    if (result) await this.mirrorAsset(result)
    return result
  }

  async deleteAsset(projectId: string, assetId: string, principal: Principal): Promise<boolean> {
    if (isStandaloneProjectId(projectId)) return false
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
    if (isStandaloneProjectId(projectId)) return null
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
        INSERT INTO shots (${shotInsertColumns}) VALUES (${shotInsertValues})
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
    if (isStandaloneProjectId(projectId)) return null
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
        referenceImages: input.referenceImages ?? current.referenceImages,
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
           updated_at = $20,
           reference_images = $21
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
          updated.referenceImages === undefined ? null : JSON.stringify(updated.referenceImages),
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
    if (isStandaloneProjectId(projectId)) return 'not_found'
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
    if (isStandaloneProjectId(projectId)) return null
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
          INSERT INTO shots (${shotInsertColumns}) VALUES (${shotInsertValues})
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
    if (isStandaloneProjectId(projectId)) return null
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
          `INSERT INTO shots (${shotInsertColumns}) VALUES (${shotInsertValues})`,
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
    if (isStandaloneProjectId(projectId)) return null
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

  private async createInStore(
    input: CreateProject,
    principal: Principal,
    idempotencyKey?: string,
    requestHash?: string | null,
  ): Promise<Project> {
    if (idempotencyKey && requestHash) {
      const requestId = `${principal.tenantId}:${principal.userId}:${idempotencyKey}`
      const existing = this.projectCreationRequests.get(requestId)
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', '创建请求标识已用于其他项目参数')
        }
        const project = this.requireStore().read((state) =>
          state.projects.find((item) => item.id === existing.projectId),
        )
        if (project) return project
        this.projectCreationRequests.delete(requestId)
      }
    }
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
    const created = await this.requireStore().mutate((state) => {
      state.projects.push(project)
      return project
    })
    if (idempotencyKey && requestHash) {
      this.projectCreationRequests.set(`${principal.tenantId}:${principal.userId}:${idempotencyKey}`, {
        requestHash,
        projectId: created.id,
      })
    }
    return created
  }

  private async createInDatabaseIdempotently(
    principal: Principal,
    idempotencyKey: string,
    requestHash: string,
    project: Project,
  ): Promise<Project> {
    let created = false
    const result = await this.database!.transaction(async (client) => {
      const claim = await client.query<{ project_id: string; request_hash: string }>(
        `INSERT INTO project_creation_requests (tenant_id, user_id, idempotency_key, request_hash, project_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, user_id, idempotency_key) DO NOTHING
         RETURNING project_id, request_hash`,
        [principal.tenantId, principal.userId, idempotencyKey, requestHash, project.id],
      )
      let projectId = claim.rows[0]?.project_id
      if (!projectId) {
        const existing = await client.query<{ project_id: string; request_hash: string }>(
          `SELECT project_id, request_hash FROM project_creation_requests
           WHERE tenant_id = $1 AND user_id = $2 AND idempotency_key = $3`,
          [principal.tenantId, principal.userId, idempotencyKey],
        )
        const row = existing.rows[0]
        if (!row) throw new AppError(409, 'IDEMPOTENCY_REQUEST_UNAVAILABLE', '创建请求正在处理中，请稍后重试')
        if (row.request_hash !== requestHash) {
          throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', '创建请求标识已用于其他项目参数')
        }
        projectId = row.project_id
      } else {
        created = true
        await client.query(
          `INSERT INTO projects (
            id, tenant_id, owner_user_id, name, content_type, visual_style,
            episode_duration_seconds, aspect_ratio, status, synopsis, script,
            version, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
      }
      const existingProject = await client.query<ProjectRow>(
        `SELECT ${projectColumns} FROM projects WHERE id = $1 AND tenant_id = $2 AND owner_user_id = $3`,
        [projectId, principal.tenantId, principal.userId],
      )
      if (!existingProject.rows[0])
        throw new AppError(409, 'IDEMPOTENCY_REQUEST_UNAVAILABLE', '创建请求正在处理中，请稍后重试')
      return projectFromRow(existingProject.rows[0])
    })
    if (created) await this.mirrorProject(result)
    return result
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
      if (input.reuseExisting) {
        const current = state.assets.find(
          (asset) =>
            asset.projectId === projectId &&
            asset.tenantId === principal.tenantId &&
            assetIdentityKey(asset) === assetIdentityKey(input),
        )
        if (current) {
          const merged = mergeCharacterVariants(current, input)
          if (merged.attributes.type === 'character' && merged.attributes.appearanceVariants.length > 100)
            throw new AppError(400, 'TOO_MANY_APPEARANCES', '每个人物最多保存 100 套造型')
          Object.assign(current, merged, { updatedAt: new Date().toISOString() })
          project.updatedAt = current.updatedAt
          return current
        }
      }
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
    change: AssetChange,
    principal: Principal,
  ): Promise<Asset | null> {
    return this.requireStore().mutate((state) => {
      const ownsProject = state.projects.some(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      const asset = state.assets.find((item) => item.id === assetId && item.projectId === projectId)
      if (!ownsProject || !asset) return null
      const input = typeof change === 'function' ? change(asset) : change
      if (input.attributes && input.attributes.type !== asset.kind) return null
      Object.assign(asset, input, {
        attributes:
          typeof change === 'function'
            ? (input.attributes ?? asset.attributes)
            : mergeAssetAttributes(asset, input.attributes),
        updatedAt: new Date().toISOString(),
      })
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
    if (isStandaloneProjectId(projectId)) return null
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
    if (isStandaloneProjectId(projectId)) return null
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

  async refreshRuntimeCacheFromDatabase(options: ProjectRuntimeCacheOptions = {}): Promise<void> {
    await refreshProjectWorkspaceRuntimeCache(this.database, this.store, options)
  }

  async runtimeProjectVersions(projectIds: readonly string[]): Promise<Map<string, string>> {
    return this.database ? readRuntimeProjectVersions(this.database, projectIds) : new Map()
  }

  private async mirrorProject(project: Project): Promise<void> {
    if (!this.store) return
    await this.store.mutateProjectWorkspaceRuntimeCacheAsync((state) => upsertProject(state, project))
  }

  private async mirrorScriptEpisode(episode: ScriptEpisode): Promise<void> {
    if (!this.store) return
    await this.store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
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
    await this.store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
      upsertAsset(state, asset)
      const project = state.projects.find(
        (item) => item.id === asset.projectId && item.tenantId === asset.tenantId,
      )
      if (project && project.updatedAt < asset.updatedAt) project.updatedAt = asset.updatedAt
    })
  }

  private async mirrorDeletedAsset(projectId: string, assetId: string): Promise<void> {
    if (!this.store) return
    await this.store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
      state.assets = state.assets.filter((asset) => asset.id !== assetId || asset.projectId !== projectId)
    })
  }

  private async mirrorShot(shot: Shot): Promise<void> {
    if (!this.store) return
    await this.store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
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
    await this.store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
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

function prefixedAssetColumns(alias: string): string {
  return assetColumns
    .split(',')
    .map((column) => `${alias}.${column.trim()}`)
    .join(',\n')
}
