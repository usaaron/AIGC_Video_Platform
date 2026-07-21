import type { MediaKind, MediaObject, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../core/errors.js'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import { MEDIA_COLUMNS, mediaFromRow, type MediaRow } from '../../infra/postgresRows.js'
import type { StoredMedia } from '../../infra/store.js'
import type { MediaStore } from './repository.js'

export class PostgresMediaRepository implements MediaStore {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async canWrite(projectId: string, principal: Principal): Promise<boolean> {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `
          select id
          from projects
          where id = $1 and tenant_id = $2 and owner_id = $3
          for key share
        `,
        [projectId, principal.tenantId, principal.userId],
      )
      return Boolean(result.rows[0])
    })
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
    return this.transactions.withTransaction(async (client) => {
      const project = await client.query<{ id: string }>(
        `
          select id
          from projects
          where id = $1 and tenant_id = $2 and owner_id = $3
          for key share
        `,
        [projectId, principal.tenantId, principal.userId],
      )
      if (!project.rows[0]) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found')

      const result = await client.query<MediaRow>(
        `
          insert into media (
            id, project_id, tenant_id, kind, name, content_type, size, storage_key, created_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          returning ${MEDIA_COLUMNS}
        `,
        [
          randomUUID(),
          projectId,
          principal.tenantId,
          kind,
          name,
          contentType,
          size,
          storageKey,
          new Date().toISOString(),
        ],
      )
      return toObject(mediaFromRow(result.rows[0]!))
    })
  }

  async find(id: string, principal: Principal): Promise<StoredMedia | null> {
    return this.transactions.withTransaction(async (client) => {
      const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
      const result = await client.query<MediaRow>(
        `
          select ${MEDIA_COLUMNS}
          from media
          where id = $1
            and tenant_id = $2
            and (
              $3::boolean
              or exists (
                select 1
                from projects
                where projects.id = media.project_id
                  and projects.tenant_id = media.tenant_id
                  and projects.owner_id = $4
              )
            )
        `,
        [id, principal.tenantId, canReadAll, principal.userId],
      )
      return result.rows[0] ? mediaFromRow(result.rows[0]) : null
    })
  }

  async findById(id: string): Promise<StoredMedia | null> {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query<MediaRow>(
        `
          select ${MEDIA_COLUMNS}
          from media
          where id = $1
        `,
        [id],
      )
      return result.rows[0] ? mediaFromRow(result.rows[0]) : null
    })
  }
}

function toObject(media: StoredMedia): MediaObject {
  return { ...media, url: `/api/v1/media/${media.id}` }
}
