import type {
  CreatedTenantInvitation,
  Membership,
  Plan,
  Role,
  SessionSummary,
  TenantInvitation,
  Workspace,
  WorkspaceMembership,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AuditLogInput, AuthAccount } from '../auth/accounts.js'

const defaultPlan: Plan = 'free'
const defaultCredits = 0

export type AccountWorkspace = {
  account: AuthAccount
  workspace: Workspace
  membership: Membership
}

export type CreateTenantUserResult =
  { kind: 'created'; membership: Membership } | { kind: 'duplicate' } | { kind: 'tenant_missing' }

export type TransferOrganizationAdminResult =
  | {
      kind: 'transferred'
      previousOrganizationAdmin: Membership
      newOrganizationAdmin: Membership
    }
  | { kind: 'missing' }
  | { kind: 'target_missing' }

export type LeaveWorkspaceResult =
  | { kind: 'left'; membership: Membership; nextWorkspace: AccountWorkspace | null }
  | { kind: 'missing' }
  | { kind: 'last_owner' }

export type DisableWorkspaceResult =
  { kind: 'disabled'; workspace: Workspace; nextWorkspace: AccountWorkspace | null } | { kind: 'missing' }

export type SaveRegistrationCodeResult =
  { kind: 'created'; expiresAt: string } | { kind: 'cooldown' } | { kind: 'invitation_unavailable' }

export type ClaimInvitationEmailResult =
  | { kind: 'claimed'; invitation: TenantInvitation }
  | { kind: 'email_mismatch' }
  | { kind: 'email_already_pending' }
  | { kind: 'membership_exists' }
  | { kind: 'invitation_unavailable' }

export type CreateInvitationResult =
  | { kind: 'created'; invitation: CreatedTenantInvitation }
  | { kind: 'membership_exists' }
  | { kind: 'token_collision' }

export type VerifiedRegistrationResult =
  | { kind: 'accepted'; workspace: AccountWorkspace }
  | {
      kind:
        | 'invitation_unavailable'
        | 'code_missing'
        | 'code_expired'
        | 'code_invalid'
        | 'code_locked'
        | 'code_used'
    }

export class AccountManagementRepository {
  constructor(private readonly database: AccountDatabase) {}

  async createWorkspaceForUser(userId: string, name: string): Promise<AccountWorkspace | null> {
    return this.database.transaction(async (client) => {
      const tenantId = `tenant-${randomUUID()}`
      const membershipId = membershipIdFor(userId, tenantId)
      const user = await client.query<{ id: string }>(
        `
        SELECT id
        FROM users
        WHERE id = $1
          AND status = 'active'
        LIMIT 1
        `,
        [userId],
      )
      if (!user.rows.length) return null
      const role = await readWorkspaceCreationRole(client, userId)

      await client.query(
        `
        INSERT INTO tenants (id, name, status, created_by_user_id, created_at, updated_at)
        VALUES ($1, $2, 'active', $3, now(), now())
        `,
        [tenantId, name, userId],
      )
      await client.query(
        `
        INSERT INTO tenant_memberships (
          id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, false, 'active', now(), now())
        `,
        [membershipId, tenantId, userId, [role]],
      )
      await client.query(
        `
        INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
        VALUES ($1, $2, $3, now(), now())
        `,
        [membershipId, defaultPlan, defaultCredits],
      )

      return this.readAccountWorkspace(client, userId, tenantId)
    })
  }

  async createInvitation(input: {
    tenantId: string
    email: string | null
    roles: Role[]
    invitedByUserId: string
    token: string
    tokenSecretHash: string
    expiresAt: string
  }): Promise<CreateInvitationResult> {
    try {
      return await this.database.transaction(async (client) => {
        let invitationId = `invitation-${randomUUID()}`
        let reissued = false
        if (input.email) {
          const activeMember = await client.query<{ id: string }>(
            `
            SELECT m.id
            FROM tenant_memberships m
            JOIN auth_identities ai ON ai.user_id = m.user_id
            JOIN users u ON u.id = m.user_id AND u.status = 'active'
            WHERE m.tenant_id = $1
              AND lower(ai.email) = lower($2)
              AND ai.provider = 'local'
              AND ai.status = 'active'
              AND m.status = 'active'
            LIMIT 1
            `,
            [input.tenantId, input.email],
          )
          if (activeMember.rows.length) return { kind: 'membership_exists' as const }

          const updated = await client.query<{ id: string }>(
            `
            UPDATE tenant_invitations
            SET roles = $3,
                invited_by_user_id = $4,
                token_secret_hash = $5,
                expires_at = $6,
                accepted_at = NULL,
                revoked_at = NULL,
                updated_at = now()
            WHERE tenant_id = $1
              AND lower(email) = lower($2)
              AND status = 'pending'
            RETURNING id
            `,
            [
              input.tenantId,
              input.email,
              input.roles,
              input.invitedByUserId,
              input.tokenSecretHash,
              input.expiresAt,
            ],
          )
          if (updated.rows[0]) {
            invitationId = updated.rows[0].id
            reissued = true
            await client.query(`DELETE FROM registration_email_codes WHERE invitation_id = $1`, [
              invitationId,
            ])
          }
        }
        if (!reissued) {
          await client.query(
            `
            INSERT INTO tenant_invitations (
              id, tenant_id, email, roles, invited_by_user_id, token_secret_hash, status, expires_at,
              accepted_at, revoked_at, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NULL, NULL, now(), now())
            `,
            [
              invitationId,
              input.tenantId,
              input.email,
              input.roles,
              input.invitedByUserId,
              input.tokenSecretHash,
              input.expiresAt,
            ],
          )
        }

        const invitation = await readInvitationById(client, invitationId)
        if (!invitation) throw new Error('Created invitation could not be read')
        return { kind: 'created' as const, invitation: { ...invitation, token: input.token } }
      })
    } catch (error) {
      if (isPostgresUniqueConstraint(error, 'tenant_invitations_token_hash_unique')) {
        return { kind: 'token_collision' }
      }
      throw error
    }
  }

  async listInvitations(tenantId: string): Promise<TenantInvitation[]> {
    const result = await this.database.query<TenantInvitationRow>(
      invitationSelectSql('WHERE i.tenant_id = $1 ORDER BY i.created_at DESC'),
      [tenantId],
    )
    return result.rows.map(toTenantInvitation)
  }

  async findInvitationByTokenHash(tokenSecretHash: string): Promise<TenantInvitation | null> {
    const result = await this.database.query<TenantInvitationRow>(
      invitationSelectSql('WHERE i.token_secret_hash = $1 LIMIT 1'),
      [tokenSecretHash],
    )
    return result.rows[0] ? toTenantInvitation(result.rows[0]) : null
  }

  async claimInvitationEmail(tokenSecretHash: string, email: string): Promise<ClaimInvitationEmailResult> {
    return this.database.transaction(async (client) => {
      const result = await client.query<TenantInvitationRow>(
        invitationSelectSql('WHERE i.token_secret_hash = $1 LIMIT 1 FOR UPDATE OF i'),
        [tokenSecretHash],
      )
      const row = result.rows[0]
      if (!row) return { kind: 'invitation_unavailable' }
      const invitation = toTenantInvitation(row)
      if (invitation.status !== 'pending') return { kind: 'invitation_unavailable' }
      if (row.email) {
        return row.email.toLowerCase() === email.toLowerCase()
          ? { kind: 'claimed', invitation }
          : { kind: 'email_mismatch' }
      }

      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `registration-invitation:${row.tenant_id}:${email.toLowerCase()}`,
      ])
      const activeMember = await client.query<{ id: string }>(
        `
        SELECT m.id
        FROM tenant_memberships m
        JOIN auth_identities ai ON ai.user_id = m.user_id
        JOIN users u ON u.id = m.user_id AND u.status = 'active'
        WHERE m.tenant_id = $1
          AND lower(ai.email) = lower($2)
          AND ai.provider = 'local'
          AND ai.status = 'active'
          AND m.status = 'active'
        LIMIT 1
        `,
        [row.tenant_id, email],
      )
      if (activeMember.rows.length) return { kind: 'membership_exists' }

      const pendingInvitation = await client.query<{ id: string }>(
        `
        SELECT id
        FROM tenant_invitations
        WHERE tenant_id = $1
          AND lower(email) = lower($2)
          AND status = 'pending'
          AND id <> $3
        LIMIT 1
        `,
        [row.tenant_id, email, row.invitation_id],
      )
      if (pendingInvitation.rows.length) return { kind: 'email_already_pending' }

      await client.query(
        `
        UPDATE tenant_invitations
        SET email = $2,
            updated_at = now()
        WHERE id = $1
          AND email IS NULL
        `,
        [row.invitation_id, email],
      )
      const claimed = await readInvitationById(client, row.invitation_id)
      return claimed ? { kind: 'claimed', invitation: claimed } : { kind: 'invitation_unavailable' }
    })
  }

  async saveRegistrationCode(input: {
    invitationId: string
    tokenSecretHash: string
    email: string
    codeSecretHash: string
    expiresAt: string
    requestedIp: string | null
    requestedUserAgent: string | null
  }): Promise<SaveRegistrationCodeResult> {
    return this.database.transaction(async (client) => {
      const invitation = await client.query<{ id: string }>(
        `
        SELECT id
        FROM tenant_invitations
        WHERE id = $1
          AND token_secret_hash = $2
          AND lower(email) = lower($3)
          AND status = 'pending'
          AND expires_at > now()
        LIMIT 1
        FOR UPDATE
        `,
        [input.invitationId, input.tokenSecretHash, input.email],
      )
      if (!invitation.rows.length) return { kind: 'invitation_unavailable' }

      const saved = await client.query<{ expires_at: Date | string }>(
        `
        INSERT INTO registration_email_codes (
          invitation_id, email, code_secret_hash, expires_at, attempts, sent_at, consumed_at,
          requested_ip, requested_user_agent, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 0, now(), NULL, $5, $6, now(), now())
        ON CONFLICT (invitation_id)
        DO UPDATE SET email = EXCLUDED.email,
                      code_secret_hash = EXCLUDED.code_secret_hash,
                      expires_at = EXCLUDED.expires_at,
                      attempts = 0,
                      sent_at = now(),
                      consumed_at = NULL,
                      requested_ip = EXCLUDED.requested_ip,
                      requested_user_agent = EXCLUDED.requested_user_agent,
                      updated_at = now()
        WHERE registration_email_codes.consumed_at IS NOT NULL
           OR registration_email_codes.expires_at <= now()
           OR registration_email_codes.sent_at <= now() - interval '60 seconds'
        RETURNING expires_at
        `,
        [
          input.invitationId,
          input.email,
          input.codeSecretHash,
          input.expiresAt,
          input.requestedIp,
          input.requestedUserAgent,
        ],
      )
      const expiresAt = saved.rows[0]?.expires_at
      return expiresAt ? { kind: 'created', expiresAt: toIso(expiresAt) } : { kind: 'cooldown' }
    })
  }

  async revokeInvitation(tenantId: string, invitationId: string): Promise<boolean> {
    const result = await this.database.query(
      `
      UPDATE tenant_invitations
      SET status = 'revoked',
          revoked_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'pending'
      `,
      [tenantId, invitationId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async acceptInvitation(input: {
    invitationId: string
    tokenSecretHash: string
    name: string
    passwordHash: string
    existingUserId?: string
  }): Promise<AccountWorkspace | null> {
    return this.database.transaction(async (client) => {
      const invitation = await client.query<TenantInvitationRow>(
        invitationSelectSql(`
          WHERE i.id = $1
            AND i.token_secret_hash = $2
            AND i.status = 'pending'
            AND i.expires_at > now()
          LIMIT 1
          FOR UPDATE OF i
        `),
        [input.invitationId, input.tokenSecretHash],
      )
      const row = invitation.rows[0]
      if (!row) return null

      return await this.persistAcceptedInvitation(client, row, input, false)
    })
  }

  async registerVerifiedInvitation(input: {
    invitationId: string
    tokenSecretHash: string
    verificationCodeHash: string
    name: string
    passwordHash: string
    existingUserId?: string
  }): Promise<VerifiedRegistrationResult> {
    return this.database.transaction(async (client) => {
      const invitation = await client.query<TenantInvitationRow>(
        invitationSelectSql(`
          WHERE i.id = $1
            AND i.token_secret_hash = $2
            AND i.status = 'pending'
            AND i.expires_at > now()
          LIMIT 1
          FOR UPDATE OF i
        `),
        [input.invitationId, input.tokenSecretHash],
      )
      const row = invitation.rows[0]
      if (!row) return { kind: 'invitation_unavailable' }

      const challenge = await client.query<RegistrationCodeRow>(
        `
        SELECT
          code_secret_hash = $2 AS code_matches,
          expires_at,
          attempts,
          consumed_at
        FROM registration_email_codes
        WHERE invitation_id = $1
        LIMIT 1
        FOR UPDATE
        `,
        [input.invitationId, input.verificationCodeHash],
      )
      const code = challenge.rows[0]
      if (!code) return { kind: 'code_missing' }
      if (code.consumed_at) return { kind: 'code_used' }
      if (new Date(code.expires_at).getTime() <= Date.now()) return { kind: 'code_expired' }
      if (code.attempts >= 5) return { kind: 'code_locked' }
      if (!code.code_matches) {
        const attempts = code.attempts + 1
        await client.query(
          `
          UPDATE registration_email_codes
          SET attempts = $2,
              updated_at = now()
          WHERE invitation_id = $1
          `,
          [input.invitationId, attempts],
        )
        return { kind: attempts >= 5 ? 'code_locked' : 'code_invalid' }
      }

      const workspace = await this.persistAcceptedInvitation(client, row, input, true)
      await client.query(
        `
        UPDATE registration_email_codes
        SET consumed_at = now(),
            updated_at = now()
        WHERE invitation_id = $1
        `,
        [input.invitationId],
      )
      return { kind: 'accepted', workspace }
    })
  }

  private async persistAcceptedInvitation(
    client: Queryable,
    row: TenantInvitationRow,
    input: {
      name: string
      passwordHash: string
      existingUserId?: string
    },
    emailVerified: boolean,
  ): Promise<AccountWorkspace> {
    if (!row.email) throw new Error('Invitation email must be claimed before acceptance')
    const userId = input.existingUserId ?? `user-${randomUUID()}`
    if (!input.existingUserId) {
      await client.query(
        `
        INSERT INTO users (id, display_name, status, created_at, updated_at)
        VALUES ($1, $2, 'active', now(), now())
        `,
        [userId, input.name],
      )
      await client.query(
        `
        INSERT INTO auth_identities (
          id, user_id, provider, provider_subject, email, password_hash, is_primary, status,
          email_verified_at, email_verification_status, created_at, updated_at
        )
        VALUES (
          $1, $2, 'local', $3, $3, $4, true, 'active',
          CASE WHEN $5::boolean THEN now() ELSE NULL END,
          CASE WHEN $5::boolean THEN 'verified' ELSE 'unverified' END,
          now(), now()
        )
        `,
        [authIdentityIdFor(userId), userId, row.email, input.passwordHash, emailVerified],
      )
    } else if (emailVerified) {
      await client.query(
        `
        UPDATE auth_identities
        SET email_verified_at = COALESCE(email_verified_at, now()),
            email_verification_status = 'verified',
            updated_at = now()
        WHERE user_id = $1
          AND provider = 'local'
          AND lower(email) = lower($2)
          AND status = 'active'
        `,
        [userId, row.email],
      )
    }

    const membershipId = membershipIdFor(userId, row.tenant_id)
    await client.query(
      `
      INSERT INTO tenant_memberships (
        id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, false, 'active', now(), now())
      ON CONFLICT (tenant_id, user_id)
      DO UPDATE SET roles = EXCLUDED.roles,
                    status = 'active',
                    updated_at = now()
      `,
      [membershipId, row.tenant_id, userId, row.roles],
    )
    await client.query(
      `
      INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
      VALUES ($1, $2, $3, now(), now())
      ON CONFLICT (membership_id) DO NOTHING
      `,
      [membershipId, defaultPlan, defaultCredits],
    )
    await client.query(
      `
      UPDATE tenant_invitations
      SET status = 'accepted',
          accepted_at = now(),
          updated_at = now()
      WHERE id = $1
      `,
      [row.invitation_id],
    )

    return await this.readAccountWorkspace(client, userId, row.tenant_id)
  }

  async listUserWorkspaces(userId: string): Promise<WorkspaceMembership[]> {
    const result = await this.database.query<AccountWorkspaceRow>(
      accountWorkspaceSelectSql(`
        WHERE u.id = $1
          AND u.status = 'active'
          AND m.status = 'active'
          AND t.status = 'active'
        ORDER BY m.is_primary DESC, m.created_at ASC
      `),
      [userId],
    )
    return result.rows.map((row) => ({
      workspace: toWorkspace(row),
      organization: toWorkspace(row),
      membership: toMembership(row),
    }))
  }

  async isSystemTenant(tenantId: string): Promise<boolean> {
    const result = await this.database.query<{ is_system: boolean }>(
      `
      SELECT is_system
      FROM tenants
      WHERE id = $1
      LIMIT 1
      `,
      [tenantId],
    )
    return result.rows[0]?.is_system === true
  }

  async findActiveAccountWorkspace(userId: string, tenantId: string): Promise<AccountWorkspace | null> {
    const result = await this.database.query<AccountWorkspaceRow>(
      accountWorkspaceSelectSql(`
        WHERE u.id = $1
          AND m.tenant_id = $2
          AND u.status = 'active'
          AND m.status = 'active'
          AND t.status = 'active'
        LIMIT 1
      `),
      [userId, tenantId],
    )
    const row = result.rows[0]
    return row
      ? {
          account: toAccountWorkspaceAccount(row),
          workspace: toWorkspace(row),
          membership: toMembership(row),
        }
      : null
  }

  async updateWorkspaceName(tenantId: string, name: string): Promise<Workspace | null> {
    const updated = await this.database.query<WorkspaceRow>(
      `
      UPDATE tenants
      SET name = $2,
          updated_at = now()
      WHERE id = $1
        AND status = 'active'
      RETURNING id, name, status, created_at, updated_at
      `,
      [tenantId, name],
    )
    return updated.rows[0] ? toWorkspaceSummary(updated.rows[0]) : null
  }

  async transferOrganizationAdmin(input: {
    tenantId: string
    currentOrganizationAdminUserId: string
    targetUserId: string
  }): Promise<TransferOrganizationAdminResult> {
    return this.database.transaction(async (client) => {
      const currentOrganizationAdmin = await client.query<{ id: string; roles: Role[] }>(
        `
        SELECT m.id, m.roles
        FROM tenant_memberships m
        JOIN users u ON u.id = m.user_id AND u.status = 'active'
        JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
        WHERE m.tenant_id = $1
          AND m.user_id = $2
          AND m.status = 'active'
          AND m.roles @> ARRAY['organization_admin']::text[]
        LIMIT 1
        FOR UPDATE OF m
        `,
        [input.tenantId, input.currentOrganizationAdminUserId],
      )
      if (!currentOrganizationAdmin.rows[0]) return { kind: 'missing' }

      const target = await client.query<{ id: string; roles: Role[] }>(
        `
        SELECT m.id, m.roles
        FROM tenant_memberships m
        JOIN users u ON u.id = m.user_id AND u.status = 'active'
        JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
        WHERE m.tenant_id = $1
          AND m.user_id = $2
          AND m.status = 'active'
          AND m.roles @> ARRAY['organization_member']::text[]
        LIMIT 1
        FOR UPDATE OF m
        `,
        [input.tenantId, input.targetUserId],
      )
      if (!target.rows[0]) return { kind: 'target_missing' }

      await client.query(
        `
        UPDATE tenant_memberships
        SET roles = $3,
            updated_at = now()
        WHERE tenant_id = $1
          AND user_id = $2
        `,
        [input.tenantId, input.currentOrganizationAdminUserId, ['organization_member']],
      )
      await client.query(
        `
        UPDATE tenant_memberships
        SET roles = ARRAY['organization_admin']::text[],
            updated_at = now()
        WHERE tenant_id = $1
          AND user_id = $2
        `,
        [input.tenantId, input.targetUserId],
      )

      const previousOrganizationAdmin = await readMembership(
        client,
        input.tenantId,
        input.currentOrganizationAdminUserId,
      )
      const newOrganizationAdmin = await readMembership(client, input.tenantId, input.targetUserId)
      if (!previousOrganizationAdmin || !newOrganizationAdmin) {
        throw new Error(`Could not read transferred organization admin ${input.tenantId}`)
      }
      return { kind: 'transferred', previousOrganizationAdmin, newOrganizationAdmin }
    })
  }

  async transferOrganizationAdminByTenant(input: {
    tenantId: string
    currentOrganizationAdminUserId: string
    targetUserId: string
  }): Promise<TransferOrganizationAdminResult> {
    return this.transferOrganizationAdmin(input)
  }

  async leaveWorkspace(userId: string, tenantId: string): Promise<LeaveWorkspaceResult> {
    return this.database.transaction(async (client) => {
      const membership = await client.query<{ id: string; roles: Role[] }>(
        `
        SELECT m.id, m.roles
        FROM tenant_memberships m
        JOIN users u ON u.id = m.user_id AND u.status = 'active'
        JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
        WHERE m.user_id = $1
          AND m.tenant_id = $2
          AND m.status = 'active'
        LIMIT 1
        FOR UPDATE OF m
        `,
        [userId, tenantId],
      )
      const row = membership.rows[0]
      if (!row) return { kind: 'missing' }
      if (row.roles.includes('owner')) {
        const owners = await client.query<{ count: number }>(
          `
          SELECT count(*)::int AS count
          FROM tenant_memberships m
          JOIN users u ON u.id = m.user_id AND u.status = 'active'
          WHERE m.tenant_id = $1
            AND m.status = 'active'
            AND m.roles @> ARRAY['owner']::text[]
          `,
          [tenantId],
        )
        if ((owners.rows[0]?.count ?? 0) <= 1) return { kind: 'last_owner' }
      }

      const currentMembership = await readMembership(client, tenantId, userId)
      if (!currentMembership) return { kind: 'missing' }
      await client.query(
        `
        UPDATE tenant_memberships
        SET status = 'disabled',
            updated_at = now()
        WHERE id = $1
        `,
        [row.id],
      )
      await client.query(
        `
        UPDATE sessions
        SET revoked_at = now()
        WHERE membership_id = $1
          AND revoked_at IS NULL
        `,
        [row.id],
      )
      const nextWorkspace = await readNextAccountWorkspace(client, userId, tenantId)
      return { kind: 'left', membership: currentMembership, nextWorkspace }
    })
  }

  async disableWorkspace(userId: string, tenantId: string): Promise<DisableWorkspaceResult> {
    return this.database.transaction(async (client) => {
      const workspace = await client.query<WorkspaceRow>(
        `
        UPDATE tenants
        SET status = 'disabled',
            updated_at = now()
        WHERE id = $1
          AND status = 'active'
        RETURNING id, name, status, created_at, updated_at
        `,
        [tenantId],
      )
      const row = workspace.rows[0]
      if (!row) return { kind: 'missing' }

      await client.query(
        `
        UPDATE sessions s
        SET revoked_at = now()
        FROM tenant_memberships m
        WHERE s.membership_id = m.id
          AND m.tenant_id = $1
          AND s.revoked_at IS NULL
        `,
        [tenantId],
      )
      const nextWorkspace = await readNextAccountWorkspace(client, userId, tenantId)
      return { kind: 'disabled', workspace: toWorkspaceSummary(row), nextWorkspace }
    })
  }

  async addMemberByEmail(input: {
    tenantId: string
    email: string
    roles: Role[]
  }): Promise<Membership | null> {
    return this.database.transaction(async (client) => {
      const account = await client.query<{ user_id: string }>(
        `
        SELECT u.id AS user_id
        FROM auth_identities ai
        JOIN users u ON u.id = ai.user_id AND u.status = 'active'
        WHERE ai.provider = 'local'
          AND lower(ai.email) = lower($1)
          AND ai.status = 'active'
          AND ai.password_hash IS NOT NULL
        ORDER BY ai.is_primary DESC, ai.created_at ASC
        LIMIT 1
        `,
        [input.email],
      )
      const userId = account.rows[0]?.user_id
      if (!userId) return null

      const membershipId = membershipIdFor(userId, input.tenantId)
      await client.query(
        `
        INSERT INTO tenant_memberships (
          id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, false, 'active', now(), now())
        ON CONFLICT (tenant_id, user_id)
        DO UPDATE SET roles = EXCLUDED.roles,
                      status = 'active',
                      updated_at = now()
        `,
        [membershipId, input.tenantId, userId, input.roles],
      )
      await client.query(
        `
        INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
        VALUES ($1, $2, $3, now(), now())
        ON CONFLICT (membership_id) DO NOTHING
        `,
        [membershipId, defaultPlan, defaultCredits],
      )
      const member = await client.query<MembershipRow>(
        membershipSelectSql('WHERE m.tenant_id = $1 AND m.user_id = $2'),
        [input.tenantId, userId],
      )
      return member.rows[0] ? toMembership(member.rows[0]) : null
    })
  }

  async createTenantUser(input: {
    tenantId: string
    email: string
    name: string
    passwordHash: string
    roles: Role[]
  }): Promise<CreateTenantUserResult> {
    return this.database.transaction(async (client) => {
      const tenant = await client.query<{ id: string }>(
        `
        SELECT id
        FROM tenants
        WHERE id = $1
          AND status = 'active'
        LIMIT 1
        `,
        [input.tenantId],
      )
      if (!tenant.rows.length) return { kind: 'tenant_missing' }

      const existingIdentity = await client.query<{ id: string }>(
        `
        SELECT id
        FROM auth_identities
        WHERE provider = 'local'
          AND lower(email) = lower($1)
        LIMIT 1
        `,
        [input.email],
      )
      if (existingIdentity.rows.length) return { kind: 'duplicate' }

      const userId = `user-${randomUUID()}`
      const membershipId = membershipIdFor(userId, input.tenantId)
      await client.query(
        `
        INSERT INTO users (
          id, display_name, status, password_reset_required, password_reset_required_at,
          created_at, updated_at
        )
        VALUES ($1, $2, 'active', true, now(), now(), now())
        `,
        [userId, input.name],
      )
      await client.query(
        `
          INSERT INTO auth_identities (
            id, user_id, provider, provider_subject, email, password_hash, is_primary, status,
            email_verified_at, email_verification_status, created_at, updated_at
          )
          VALUES ($1, $2, 'local', $3, $3, $4, true, 'active', now(), 'verified', now(), now())
        `,
        [authIdentityIdFor(userId), userId, input.email, input.passwordHash],
      )
      await client.query(
        `
        INSERT INTO tenant_memberships (
          id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, false, 'active', now(), now())
        `,
        [membershipId, input.tenantId, userId, input.roles],
      )
      await client.query(
        `
        INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
        VALUES ($1, $2, $3, now(), now())
        `,
        [membershipId, defaultPlan, defaultCredits],
      )

      const member = await client.query<MembershipRow>(
        membershipSelectSql('WHERE m.tenant_id = $1 AND m.user_id = $2'),
        [input.tenantId, userId],
      )
      if (!member.rows[0]) throw new Error(`Could not read created membership ${membershipId}`)
      return { kind: 'created', membership: toMembership(member.rows[0]) }
    })
  }

  async listMembers(tenantId: string): Promise<Membership[]> {
    const result = await this.database.query<MembershipRow>(membershipSelectSql('WHERE m.tenant_id = $1'), [
      tenantId,
    ])
    return result.rows.map(toMembership)
  }

  async findMembership(tenantId: string, userId: string): Promise<Membership | null> {
    const result = await this.database.query<MembershipRow>(
      membershipSelectSql('WHERE m.tenant_id = $1 AND m.user_id = $2'),
      [tenantId, userId],
    )
    return result.rows[0] ? toMembership(result.rows[0]) : null
  }

  async countActiveOwners(tenantId: string): Promise<number> {
    const result = await this.database.query<{ count: string }>(
      `
      SELECT count(*) AS count
      FROM tenant_memberships
      WHERE tenant_id = $1
        AND status = 'active'
        AND roles @> ARRAY['owner']::text[]
      `,
      [tenantId],
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async countActiveUsersWithRole(
    role: Extract<Role, 'owner' | 'super_admin'>,
    excludeUserId?: string,
  ): Promise<number> {
    const result = await this.database.query<{ count: string }>(
      `
      SELECT count(DISTINCT m.user_id) AS count
      FROM tenant_memberships m
      JOIN users u ON u.id = m.user_id AND u.status = 'active'
      WHERE m.status = 'active'
        AND m.roles @> ARRAY[$1]::text[]
        AND ($2::text IS NULL OR m.user_id <> $2)
      `,
      [role, excludeUserId ?? null],
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async updateMembershipRoles(tenantId: string, userId: string, roles: Role[]): Promise<Membership | null> {
    const result = await this.database.transaction(async (client) => {
      const updated = await client.query<{ id: string }>(
        `
        UPDATE tenant_memberships
        SET roles = $3,
            updated_at = now()
        WHERE tenant_id = $1
          AND user_id = $2
          AND status = 'active'
        RETURNING id
        `,
        [tenantId, userId, roles],
      )
      return updated.rows[0]?.id ?? null
    })
    return result ? this.findMembership(tenantId, userId) : null
  }

  async disableMembership(tenantId: string, userId: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const updated = await client.query<{ id: string }>(
        `
        UPDATE tenant_memberships
        SET status = 'disabled',
            updated_at = now()
        WHERE tenant_id = $1
          AND user_id = $2
          AND status = 'active'
        RETURNING id
        `,
        [tenantId, userId],
      )
      const membershipId = updated.rows[0]?.id
      if (!membershipId) return false
      await client.query(
        `
        UPDATE sessions
        SET revoked_at = now()
        WHERE membership_id = $1
          AND revoked_at IS NULL
        `,
        [membershipId],
      )
      return true
    })
  }

  async disableAccount(userId: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const updated = await client.query(
        `
        UPDATE users
        SET status = 'disabled',
            updated_at = now()
        WHERE id = $1
          AND status = 'active'
        `,
        [userId],
      )
      if ((updated.rowCount ?? 0) === 0) return false
      await client.query(
        `
        UPDATE auth_identities
        SET status = 'disabled',
            updated_at = now()
        WHERE user_id = $1
        `,
        [userId],
      )
      await client.query(
        `
        UPDATE tenant_memberships
        SET status = 'disabled',
            updated_at = now()
        WHERE user_id = $1
        `,
        [userId],
      )
      await client.query(
        `
        UPDATE sessions s
        SET revoked_at = now()
        FROM tenant_memberships m
        WHERE s.membership_id = m.id
          AND m.user_id = $1
          AND s.revoked_at IS NULL
        `,
        [userId],
      )
      return true
    })
  }

  async listUserSessions(
    userId: string,
    tenantId: string,
    currentSessionId: string | null,
  ): Promise<SessionSummary[]> {
    const result = await this.database.query<SessionRow>(
      `
      SELECT
        s.id AS session_id,
        m.user_id,
        m.tenant_id,
        t.name AS tenant_name,
        m.roles,
        s.created_at,
        s.last_seen_at,
        s.expires_at,
        s.revoked_at,
        s.ip_address,
        s.user_agent,
        s.device_label
      FROM sessions s
      JOIN tenant_memberships m ON m.id = s.membership_id
      JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
        AND m.tenant_id = $2
      ORDER BY s.created_at DESC
      `,
      [userId, tenantId],
    )
    return result.rows.map((row) => toSessionSummary(row, currentSessionId))
  }

  async listTenantSessions(tenantId: string, currentSessionId: string | null): Promise<SessionSummary[]> {
    const result = await this.database.query<SessionRow>(
      `
      SELECT
        s.id AS session_id,
        m.user_id,
        m.tenant_id,
        t.name AS tenant_name,
        m.roles,
        s.created_at,
        s.last_seen_at,
        s.expires_at,
        s.revoked_at,
        s.ip_address,
        s.user_agent,
        s.device_label
      FROM sessions s
      JOIN tenant_memberships m ON m.id = s.membership_id
      JOIN tenants t ON t.id = m.tenant_id
      WHERE m.tenant_id = $1
      ORDER BY s.created_at DESC
      `,
      [tenantId],
    )
    return result.rows.map((row) => toSessionSummary(row, currentSessionId))
  }

  async findTenantSession(tenantId: string, sessionId: string): Promise<SessionSummary | null> {
    const result = await this.database.query<SessionRow>(
      `
      SELECT
        s.id AS session_id,
        m.user_id,
        m.tenant_id,
        t.name AS tenant_name,
        m.roles,
        s.created_at,
        s.last_seen_at,
        s.expires_at,
        s.revoked_at,
        s.ip_address,
        s.user_agent,
        s.device_label
      FROM sessions s
      JOIN tenant_memberships m ON m.id = s.membership_id
      JOIN tenants t ON t.id = m.tenant_id
      WHERE m.tenant_id = $1
        AND s.id = $2
      LIMIT 1
      `,
      [tenantId, sessionId],
    )
    return result.rows[0] ? toSessionSummary(result.rows[0], null) : null
  }

  async revokeUserSession(userId: string, tenantId: string, sessionId: string): Promise<boolean> {
    const result = await this.database.query(
      `
      UPDATE sessions s
      SET revoked_at = now()
      FROM tenant_memberships m
      WHERE s.membership_id = m.id
        AND s.id = $1
        AND m.user_id = $2
        AND m.tenant_id = $3
        AND s.revoked_at IS NULL
      `,
      [sessionId, userId, tenantId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async revokeTenantSession(tenantId: string, sessionId: string): Promise<boolean> {
    const result = await this.database.query(
      `
      UPDATE sessions s
      SET revoked_at = now()
      FROM tenant_memberships m
      WHERE s.membership_id = m.id
        AND s.id = $1
        AND m.tenant_id = $2
        AND s.revoked_at IS NULL
      `,
      [sessionId, tenantId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async recordAuditLog(input: AuditLogInput): Promise<void> {
    await insertAuditLog(this.database, input)
  }

  private async readAccountWorkspace(
    client: Queryable,
    userId: string,
    tenantId: string,
  ): Promise<AccountWorkspace> {
    const result = await client.query<AccountWorkspaceRow>(
      accountWorkspaceSelectSql(`
        WHERE u.id = $1
          AND m.tenant_id = $2
        LIMIT 1
      `),
      [userId, tenantId],
    )
    const row = result.rows[0]
    if (!row) throw new Error(`Could not read account workspace ${tenantId} for ${userId}`)
    return {
      account: toAccountWorkspaceAccount(row),
      workspace: toWorkspace(row),
      membership: toMembership(row),
    }
  }
}

type Queryable = {
  query<T extends { [key: string]: unknown } = { [key: string]: unknown }>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>
}

type AccountWorkspaceRow = MembershipRow & {
  password_hash: string | null
  password_reset_required: boolean
  email_verified: boolean
  plan: Plan
  credits: number
  tenant_status: Workspace['status']
  tenant_created_at: Date | string
  tenant_updated_at: Date | string
}

type WorkspaceRow = {
  id: string
  name: string
  status: Workspace['status']
  created_at: Date | string
  updated_at: Date | string
}

type MembershipRow = {
  id: string
  email: string
  name: string
  membership_id: string
  tenant_id: string
  tenant_name: string
  roles: Role[]
  membership_status: Membership['status']
  is_primary: boolean
  membership_created_at: Date | string
  membership_updated_at: Date | string
}

type SessionRow = {
  session_id: string
  user_id: string
  tenant_id: string
  tenant_name: string
  roles: Role[]
  created_at: Date | string
  last_seen_at: Date | string | null
  expires_at: Date | string
  revoked_at: Date | string | null
  ip_address: string | null
  user_agent: string | null
  device_label: string | null
}

type RegistrationCodeRow = {
  code_matches: boolean
  expires_at: Date | string
  attempts: number
  consumed_at: Date | string | null
}

type TenantInvitationRow = {
  invitation_id: string
  tenant_id: string
  tenant_name: string
  email: string | null
  roles: Role[]
  invitation_status: TenantInvitation['status']
  invited_by_user_id: string
  expires_at: Date | string
  accepted_at: Date | string | null
  revoked_at: Date | string | null
  invitation_created_at: Date | string
  invitation_updated_at: Date | string
}

function accountWorkspaceSelectSql(whereClause: string): string {
  return `
    SELECT
      u.id,
      ai.email,
      u.display_name AS name,
      ai.password_hash,
      u.password_reset_required,
      COALESCE(ai.email_verification_status = 'verified', false) AS email_verified,
      m.id AS membership_id,
      m.tenant_id,
      m.roles,
      m.status AS membership_status,
      m.is_primary,
      m.created_at AS membership_created_at,
      m.updated_at AS membership_updated_at,
      t.name AS tenant_name,
      t.status AS tenant_status,
      t.created_at AS tenant_created_at,
      t.updated_at AS tenant_updated_at,
      b.plan,
      b.credits
    FROM users u
    JOIN tenant_memberships m ON m.user_id = u.id
    JOIN tenants t ON t.id = m.tenant_id
    JOIN billing_accounts b ON b.membership_id = m.id
    LEFT JOIN LATERAL (
      SELECT email, password_hash, email_verification_status
      FROM auth_identities ai
      WHERE ai.user_id = u.id
        AND ai.provider = 'local'
        AND ai.status = 'active'
      ORDER BY ai.is_primary DESC, ai.created_at ASC
      LIMIT 1
    ) ai ON true
    ${whereClause}
  `
}

function invitationSelectSql(whereClause: string): string {
  return `
    SELECT
      i.id AS invitation_id,
      i.tenant_id,
      t.name AS tenant_name,
      i.email,
      i.roles,
      CASE
        WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired'
        ELSE i.status
      END AS invitation_status,
      i.invited_by_user_id,
      i.expires_at,
      i.accepted_at,
      i.revoked_at,
      i.created_at AS invitation_created_at,
      i.updated_at AS invitation_updated_at
    FROM tenant_invitations i
    JOIN tenants t ON t.id = i.tenant_id
    ${whereClause}
  `
}

function membershipSelectSql(whereClause: string): string {
  return `
    SELECT
      u.id,
      ai.email,
      u.display_name AS name,
      m.id AS membership_id,
      m.tenant_id,
      t.name AS tenant_name,
      m.roles,
      m.status AS membership_status,
      m.is_primary,
      m.created_at AS membership_created_at,
      m.updated_at AS membership_updated_at
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id
    JOIN tenants t ON t.id = m.tenant_id
    LEFT JOIN LATERAL (
      SELECT email
      FROM auth_identities ai
      WHERE ai.user_id = u.id
        AND ai.provider = 'local'
      ORDER BY ai.is_primary DESC, ai.created_at ASC
      LIMIT 1
    ) ai ON true
    ${whereClause}
    ORDER BY m.created_at ASC
  `
}

function membershipIdFor(userId: string, tenantId: string): string {
  return `membership-${tenantId}-${userId}`
}

function authIdentityIdFor(userId: string): string {
  return `identity-${userId}`
}

async function readInvitationById(client: Queryable, invitationId: string): Promise<TenantInvitation | null> {
  const result = await client.query<TenantInvitationRow>(invitationSelectSql('WHERE i.id = $1 LIMIT 1'), [
    invitationId,
  ])
  return result.rows[0] ? toTenantInvitation(result.rows[0]) : null
}

async function readMembership(
  client: Queryable,
  tenantId: string,
  userId: string,
): Promise<Membership | null> {
  const result = await client.query<MembershipRow>(
    membershipSelectSql('WHERE m.tenant_id = $1 AND m.user_id = $2'),
    [tenantId, userId],
  )
  return result.rows[0] ? toMembership(result.rows[0]) : null
}

async function readNextAccountWorkspace(
  client: Queryable,
  userId: string,
  excludedTenantId: string,
): Promise<AccountWorkspace | null> {
  const result = await client.query<AccountWorkspaceRow>(
    accountWorkspaceSelectSql(`
      WHERE u.id = $1
        AND m.tenant_id <> $2
        AND u.status = 'active'
        AND m.status = 'active'
        AND t.status = 'active'
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1
    `),
    [userId, excludedTenantId],
  )
  const row = result.rows[0]
  return row
    ? {
        account: toAccountWorkspaceAccount(row),
        workspace: toWorkspace(row),
        membership: toMembership(row),
      }
    : null
}

async function readWorkspaceCreationRole(client: Queryable, userId: string): Promise<Role> {
  const result = await client.query<{ roles: Role[] }>(
    `
    SELECT roles
    FROM tenant_memberships
    WHERE user_id = $1
      AND status = 'active'
    ORDER BY is_primary DESC, created_at ASC
    LIMIT 1
    `,
    [userId],
  )
  const roles = result.rows[0]?.roles ?? []
  if (roles.includes('organization_admin')) return 'organization_admin'
  return 'member'
}

function toWorkspaceSummary(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

function toWorkspace(row: AccountWorkspaceRow): Workspace {
  return {
    id: row.tenant_id,
    name: row.tenant_name,
    status: row.tenant_status,
    createdAt: toIso(row.tenant_created_at),
    updatedAt: toIso(row.tenant_updated_at),
  }
}

function toAccountWorkspaceAccount(row: AccountWorkspaceRow): AuthAccount {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash ?? '',
    tenantId: row.tenant_id,
    organizationId: row.tenant_id,
    roles: row.roles,
    plan: row.plan,
    credits: row.credits,
    passwordResetRequired: row.password_reset_required,
    emailVerified: row.email_verified,
  }
}

function toMembership(row: MembershipRow): Membership {
  return {
    id: row.membership_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    organizationId: row.tenant_id,
    organizationName: row.tenant_name,
    userId: row.id,
    email: row.email,
    name: row.name,
    roles: row.roles,
    status: row.membership_status,
    isPrimary: row.is_primary,
    createdAt: toIso(row.membership_created_at),
    updatedAt: toIso(row.membership_updated_at),
  }
}

function toTenantInvitation(row: TenantInvitationRow): TenantInvitation {
  return {
    id: row.invitation_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    organizationId: row.tenant_id,
    organizationName: row.tenant_name,
    email: row.email,
    roles: row.roles,
    status: row.invitation_status,
    invitedByUserId: row.invited_by_user_id,
    expiresAt: toIso(row.expires_at),
    acceptedAt: row.accepted_at ? toIso(row.accepted_at) : null,
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    createdAt: toIso(row.invitation_created_at),
    updatedAt: toIso(row.invitation_updated_at),
  }
}

function isPostgresUniqueConstraint(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') return false
  const details = error as { code?: unknown; constraint?: unknown }
  return details.code === '23505' && details.constraint === constraint
}

function toSessionSummary(row: SessionRow, currentSessionId: string | null): SessionSummary {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    organizationId: row.tenant_id,
    organizationName: row.tenant_name,
    roles: row.roles,
    createdAt: toIso(row.created_at),
    lastSeenAt: row.last_seen_at ? toIso(row.last_seen_at) : null,
    expiresAt: toIso(row.expires_at),
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    deviceLabel: row.device_label,
    current: currentSessionId === row.session_id,
  }
}

async function insertAuditLog(client: Queryable, input: AuditLogInput): Promise<void> {
  await client.query(
    `
    INSERT INTO audit_log_entries (
      id, tenant_id, user_id, actor_user_id, action, resource_type, resource_id,
      ip_address, user_agent, metadata, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
    `,
    [
      `audit-${randomUUID()}`,
      input.tenantId,
      input.userId,
      input.actorUserId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.ipAddress,
      input.userAgent,
      JSON.stringify(input.metadata ?? {}),
    ],
  )
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
