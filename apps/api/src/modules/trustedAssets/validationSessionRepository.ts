import type { Principal } from '@seqora/contracts'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore, StoredTrustedValidationSession } from '../../infra/store.js'

export type NewTrustedValidationSession = Omit<StoredTrustedValidationSession, 'createdAt' | 'updatedAt'> & {
  createdAt?: string
  updatedAt?: string
}

export type TrustedValidationSessionPatch = Partial<
  Pick<
    StoredTrustedValidationSession,
    'status' | 'groupId' | 'providerAssetId' | 'error' | 'expiresAt' | 'updatedAt'
  >
>

type SessionRow = {
  id: string
  tenant_id: string
  user_id: string
  project_id: string
  asset_id: string
  provider_token: string
  h5_link: string
  qr_code: string | null
  status: StoredTrustedValidationSession['status']
  group_id: string | null
  provider_asset_id: string | null
  error: string | null
  expires_at: string
  created_at: string
  updated_at: string
}

export class TrustedValidationSessionRepository {
  constructor(
    private readonly store: AppStore,
    private readonly database: AccountDatabase | null = null,
  ) {}

  async create(input: NewTrustedValidationSession): Promise<StoredTrustedValidationSession> {
    const now = input.createdAt ?? new Date().toISOString()
    const session = { ...input, createdAt: now, updatedAt: input.updatedAt ?? now }
    if (this.database) {
      const result = await this.database.query<SessionRow>(
        `
        INSERT INTO trusted_validation_sessions
          (id, tenant_id, user_id, project_id, asset_id, provider_token, h5_link, qr_code,
           status, group_id, provider_asset_id, error, expires_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING id, tenant_id, user_id, project_id, asset_id, provider_token, h5_link, qr_code,
          status, group_id, provider_asset_id, error, expires_at::text, created_at::text, updated_at::text
        `,
        [
          session.id,
          session.tenantId,
          session.userId,
          session.projectId,
          session.assetId,
          session.providerToken,
          session.h5Link,
          session.qrCode,
          session.status,
          session.groupId,
          session.providerAssetId,
          session.error,
          session.expiresAt,
          session.createdAt,
          session.updatedAt,
        ],
      )
      return sessionFromRow(result.rows[0]!)
    }
    return this.store.mutate((state) => {
      ;(state.trustedValidationSessions ??= []).unshift(session)
      return session
    })
  }

  async findOwned(id: string, principal: Principal): Promise<StoredTrustedValidationSession | null> {
    if (this.database) {
      const result = await this.database.query<SessionRow>(
        `
        SELECT id, tenant_id, user_id, project_id, asset_id, provider_token, h5_link, qr_code,
          status, group_id, provider_asset_id, error, expires_at::text, created_at::text, updated_at::text
        FROM trusted_validation_sessions
        WHERE id = $1 AND tenant_id = $2 AND user_id = $3
        LIMIT 1
        `,
        [id, principal.tenantId, principal.userId],
      )
      return result.rows[0] ? sessionFromRow(result.rows[0]) : null
    }
    return this.store.read(
      (state) =>
        state.trustedValidationSessions?.find(
          (session) =>
            session.id === id &&
            session.tenantId === principal.tenantId &&
            session.userId === principal.userId,
        ) ?? null,
    )
  }

  async findLatestOwned(
    projectId: string,
    assetId: string,
    principal: Principal,
  ): Promise<StoredTrustedValidationSession | null> {
    if (this.database) {
      const result = await this.database.query<SessionRow>(
        `
        SELECT id, tenant_id, user_id, project_id, asset_id, provider_token, h5_link, qr_code,
          status, group_id, provider_asset_id, error, expires_at::text, created_at::text, updated_at::text
        FROM trusted_validation_sessions
        WHERE tenant_id = $1 AND user_id = $2 AND project_id = $3 AND asset_id = $4
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [principal.tenantId, principal.userId, projectId, assetId],
      )
      return result.rows[0] ? sessionFromRow(result.rows[0]) : null
    }
    return this.store.read(
      (state) =>
        (state.trustedValidationSessions
          ? state.trustedValidationSessions
              .filter(
                (session) =>
                  session.tenantId === principal.tenantId &&
                  session.userId === principal.userId &&
                  session.projectId === projectId &&
                  session.assetId === assetId,
              )
              .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
          : null) ?? null,
    )
  }

  async update(
    id: string,
    principal: Principal,
    patch: TrustedValidationSessionPatch,
  ): Promise<StoredTrustedValidationSession | null> {
    const updatedAt = patch.updatedAt ?? new Date().toISOString()
    if (this.database) {
      const result = await this.database.query<SessionRow>(
        `
        UPDATE trusted_validation_sessions
        SET status = COALESCE($4, status),
            group_id = COALESCE($5, group_id),
            provider_asset_id = COALESCE($6, provider_asset_id),
            error = $7,
            expires_at = COALESCE($8::timestamptz, expires_at),
            updated_at = $9::timestamptz
        WHERE id = $1 AND tenant_id = $2 AND user_id = $3
        RETURNING id, tenant_id, user_id, project_id, asset_id, provider_token, h5_link, qr_code,
          status, group_id, provider_asset_id, error, expires_at::text, created_at::text, updated_at::text
        `,
        [
          id,
          principal.tenantId,
          principal.userId,
          patch.status ?? null,
          patch.groupId ?? null,
          patch.providerAssetId ?? null,
          patch.error ?? null,
          patch.expiresAt ?? null,
          updatedAt,
        ],
      )
      return result.rows[0] ? sessionFromRow(result.rows[0]) : null
    }
    return this.store.mutate((state) => {
      const session = state.trustedValidationSessions?.find(
        (candidate) =>
          candidate.id === id &&
          candidate.tenantId === principal.tenantId &&
          candidate.userId === principal.userId,
      )
      if (!session) return null
      Object.assign(session, patch, { updatedAt })
      return session
    })
  }

  async claimForUpload(
    id: string,
    principal: Principal,
    groupId: string,
  ): Promise<StoredTrustedValidationSession | null> {
    const updatedAt = new Date().toISOString()
    if (this.database) {
      const result = await this.database.query<SessionRow>(
        `
        UPDATE trusted_validation_sessions
        SET status = 'uploading', group_id = $4, error = NULL, updated_at = $5::timestamptz
        WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND status = 'pending'
        RETURNING id, tenant_id, user_id, project_id, asset_id, provider_token, h5_link, qr_code,
          status, group_id, provider_asset_id, error, expires_at::text, created_at::text, updated_at::text
        `,
        [id, principal.tenantId, principal.userId, groupId, updatedAt],
      )
      return result.rows[0] ? sessionFromRow(result.rows[0]) : null
    }
    return this.store.mutate((state) => {
      const session = state.trustedValidationSessions?.find(
        (candidate) =>
          candidate.id === id &&
          candidate.tenantId === principal.tenantId &&
          candidate.userId === principal.userId &&
          candidate.status === 'pending',
      )
      if (!session) return null
      Object.assign(session, { status: 'uploading', groupId, error: null, updatedAt })
      return session
    })
  }
}

function sessionFromRow(row: SessionRow): StoredTrustedValidationSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    projectId: row.project_id,
    assetId: row.asset_id,
    providerToken: row.provider_token,
    h5Link: row.h5_link,
    qrCode: row.qr_code,
    status: row.status,
    groupId: row.group_id,
    providerAssetId: row.provider_asset_id,
    error: row.error,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
