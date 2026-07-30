import type {
  AcceptTenantInvitationInput,
  Account,
  AddTenantMemberInput,
  CreatedTenantInvitation,
  CreateTenantInvitationInput,
  CreateTenantUserInput,
  CreateWorkspaceInput,
  Membership,
  Principal,
  RegisterAccountInput,
  Role,
  Session,
  SessionSummary,
  TenantInvitation,
  TransferWorkspaceOwnerInput,
  UpdateMembershipRolesInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceMembership,
} from '@seqora/contracts'
import { ROLES } from '@seqora/contracts'
import { createHash, randomBytes } from 'node:crypto'
import { permissionsFor } from '../../core/auth/authorization.js'
import { hashPassword, verifyPassword } from '../../core/auth/password.js'
import {
  hashSessionSecret,
  issueSessionToken,
  parseIssuedSessionToken,
} from '../../core/auth/sessionToken.js'
import { AppError } from '../../core/errors.js'
import type { AppStore } from '../../infra/store.js'
import type { SessionMetadata } from '../auth/accounts.js'
import type { UserRepository } from '../users/repository.js'
import { AccountManagementRepository, type AccountWorkspace } from './repository.js'

const invitationLifetimeSeconds = 60 * 60 * 24 * 7

export class AccountManagementService {
  constructor(
    private readonly accounts: AccountManagementRepository,
    private readonly users: UserRepository,
    private readonly store: AppStore,
    private readonly secret: string,
    _webOrigin: string,
  ) {}

  async createWorkspace(
    principal: Principal,
    input: CreateWorkspaceInput,
    metadata?: SessionMetadata,
  ): Promise<{
    session: Session
    token: string
    workspace: Workspace
  }> {
    const current = await this.requireCurrentAccount(principal)
    const created = await this.accounts.createWorkspaceForUser(current.id, normalizeName(input.name))
    if (!created) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
    }
    await this.accounts.recordAuditLog({
      tenantId: created.workspace.id,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'workspace.created',
      resourceType: 'tenant',
      resourceId: created.workspace.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: { name: created.workspace.name },
    })
    return await this.issueSession(created, metadata)
  }

  async listWorkspaces(principal: Principal): Promise<WorkspaceMembership[]> {
    await this.requireCurrentAccount(principal)
    return await this.accounts.listUserWorkspaces(principal.userId)
  }

  async updateWorkspace(
    principal: Principal,
    tenantId: string,
    input: UpdateWorkspaceInput,
    metadata?: SessionMetadata,
  ): Promise<Workspace> {
    this.requireTenantScope(principal, tenantId)
    this.requireTenantManager(principal)
    await this.requireCurrentAccount(principal)
    const updated = await this.accounts.updateWorkspaceName(tenantId, normalizeName(input.name))
    if (!updated) {
      throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace does not exist')
    }
    await this.accounts.recordAuditLog({
      tenantId,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'workspace.updated',
      resourceType: 'tenant',
      resourceId: tenantId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: { name: updated.name },
    })
    return updated
  }

  async switchWorkspace(
    principal: Principal,
    tenantId: string,
    metadata?: SessionMetadata,
  ): Promise<{
    session: Session
    token: string
    workspace: Workspace
  }> {
    await this.requireCurrentAccount(principal)
    const workspace = await this.accounts.findActiveAccountWorkspace(principal.userId, tenantId)
    if (!workspace) {
      throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace does not exist or membership is disabled')
    }
    return await this.issueSession(workspace, metadata)
  }

  async disableWorkspace(
    principal: Principal,
    tenantId: string,
    metadata?: SessionMetadata,
  ): Promise<{ session: Session; token: string; workspace: Workspace } | null> {
    this.requireTenantScope(principal, tenantId)
    this.requireOwner(principal, 'Only owners can disable workspaces')
    await this.requireCurrentAccount(principal)
    const result = await this.accounts.disableWorkspace(principal.userId, tenantId)
    if (result.kind === 'missing') {
      throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace does not exist')
    }
    await this.store.mutate((state) => {
      state.users = state.users.filter((item) => item.tenantId !== tenantId)
    })
    await this.accounts.recordAuditLog({
      tenantId,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'workspace.disabled',
      resourceType: 'tenant',
      resourceId: tenantId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: { name: result.workspace.name },
    })
    return result.nextWorkspace ? await this.issueSession(result.nextWorkspace, metadata) : null
  }

  async transferWorkspaceOwner(
    principal: Principal,
    tenantId: string,
    input: TransferWorkspaceOwnerInput,
    metadata?: SessionMetadata,
  ): Promise<{ previousOwner: Membership; newOwner: Membership }> {
    this.requireTenantScope(principal, tenantId)
    this.requireOwner(principal, 'Only owners can transfer workspace ownership')
    await this.requireCurrentAccount(principal)
    if (principal.userId === input.targetUserId) {
      throw new AppError(400, 'CANNOT_TRANSFER_OWNER_TO_SELF', 'Cannot transfer ownership to yourself')
    }
    const result = await this.accounts.transferWorkspaceOwner({
      tenantId,
      currentOwnerUserId: principal.userId,
      targetUserId: input.targetUserId,
      previousOwnerRole: input.previousOwnerRole,
    })
    if (result.kind === 'missing') {
      throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace owner membership does not exist')
    }
    if (result.kind === 'target_missing') {
      throw new AppError(404, 'TARGET_MEMBERSHIP_NOT_FOUND', 'Target member does not exist')
    }
    await this.mirrorMembership(result.previousOwner)
    await this.mirrorMembership(result.newOwner)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: result.newOwner.userId,
      actorUserId: principal.userId,
      action: 'workspace.owner.transferred',
      resourceType: 'tenant',
      resourceId: tenantId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: {
        previousOwnerUserId: result.previousOwner.userId,
        newOwnerUserId: result.newOwner.userId,
        previousOwnerRole: input.previousOwnerRole,
      },
    })
    return { previousOwner: result.previousOwner, newOwner: result.newOwner }
  }

  async leaveWorkspace(
    principal: Principal,
    tenantId: string,
    metadata?: SessionMetadata,
  ): Promise<{ session: Session; token: string; workspace: Workspace } | null> {
    this.requireTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    const result = await this.accounts.leaveWorkspace(principal.userId, tenantId)
    if (result.kind === 'missing') {
      throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
    }
    if (result.kind === 'last_owner') {
      throw new AppError(409, 'LAST_OWNER_CANNOT_LEAVE', 'Transfer ownership before leaving this workspace')
    }
    await this.store.mutate((state) => {
      state.users = state.users.filter(
        (item) => !(item.id === principal.userId && item.tenantId === tenantId),
      )
    })
    await this.accounts.recordAuditLog({
      tenantId,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'workspace.left',
      resourceType: 'tenant_membership',
      resourceId: result.membership.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: { roles: result.membership.roles },
    })
    return result.nextWorkspace ? await this.issueSession(result.nextWorkspace, metadata) : null
  }

  async createInvitation(
    principal: Principal,
    tenantId: string,
    input: CreateTenantInvitationInput,
  ): Promise<CreatedTenantInvitation> {
    this.requireTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    const roles = normalizeRoles(input.roles)
    this.requireAssignableRoles(principal, roles)
    const token = issueInvitationToken()
    const invitation = await this.accounts.createInvitation({
      tenantId,
      email: normalizeEmail(input.email),
      roles,
      invitedByUserId: principal.userId,
      token,
      tokenSecretHash: hashInvitationToken(token),
      expiresAt: new Date(Date.now() + invitationLifetimeSeconds * 1_000).toISOString(),
    })
    if (!invitation) {
      throw new AppError(409, 'MEMBERSHIP_ALREADY_EXISTS', 'Account is already an active member')
    }
    return invitation
  }

  async listInvitations(principal: Principal, tenantId: string): Promise<TenantInvitation[]> {
    this.requireTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    return await this.accounts.listInvitations(tenantId)
  }

  async revokeInvitation(principal: Principal, tenantId: string, invitationId: string): Promise<void> {
    this.requireTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    if (!(await this.accounts.revokeInvitation(tenantId, invitationId))) {
      throw new AppError(404, 'INVITATION_NOT_FOUND', 'Invitation does not exist')
    }
  }

  async acceptInvitation(
    input: AcceptTenantInvitationInput,
    metadata?: SessionMetadata,
  ): Promise<{ session: Session; token: string; workspace: Workspace }> {
    return await this.acceptInvitationToken(input, metadata)
  }

  async registerAccount(
    input: RegisterAccountInput,
    metadata?: SessionMetadata,
  ): Promise<{ session: Session; token: string; workspace: Workspace }> {
    return await this.acceptInvitationToken(input, metadata)
  }

  private async acceptInvitationToken(
    input: AcceptTenantInvitationInput | RegisterAccountInput,
    metadata?: SessionMetadata,
  ): Promise<{ session: Session; token: string; workspace: Workspace }> {
    const tokenSecretHash = hashInvitationToken(input.token)
    const invitation = await this.accounts.findInvitationByTokenHash(tokenSecretHash)
    if (!invitation) {
      throw new AppError(404, 'INVITATION_NOT_FOUND', 'Invitation does not exist')
    }
    if (invitation.status === 'expired') {
      throw new AppError(410, 'INVITATION_EXPIRED', 'Invitation has expired')
    }
    if (invitation.status !== 'pending') {
      throw new AppError(409, 'INVITATION_NOT_PENDING', 'Invitation is no longer pending')
    }
    if (input.email && normalizeEmail(input.email) !== normalizeEmail(invitation.email)) {
      throw new AppError(400, 'INVITATION_EMAIL_MISMATCH', 'Invitation code does not match this email')
    }

    const existing = await this.users.findByEmail(invitation.email)
    if (existing && !verifyPassword(input.password, existing.passwordHash)) {
      throw new AppError(401, 'INVITATION_ACCOUNT_PASSWORD_INVALID', 'Password is incorrect')
    }

    const accepted = await this.accounts.acceptInvitation({
      invitationId: invitation.id,
      tokenSecretHash,
      name: normalizeName(input.name),
      passwordHash: hashPassword(input.password),
      ...(existing ? { existingUserId: existing.id } : {}),
    })
    if (!accepted) {
      throw new AppError(410, 'INVITATION_EXPIRED', 'Invitation has expired')
    }
    return await this.issueSession(accepted, metadata)
  }

  async addMember(
    principal: Principal,
    tenantId: string,
    input: AddTenantMemberInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    this.requireTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    const roles = normalizeRoles(input.roles)
    this.requireAssignableRoles(principal, roles)
    const member = await this.accounts.addMemberByEmail({
      tenantId,
      email: normalizeEmail(input.email),
      roles,
    })
    if (!member) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
    }
    await this.mirrorMembership(member)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: member.userId,
      actorUserId: principal.userId,
      action: 'membership.added',
      resourceType: 'tenant_membership',
      resourceId: member.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: { roles: member.roles },
    })
    return member
  }

  async createTenantUser(
    principal: Principal,
    tenantId: string,
    input: CreateTenantUserInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    this.requireTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    const roles: Role[] = [input.role]
    this.requireAssignableRoles(principal, roles)
    const passwordHash = hashPassword(input.password)
    const result = await this.accounts.createTenantUser({
      tenantId,
      email: normalizeEmail(input.email),
      name: normalizeName(input.name),
      passwordHash,
      roles,
    })
    if (result.kind === 'duplicate') {
      throw new AppError(409, 'ACCOUNT_ALREADY_EXISTS', 'A local account already exists for this email')
    }
    if (result.kind === 'tenant_missing') {
      throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace does not exist')
    }
    await this.mirrorMembership(result.membership, passwordHash)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: result.membership.userId,
      actorUserId: principal.userId,
      action: 'account.created',
      resourceType: 'user',
      resourceId: result.membership.userId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: {
        membershipId: result.membership.id,
        roles: result.membership.roles,
      },
    })
    return result.membership
  }

  async listMembers(principal: Principal, tenantId: string): Promise<Membership[]> {
    this.requireTenantScope(principal, tenantId)
    return await this.accounts.listMembers(tenantId)
  }

  async updateMembershipRoles(
    principal: Principal,
    tenantId: string,
    userId: string,
    input: UpdateMembershipRolesInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    this.requireTenantScope(principal, tenantId)
    const roles = normalizeRoles(input.roles)
    this.requireAssignableRoles(principal, roles)
    const target = await this.requireMembership(tenantId, userId)
    this.requireCanManageMembership(principal, target, 'roles')
    if (target.roles.includes(ROLES.OWNER) && !roles.includes(ROLES.OWNER)) {
      const owners = await this.accounts.countActiveOwners(tenantId)
      if (owners <= 1) {
        throw new AppError(409, 'LAST_OWNER_CANNOT_BE_REMOVED', 'The last owner cannot be removed')
      }
    }
    const updated = await this.accounts.updateMembershipRoles(tenantId, userId, roles)
    if (!updated) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
    await this.mirrorMembership(updated)
    await this.accounts.recordAuditLog({
      tenantId,
      userId,
      actorUserId: principal.userId,
      action: 'membership.roles.updated',
      resourceType: 'tenant_membership',
      resourceId: updated.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: {
        previousRoles: target.roles,
        roles: updated.roles,
      },
    })
    return updated
  }

  async disableMembership(
    principal: Principal,
    tenantId: string,
    userId: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    this.requireTenantScope(principal, tenantId)
    if (principal.userId === userId) {
      throw new AppError(400, 'CANNOT_DISABLE_SELF_MEMBERSHIP', 'Cannot disable your current membership')
    }
    const target = await this.requireMembership(tenantId, userId)
    this.requireCanManageMembership(principal, target, 'disable')
    if (target.roles.includes(ROLES.OWNER)) {
      const owners = await this.accounts.countActiveOwners(tenantId)
      if (owners <= 1) {
        throw new AppError(409, 'LAST_OWNER_CANNOT_BE_DISABLED', 'The last owner cannot be disabled')
      }
    }
    if (!(await this.accounts.disableMembership(tenantId, userId))) {
      throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
    }
    await this.store.mutate((state) => {
      state.users = state.users.filter((item) => !(item.id === userId && item.tenantId === tenantId))
    })
    await this.accounts.recordAuditLog({
      tenantId,
      userId,
      actorUserId: principal.userId,
      action: 'membership.disabled',
      resourceType: 'tenant_membership',
      resourceId: target.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: { roles: target.roles },
    })
  }

  async disableAccount(
    principal: Principal,
    tenantId: string,
    userId: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    this.requireTenantScope(principal, tenantId)
    if (!principal.roles.includes(ROLES.OWNER)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only owners can disable accounts')
    }
    if (principal.userId === userId) {
      throw new AppError(400, 'CANNOT_DISABLE_SELF_ACCOUNT', 'Cannot disable your own account')
    }
    const target = await this.requireMembership(tenantId, userId)
    if (target.roles.includes(ROLES.OWNER)) {
      const owners = await this.accounts.countActiveOwners(tenantId)
      if (owners <= 1) {
        throw new AppError(409, 'LAST_OWNER_CANNOT_BE_DISABLED', 'The last owner cannot be disabled')
      }
    }
    if (!(await this.accounts.disableAccount(userId))) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
    }
    await this.store.mutate((state) => {
      state.users = state.users.filter((item) => item.id !== userId)
    })
    await this.accounts.recordAuditLog({
      tenantId,
      userId,
      actorUserId: principal.userId,
      action: 'account.disabled',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: { membershipId: target.id, roles: target.roles },
    })
  }

  async listSessions(
    principal: Principal,
    currentSessionToken: string | undefined,
  ): Promise<SessionSummary[]> {
    await this.requireCurrentAccount(principal)
    const currentSessionId = currentSessionIdFromToken(currentSessionToken, this.secret)
    return await this.accounts.listUserSessions(principal.userId, principal.tenantId, currentSessionId)
  }

  async listTenantSessions(
    principal: Principal,
    tenantId: string,
    currentSessionToken: string | undefined,
  ): Promise<SessionSummary[]> {
    this.requireTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    const currentSessionId = currentSessionIdFromToken(currentSessionToken, this.secret)
    return await this.accounts.listTenantSessions(tenantId, currentSessionId)
  }

  async revokeCurrentTenantSession(
    principal: Principal,
    sessionId: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    await this.requireCurrentAccount(principal)
    if (!(await this.accounts.revokeUserSession(principal.userId, principal.tenantId, sessionId))) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session does not exist')
    }
    await this.accounts.recordAuditLog({
      tenantId: principal.tenantId,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'session.revoked',
      resourceType: 'session',
      resourceId: sessionId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: { scope: 'self' },
    })
  }

  async revokeTenantSession(
    principal: Principal,
    tenantId: string,
    sessionId: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    this.requireTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    const target = await this.accounts.findTenantSession(tenantId, sessionId)
    if (!target || target.revokedAt) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session does not exist')
    }
    this.requireCanManageSession(principal, target)
    if (!(await this.accounts.revokeTenantSession(tenantId, sessionId))) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session does not exist')
    }
    await this.accounts.recordAuditLog({
      tenantId,
      userId: target.userId,
      actorUserId: principal.userId,
      action: 'session.revoked',
      resourceType: 'session',
      resourceId: sessionId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: { scope: 'tenant' },
    })
  }

  async selfWorkspace(principal: Principal): Promise<Account | null> {
    const account = await this.users.findById(principal.userId, principal.tenantId)
    return account ? this.users.toAccount(account) : null
  }

  private async issueSession(
    created: AccountWorkspace,
    metadata?: SessionMetadata,
  ): Promise<{ session: Session; token: string; workspace: Workspace }> {
    const issued = issueSessionToken(this.secret)
    const createdSession = await this.users.createSession(
      created.account.id,
      created.account.tenantId,
      issued.payload.sessionId,
      hashSessionSecret(issued.payload.tokenSecret),
      new Date(issued.payload.expiresAt * 1_000).toISOString(),
      metadata,
    )
    if (!createdSession) {
      throw new AppError(500, 'SESSION_CREATE_FAILED', 'Could not create session')
    }
    await this.mirrorWorkspace(created)
    return {
      token: issued.token,
      session: {
        account: this.users.toAccount(created.account),
        permissions: [
          ...permissionsFor({
            userId: created.account.id,
            tenantId: created.account.tenantId,
            roles: created.account.roles,
          }),
        ],
      },
      workspace: created.workspace,
    }
  }

  private async requireCurrentAccount(principal: Principal) {
    const account = await this.users.findById(principal.userId, principal.tenantId)
    if (!account || account.tenantId !== principal.tenantId) {
      throw new AppError(401, 'SESSION_INVALID', 'Session is no longer valid')
    }
    return account
  }

  private async requireMembership(tenantId: string, userId: string): Promise<Membership> {
    const membership = await this.accounts.findMembership(tenantId, userId)
    if (!membership) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
    return membership
  }

  private requireTenantScope(principal: Principal, tenantId: string): void {
    if (principal.tenantId !== tenantId) {
      throw new AppError(403, 'TENANT_SCOPE_MISMATCH', 'Cannot manage another workspace from this session')
    }
  }

  private requireAssignableRoles(principal: Principal, roles: Role[]): void {
    if (roles.includes(ROLES.OWNER) && !principal.roles.includes(ROLES.OWNER)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only owners can assign owner role')
    }
    if (roles.includes(ROLES.ADMIN) && !principal.roles.includes(ROLES.OWNER)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only owners can assign admin role')
    }
  }

  private requireTenantManager(principal: Principal): void {
    if (principal.roles.includes(ROLES.OWNER) || principal.roles.includes(ROLES.ADMIN)) return
    throw new AppError(403, 'PERMISSION_DENIED', 'Only owners or administrators can manage workspaces')
  }

  private requireOwner(principal: Principal, message: string): void {
    if (principal.roles.includes(ROLES.OWNER)) return
    throw new AppError(403, 'OWNER_REQUIRED', message)
  }

  private requireCanManageMembership(
    principal: Principal,
    target: Membership,
    action: 'roles' | 'disable',
  ): void {
    if (principal.userId === target.userId) {
      const code = action === 'roles' ? 'CANNOT_CHANGE_SELF_ROLES' : 'CANNOT_DISABLE_SELF_MEMBERSHIP'
      const message =
        action === 'roles'
          ? 'Cannot change your own membership roles'
          : 'Cannot disable your current membership'
      throw new AppError(400, code, message)
    }
    if (principal.roles.includes(ROLES.OWNER)) return
    if (hasElevatedRole(target.roles)) {
      throw new AppError(
        403,
        'ELEVATED_MEMBERSHIP_REQUIRES_OWNER',
        'Only owners can manage owner or admin memberships',
      )
    }
  }

  private requireCanManageSession(principal: Principal, target: SessionSummary): void {
    if (principal.userId === target.userId) {
      throw new AppError(400, 'CANNOT_REVOKE_SELF_SESSION', 'Use the current account session API to sign out')
    }
    if (principal.roles.includes(ROLES.OWNER)) return
    if (hasElevatedRole(target.roles)) {
      throw new AppError(
        403,
        'ELEVATED_SESSION_REQUIRES_OWNER',
        'Only owners can revoke owner or admin sessions',
      )
    }
  }

  private async mirrorWorkspace(workspace: AccountWorkspace): Promise<void> {
    await this.store.mutate((state) => {
      const next = {
        id: workspace.account.id,
        email: normalizeEmail(workspace.account.email),
        name: workspace.account.name,
        passwordHash: workspace.account.passwordHash,
        tenantId: workspace.account.tenantId,
        roles: workspace.account.roles,
        plan: workspace.account.plan,
        credits: workspace.account.credits,
      }
      const existing = state.users.find((item) => item.id === next.id && item.tenantId === next.tenantId)
      if (existing) {
        Object.assign(existing, next)
      } else {
        state.users.push(next)
      }
    })
  }

  private async mirrorMembership(membership: Membership, passwordHash?: string): Promise<void> {
    await this.store.mutate((state) => {
      const existing = state.users.find(
        (item) => item.id === membership.userId && item.tenantId === membership.tenantId,
      )
      if (existing) {
        existing.email = normalizeEmail(membership.email)
        existing.name = membership.name
        existing.roles = membership.roles
        if (passwordHash) existing.passwordHash = passwordHash
      } else if (membership.status === 'active') {
        const account = state.users.find((item) => item.id === membership.userId)
        state.users.push({
          id: membership.userId,
          email: normalizeEmail(membership.email),
          name: membership.name,
          passwordHash: passwordHash ?? account?.passwordHash ?? '',
          tenantId: membership.tenantId,
          roles: membership.roles,
          plan: account?.plan ?? 'free',
          credits: 0,
        })
      }
    })
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeName(name: string): string {
  return name.trim()
}

function normalizeRoles(roles: Role[]): Role[] {
  return [...new Set(roles)]
}

function issueInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function hasElevatedRole(roles: Role[]): boolean {
  return roles.includes(ROLES.OWNER) || roles.includes(ROLES.ADMIN)
}

function currentSessionIdFromToken(token: string | undefined, secret: string): string | null {
  if (!token) return null
  const payload = parseIssuedSessionToken(token, secret)
  return payload?.sessionId ?? null
}
