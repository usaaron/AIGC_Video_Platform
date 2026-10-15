import type { MediaKind, MediaObject, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { StateStore, StoredMedia } from '../../infra/store.js'

export interface MediaStore {
  canWrite(projectId: string, principal: Principal): Promise<boolean>
  create(
    projectId: string,
    kind: MediaKind,
    name: string,
    contentType: string,
    size: number,
    storageKey: string,
    principal: Principal,
  ): Promise<MediaObject>
  find(id: string, principal: Principal): Promise<StoredMedia | null>
  findById(id: string): Promise<StoredMedia | null>
}

export class MediaRepository implements MediaStore {
  constructor(private readonly store: StateStore) {}

  async canWrite(projectId: string, principal: Principal): Promise<boolean> {
    return this.store.read((state) => canAccessProject(state, projectId, principal, 'edit'))
  }

  async create(
    projectId: string,
    kind: MediaKind,
    name: string,
    contentType: string,
    size: number,
    storageKey: string,
    principal: Principal,
  ): Promise<MediaObject> {
    const media: StoredMedia = {
      id: randomUUID(),
      projectId,
      tenantId: principal.tenantId,
      kind,
      name,
      contentType,
      size,
      storageKey,
      createdAt: new Date().toISOString(),
    }
    await this.store.mutate((state) => state.media.push(media))
    return this.toObject(media)
  }

  async find(id: string, principal: Principal): Promise<StoredMedia | null> {
    return this.store.read((state) => {
      const media = state.media.find((item) => item.id === id && item.tenantId === principal.tenantId)
      if (!media) return null
      const project = state.projects.find((item) => item.id === media.projectId)
      return project && canAccessProject(state, project.id, principal, 'read') ? media : null
    })
  }

  async findById(id: string): Promise<StoredMedia | null> {
    return this.store.read((state) => state.media.find((item) => item.id === id) ?? null)
  }

  private toObject(media: StoredMedia): MediaObject {
    return { ...media, url: `/api/v1/media/${media.id}` }
  }
}

function canAccessProject(
  state: {
    users: Array<{ id: string; tenantId: string; email: string }>
    projects: Array<{ id: string; tenantId: string; ownerId: string }>
    projectShares: Array<{
      projectId: string
      tenantId: string
      sharedWithUserId: string | null
      sharedWithEmail: string | null
      status: string
      permission: 'view' | 'comment' | 'edit'
    }>
  },
  projectId: string,
  principal: Principal,
  mode: 'read' | 'edit',
): boolean {
  if (principal.roles.some((role) => role === 'admin' || role === 'owner')) return true
  const project = state.projects.find((item) => item.id === projectId && item.tenantId === principal.tenantId)
  if (!project) return false
  if (project.ownerId === principal.userId) return true
  const email =
    state.users
      .find((user) => user.id === principal.userId && user.tenantId === principal.tenantId)
      ?.email.toLowerCase() ?? ''
  const share = state.projectShares.find(
    (item) =>
      item.projectId === projectId &&
      item.tenantId === principal.tenantId &&
      item.status === 'active' &&
      (item.sharedWithUserId === principal.userId ||
        Boolean(item.sharedWithEmail && item.sharedWithEmail.toLowerCase() === email)),
  )
  if (!share) return false
  return mode === 'read' ? true : share.permission === 'edit'
}
