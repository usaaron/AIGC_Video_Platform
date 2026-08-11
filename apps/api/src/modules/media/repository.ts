import type { MediaKind, MediaObject, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import { insertAuditLog, type AuditLogInput } from '../../core/audit/auditLog.js'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore, StoredMedia } from '../../infra/store.js'

export type MediaObjectSource = {
  storageKey: string
  contentType: string
}

type MediaObjectRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  media_type: string
  name: string
  content_type: string
  size_bytes: number | string
  storage_key: string
  created_at: Date | string
}

type MediaAccessFailureRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  media_type: string
  status: string
  owner_user_id: string | null
}

export type MediaJsonImportResult = {
  media: { inserted: number; skipped: number }
}

export class MediaRepository {
  constructor(
    private readonly store: AppStore,
    private readonly database: AccountDatabase | null = null,
    private readonly storageDriver = 'local',
    private readonly bucket: string | null = null,
  ) {}

  async importFromStore(): Promise<MediaJsonImportResult> {
    const result: MediaJsonImportResult = { media: { inserted: 0, skipped: 0 } }
    if (!this.database) return result
    const media = this.store.read((state) => state.media)
    await this.database.transaction(async (client) => {
      for (const item of media) {
        const inserted = await insertMediaFromStore(client, item, this.storageDriver, this.bucket)
        if (inserted) result.media.inserted += 1
        else result.media.skipped += 1
      }
    })
    return result
  }

  async bootstrapFromStore(): Promise<void> {
    await this.importFromStore()
  }

  async canWrite(projectId: string, principal: Principal): Promise<boolean> {
    if (this.database) {
      const result = await this.database.query<{ id: string }>(
        `
        SELECT id
        FROM projects
        WHERE id = $1
          AND tenant_id = $2
          AND owner_user_id = $3
          AND status <> 'archived'
        LIMIT 1
        `,
        [projectId, principal.tenantId, principal.userId],
      )
      return Boolean(result.rows[0])
    }
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
    if (this.database) {
      const inserted = await this.database.query<MediaObjectRow>(
        `
        INSERT INTO media_objects (
          id,
          project_id,
          tenant_id,
          created_by_user_id,
          media_type,
          purpose,
          name,
          content_type,
          size_bytes,
          storage_driver,
          storage_key,
          bucket,
          metadata,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'upload', $6, $7, $8, $9, $10, $11, '{}'::jsonb, 'active', now(), now())
        RETURNING id, project_id, tenant_id, media_type, name, content_type, size_bytes, storage_key, created_at
        `,
        [
          randomUUID(),
          projectId,
          principal.tenantId,
          principal.userId,
          mediaTypeForKind(kind),
          name.slice(0, 255),
          contentType,
          size,
          this.storageDriver,
          storageKey,
          this.bucket,
        ],
      )
      return this.toObject(mediaFromRow(inserted.rows[0]!))
    }

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
    if (this.database) {
      const result = await this.database.query<MediaObjectRow>(
        `
        SELECT
          mo.id,
          mo.project_id,
          mo.tenant_id,
          mo.media_type,
          mo.name,
          mo.content_type,
          mo.size_bytes,
          mo.storage_key,
          mo.created_at
        FROM media_objects mo
        JOIN projects p ON p.id = mo.project_id AND p.tenant_id = mo.tenant_id
        WHERE mo.id = $1
          AND mo.tenant_id = $2
          AND mo.status = 'active'
          AND ($3::boolean OR p.owner_user_id = $4)
        LIMIT 1
        `,
        [id, principal.tenantId, canReadAllTenantContent(principal), principal.userId],
      )
      return result.rows[0] ? mediaFromRow(result.rows[0]) : null
    }
    return this.store.read((state) => {
      const media = state.media.find((item) => item.id === id && item.tenantId === principal.tenantId)
      if (!media) return null
      const canReadAll = canReadAllTenantContent(principal)
      const project = state.projects.find((item) => item.id === media.projectId)
      return canReadAll || project?.ownerId === principal.userId ? media : null
    })
  }

  async accessFailureContext(id: string, principal: Principal): Promise<Record<string, unknown>> {
    if (this.database) {
      const result = await this.database.query<MediaAccessFailureRow>(
        `
        SELECT mo.id, mo.project_id, mo.tenant_id, mo.media_type, mo.status, p.owner_user_id
        FROM media_objects mo
        LEFT JOIN projects p ON p.id = mo.project_id AND p.tenant_id = mo.tenant_id
        WHERE mo.id = $1
        LIMIT 1
        `,
        [id],
      )
      const media = result.rows[0]
      if (!media) return { reason: 'media_not_found' }
      if (media.status !== 'active') {
        return {
          reason: 'media_deleted',
          projectId: media.project_id,
          mediaKind: media.media_type,
        }
      }
      if (media.tenant_id !== principal.tenantId) {
        return {
          reason: 'tenant_mismatch',
          targetTenantId: media.tenant_id,
          projectId: media.project_id,
          mediaKind: media.media_type,
        }
      }
      if (!media.owner_user_id) {
        return {
          reason: 'project_not_found',
          projectId: media.project_id,
          mediaKind: media.media_type,
        }
      }
      return {
        reason: 'permission_denied',
        projectId: media.project_id,
        mediaKind: media.media_type,
        projectOwnerId: media.owner_user_id,
      }
    }
    return this.store.read((state) => {
      const media = state.media.find((item) => item.id === id)
      if (!media) return { reason: 'media_not_found' }
      if (media.tenantId !== principal.tenantId) {
        return {
          reason: 'tenant_mismatch',
          targetTenantId: media.tenantId,
          projectId: media.projectId,
          mediaKind: media.kind,
        }
      }
      const project = state.projects.find((item) => item.id === media.projectId)
      if (!project) {
        return {
          reason: 'project_not_found',
          projectId: media.projectId,
          mediaKind: media.kind,
        }
      }
      return {
        reason: 'permission_denied',
        projectId: media.projectId,
        mediaKind: media.kind,
        projectOwnerId: project.ownerId,
      }
    })
  }

  async findSourceById(
    id: string,
    projectId: string,
    tenantId: string,
    kind: MediaKind = 'image',
  ): Promise<MediaObjectSource | null> {
    if (this.database) {
      const result = await this.database.query<{ storage_key: string; content_type: string }>(
        `
        SELECT storage_key, content_type
        FROM media_objects
        WHERE id = $1
          AND project_id = $2
          AND tenant_id = $3
          AND media_type = $4
          AND status = 'active'
        LIMIT 1
        `,
        [id, projectId, tenantId, mediaTypeForKind(kind)],
      )
      const row = result.rows[0]
      return row ? { storageKey: row.storage_key, contentType: row.content_type } : null
    }
    return this.store.read((state) => {
      const media = state.media.find(
        (item) =>
          item.id === id && item.projectId === projectId && item.tenantId === tenantId && item.kind === kind,
      )
      return media ? sourceFromMedia(media) : null
    })
  }

  async findSourceByReferenceIds(
    referenceIds: readonly string[],
    projectId: string,
    tenantId: string,
    kind: MediaKind = 'image',
  ): Promise<MediaObjectSource | null> {
    if (!referenceIds.length) return null
    if (this.database) {
      const result = await this.database.query<{ storage_key: string; content_type: string }>(
        `
        SELECT storage_key, content_type
        FROM media_objects
        WHERE id = ANY($1::text[])
          AND project_id = $2
          AND tenant_id = $3
          AND media_type = $4
          AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [[...referenceIds], projectId, tenantId, mediaTypeForKind(kind)],
      )
      const row = result.rows[0]
      return row ? { storageKey: row.storage_key, contentType: row.content_type } : null
    }
    return this.store.read((state) => {
      const media = state.media.find(
        (item) =>
          referenceIds.includes(item.id) &&
          item.projectId === projectId &&
          item.tenantId === tenantId &&
          item.kind === kind,
      )
      return media ? sourceFromMedia(media) : null
    })
  }

  async recordAuditLog(input: AuditLogInput): Promise<void> {
    if (!this.database) return
    await insertAuditLog(this.database, input)
  }

  private toObject(media: StoredMedia): MediaObject {
    return { ...media, url: `/api/v1/media/${media.id}` }
  }
}

async function insertMediaFromStore(
  client: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[]; rowCount?: number | null }>
  },
  media: StoredMedia,
  storageDriver: string,
  bucket: string | null,
): Promise<boolean> {
  const result = await client.query(
    `
    INSERT INTO media_objects (
      id,
      project_id,
      tenant_id,
      media_type,
      purpose,
      name,
      content_type,
      size_bytes,
      storage_driver,
      storage_key,
      bucket,
      metadata,
      status,
      created_at,
      updated_at
    )
    SELECT $1, $2, $3, $4, 'upload', $5, $6, $7, $8, $9, $10, $11::jsonb, 'active', $12, $12
    WHERE EXISTS (SELECT 1 FROM projects WHERE id = $2 AND tenant_id = $3)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
    `,
    [
      media.id,
      media.projectId,
      media.tenantId,
      mediaTypeForKind(media.kind),
      media.name,
      media.contentType,
      media.size,
      storageDriver,
      media.storageKey,
      bucket,
      JSON.stringify({ importedFromJson: true }),
      media.createdAt,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

function mediaFromRow(row: MediaObjectRow): StoredMedia {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    kind: kindFromMediaType(row.media_type),
    name: row.name,
    contentType: row.content_type,
    size: Number(row.size_bytes),
    storageKey: row.storage_key,
    createdAt: isoString(row.created_at),
  }
}

function sourceFromMedia(media: StoredMedia): MediaObjectSource {
  return { storageKey: media.storageKey, contentType: media.contentType }
}

function mediaTypeForKind(kind: MediaKind): 'image' | 'audio' {
  return kind
}

function kindFromMediaType(value: string): MediaKind {
  return value === 'audio' ? 'audio' : 'image'
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
