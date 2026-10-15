import type {
  Asset,
  CreateAsset,
  CreateProject,
  CreateShot,
  CreateProjectComment,
  CreateProjectShare,
  Principal,
  Project,
  ProjectComment,
  ProjectWorkspace,
  ProjectCollaboration,
  ProjectShare,
  Shot,
  ReviewProjectComment,
  UpdateAsset,
  UpdateProject,
  UpdateProjectShare,
  UpdateShot,
  WorkspaceMember,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { AppError } from '../../core/errors.js'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import { BILLING_PACKAGES, defaultSubscriptionForTenant } from '../billing/catalog.js'
import {
  ASSET_COLUMNS,
  CHECKOUT_SESSION_COLUMNS,
  PROJECT_COLUMNS,
  PROJECT_COMMENT_COLUMNS,
  PROJECT_SHARE_COLUMNS,
  SHOT_COLUMNS,
  SUBSCRIPTION_COLUMNS,
  assetFromRow,
  checkoutSessionFromRow,
  projectFromRow,
  projectCommentFromRow,
  projectShareFromRow,
  subscriptionFromRow,
  shotFromRow,
  type AssetRow,
  type CheckoutSessionRow,
  type ProjectRow,
  type ProjectCommentRow,
  type ProjectShareRow,
  type SubscriptionRow,
  type ShotRow,
} from '../../infra/postgresRows.js'
import type { ProjectStore } from './repository.js'

export class PostgresProjectRepository implements ProjectStore {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async list(principal: Principal): Promise<Project[]> {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query<ProjectRow>(
        `
          select ${PROJECT_COLUMNS}
          from projects
          where tenant_id = $1
          order by updated_at desc, id
        `,
        [principal.tenantId],
      )
      const permissions = await projectAccessRows(client, principal)
      return result.rows
        .map(projectFromRow)
        .filter((project) => canAccessProject(project, principal, permissions, 'read'))
    })
  }

  async workspace(projectId: string, principal: Principal): Promise<ProjectWorkspace | null> {
    return this.transactions.withTransaction(async (client) => {
      const permissions = await projectAccessRows(client, principal)
      const project = await readableProject(client, projectId, principal, permissions)
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
        collaboration: await collaborationSnapshot(client, projectId, principal, project),
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
      const permissions = await projectAccessRows(client, principal)
      const project = await lockedEditableProject(client, projectId, principal, permissions)
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
      const permissions = await projectAccessRows(client, principal)
      const project = await lockedEditableProject(client, projectId, principal, permissions)
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
      const permissions = await projectAccessRows(client, principal)
      const project = await lockedEditableProject(client, projectId, principal, permissions)
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
      const permissions = await projectAccessRows(client, principal)
      const project = await lockedEditableProject(client, projectId, principal, permissions)
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
      const permissions = await projectAccessRows(client, principal)
      const project = await lockedEditableProject(client, projectId, principal, permissions)
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
      const permissions = await projectAccessRows(client, principal)
      const project = await lockedEditableProject(client, projectId, principal, permissions)
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
      const permissions = await projectAccessRows(client, principal)
      const project = await lockedEditableProject(client, projectId, principal, permissions)
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
      const permissions = await projectAccessRows(client, principal)
      const project = await lockedEditableProject(client, projectId, principal, permissions)
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

  async createShare(
    projectId: string,
    input: CreateProjectShare,
    principal: Principal,
  ): Promise<ProjectShare | null> {
    return this.transactions.withTransaction(async (client) => {
      const permissions = await projectAccessRows(client, principal)
      const project = await lockedEditableProject(client, projectId, principal, permissions)
      if (!project) return null

      const now = new Date().toISOString()
      const sharedWithEmail = input.sharedWithEmail?.toLowerCase() ?? null
      const existing = await findExistingProjectShare(
        client,
        projectId,
        principal.tenantId,
        input.sharedWithUserId ?? null,
        sharedWithEmail,
      )
      if (existing) {
        return saveProjectShare(client, {
          ...existing,
          sharedWithUserId: input.sharedWithUserId ?? existing.sharedWithUserId,
          sharedWithEmail,
          permission: input.permission,
          commentApprovalRequired: input.commentApprovalRequired,
          status: 'active',
          updatedAt: now,
        })
      }

      return insertProjectShare(client, {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        sharedWithUserId: input.sharedWithUserId ?? null,
        sharedWithEmail,
        permission: input.permission,
        commentApprovalRequired: input.commentApprovalRequired,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
    })
  }

  async updateShare(
    projectId: string,
    shareId: string,
    input: UpdateProjectShare,
    principal: Principal,
  ): Promise<ProjectShare | null> {
    return this.transactions.withTransaction(async (client) => {
      const permissions = await projectAccessRows(client, principal)
      const project = await lockedEditableProject(client, projectId, principal, permissions)
      if (!project) return null
      const share = await lockedProjectShare(client, projectId, shareId, principal.tenantId)
      if (!share) return null
      return saveProjectShare(client, {
        ...share,
        ...(stripUndefined(input) as Partial<ProjectShare>),
        updatedAt: new Date().toISOString(),
      })
    })
  }

  async createComment(
    projectId: string,
    input: CreateProjectComment,
    principal: Principal,
  ): Promise<ProjectComment | null> {
    return this.transactions.withTransaction(async (client) => {
      const permissions = await projectAccessRows(client, principal)
      const project = await readableProject(client, projectId, principal, permissions)
      if (!project) return null
      const share = await projectShareForPrincipal(client, projectId, principal)
      if (!canCommentOnProject(project, principal, share)) return null
      const user = await currentUser(client, principal)
      if (!user) return null

      const now = new Date().toISOString()
      const status =
        share?.commentApprovalRequired && !canApproveProjectComments(project, principal)
          ? 'pending'
          : 'approved'
      const result = await client.query<ProjectCommentRow>(
        `
          insert into project_comments (
            id, project_id, tenant_id, target_type, target_id, author_user_id,
            author_name, body, status, reviewed_by_user_id, reviewed_at,
            created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
          returning ${PROJECT_COMMENT_COLUMNS}
        `,
        [
          randomUUID(),
          projectId,
          principal.tenantId,
          input.targetType,
          input.targetId,
          user.id,
          input.authorName ?? user.name,
          input.body,
          status,
          status === 'approved' ? principal.userId : null,
          status === 'approved' ? now : null,
          now,
        ],
      )
      return projectCommentFromRow(result.rows[0]!)
    })
  }

  async reviewComment(
    projectId: string,
    commentId: string,
    input: ReviewProjectComment,
    principal: Principal,
  ): Promise<ProjectComment | null> {
    return this.transactions.withTransaction(async (client) => {
      const permissions = await projectAccessRows(client, principal)
      const project = await readableProject(client, projectId, principal, permissions)
      if (!project || !canApproveProjectComments(project, principal)) return null
      const now = new Date().toISOString()
      const result = await client.query<ProjectCommentRow>(
        `
          update project_comments
          set status = $4,
            reviewed_by_user_id = $5,
            reviewed_at = $6,
            updated_at = $6
          where id = $1 and project_id = $2 and tenant_id = $3
          returning ${PROJECT_COMMENT_COLUMNS}
        `,
        [commentId, projectId, principal.tenantId, input.status, principal.userId, now],
      )
      return result.rows[0] ? projectCommentFromRow(result.rows[0]) : null
    })
  }
}

async function projectAccessRows(
  client: PoolClient,
  principal: Principal,
): Promise<Map<string, ProjectShareRow['permission']>> {
  if (principal.roles.some((role) => role === 'admin' || role === 'owner')) return new Map()
  const user = await currentUser(client, principal)
  const email = typeof user?.email === 'string' ? user.email.toLowerCase() : ''
  const result = await client.query<ProjectShareRow>(
    `
      select ${PROJECT_SHARE_COLUMNS}
      from project_shares
      where tenant_id = $1
        and status = 'active'
        and (
          shared_with_user_id = $2
          or lower(shared_with_email) = $3
        )
    `,
    [principal.tenantId, principal.userId, email],
  )
  return new Map(result.rows.map((row) => [row.projectId, row.permission]))
}

function canAccessProject(
  project: Project,
  principal: Principal,
  permissions: Map<string, ProjectShareRow['permission']>,
  mode: 'read' | 'edit',
): boolean {
  if (principal.roles.some((role) => role === 'admin' || role === 'owner')) return true
  if (project.ownerId === principal.userId) return true
  const permission = permissions.get(project.id)
  if (!permission) return false
  return mode === 'read' ? true : permission === 'edit'
}

async function readableProject(
  client: PoolClient,
  projectId: string,
  principal: Principal,
  permissions: Map<string, ProjectShareRow['permission']>,
): Promise<Project | null> {
  const result = await client.query<ProjectRow>(
    `
      select ${PROJECT_COLUMNS}
      from projects
      where id = $1 and tenant_id = $2
    `,
    [projectId, principal.tenantId],
  )
  const project = result.rows[0] ? projectFromRow(result.rows[0]) : null
  if (!project || !canAccessProject(project, principal, permissions, 'read')) return null
  return project
}

async function lockedEditableProject(
  client: PoolClient,
  projectId: string,
  principal: Principal,
  permissions: Map<string, ProjectShareRow['permission']>,
): Promise<Project | null> {
  const result = await client.query<ProjectRow>(
    `
      select ${PROJECT_COLUMNS}
      from projects
      where id = $1 and tenant_id = $2
      for update
    `,
    [projectId, principal.tenantId],
  )
  const project = result.rows[0] ? projectFromRow(result.rows[0]) : null
  if (!project || !canAccessProject(project, principal, permissions, 'edit')) return null
  return project
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

async function currentUser(client: PoolClient, principal: Principal) {
  const result = await client.query<UserLookupRow>(
    `
      select id, email, name
      from users
      where id = $1 and tenant_id = $2
    `,
    [principal.userId, principal.tenantId],
  )
  return result.rows[0] ?? null
}

type UserLookupRow = {
  id: string
  email: string
  name: string
}

async function projectShareForPrincipal(
  client: PoolClient,
  projectId: string,
  principal: Principal,
): Promise<ProjectShare | null> {
  const user = await currentUser(client, principal)
  const email = typeof user?.email === 'string' ? user.email.toLowerCase() : ''
  const result = await client.query<ProjectShareRow>(
    `
      select ${PROJECT_SHARE_COLUMNS}
      from project_shares
      where project_id = $1
        and tenant_id = $2
        and status = 'active'
        and (
          shared_with_user_id = $3
          or lower(shared_with_email) = $4
        )
      order by updated_at desc, id
      limit 1
    `,
    [projectId, principal.tenantId, principal.userId, email],
  )
  return result.rows[0] ? projectShareFromRow(result.rows[0]) : null
}

function canCommentOnProject(project: Project, principal: Principal, share: ProjectShare | null): boolean {
  if (principal.roles.some((role) => role === 'admin' || role === 'owner')) return true
  if (project.ownerId === principal.userId) return true
  return Boolean(share && (share.permission === 'comment' || share.permission === 'edit'))
}

function canApproveProjectComments(project: Project, principal: Principal): boolean {
  if (principal.roles.some((role) => role === 'admin' || role === 'owner' || role === 'creator')) return true
  return project.ownerId === principal.userId
}

async function findExistingProjectShare(
  client: PoolClient,
  projectId: string,
  tenantId: string,
  sharedWithUserId: string | null,
  sharedWithEmail: string | null,
): Promise<ProjectShare | null> {
  const result = await client.query<ProjectShareRow>(
    `
      select ${PROJECT_SHARE_COLUMNS}
      from project_shares
      where project_id = $1
        and tenant_id = $2
        and (
          ($3::text is not null and shared_with_user_id = $3)
          or ($4::text is not null and lower(shared_with_email) = $4)
        )
      for update
    `,
    [projectId, tenantId, sharedWithUserId, sharedWithEmail],
  )
  return result.rows[0] ? projectShareFromRow(result.rows[0]) : null
}

async function lockedProjectShare(
  client: PoolClient,
  projectId: string,
  shareId: string,
  tenantId: string,
): Promise<ProjectShare | null> {
  const result = await client.query<ProjectShareRow>(
    `
      select ${PROJECT_SHARE_COLUMNS}
      from project_shares
      where id = $1 and project_id = $2 and tenant_id = $3
      for update
    `,
    [shareId, projectId, tenantId],
  )
  return result.rows[0] ? projectShareFromRow(result.rows[0]) : null
}

async function insertProjectShare(client: PoolClient, share: ProjectShare): Promise<ProjectShare> {
  const result = await client.query<ProjectShareRow>(
    `
      insert into project_shares (
        id, project_id, tenant_id, shared_with_user_id, shared_with_email,
        permission, comment_approval_required, status, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning ${PROJECT_SHARE_COLUMNS}
    `,
    projectShareParams(share),
  )
  return projectShareFromRow(result.rows[0]!)
}

async function saveProjectShare(client: PoolClient, share: ProjectShare): Promise<ProjectShare> {
  const result = await client.query<ProjectShareRow>(
    `
      update project_shares
      set shared_with_user_id = $4,
        shared_with_email = $5,
        permission = $6,
        comment_approval_required = $7,
        status = $8,
        updated_at = $9
      where id = $1 and project_id = $2 and tenant_id = $3
      returning ${PROJECT_SHARE_COLUMNS}
    `,
    projectShareUpdateParams(share),
  )
  return projectShareFromRow(result.rows[0]!)
}

function projectShareParams(share: ProjectShare): unknown[] {
  return [
    share.id,
    share.projectId,
    share.tenantId,
    share.sharedWithUserId,
    share.sharedWithEmail,
    share.permission,
    share.commentApprovalRequired,
    share.status,
    share.createdAt,
    share.updatedAt,
  ]
}

function projectShareUpdateParams(share: ProjectShare): unknown[] {
  return [
    share.id,
    share.projectId,
    share.tenantId,
    share.sharedWithUserId,
    share.sharedWithEmail,
    share.permission,
    share.commentApprovalRequired,
    share.status,
    share.updatedAt,
  ]
}

async function collaborationSnapshot(
  client: PoolClient,
  projectId: string,
  principal: Principal,
  project: Project,
): Promise<ProjectCollaboration> {
  const members = await client.query<WorkspaceMemberRow>(
    `
      select id, email, name, tenant_id as "tenantId", roles, plan, credits
      from users
      where tenant_id = $1
      order by created_at, id
    `,
    [principal.tenantId],
  )
  const shares = await client.query<ProjectShareRow>(
    `
      select ${PROJECT_SHARE_COLUMNS}
      from project_shares
      where project_id = $1 and tenant_id = $2
      order by updated_at desc, id
    `,
    [projectId, principal.tenantId],
  )
  const comments = await client.query<ProjectCommentRow>(
    `
      select ${PROJECT_COMMENT_COLUMNS}
      from project_comments
      where project_id = $1 and tenant_id = $2
      order by created_at desc, id
    `,
    [projectId, principal.tenantId],
  )
  const subscription = await subscriptionForTenant(client, principal.tenantId)
  const checkoutSessions = await client.query<CheckoutSessionRow>(
    `
      select ${CHECKOUT_SESSION_COLUMNS}
      from billing_checkout_sessions
      where tenant_id = $1
      order by created_at desc, id
    `,
    [principal.tenantId],
  )

  return {
    members: members.rows.map((user) => workspaceMemberFromRow(user, project)),
    shares: shares.rows.map(projectShareFromRow),
    comments: comments.rows.map(projectCommentFromRow),
    usage: await usageSummaryForTenant(client, principal.tenantId, projectId),
    packages: BILLING_PACKAGES,
    subscription,
    checkoutSessions: checkoutSessions.rows.map(checkoutSessionFromRow),
  }
}

type WorkspaceMemberRow = {
  id: string
  email: string
  name: string
  tenantId: string
  roles: string[]
  plan: string
  credits: number
}

function workspaceMemberFromRow(row: WorkspaceMemberRow, project: Project): WorkspaceMember {
  const isOwner = row.roles.includes('owner')
  const canManageBilling = isOwner || row.roles.includes('admin')
  const canApproveComments = isOwner || row.roles.includes('admin') || row.roles.includes('creator')
  return {
    id: row.id,
    userId: row.id,
    tenantId: row.tenantId,
    email: row.email,
    name: row.name,
    roles: row.roles as WorkspaceMember['roles'],
    plan: row.plan as WorkspaceMember['plan'],
    credits: row.credits,
    canManageBilling,
    canApproveComments,
    isOwner,
    status: 'active',
    joinedAt: project.createdAt,
  }
}

async function subscriptionForTenant(
  client: PoolClient,
  tenantId: string,
): Promise<ProjectCollaboration['subscription']> {
  const result = await client.query<SubscriptionRow>(
    `
      select ${SUBSCRIPTION_COLUMNS}
      from billing_subscriptions
      where tenant_id = $1
    `,
    [tenantId],
  )
  const subscription = result.rows[0]
    ? subscriptionFromRow(result.rows[0])
    : defaultSubscriptionForTenant(tenantId)
  return {
    ...subscription,
    activeSeats: await activeSeatCount(client, tenantId),
  }
}

async function activeSeatCount(client: PoolClient, tenantId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `
      select count(*)::text as count
      from users
      where tenant_id = $1
    `,
    [tenantId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function usageSummaryForTenant(
  client: PoolClient,
  tenantId: string,
  projectId: string,
): Promise<ProjectCollaboration['usage']> {
  const credits = await client.query<{ total: string | null }>(
    `
      select coalesce(sum(amount), 0)::text as total
      from ledger_entries
      where tenant_id = $1 and amount < 0
    `,
    [tenantId],
  )
  const tasks = await client.query<{ kind: string; count: string }>(
    `
      select kind, count(*)::text as count
      from generation_tasks
      where tenant_id = $1
      group by kind
    `,
    [tenantId],
  )
  const watermarkTasks = await client.query<{ count: string }>(
    `
      select count(*)::text as count
      from generation_tasks
      where tenant_id = $1
        and coalesce((metadata->>'watermark')::boolean, false) = true
    `,
    [tenantId],
  )
  const shares = await client.query<{ count: string }>(
    `
      select count(*)::text as count
      from project_shares
      where tenant_id = $1 and status = 'active'
    `,
    [tenantId],
  )
  const comments = await client.query<{ count: string }>(
    `
      select count(*)::text as count
      from project_comments
      where tenant_id = $1 and project_id = $2 and status = 'pending'
    `,
    [tenantId, projectId],
  )
  const members = await activeSeatCount(client, tenantId)

  const taskCounts = new Map(tasks.rows.map((row) => [row.kind, Number(row.count ?? 0)]))
  return {
    generatedAt: new Date().toISOString(),
    periodDays: 30,
    creditsSpent: Math.abs(Number(credits.rows[0]?.total ?? 0)),
    tasksCreated: [...taskCounts.values()].reduce((total, value) => total + value, 0),
    imageTasks: taskCounts.get('image') ?? 0,
    videoTasks: taskCounts.get('video') ?? 0,
    audioTasks: taskCounts.get('audio') ?? 0,
    activeShares: Number(shares.rows[0]?.count ?? 0),
    pendingComments: Number(comments.rows[0]?.count ?? 0),
    activeMembers: members,
    watermarkTasks: Number(watermarkTasks.rows[0]?.count ?? 0),
  }
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

function stripUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}
