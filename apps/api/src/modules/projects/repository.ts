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
import type { StateStore } from '../../infra/store.js'
import { BILLING_PACKAGES, defaultSubscriptionForTenant } from '../billing/catalog.js'

export interface ProjectStore {
  list(principal: Principal): Promise<Project[]>
  workspace(projectId: string, principal: Principal): Promise<ProjectWorkspace | null>
  create(input: CreateProject, principal: Principal): Promise<Project>
  update(projectId: string, input: UpdateProject, principal: Principal): Promise<Project | null>
  saveVersion(projectId: string, principal: Principal): Promise<Project | null>
  createAsset(projectId: string, input: CreateAsset, principal: Principal): Promise<Asset | null>
  updateAsset(
    projectId: string,
    assetId: string,
    input: UpdateAsset,
    principal: Principal,
  ): Promise<Asset | null>
  deleteAsset(projectId: string, assetId: string, principal: Principal): Promise<boolean>
  createShot(projectId: string, input: CreateShot, principal: Principal): Promise<Shot | null>
  updateShot(projectId: string, shotId: string, input: UpdateShot, principal: Principal): Promise<Shot | null>
  replaceShots(projectId: string, shots: CreateShot[], principal: Principal): Promise<Shot[] | null>
  createShare(
    projectId: string,
    input: CreateProjectShare,
    principal: Principal,
  ): Promise<ProjectShare | null>
  updateShare(
    projectId: string,
    shareId: string,
    input: UpdateProjectShare,
    principal: Principal,
  ): Promise<ProjectShare | null>
  createComment(
    projectId: string,
    input: CreateProjectComment,
    principal: Principal,
  ): Promise<ProjectComment | null>
  reviewComment(
    projectId: string,
    commentId: string,
    input: ReviewProjectComment,
    principal: Principal,
  ): Promise<ProjectComment | null>
}

export class ProjectRepository implements ProjectStore {
  constructor(private readonly store: StateStore) {}

  async list(principal: Principal): Promise<Project[]> {
    return this.store.read((state) =>
      state.projects
        .filter((project) => project.tenantId === principal.tenantId)
        .filter((project) => canAccessProject(state, project, principal, 'read'))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    )
  }

  async workspace(projectId: string, principal: Principal): Promise<ProjectWorkspace | null> {
    return this.store.read((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'read'),
      )
      if (!project) return null
      return {
        project,
        assets: state.assets.filter(
          (asset) => asset.projectId === projectId && asset.tenantId === principal.tenantId,
        ),
        shots: state.shots
          .filter((shot) => shot.projectId === projectId && shot.tenantId === principal.tenantId)
          .sort((left, right) => left.order - right.order),
        collaboration: collaborationSnapshot(state, projectId, principal, project),
      }
    })
  }

  async create(input: CreateProject, principal: Principal): Promise<Project> {
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

  async update(projectId: string, input: UpdateProject, principal: Principal): Promise<Project | null> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'edit'),
      )
      if (!project) return null
      Object.assign(project, input, { updatedAt: new Date().toISOString() })
      return project
    })
  }

  async saveVersion(projectId: string, principal: Principal): Promise<Project | null> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'edit'),
      )
      if (!project) return null
      project.version += 1
      project.updatedAt = new Date().toISOString()
      return project
    })
  }

  async createAsset(projectId: string, input: CreateAsset, principal: Principal): Promise<Asset | null> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'edit'),
      )
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
      state.assets.push(asset)
      project.updatedAt = now
      return asset
    })
  }

  async updateAsset(
    projectId: string,
    assetId: string,
    input: UpdateAsset,
    principal: Principal,
  ): Promise<Asset | null> {
    return this.store.mutate((state) => {
      const ownsProject = state.projects.some(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'edit'),
      )
      const asset = state.assets.find((item) => item.id === assetId && item.projectId === projectId)
      if (!ownsProject || !asset) return null
      if (input.attributes && input.attributes.type !== asset.kind) return null
      Object.assign(asset, input, { updatedAt: new Date().toISOString() })
      return asset
    })
  }

  async deleteAsset(projectId: string, assetId: string, principal: Principal): Promise<boolean> {
    return this.store.mutate((state) => {
      const ownsProject = state.projects.some(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'edit'),
      )
      const index = state.assets.findIndex((item) => item.id === assetId && item.projectId === projectId)
      if (!ownsProject || index < 0) return false
      state.assets.splice(index, 1)
      return true
    })
  }

  async createShot(projectId: string, input: CreateShot, principal: Principal): Promise<Shot | null> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'edit'),
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
        assetIds: input.assetIds ?? [],
        createdAt: now,
        updatedAt: now,
      }
      state.shots.push(shot)
      project.updatedAt = now
      return shot
    })
  }

  async updateShot(
    projectId: string,
    shotId: string,
    input: UpdateShot,
    principal: Principal,
  ): Promise<Shot | null> {
    return this.store.mutate((state) => {
      const ownsProject = state.projects.some(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'edit'),
      )
      const shot = state.shots.find((item) => item.id === shotId && item.projectId === projectId)
      if (!ownsProject || !shot) return null
      Object.assign(shot, input, { updatedAt: new Date().toISOString() })
      return shot
    })
  }

  async replaceShots(projectId: string, shots: CreateShot[], principal: Principal): Promise<Shot[] | null> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'edit'),
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
        assetIds: input.assetIds ?? [],
        createdAt: now,
        updatedAt: now,
      }))
      state.shots.push(...created)
      project.updatedAt = now
      return created
    })
  }

  async createShare(
    projectId: string,
    input: CreateProjectShare,
    principal: Principal,
  ): Promise<ProjectShare | null> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'edit'),
      )
      if (!project) return null

      const now = new Date().toISOString()
      const sharedWithEmail = input.sharedWithEmail?.toLowerCase() ?? null
      const existing = state.projectShares.find(
        (share) =>
          share.projectId === projectId &&
          share.tenantId === principal.tenantId &&
          ((input.sharedWithUserId && share.sharedWithUserId === input.sharedWithUserId) ||
            (sharedWithEmail && share.sharedWithEmail?.toLowerCase() === sharedWithEmail)),
      )
      if (existing) {
        existing.sharedWithUserId = input.sharedWithUserId ?? existing.sharedWithUserId
        existing.sharedWithEmail = sharedWithEmail
        existing.permission = input.permission
        existing.commentApprovalRequired = input.commentApprovalRequired
        existing.status = 'active'
        existing.updatedAt = now
        return existing
      }

      const share: ProjectShare = {
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
      }
      state.projectShares.unshift(share)
      return share
    })
  }

  async updateShare(
    projectId: string,
    shareId: string,
    input: UpdateProjectShare,
    principal: Principal,
  ): Promise<ProjectShare | null> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'edit'),
      )
      if (!project) return null
      const share = state.projectShares.find(
        (item) => item.id === shareId && item.projectId === projectId && item.tenantId === principal.tenantId,
      )
      if (!share) return null
      if (input.permission !== undefined) share.permission = input.permission
      if (input.commentApprovalRequired !== undefined) {
        share.commentApprovalRequired = input.commentApprovalRequired
      }
      if (input.status !== undefined) share.status = input.status
      share.updatedAt = new Date().toISOString()
      return share
    })
  }

  async createComment(
    projectId: string,
    input: CreateProjectComment,
    principal: Principal,
  ): Promise<ProjectComment | null> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'read'),
      )
      if (!project || !canCommentOnProject(state, project, principal)) return null
      const user = currentUser(state, principal)
      if (!user) return null

      const now = new Date().toISOString()
      const share = findShareForPrincipal(state, project, principal)
      const status =
        share?.commentApprovalRequired && !canApproveProjectComments(project, principal)
          ? 'pending'
          : 'approved'
      const comment: ProjectComment = {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        targetType: input.targetType,
        targetId: input.targetId,
        authorUserId: user.id,
        authorName: input.authorName ?? user.name,
        body: input.body,
        status,
        reviewedByUserId: status === 'approved' ? principal.userId : null,
        reviewedAt: status === 'approved' ? now : null,
        createdAt: now,
        updatedAt: now,
      }
      state.projectComments.unshift(comment)
      return comment
    })
  }

  async reviewComment(
    projectId: string,
    commentId: string,
    input: ReviewProjectComment,
    principal: Principal,
  ): Promise<ProjectComment | null> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item, principal, 'read'),
      )
      if (!project || !canApproveProjectComments(project, principal)) return null
      const comment = state.projectComments.find(
        (item) =>
          item.id === commentId && item.projectId === projectId && item.tenantId === principal.tenantId,
      )
      if (!comment) return null
      const now = new Date().toISOString()
      comment.status = input.status
      comment.reviewedByUserId = principal.userId
      comment.reviewedAt = now
      comment.updatedAt = now
      return comment
    })
  }
}

type ProjectAccessMode = 'read' | 'edit'

type StateWithShares = Parameters<StateStore['read']>[0] extends (state: infer T) => unknown ? T : never

function canAccessProject(
  state: Readonly<StateWithShares>,
  project: Project,
  principal: Principal,
  mode: ProjectAccessMode,
): boolean {
  if (principal.roles.some((role) => role === 'admin' || role === 'owner')) return true
  if (project.ownerId === principal.userId) return true

  const share = findShareForPrincipal(state, project, principal)
  if (!share) return false
  if (mode === 'read') return true
  return share.permission === 'edit'
}

function findShareForPrincipal(
  state: Readonly<StateWithShares>,
  project: Project,
  principal: Principal,
): ProjectShare | null {
  const email = currentUser(state, principal)?.email.toLowerCase() ?? ''
  return (
    state.projectShares.find(
      (item) =>
        item.projectId === project.id &&
        item.tenantId === principal.tenantId &&
        item.status === 'active' &&
        (item.sharedWithUserId === principal.userId ||
          Boolean(item.sharedWithEmail && item.sharedWithEmail.toLowerCase() === email)),
    ) ?? null
  )
}

function canCommentOnProject(
  state: Readonly<StateWithShares>,
  project: Project,
  principal: Principal,
): boolean {
  if (principal.roles.some((role) => role === 'admin' || role === 'owner')) return true
  if (project.ownerId === principal.userId) return true
  const share = findShareForPrincipal(state, project, principal)
  return Boolean(share && (share.permission === 'comment' || share.permission === 'edit'))
}

function canApproveProjectComments(project: Project, principal: Principal): boolean {
  if (principal.roles.some((role) => role === 'admin' || role === 'owner' || role === 'creator')) return true
  return project.ownerId === principal.userId
}

function currentUser(state: Readonly<StateWithShares>, principal: Principal) {
  return (
    state.users.find((user) => user.id === principal.userId && user.tenantId === principal.tenantId) ?? null
  )
}

function collaborationSnapshot(
  state: Readonly<StateWithShares>,
  projectId: string,
  principal: Principal,
  project: Project,
): ProjectCollaboration {
  const members = state.users
    .filter((user) => user.tenantId === principal.tenantId)
    .map((user) => workspaceMemberForUser(user, project))
  const shares = state.projectShares
    .filter((share) => share.projectId === projectId && share.tenantId === principal.tenantId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const comments = state.projectComments
    .filter((comment) => comment.projectId === projectId && comment.tenantId === principal.tenantId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const subscription = subscriptionForTenant(state, principal.tenantId, members.length)

  return {
    members,
    shares,
    comments,
    usage: usageSummaryForState(state, principal.tenantId, projectId),
    packages: BILLING_PACKAGES,
    subscription,
    checkoutSessions: state.checkoutSessions
      .filter((session) => session.tenantId === principal.tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  }
}

function workspaceMemberForUser(
  user: {
    id: string
    email: string
    name: string
    tenantId: string
    roles: string[]
    plan: string
    credits: number
  },
  project: Project,
): WorkspaceMember {
  const isOwner = user.roles.includes('owner')
  const canManageBilling = isOwner || user.roles.includes('admin')
  const canApproveComments = isOwner || user.roles.includes('admin') || user.roles.includes('creator')
  return {
    id: user.id,
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    roles: user.roles as WorkspaceMember['roles'],
    plan: user.plan as WorkspaceMember['plan'],
    credits: user.credits,
    canManageBilling,
    canApproveComments,
    isOwner,
    status: 'active',
    joinedAt: project.createdAt,
  }
}

function subscriptionForTenant(
  state: Readonly<StateWithShares>,
  tenantId: string,
  activeSeats: number,
): ProjectCollaboration['subscription'] {
  const stored = state.subscriptions.find((item) => item.tenantId === tenantId)
  if (!stored) {
    const fallback = defaultSubscriptionForTenant(tenantId)
    return { ...fallback, activeSeats, seatLimit: fallback.seatLimit }
  }
  return {
    ...stored,
    activeSeats,
    seatLimit: stored.seatLimit,
  }
}

function usageSummaryForState(
  state: Readonly<StateWithShares>,
  tenantId: string,
  projectId: string,
): ProjectCollaboration['usage'] {
  const tenantTasks = state.tasks.filter((task) => task.tenantId === tenantId)
  const tenantLedger = state.ledger.filter((entry) => entry.tenantId === tenantId)
  const tenantShares = state.projectShares.filter(
    (share) => share.tenantId === tenantId && share.status === 'active',
  )
  const tenantComments = state.projectComments.filter(
    (comment) => comment.tenantId === tenantId && comment.projectId === projectId,
  )
  const watermarkTasks = tenantTasks.filter((task) => Boolean(task.metadata?.watermark)).length

  return {
    generatedAt: new Date().toISOString(),
    periodDays: 30,
    creditsSpent: Math.abs(
      tenantLedger.filter((entry) => entry.amount < 0).reduce((total, entry) => total + entry.amount, 0),
    ),
    tasksCreated: tenantTasks.length,
    imageTasks: tenantTasks.filter((task) => task.kind === 'image').length,
    videoTasks: tenantTasks.filter((task) => task.kind === 'video').length,
    audioTasks: tenantTasks.filter((task) => task.kind === 'audio').length,
    activeShares: tenantShares.length,
    pendingComments: tenantComments.filter((comment) => comment.status === 'pending').length,
    activeMembers: state.users.filter((user) => user.tenantId === tenantId).length,
    watermarkTasks,
  }
}
