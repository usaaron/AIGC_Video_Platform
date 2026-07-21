import type {
  Asset,
  CreateAsset,
  CreateProject,
  CreateShot,
  Principal,
  Project,
  ProjectWorkspace,
  Shot,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { AppError } from '../../core/errors.js'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import {
  ASSET_COLUMNS,
  PROJECT_COLUMNS,
  SHOT_COLUMNS,
  assetFromRow,
  projectFromRow,
  shotFromRow,
  type AssetRow,
  type ProjectRow,
  type ShotRow,
} from '../../infra/postgresRows.js'
import type { ProjectStore } from './repository.js'

export class PostgresProjectRepository implements ProjectStore {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async list(principal: Principal): Promise<Project[]> {
    return this.transactions.withTransaction(async (client) => {
      const canReadAll = canReadTenantProjects(principal)
      const result = await client.query<ProjectRow>(
        `
          select ${PROJECT_COLUMNS}
          from projects
          where tenant_id = $1
            and ($2::boolean or owner_id = $3)
          order by updated_at desc, id
        `,
        [principal.tenantId, canReadAll, principal.userId],
      )
      return result.rows.map(projectFromRow)
    })
  }

  async workspace(projectId: string, principal: Principal): Promise<ProjectWorkspace | null> {
    return this.transactions.withTransaction(async (client) => {
      const project = await readableProject(client, projectId, principal)
      if (!project) return null

      const assets = await client.query<AssetRow>(
        `
          select ${ASSET_COLUMNS}
          from assets
          where project_id = $1 and tenant_id = $2
          order by updated_at desc, id
        `,
        [projectId, principal.tenantId],
      )
      const shots = await client.query<ShotRow>(
        `
          select ${SHOT_COLUMNS}
          from shots
          where project_id = $1 and tenant_id = $2
          order by order_index, id
        `,
        [projectId, principal.tenantId],
      )

      return {
        project,
        assets: assets.rows.map(assetFromRow),
        shots: shots.rows.map(shotFromRow),
      }
    })
  }

  async create(input: CreateProject, principal: Principal): Promise<Project> {
    return this.transactions.withTransaction(async (client) => {
      const account = await client.query<{ id: string }>(
        `
          select id
          from users
          where id = $1 and tenant_id = $2
          for key share
        `,
        [principal.userId, principal.tenantId],
      )
      if (!account.rows[0]) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account not found')

      const now = new Date().toISOString()
      const result = await client.query<ProjectRow>(
        `
          insert into projects (
            id, tenant_id, owner_id, name, content_type, aspect_ratio, status,
            synopsis, script, version, created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, 'draft', '', '', 1, $7, $7)
          returning ${PROJECT_COLUMNS}
        `,
        [
          randomUUID(),
          principal.tenantId,
          principal.userId,
          input.name,
          input.contentType,
          input.aspectRatio,
          now,
        ],
      )
      return projectFromRow(result.rows[0]!)
    })
  }

  async update(projectId: string, input: UpdateProject, principal: Principal): Promise<Project | null> {
    return this.transactions.withTransaction(async (client) => {
      const project = await lockedOwnedProject(client, projectId, principal)
      if (!project) return null
      const next: Project = {
        ...project,
        ...(stripUndefined(input) as Partial<Project>),
        updatedAt: new Date().toISOString(),
      }
      return updateProjectRow(client, next)
    })
  }

  async saveVersion(projectId: string, principal: Principal): Promise<Project | null> {
    return this.transactions.withTransaction(async (client) => {
      const project = await lockedOwnedProject(client, projectId, principal)
      if (!project) return null
      return updateProjectRow(client, {
        ...project,
        version: project.version + 1,
        updatedAt: new Date().toISOString(),
      })
    })
  }

  async createAsset(projectId: string, input: CreateAsset, principal: Principal): Promise<Asset | null> {
    return this.transactions.withTransaction(async (client) => {
      const project = await lockedOwnedProject(client, projectId, principal)
      if (!project) return null

      const now = new Date().toISOString()
      const asset: Asset = {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        ...input,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      }
      const created = await insertAsset(client, asset)
      await touchProject(client, project.id, project.tenantId, now)
      return created
    })
  }

  async updateAsset(
    projectId: string,
    assetId: string,
    input: UpdateAsset,
    principal: Principal,
  ): Promise<Asset | null> {
    return this.transactions.withTransaction(async (client) => {
      const project = await lockedOwnedProject(client, projectId, principal)
      if (!project) return null
      const asset = await lockedAsset(client, projectId, assetId, principal.tenantId)
      if (!asset) return null
      if (input.attributes && input.attributes.type !== asset.kind) return null

      const now = new Date().toISOString()
      const next: Asset = {
        ...asset,
        ...(stripUndefined(input) as Partial<Asset>),
        updatedAt: now,
      }
      const updated = await updateAssetRow(client, next)
      await touchProject(client, project.id, project.tenantId, now)
      return updated
    })
  }

  async deleteAsset(projectId: string, assetId: string, principal: Principal): Promise<boolean> {
    return this.transactions.withTransaction(async (client) => {
      const project = await lockedOwnedProject(client, projectId, principal)
      if (!project) return false
      const result = await client.query<{ id: string }>(
        `
          delete from assets
          where id = $1 and project_id = $2 and tenant_id = $3
          returning id
        `,
        [assetId, projectId, principal.tenantId],
      )
      if (!result.rows[0]) return false
      await touchProject(client, project.id, project.tenantId, new Date().toISOString())
      return true
    })
  }

  async createShot(projectId: string, input: CreateShot, principal: Principal): Promise<Shot | null> {
    return this.transactions.withTransaction(async (client) => {
      const project = await lockedOwnedProject(client, projectId, principal)
      if (!project) return null
      const order = await nextShotOrder(client, projectId, principal.tenantId)
      const now = new Date().toISOString()
      const shot = await insertShot(client, {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        order,
        ...input,
        assetIds: input.assetIds ?? [],
        createdAt: now,
        updatedAt: now,
      })
      await touchProject(client, project.id, project.tenantId, now)
      return shot
    })
  }

  async updateShot(
    projectId: string,
    shotId: string,
    input: UpdateShot,
    principal: Principal,
  ): Promise<Shot | null> {
    return this.transactions.withTransaction(async (client) => {
      const project = await lockedOwnedProject(client, projectId, principal)
      if (!project) return null
      const shot = await lockedShot(client, projectId, shotId, principal.tenantId)
      if (!shot) return null
      const now = new Date().toISOString()
      const next: Shot = {
        ...shot,
        ...(stripUndefined(input) as Partial<Shot>),
        assetIds: input.assetIds ?? shot.assetIds,
        updatedAt: now,
      }
      const updated = await updateShotRow(client, next)
      await touchProject(client, project.id, project.tenantId, now)
      return updated
    })
  }

  async replaceShots(projectId: string, shots: CreateShot[], principal: Principal): Promise<Shot[] | null> {
    return this.transactions.withTransaction(async (client) => {
      const project = await lockedOwnedProject(client, projectId, principal)
      if (!project) return null
      const now = new Date().toISOString()
      await client.query('delete from shots where project_id = $1 and tenant_id = $2', [
        projectId,
        principal.tenantId,
      ])
      const created: Shot[] = []
      for (const [index, input] of shots.entries()) {
        created.push(
          await insertShot(client, {
            id: randomUUID(),
            projectId,
            tenantId: principal.tenantId,
            order: index + 1,
            ...input,
            assetIds: input.assetIds ?? [],
            createdAt: now,
            updatedAt: now,
          }),
        )
      }
      await touchProject(client, project.id, project.tenantId, now)
      return created
    })
  }
}

async function readableProject(
  client: PoolClient,
  projectId: string,
  principal: Principal,
): Promise<Project | null> {
  const canReadAll = canReadTenantProjects(principal)
  const result = await client.query<ProjectRow>(
    `
      select ${PROJECT_COLUMNS}
      from projects
      where id = $1
        and tenant_id = $2
        and ($3::boolean or owner_id = $4)
    `,
    [projectId, principal.tenantId, canReadAll, principal.userId],
  )
  return result.rows[0] ? projectFromRow(result.rows[0]) : null
}

async function lockedOwnedProject(
  client: PoolClient,
  projectId: string,
  principal: Principal,
): Promise<Project | null> {
  const result = await client.query<ProjectRow>(
    `
      select ${PROJECT_COLUMNS}
      from projects
      where id = $1 and tenant_id = $2 and owner_id = $3
      for update
    `,
    [projectId, principal.tenantId, principal.userId],
  )
  return result.rows[0] ? projectFromRow(result.rows[0]) : null
}

async function lockedAsset(
  client: PoolClient,
  projectId: string,
  assetId: string,
  tenantId: string,
): Promise<Asset | null> {
  const result = await client.query<AssetRow>(
    `
      select ${ASSET_COLUMNS}
      from assets
      where id = $1 and project_id = $2 and tenant_id = $3
      for update
    `,
    [assetId, projectId, tenantId],
  )
  return result.rows[0] ? assetFromRow(result.rows[0]) : null
}

async function lockedShot(
  client: PoolClient,
  projectId: string,
  shotId: string,
  tenantId: string,
): Promise<Shot | null> {
  const result = await client.query<ShotRow>(
    `
      select ${SHOT_COLUMNS}
      from shots
      where id = $1 and project_id = $2 and tenant_id = $3
      for update
    `,
    [shotId, projectId, tenantId],
  )
  return result.rows[0] ? shotFromRow(result.rows[0]) : null
}

async function nextShotOrder(client: PoolClient, projectId: string, tenantId: string): Promise<number> {
  const result = await client.query<{ order: number | null }>(
    `
      select max(order_index) as "order"
      from shots
      where project_id = $1 and tenant_id = $2
    `,
    [projectId, tenantId],
  )
  return (result.rows[0]?.order ?? 0) + 1
}

async function updateProjectRow(client: PoolClient, project: Project): Promise<Project> {
  const result = await client.query<ProjectRow>(
    `
      update projects
      set name = $1,
        content_type = $2,
        aspect_ratio = $3,
        status = $4,
        synopsis = $5,
        script = $6,
        version = $7,
        updated_at = $8
      where id = $9 and tenant_id = $10
      returning ${PROJECT_COLUMNS}
    `,
    [
      project.name,
      project.contentType,
      project.aspectRatio,
      project.status,
      project.synopsis,
      project.script,
      project.version,
      project.updatedAt,
      project.id,
      project.tenantId,
    ],
  )
  return projectFromRow(result.rows[0]!)
}

async function insertAsset(client: PoolClient, asset: Asset): Promise<Asset> {
  const result = await client.query<AssetRow>(
    `
      insert into assets (
        id, project_id, tenant_id, kind, source_mode, name, description,
        prompt, prompt_mode, custom_prompt_mode, custom_prompt,
        negative_prompt, "references", attributes, image_url, status,
        created_at, updated_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13::jsonb, $14::jsonb, $15, $16, $17, $18
      )
      returning ${ASSET_COLUMNS}
    `,
    assetParams(asset),
  )
  return assetFromRow(result.rows[0]!)
}

async function updateAssetRow(client: PoolClient, asset: Asset): Promise<Asset> {
  const result = await client.query<AssetRow>(
    `
      update assets
      set source_mode = $5,
        name = $6,
        description = $7,
        prompt = $8,
        prompt_mode = $9,
        custom_prompt_mode = $10,
        custom_prompt = $11,
        negative_prompt = $12,
        "references" = $13::jsonb,
        attributes = $14::jsonb,
        image_url = $15,
        status = $16,
        updated_at = $17
      where id = $1 and project_id = $2 and tenant_id = $3 and kind = $4
      returning ${ASSET_COLUMNS}
    `,
    assetUpdateParams(asset),
  )
  return assetFromRow(result.rows[0]!)
}

function assetParams(asset: Asset): unknown[] {
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

function assetUpdateParams(asset: Asset): unknown[] {
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
    asset.updatedAt,
  ]
}

async function insertShot(client: PoolClient, shot: Shot): Promise<Shot> {
  const result = await client.query<ShotRow>(
    `
      insert into shots (
        id, project_id, tenant_id, order_index, title, framing,
        duration, prompt, asset_ids, image_url, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      returning ${SHOT_COLUMNS}
    `,
    shotParams(shot),
  )
  return shotFromRow(result.rows[0]!)
}

async function updateShotRow(client: PoolClient, shot: Shot): Promise<Shot> {
  const result = await client.query<ShotRow>(
    `
      update shots
      set order_index = $4,
        title = $5,
        framing = $6,
        duration = $7,
        prompt = $8,
        asset_ids = $9,
        image_url = $10,
        updated_at = $11
      where id = $1 and project_id = $2 and tenant_id = $3
      returning ${SHOT_COLUMNS}
    `,
    shotUpdateParams(shot),
  )
  return shotFromRow(result.rows[0]!)
}

function shotParams(shot: Shot): unknown[] {
  return [
    shot.id,
    shot.projectId,
    shot.tenantId,
    shot.order,
    shot.title,
    shot.framing,
    shot.duration,
    shot.prompt,
    shot.assetIds,
    shot.imageUrl,
    shot.createdAt,
    shot.updatedAt,
  ]
}

function shotUpdateParams(shot: Shot): unknown[] {
  return [
    shot.id,
    shot.projectId,
    shot.tenantId,
    shot.order,
    shot.title,
    shot.framing,
    shot.duration,
    shot.prompt,
    shot.assetIds,
    shot.imageUrl,
    shot.updatedAt,
  ]
}

async function touchProject(
  client: PoolClient,
  projectId: string,
  tenantId: string,
  now: string,
): Promise<void> {
  await client.query(
    `
      update projects
      set updated_at = $1
      where id = $2 and tenant_id = $3
    `,
    [now, projectId, tenantId],
  )
}

function canReadTenantProjects(principal: Principal): boolean {
  return principal.roles.some((role) => role === 'admin' || role === 'owner')
}

function stripUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}
