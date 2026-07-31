import type {
  Asset,
  CreateAsset,
  CreateProject,
  CreateShot,
  Principal,
  Plan,
  Project,
  ProjectWorkspace,
  Shot,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppState, AppStore } from '../../infra/store.js'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>
}

type ProjectRow = QueryResultRow & {
  id: string
  tenant_id: string
  owner_user_id: string
  name: string
  content_type: Project['contentType']
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
  shot_order: number | string
  title: string
  framing: string
  duration_seconds: number | string
  prompt: string
  negative_prompt: string
  image_url: string | null
  continuity_mode: Shot['continuityMode']
  continuity_note: string
  created_at: Date | string
  updated_at: Date | string
}

const projectColumns = `
  id,
  tenant_id,
  owner_user_id,
  name,
  content_type,
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
  shot_order,
  title,
  framing,
  duration_seconds,
  prompt,
  negative_prompt,
  image_url,
  continuity_mode,
  continuity_note,
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
    private readonly store: AppStore,
    private readonly database: AccountDatabase | null = null,
  ) {}

  async importFromStore(): Promise<ProjectJsonImportResult> {
    if (!this.database) {
      return {
        projects: { inserted: 0, skipped: 0 },
        assets: { inserted: 0, skipped: 0 },
        shots: { inserted: 0, skipped: 0 },
      }
    }
    const snapshot = this.store.read((state) => ({
      projects: state.projects,
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
    return this.store.read(
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
        AND ($2::boolean OR owner_user_id = $3)
      ORDER BY updated_at DESC
      `,
      [principal.tenantId, canReadAll, principal.userId],
    )
    return result.rows.map(projectFromRow)
  }

  async workspace(projectId: string, principal: Principal): Promise<ProjectWorkspace | null> {
    if (!this.database) return this.workspaceFromStore(projectId, principal)

    const project = await this.findReadableProject(this.database, projectId, principal)
    if (!project) return null

    const [assets, shots] = await Promise.all([
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
      assets: assets.rows.map(assetFromRow),
      shots: shots.rows.map(shotFromRow),
    }
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
        aspect_ratio,
        status,
        synopsis,
        script,
        version,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        project.id,
        project.tenantId,
        project.ownerId,
        project.name,
        project.contentType,
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
        synopsis = $6,
        script = $7,
        updated_at = $8
      WHERE id = $1 AND tenant_id = $2 AND owner_user_id = $3
      RETURNING ${projectColumns}
      `,
      [
        projectId,
        principal.tenantId,
        principal.userId,
        updated.name,
        updated.status,
        updated.synopsis,
        updated.script,
        updated.updatedAt,
      ],
    )
    const project = result.rows[0] ? projectFromRow(result.rows[0]) : null
    if (project) await this.mirrorProject(project)
    return project
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
        attributes: input.attributes ?? current.attributes,
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

      const orderResult = await client.query<{ next_order: number | string }>(
        `
        SELECT (COALESCE(MAX(shot_order), 0) + 1)::integer AS next_order
        FROM shots
        WHERE project_id = $1 AND tenant_id = $2
        `,
        [projectId, principal.tenantId],
      )
      const now = new Date().toISOString()
      const shot: Shot = {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        order: Number(orderResult.rows[0]?.next_order ?? 1),
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
          shot_order,
          title,
          framing,
          duration_seconds,
          prompt,
          negative_prompt,
          image_url,
          continuity_mode,
          continuity_note,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING ${shotColumns}
        `,
        shotInsertParams(shot),
      )
      await touchProject(client, projectId, principal.tenantId, now)
      return inserted.rows[0] ? shotFromRow(inserted.rows[0]) : null
    })

    if (result) await this.mirrorShot(result)
    return result
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
        order: input.order ?? current.order,
        title: input.title ?? current.title,
        framing: input.framing ?? current.framing,
        duration: input.duration ?? current.duration,
        prompt: input.prompt ?? current.prompt,
        negativePrompt: input.negativePrompt ?? current.negativePrompt,
        imageUrl: input.imageUrl === undefined ? current.imageUrl : input.imageUrl,
        continuityMode: input.continuityMode ?? current.continuityMode,
        continuityNote: input.continuityNote ?? current.continuityNote,
        updatedAt: new Date().toISOString(),
      }
      const updatedResult = await client.query<ShotRow>(
        `
        UPDATE shots
        SET
          shot_order = $4,
          title = $5,
          framing = $6,
          duration_seconds = $7,
          prompt = $8,
          negative_prompt = $9,
          image_url = $10,
          continuity_mode = $11,
          continuity_note = $12,
          updated_at = $13
        WHERE id = $1 AND project_id = $2 AND tenant_id = $3
        RETURNING ${shotColumns}
        `,
        [
          shotId,
          projectId,
          principal.tenantId,
          updated.order,
          updated.title,
          updated.framing,
          updated.duration,
          updated.prompt,
          updated.negativePrompt,
          updated.imageUrl,
          updated.continuityMode,
          updated.continuityNote,
          updated.updatedAt,
        ],
      )
      await touchProject(client, projectId, principal.tenantId, updated.updatedAt)
      return updatedResult.rows[0] ? shotFromRow(updatedResult.rows[0]) : null
    })

    if (result) await this.mirrorShot(result)
    return result
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
            shot_order,
            title,
            framing,
            duration_seconds,
            prompt,
            negative_prompt,
            image_url,
            continuity_mode,
            continuity_note,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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

  private listFromStore(principal: Principal): Project[] {
    const canReadAll = canReadAllTenantContent(principal)
    return this.store.read((state) =>
      state.projects
        .filter((project) => project.tenantId === principal.tenantId)
        .filter((project) => canReadAll || project.ownerId === principal.userId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    )
  }

  private workspaceFromStore(projectId: string, principal: Principal): ProjectWorkspace | null {
    const project = this.listFromStore(principal).find((item) => item.id === projectId)
    if (!project) return null
    return this.store.read((state) => ({
      project,
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
      aspectRatio: input.aspectRatio,
      status: 'draft',
      synopsis: '',
      script: '',
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    return this.store.mutate((state) => {
      state.projects.push(project)
      return project
    })
  }

  private async updateInStore(
    projectId: string,
    input: UpdateProject,
    principal: Principal,
  ): Promise<Project | null> {
    return this.store.mutate((state) => {
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
    return this.store.mutate((state) => {
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
    return this.store.mutate((state) => {
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
    return this.store.mutate((state) => {
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
    return this.store.mutate((state) => {
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
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) return null
      const projectShots = state.shots.filter((shot) => shot.projectId === projectId)
      const now = new Date().toISOString()
      const shot: Shot = {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        order: Math.max(0, ...projectShots.map((item) => item.order)) + 1,
        ...input,
        createdAt: now,
        updatedAt: now,
      }
      state.shots.push(shot)
      project.updatedAt = now
      return shot
    })
  }

  private async updateShotInStore(
    projectId: string,
    shotId: string,
    input: UpdateShot,
    principal: Principal,
  ): Promise<Shot | null> {
    return this.store.mutate((state) => {
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
    return this.store.mutate((state) => {
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

  async refreshRuntimeCacheFromDatabase(): Promise<void> {
    if (!this.database) return
    const [projects, assets, shots] = await Promise.all([
      this.database.query<ProjectRow>(`SELECT ${projectColumns} FROM projects ORDER BY updated_at DESC`),
      this.database.query<AssetRow>(
        `SELECT ${assetColumns} FROM assets ORDER BY updated_at DESC, created_at DESC`,
      ),
      this.database.query<ShotRow>(`SELECT ${shotColumns} FROM shots ORDER BY shot_order ASC`),
    ])
    this.store.replaceProjectWorkspaceRuntimeCache({
      projects: projects.rows.map(projectFromRow),
      assets: assets.rows.map(assetFromRow),
      shots: shots.rows.map(shotFromRow),
    })
  }

  private async mirrorProject(project: Project): Promise<void> {
    this.store.mutateProjectWorkspaceRuntimeCache((state) => upsertProject(state, project))
  }

  private async mirrorAsset(asset: Asset): Promise<void> {
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      upsertAsset(state, asset)
      const project = state.projects.find(
        (item) => item.id === asset.projectId && item.tenantId === asset.tenantId,
      )
      if (project && project.updatedAt < asset.updatedAt) project.updatedAt = asset.updatedAt
    })
  }

  private async mirrorDeletedAsset(projectId: string, assetId: string): Promise<void> {
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      state.assets = state.assets.filter((asset) => asset.id !== assetId || asset.projectId !== projectId)
    })
  }

  private async mirrorShot(shot: Shot): Promise<void> {
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      upsertShot(state, shot)
      const project = state.projects.find(
        (item) => item.id === shot.projectId && item.tenantId === shot.tenantId,
      )
      if (project && project.updatedAt < shot.updatedAt) project.updatedAt = shot.updatedAt
    })
  }

  private async mirrorReplacedShots(projectId: string, shots: Shot[]): Promise<void> {
    this.store.mutateProjectWorkspaceRuntimeCache((state) => {
      const tenantId = shots[0]?.tenantId
      state.shots = state.shots.filter(
        (shot) => shot.projectId !== projectId || (tenantId ? shot.tenantId !== tenantId : false),
      )
      state.shots.push(...shots)
      const project = state.projects.find(
        (item) => item.id === projectId && (!tenantId || item.tenantId === tenantId),
      )
      const latest = shots[0]?.updatedAt
      if (project && latest && project.updatedAt < latest) project.updatedAt = latest
    })
  }
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
      aspect_ratio,
      status,
      synopsis,
      script,
      version,
      created_at,
      updated_at
    )
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
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

async function insertShotFromStore(client: PoolClient, shot: Shot): Promise<boolean> {
  const result = await client.query(
    `
    INSERT INTO shots (
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
      continuity_mode,
      continuity_note,
      created_at,
      updated_at
    )
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
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
  await queryable.query(
    'UPDATE projects SET updated_at = $3 WHERE id = $1 AND tenant_id = $2',
    [projectId, tenantId, updatedAt],
  )
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

function shotInsertParams(shot: Shot): unknown[] {
  return [
    shot.id,
    shot.projectId,
    shot.tenantId,
    shot.order,
    shot.title,
    shot.framing,
    shot.duration,
    shot.prompt,
    shot.negativePrompt,
    shot.imageUrl,
    shot.continuityMode,
    shot.continuityNote,
    shot.createdAt,
    shot.updatedAt,
  ]
}

function upsertProject(state: AppState, project: Project): void {
  const index = state.projects.findIndex((item) => item.id === project.id && item.tenantId === project.tenantId)
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

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerId: row.owner_user_id,
    name: row.name,
    contentType: row.content_type,
    aspectRatio: row.aspect_ratio,
    status: row.status,
    synopsis: row.synopsis,
    script: row.script,
    version: Number(row.version),
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
    order: Number(row.shot_order),
    title: row.title,
    framing: row.framing,
    duration: Number(row.duration_seconds),
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    imageUrl: row.image_url,
    continuityMode: row.continuity_mode,
    continuityNote: row.continuity_note,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
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
