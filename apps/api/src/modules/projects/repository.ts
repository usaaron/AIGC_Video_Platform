import type {
  Asset,
  CreateAsset,
  CreateProject,
  CreateShot,
  Principal,
  Plan,
  Project,
  ProjectGenerationSummary,
  ProjectWorkspace,
  Shot,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { AppState, AppStore } from '../../infra/store.js'

export class ProjectRepository {
  constructor(private readonly store: AppStore) {}

  planFor(principal: Principal): Plan | null {
    return this.store.read(
      (state) =>
        state.users.find((user) => user.id === principal.userId && user.tenantId === principal.tenantId)
          ?.plan ?? null,
    )
  }

  list(principal: Principal): Project[] {
    const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
    return this.store.read((state) =>
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

  workspace(projectId: string, principal: Principal): ProjectWorkspace | null {
    const project = this.list(principal).find((item) => item.id === projectId)
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

  async create(input: CreateProject, principal: Principal): Promise<Project> {
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
    return this.store.mutate((state) => {
      state.projects.push(project)
      return project
    })
  }

  async update(projectId: string, input: UpdateProject, principal: Principal): Promise<Project | null> {
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

  async archive(projectId: string, principal: Principal): Promise<boolean> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) return false
      project.status = 'archived'
      project.updatedAt = new Date().toISOString()
      return true
    })
  }

  async saveVersion(projectId: string, principal: Principal): Promise<Project | null> {
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

  async createAsset(projectId: string, input: CreateAsset, principal: Principal): Promise<Asset | null> {
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
        attributes: enforceProjectVisualStyle(input.attributes, project.visualStyle ?? 'cinematic-cg'),
        customPromptMode: 'replace',
        status: input.sourceMode === 'import' ? 'confirmed' : 'draft',
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
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      const asset = state.assets.find((item) => item.id === assetId && item.projectId === projectId)
      if (!project || !asset) return null
      if (input.attributes && input.attributes.type !== asset.kind) return null
      Object.assign(asset, input, {
        ...(input.attributes
          ? { attributes: enforceProjectVisualStyle(input.attributes, project.visualStyle ?? 'cinematic-cg') }
          : {}),
        customPromptMode: 'replace',
        updatedAt: new Date().toISOString(),
      })
      return asset
    })
  }

  async deleteAsset(projectId: string, assetId: string, principal: Principal): Promise<boolean> {
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

  async createShot(projectId: string, input: CreateShot, principal: Principal): Promise<Shot | null> {
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
        continuityMode: projectShots.length === 0 ? 'independent' : input.continuityMode,
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
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      const shot = state.shots.find((item) => item.id === shotId && item.projectId === projectId)
      if (!ownsProject || !shot) return null
      const updates = { ...input }
      if (input.selectedImageTaskId) {
        const selectedImageTask = state.tasks.find(
          (task) =>
            task.id === input.selectedImageTaskId &&
            task.projectId === projectId &&
            task.tenantId === principal.tenantId &&
            task.kind === 'image' &&
            task.status === 'completed' &&
            task.metadata.shotId === shotId,
        )
        if (!selectedImageTask?.resultUrl) return null
        updates.imageUrl = selectedImageTask.resultUrl
      }
      if (input.selectedVideoTaskId) {
        const selectedVideoTask = state.tasks.find(
          (task) =>
            task.id === input.selectedVideoTaskId &&
            task.projectId === projectId &&
            task.tenantId === principal.tenantId &&
            task.kind === 'video' &&
            task.status === 'completed' &&
            task.metadata.shotId === shotId,
        )
        if (!selectedVideoTask?.resultUrl) return null
      }
      Object.assign(shot, updates, { updatedAt: new Date().toISOString() })
      return shot
    })
  }

  async replaceShots(projectId: string, shots: CreateShot[], principal: Principal): Promise<Shot[] | null> {
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

  async updateShotEpisodes(
    projectId: string,
    episodes: Array<Pick<Shot, 'id' | 'episodeNumber' | 'episodeTitle' | 'episodeKind'>>,
    principal: Principal,
  ): Promise<Shot[] | null> {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId && item.tenantId === principal.tenantId && item.ownerId === principal.userId,
      )
      if (!project) return null
      const updates = new Map(episodes.map((episode) => [episode.id, episode]))
      const now = new Date().toISOString()
      const updated = state.shots
        .filter((shot) => shot.projectId === projectId && updates.has(shot.id))
        .map((shot) => {
          const episode = updates.get(shot.id)!
          Object.assign(shot, episode, { updatedAt: now })
          return shot
        })
      project.updatedAt = now
      return updated
    })
  }
}

function enforceProjectVisualStyle<T extends Asset['attributes']>(
  attributes: T,
  visualStyle: Project['visualStyle'],
): T {
  const next = 'visualStyle' in attributes ? { ...attributes, visualStyle } : { ...attributes }
  if (next.type === 'scene') {
    return { ...next, emptyScene: true, activitySpace: true } as T
  }
  return next as T
}

export function projectPreviewUrl(
  projectId: string,
  state: Pick<AppState, 'tasks' | 'shots' | 'assets'>,
): string | null {
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
  state: Pick<AppState, 'tasks'>,
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

function assetPreviewUrl(asset: Asset): string | null {
  if (asset.imageUrl) return asset.imageUrl
  const attributes = asset.attributes as Record<string, unknown>
  const faceReference = attributes.faceReference as { url?: unknown } | null | undefined
  if (typeof faceReference?.url === 'string') return faceReference.url
  return asset.references?.[0]?.url ?? null
}
