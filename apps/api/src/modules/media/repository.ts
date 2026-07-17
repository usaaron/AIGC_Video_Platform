import type { MediaKind, MediaObject, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { AppStore, StoredMedia } from '../../infra/store.js'

export class MediaRepository {
  constructor(private readonly store: AppStore) {}

  canWrite(projectId: string, principal: Principal): boolean {
    return this.store.read((state) =>
      state.projects.some(
        (project) =>
          project.id === projectId &&
          project.tenantId === principal.tenantId &&
          project.ownerId === principal.userId,
      ),
    )
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

  find(id: string, principal: Principal): StoredMedia | null {
    return this.store.read((state) => {
      const media = state.media.find((item) => item.id === id && item.tenantId === principal.tenantId)
      if (!media) return null
      const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
      const project = state.projects.find((item) => item.id === media.projectId)
      return canReadAll || project?.ownerId === principal.userId ? media : null
    })
  }

  private toObject(media: StoredMedia): MediaObject {
    return { ...media, url: `/api/v1/media/${media.id}` }
  }
}
