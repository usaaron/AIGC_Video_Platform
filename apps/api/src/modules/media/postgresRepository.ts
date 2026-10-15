import type { MediaKind, MediaObject, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { AppError } from '../../core/errors.js'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import { MEDIA_COLUMNS, mediaFromRow, type MediaRow } from '../../infra/postgresRows.js'
import type { StoredMedia } from '../../infra/store.js'
import type { MediaStore } from './repository.js'

export class PostgresMediaRepository implements MediaStore {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async canWrite(projectId: string, principal: Principal): Promise<boolean> {
    return this.transactions.withTransaction(async (client) => {
      return canAccessProject(client, projectId, principal, 'edit')
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
      if (!(await canAccessProject(client, projectId, principal, 'edit'))) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found')
      }

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
      const result = await client.query<MediaRow>(
        `
          select ${MEDIA_COLUMNS}
          from media
          where id = $1
            and tenant_id = $2
        `,
        [id, principal.tenantId],
      )
      const media = result.rows[0] ? mediaFromRow(result.rows[0]) : null
      if (!media) return null
      return (await canAccessProject(client, media.projectId, principal, 'read')) ? media : null
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

async function canAccessProject(
  client: PoolClient,
  projectId: string,
  principal: Principal,
  mode: 'read' | 'edit',
): Promise<boolean> {
  const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
  const result = await client.query<{ id: string }>(
    `
      select projects.id
      from projects
      left join users actor
        on actor.id = $3
        and actor.tenant_id = projects.tenant_id
      left join project_shares
        on project_shares.project_id = projects.id
        and project_shares.tenant_id = projects.tenant_id
        and project_shares.status = 'active'
        and (
          project_shares.shared_with_user_id = $3
          or lower(project_shares.shared_with_email) = lower(actor.email)
        )
      where projects.id = $1
        and projects.tenant_id = $2
        and (
          $4::boolean
          or projects.owner_id = $3
          or ($5::boolean and project_shares.id is not null)
          or (not $5::boolean and project_shares.permission = 'edit')
        )
      limit 1
      for key share of projects
    `,
    [projectId, principal.tenantId, principal.userId, canReadAll, mode === 'read'],
  )
  return Boolean(result.rows[0])
}
