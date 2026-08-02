import type {
  AcceptTenantInvitationInput,
  Account,
  AddTenantMemberInput,
  CreatedTenantInvitation,
  CreateOrganizationInput,
  CreateTenantInvitationInput,
  CreateTenantUserInput,
  CreateWorkspaceInput,
  Membership,
  Organization,
  OrganizationMembership,
  Principal,
  RegisterAccountInput,
  Role,
  Session,
  SessionSummary,
  TenantInvitation,
  TransferOrganizationAdminInput,
  AdminTransferOrganizationAdminInput,
  UpdateMembershipRolesInput,
  UpdateOrganizationInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceMembership,
} from '@seqora/contracts'
import { ROLES } from '@seqora/contracts'
import { createHash, randomBytes } from 'node:crypto'
import { permissionsFor } from '../../core/auth/authorization.js'
import { hashPassword, verifyPassword } from '../../core/auth/password.js'
import {
  hasAdminRole,
  hasOrganizationAdminRole,
  hasOwnerRole,
  hasSuperAdminRole,
  isOwner,
  isPlatformAdmin,
  isTenantManager,
} from '../../core/auth/roles.js'
import {
  hashSessionSecret,
  issueSessionToken,
  parseIssuedSessionToken,
} from '../../core/auth/sessionToken.js'
import { NoopMailer, tokenUrl, type Mailer } from '../../core/email/mailer.js'
import { AppError } from '../../core/errors.js'
import { traceMetadata } from '../../core/observability/trace.js'
import type { AppStore } from '../../infra/store.js'
import type { SessionMetadata } from '../auth/accounts.js'
import type { UserRepository } from '../users/repository.js'
import { AccountManagementRepository, type AccountWorkspace } from './repository.js'

const invitationLifetimeSeconds = 60 * 60 * 24 * 7
const systemTenantId = 'tenant-seqora-demo'
const systemOrganizationRoles = new Set<Role>([ROLES.OWNER, ROLES.SUPER_ADMIN, ROLES.ADMIN])
type RequestEmailVerification = (
  input: { email: string },
  metadata?: SessionMetadata,
) => Promise<unknown>

export class AccountManagementService {
  constructor(
    private readonly accounts: AccountManagementRepository,
    private readonly users: UserRepository,
    private readonly store: AppStore,
    private readonly secret: string,
    private readonly webOrigin: string,
    private readonly mailer: Mailer = new NoopMailer(),
    private readonly invitationUrl: string = `${webOrigin.replace(/\/+$/, '')}/register`,
    private readonly requestEmailVerification?: RequestEmailVerification,
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
      metadata: auditMetadata(metadata, { name: created.workspace.name }),
    })
    return await this.issueSession(created, metadata)
  }

  async createOrganization(
    principal: Principal,
    input: CreateOrganizationInput,
    metadata?: SessionMetadata,
  ): Promise<{
    session: Session
    token: string
    workspace: Workspace
  }> {
    return await this.createWorkspace(principal, input, metadata)
  }

  async listWorkspaces(principal: Principal): Promise<WorkspaceMembership[]> {
    await this.requireCurrentAccount(principal)
    return await this.accounts.listUserWorkspaces(principal.userId)
  }

  async listOrganizations(principal: Principal): Promise<OrganizationMembership[]> {
    return await this.listWorkspaces(principal)
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
    await this.requireSystemOrganizationManagedByInternalAccount(principal, tenantId)
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
      metadata: auditMetadata(metadata, { name: updated.name }),
    })
    return updated
  }

  async updateOrganization(
    principal: Principal,
    tenantId: string,
    input: UpdateOrganizationInput,
    metadata?: SessionMetadata,
  ): Promise<Organization> {
    return await this.updateWorkspace(principal, tenantId, input, metadata)
  }

  async adminUpdateWorkspace(
    principal: Principal,
    tenantId: string,
    input: UpdateWorkspaceInput,
    metadata?: SessionMetadata,
  ): Promise<Workspace> {
    this.requireAdminTenantScope(principal, tenantId)
    this.requireTenantManager(principal)
    await this.requireCurrentAccount(principal)
    await this.requireSystemOrganizationManagedByInternalAccount(principal, tenantId)
    const updated = await this.accounts.updateWorkspaceName(tenantId, normalizeName(input.name))
    if (!updated) {
      throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace does not exist')
    }
    await this.accounts.recordAuditLog({
      tenantId,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'admin.workspace.updated',
      resourceType: 'tenant',
      resourceId: tenantId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, { name: updated.name, scope: 'admin_console' }),
    })
    return updated
  }

  async adminUpdateOrganization(
    principal: Principal,
    tenantId: string,
    input: UpdateOrganizationInput,
    metadata?: SessionMetadata,
  ): Promise<Organization> {
    return await this.adminUpdateWorkspace(principal, tenantId, input, metadata)
  }

  async adminCreateOrganization(
    principal: Principal,
    input: CreateOrganizationInput,
    metadata?: SessionMetadata,
  ): Promise<Organization> {
    if (!isPlatformAdmin(principal)) {
      throw new AppError(
        403,
        'PLATFORM_ADMIN_REQUIRED',
        'Only owners or super admins can create organizations from the admin console',
      )
    }
    await this.requireCurrentAccount(principal)
    const organization = await this.accounts.createOrganizationForAdmin({
      name: normalizeName(input.name),
      createdByUserId: principal.userId,
    })
    await this.accounts.recordAuditLog({
      tenantId: organization.id,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'admin.organization.created',
      resourceType: 'tenant',
      resourceId: organization.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, { name: organization.name, scope: 'admin_console' }),
    })
    return organization
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

  async switchOrganization(
    principal: Principal,
    tenantId: string,
    metadata?: SessionMetadata,
  ): Promise<{
    session: Session
    token: string
    workspace: Workspace
  }> {
    return await this.switchWorkspace(principal, tenantId, metadata)
  }

  async disableWorkspace(
    principal: Principal,
    tenantId: string,
    metadata?: SessionMetadata,
  ): Promise<{ session: Session; token: string; workspace: Workspace } | null> {
    this.requireTenantScope(principal, tenantId)
    this.requireOwner(principal, 'Only owners can disable workspaces')
    await this.requireCurrentAccount(principal)
    await this.rejectSystemOrganizationLifecycleChange(tenantId, 'System organization cannot be disabled')
    const result = await this.accounts.disableWorkspace(principal.userId, tenantId)
    if (result.kind === 'missing') {
      throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace does not exist')
    }
    this.removeTenantFromRuntimeCache(tenantId)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'workspace.disabled',
      resourceType: 'tenant',
      resourceId: tenantId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, { name: result.workspace.name }),
    })
    return result.nextWorkspace ? await this.issueSession(result.nextWorkspace, metadata) : null
  }

  async disableOrganization(
    principal: Principal,
    tenantId: string,
    metadata?: SessionMetadata,
  ): Promise<{ session: Session; token: string; workspace: Workspace } | null> {
    return await this.disableWorkspace(principal, tenantId, metadata)
  }

  async adminDisableWorkspace(
    principal: Principal,
    tenantId: string,
    metadata?: SessionMetadata,
  ): Promise<Workspace> {
    this.requireAdminTenantScope(principal, tenantId)
    this.requireOwner(principal, 'Only owners can disable workspaces')
    await this.requireCurrentAccount(principal)
    await this.rejectSystemOrganizationLifecycleChange(tenantId, 'System organization cannot be disabled')
    const result = await this.accounts.disableWorkspace(principal.userId, tenantId)
    if (result.kind === 'missing') {
      throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace does not exist')
    }
    this.removeTenantFromRuntimeCache(tenantId)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'admin.workspace.disabled',
      resourceType: 'tenant',
      resourceId: tenantId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, { name: result.workspace.name, scope: 'admin_console' }),
    })
    return result.workspace
  }

  async adminDisableOrganization(
    principal: Principal,
    tenantId: string,
    metadata?: SessionMetadata,
  ): Promise<Organization> {
    return await this.adminDisableWorkspace(principal, tenantId, metadata)
  }

  async transferOrganizationAdmin(
    principal: Principal,
    tenantId: string,
    input: TransferOrganizationAdminInput,
    metadata?: SessionMetadata,
  ): Promise<{ previousOrganizationAdmin: Membership; newOrganizationAdmin: Membership }> {
    this.requireTenantScope(principal, tenantId)
    if (!principal.roles.includes(ROLES.ORGANIZATION_ADMIN)) {
      throw new AppError(
        403,
        'ORGANIZATION_ADMIN_REQUIRED',
        'Only organization administrators can transfer organization leadership',
      )
    }
    await this.requireCurrentAccount(principal)
    await this.rejectSystemOrganizationLifecycleChange(
      tenantId,
      'System organization cannot transfer organization leadership',
    )
    if (principal.userId === input.targetUserId) {
      throw new AppError(
        400,
        'CANNOT_TRANSFER_ORGANIZATION_ADMIN_TO_SELF',
        'Cannot transfer organization leadership to yourself',
      )
    }
    const result = await this.accounts.transferOrganizationAdmin({
      tenantId,
      currentOrganizationAdminUserId: principal.userId,
      targetUserId: input.targetUserId,
    })
    if (result.kind === 'missing') {
      throw new AppError(
        404,
        'ORGANIZATION_ADMIN_MEMBERSHIP_NOT_FOUND',
        'Organization administrator membership does not exist',
      )
    }
    if (result.kind === 'target_missing') {
      throw new AppError(
        404,
        'TARGET_ORGANIZATION_MEMBER_NOT_FOUND',
        'Target organization member does not exist',
      )
    }
    this.mirrorMembership(result.previousOrganizationAdmin)
    this.mirrorMembership(result.newOrganizationAdmin)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: result.newOrganizationAdmin.userId,
      actorUserId: principal.userId,
      action: 'organization.admin.transferred',
      resourceType: 'tenant',
      resourceId: tenantId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, {
        previousOrganizationAdminUserId: result.previousOrganizationAdmin.userId,
        newOrganizationAdminUserId: result.newOrganizationAdmin.userId,
      }),
    })
    return {
      previousOrganizationAdmin: result.previousOrganizationAdmin,
      newOrganizationAdmin: result.newOrganizationAdmin,
    }
  }

  async adminTransferOrganizationAdmin(
    principal: Principal,
    tenantId: string,
    input: AdminTransferOrganizationAdminInput,
    metadata?: SessionMetadata,
  ): Promise<{ previousOrganizationAdmin: Membership; newOrganizationAdmin: Membership }> {
    this.requireAdminTenantScope(principal, tenantId)
    if (!isPlatformAdmin(principal)) {
      throw new AppError(
        403,
        'PLATFORM_ADMIN_REQUIRED',
        'Only owners or super admins can transfer organization leadership',
      )
    }
    await this.requireCurrentAccount(principal)
    await this.rejectSystemOrganizationLifecycleChange(
      tenantId,
      'System organization cannot transfer organization leadership',
    )
    if (input.currentOrganizationAdminUserId === input.targetUserId) {
      throw new AppError(
        400,
        'CANNOT_TRANSFER_ORGANIZATION_ADMIN_TO_SELF',
        'Cannot transfer organization leadership to yourself',
      )
    }
    const currentOrganizationAdmin = await this.requireMembership(
      tenantId,
      input.currentOrganizationAdminUserId,
    )
    if (!currentOrganizationAdmin.roles.includes(ROLES.ORGANIZATION_ADMIN)) {
      throw new AppError(
        409,
        'ORGANIZATION_ADMIN_MEMBERSHIP_REQUIRED',
        'Current organization leader must have organization_admin role',
      )
    }
    const result = await this.accounts.transferOrganizationAdminByTenant({
      tenantId,
      currentOrganizationAdminUserId: input.currentOrganizationAdminUserId,
      targetUserId: input.targetUserId,
    })
    if (result.kind === 'missing') {
      throw new AppError(
        404,
        'ORGANIZATION_ADMIN_MEMBERSHIP_NOT_FOUND',
        'Organization administrator membership does not exist',
      )
    }
    if (result.kind === 'target_missing') {
      throw new AppError(
        404,
        'TARGET_ORGANIZATION_MEMBER_NOT_FOUND',
        'Target organization member does not exist',
      )
    }
    this.mirrorMembership(result.previousOrganizationAdmin)
    this.mirrorMembership(result.newOrganizationAdmin)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: result.newOrganizationAdmin.userId,
      actorUserId: principal.userId,
      action: 'admin.organization.admin.transferred',
      resourceType: 'tenant',
      resourceId: tenantId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, {
        previousOrganizationAdminUserId: result.previousOrganizationAdmin.userId,
        newOrganizationAdminUserId: result.newOrganizationAdmin.userId,
        scope: 'admin_console',
      }),
    })
    return {
      previousOrganizationAdmin: result.previousOrganizationAdmin,
      newOrganizationAdmin: result.newOrganizationAdmin,
    }
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
    this.removeMembershipFromRuntimeCache(principal.userId, tenantId)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'workspace.left',
      resourceType: 'tenant_membership',
      resourceId: result.membership.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, { roles: result.membership.roles }),
    })
    return result.nextWorkspace ? await this.issueSession(result.nextWorkspace, metadata) : null
  }

  async leaveOrganization(
    principal: Principal,
    tenantId: string,
    metadata?: SessionMetadata,
  ): Promise<{ session: Session; token: string; workspace: Workspace } | null> {
    return await this.leaveWorkspace(principal, tenantId, metadata)
  }

  async createInvitation(
    principal: Principal,
    tenantId: string,
    input: CreateTenantInvitationInput,
  ): Promise<CreatedTenantInvitation> {
    this.requireTenantScope(principal, tenantId)
    return await this.createInvitationWithScope(principal, tenantId, input)
  }

  async listInvitations(principal: Principal, tenantId: string): Promise<TenantInvitation[]> {
    this.requireTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    return await this.accounts.listInvitations(tenantId)
  }

  async adminListInvitations(principal: Principal, tenantId: string): Promise<TenantInvitation[]> {
    this.requireAdminTenantScope(principal, tenantId)
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

  async adminRevokeInvitation(principal: Principal, tenantId: string, invitationId: string): Promise<void> {
    this.requireAdminTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    if (!(await this.accounts.revokeInvitation(tenantId, invitationId))) {
      throw new AppError(404, 'INVITATION_NOT_FOUND', 'Invitation does not exist')
    }
  }

  async adminCreateInvitation(
    principal: Principal,
    tenantId: string,
    input: CreateTenantInvitationInput,
  ): Promise<CreatedTenantInvitation> {
    this.requireAdminTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    return await this.createInvitationWithScope(principal, tenantId, input)
  }

  async adminCreatePlatformInvitation(
    principal: Principal,
    input: CreateTenantInvitationInput,
  ): Promise<CreatedTenantInvitation> {
    await this.requireCurrentAccount(principal)
    const roles = normalizeRoles(input.roles)
    if (roles.some(isOrganizationScopedRole)) {
      throw new AppError(
        400,
        'ORGANIZATION_REQUIRED',
        'Organization scoped roles must be invited inside an organization',
      )
    }
    if (roles.length !== 1) {
      throw new AppError(
        400,
        'SINGLE_ROLE_REQUIRED',
        'Platform invitations must assign exactly one role',
      )
    }
    this.requireAssignableRoles(principal, roles)
    await this.requireGlobalRoleCapacity(roles)

    if (roles.every(isSystemOrganizationRole)) {
      return await this.createInvitationWithScope(principal, systemTenantId, input)
    }

    const token = issueInvitationToken()
    const invitation = await this.accounts.createInvitationWithNewWorkspace({
      tenantName: personalOrganizationName(input.email.split('@')[0] ?? input.email, input.email),
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
    await this.sendInvitationEmail(invitation)
    return invitation
  }

  private async sendInvitationEmail(invitation: CreatedTenantInvitation): Promise<void> {
    const invitationUrl = tokenUrl(this.invitationUrl, invitation.token)
    await this.mailer.send({
      to: invitation.email,
      subject: `You have been invited to ${invitation.organizationName}`,
      text: [
        `You have been invited to join ${invitation.organizationName}.`,
        '',
        invitationUrl,
        '',
        `This invitation expires at ${invitation.expiresAt}.`,
      ].join('\n'),
      html: [
        `<p>You have been invited to join ${escapeHtml(invitation.organizationName)}.</p>`,
        `<p><a href="${escapeHtml(invitationUrl)}">Accept invitation</a></p>`,
        `<p>This invitation expires at ${escapeHtml(invitation.expiresAt)}.</p>`,
      ].join(''),
      purpose: 'invitation',
      idempotencyKey: `invitation:${hashInvitationToken(invitation.token)}`,
    })
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
    await this.requireGlobalRoleCapacity(invitation.roles, existing?.id)
    await this.rejectExternalSystemOrganizationRoles(invitation.tenantId, invitation.roles)

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
    await this.requestVerificationEmail(accepted.account.email, metadata)
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
    const existing = await this.users.findByEmail(normalizeEmail(input.email))
    await this.requireGlobalRoleCapacity(roles, existing?.id)
    await this.requireSystemOrganizationMembershipWrite(principal, tenantId, roles)
    const member = await this.accounts.addMemberByEmail({
      tenantId,
      email: normalizeEmail(input.email),
      roles,
    })
    if (!member) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
    }
    this.mirrorMembership(member)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: member.userId,
      actorUserId: principal.userId,
      action: 'membership.added',
      resourceType: 'tenant_membership',
      resourceId: member.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, { roles: member.roles }),
    })
    await this.requestVerificationEmail(member.email, metadata)
    return member
  }

  async addOrganizationMember(
    principal: Principal,
    tenantId: string,
    input: AddTenantMemberInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    return await this.addMember(principal, tenantId, input, metadata)
  }

  async adminAddOrganizationMember(
    principal: Principal,
    tenantId: string,
    input: AddTenantMemberInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    this.requireAdminTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    const roles = normalizeRoles(input.roles)
    this.requireAssignableRoles(principal, roles)
    const existing = await this.users.findByEmail(normalizeEmail(input.email))
    await this.requireGlobalRoleCapacity(roles, existing?.id)
    await this.requireSystemOrganizationMembershipWrite(principal, tenantId, roles)
    const member = await this.accounts.addMemberByEmail({
      tenantId,
      email: normalizeEmail(input.email),
      roles,
    })
    if (!member) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
    }
    this.mirrorMembership(member)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: member.userId,
      actorUserId: principal.userId,
      action: 'admin.membership.added',
      resourceType: 'tenant_membership',
      resourceId: member.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, { roles: member.roles, scope: 'admin_console' }),
    })
    await this.requestVerificationEmail(member.email, metadata)
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
    await this.requireGlobalRoleCapacity(roles)
    await this.requireSystemOrganizationMembershipWrite(principal, tenantId, roles)
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
    this.mirrorMembership(result.membership, passwordHash)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: result.membership.userId,
      actorUserId: principal.userId,
      action: 'account.created',
      resourceType: 'user',
      resourceId: result.membership.userId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, {
        membershipId: result.membership.id,
        roles: result.membership.roles,
      }),
    })
    await this.requestVerificationEmail(result.membership.email, metadata)
    return result.membership
  }

  async createOrganizationUser(
    principal: Principal,
    tenantId: string,
    input: CreateTenantUserInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    return await this.createTenantUser(principal, tenantId, input, metadata)
  }

  async adminCreateTenantUser(
    principal: Principal,
    tenantId: string,
    input: CreateTenantUserInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    this.requireAdminTenantScope(principal, tenantId)
    await this.requireCurrentAccount(principal)
    const roles: Role[] = [input.role]
    this.requireAssignableRoles(principal, roles)
    await this.requireGlobalRoleCapacity(roles)
    await this.requireSystemOrganizationMembershipWrite(principal, tenantId, roles)
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
    this.mirrorMembership(result.membership, passwordHash)
    await this.accounts.recordAuditLog({
      tenantId,
      userId: result.membership.userId,
      actorUserId: principal.userId,
      action: 'admin.account.created',
      resourceType: 'user',
      resourceId: result.membership.userId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, {
        membershipId: result.membership.id,
        roles: result.membership.roles,
        scope: 'admin_console',
      }),
    })
    await this.requestVerificationEmail(result.membership.email, metadata)
    return result.membership
  }

  async adminCreatePlatformUser(
    principal: Principal,
    input: CreateTenantUserInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    await this.requireCurrentAccount(principal)
    const roles: Role[] = [input.role]
    if (roles.some(isOrganizationScopedRole)) {
      throw new AppError(
        400,
        'ORGANIZATION_REQUIRED',
        'Organization scoped roles must be created inside an organization',
      )
    }
    this.requireAssignableRoles(principal, roles)
    await this.requireGlobalRoleCapacity(roles)

    if (roles.every(isSystemOrganizationRole)) {
      return await this.adminCreateTenantUser(principal, systemTenantId, input, metadata)
    }

    const passwordHash = hashPassword(input.password)
    const result = await this.accounts.createTenantUserWithNewWorkspace({
      tenantName: personalOrganizationName(input.name, input.email),
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
    this.mirrorMembership(result.membership, passwordHash)
    await this.accounts.recordAuditLog({
      tenantId: result.membership.tenantId,
      userId: result.membership.userId,
      actorUserId: principal.userId,
      action: 'admin.account.created',
      resourceType: 'user',
      resourceId: result.membership.userId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, {
        membershipId: result.membership.id,
        roles: result.membership.roles,
        scope: 'admin_console',
        personalOrganizationCreated: true,
      }),
    })
    await this.requestVerificationEmail(result.membership.email, metadata)
    return result.membership
  }

  async adminCreateOrganizationUser(
    principal: Principal,
    tenantId: string,
    input: CreateTenantUserInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    return await this.adminCreateTenantUser(principal, tenantId, input, metadata)
  }

  private async requestVerificationEmail(email: string, metadata?: SessionMetadata): Promise<void> {
    if (!this.requestEmailVerification) return
    await this.requestEmailVerification({ email }, metadata)
  }

  async listMembers(principal: Principal, tenantId: string): Promise<Membership[]> {
    this.requireTenantScope(principal, tenantId)
    return await this.accounts.listMembers(tenantId)
  }

  async listOrganizationMembers(principal: Principal, tenantId: string): Promise<Membership[]> {
    return await this.listMembers(principal, tenantId)
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
    await this.requireGlobalRoleCapacity(roles, userId)
    await this.requireSystemOrganizationMembershipWrite(principal, tenantId, roles)
    if (target.roles.includes(ROLES.OWNER) && !roles.includes(ROLES.OWNER)) {
      const owners = await this.accounts.countActiveOwners(tenantId)
      if (owners <= 1) {
        throw new AppError(409, 'LAST_OWNER_CANNOT_BE_REMOVED', 'The last owner cannot be removed')
      }
    }
    const updated = await this.accounts.updateMembershipRoles(tenantId, userId, roles)
    if (!updated) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
    this.mirrorMembership(updated)
    await this.accounts.recordAuditLog({
      tenantId,
      userId,
      actorUserId: principal.userId,
      action: 'membership.roles.updated',
      resourceType: 'tenant_membership',
      resourceId: updated.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, {
        previousRoles: target.roles,
        roles: updated.roles,
      }),
    })
    return updated
  }

  async updateOrganizationMembershipRoles(
    principal: Principal,
    tenantId: string,
    userId: string,
    input: UpdateMembershipRolesInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    return await this.updateMembershipRoles(principal, tenantId, userId, input, metadata)
  }

  async adminUpdateMembershipRoles(
    principal: Principal,
    tenantId: string,
    userId: string,
    input: UpdateMembershipRolesInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    this.requireAdminTenantScope(principal, tenantId)
    const roles = normalizeRoles(input.roles)
    this.requireAssignableRoles(principal, roles)
    const target = await this.requireMembership(tenantId, userId)
    this.requireCanManageMembership(principal, target, 'roles')
    await this.requireGlobalRoleCapacity(roles, userId)
    await this.requireSystemOrganizationMembershipWrite(principal, tenantId, roles)
    if (target.roles.includes(ROLES.OWNER) && !roles.includes(ROLES.OWNER)) {
      const owners = await this.accounts.countActiveOwners(tenantId)
      if (owners <= 1) {
        throw new AppError(409, 'LAST_OWNER_CANNOT_BE_REMOVED', 'The last owner cannot be removed')
      }
    }
    const updated = await this.accounts.updateMembershipRoles(tenantId, userId, roles)
    if (!updated) throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership does not exist')
    this.mirrorMembership(updated)
    await this.accounts.recordAuditLog({
      tenantId,
      userId,
      actorUserId: principal.userId,
      action: 'admin.membership.roles.updated',
      resourceType: 'tenant_membership',
      resourceId: updated.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, {
        previousRoles: target.roles,
        roles: updated.roles,
        scope: 'admin_console',
      }),
    })
    return updated
  }

  async adminUpdateOrganizationMembershipRoles(
    principal: Principal,
    tenantId: string,
    userId: string,
    input: UpdateMembershipRolesInput,
    metadata?: SessionMetadata,
  ): Promise<Membership> {
    return await this.adminUpdateMembershipRoles(principal, tenantId, userId, input, metadata)
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
    await this.requireSystemOrganizationManagedByInternalAccount(principal, tenantId)
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
    this.removeMembershipFromRuntimeCache(userId, tenantId)
    await this.accounts.recordAuditLog({
      tenantId,
      userId,
      actorUserId: principal.userId,
      action: 'membership.disabled',
      resourceType: 'tenant_membership',
      resourceId: target.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, { roles: target.roles }),
    })
  }

  async disableOrganizationMembership(
    principal: Principal,
    tenantId: string,
    userId: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    await this.disableMembership(principal, tenantId, userId, metadata)
  }

  async adminDisableMembership(
    principal: Principal,
    tenantId: string,
    userId: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    this.requireAdminTenantScope(principal, tenantId)
    if (principal.userId === userId) {
      throw new AppError(400, 'CANNOT_DISABLE_SELF_MEMBERSHIP', 'Cannot disable your current membership')
    }
    const target = await this.requireMembership(tenantId, userId)
    await this.requireSystemOrganizationManagedByInternalAccount(principal, tenantId)
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
    this.removeMembershipFromRuntimeCache(userId, tenantId)
    await this.accounts.recordAuditLog({
      tenantId,
      userId,
      actorUserId: principal.userId,
      action: 'admin.membership.disabled',
      resourceType: 'tenant_membership',
      resourceId: target.id,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, { roles: target.roles, scope: 'admin_console' }),
    })
  }

  async adminDisableOrganizationMembership(
    principal: Principal,
    tenantId: string,
    userId: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    await this.adminDisableMembership(principal, tenantId, userId, metadata)
  }

  async disableAccount(
    principal: Principal,
    tenantId: string,
    userId: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    this.requireTenantScope(principal, tenantId)
    if (!isPlatformAdmin(principal)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only owners or super admins can disable accounts')
    }
    if (principal.userId === userId) {
      throw new AppError(400, 'CANNOT_DISABLE_SELF_ACCOUNT', 'Cannot disable your own account')
    }
    const target = await this.requireMembership(tenantId, userId)
    this.requireCanManageMembership(principal, target, 'disable')
    if (target.roles.includes(ROLES.OWNER)) {
      const owners = await this.accounts.countActiveOwners(tenantId)
      if (owners <= 1) {
        throw new AppError(409, 'LAST_OWNER_CANNOT_BE_DISABLED', 'The last owner cannot be disabled')
      }
    }
    if (!(await this.accounts.disableAccount(userId))) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
    }
    this.removeAccountFromRuntimeCache(userId)
    await this.accounts.recordAuditLog({
      tenantId,
      userId,
      actorUserId: principal.userId,
      action: 'account.disabled',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: auditMetadata(metadata, { membershipId: target.id, roles: target.roles }),
    })
  }

  async disableOrganizationAccount(
    principal: Principal,
    tenantId: string,
    userId: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    await this.disableAccount(principal, tenantId, userId, metadata)
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

  async listOrganizationSessions(
    principal: Principal,
    tenantId: string,
    currentSessionToken: string | undefined,
  ): Promise<SessionSummary[]> {
    return await this.listTenantSessions(principal, tenantId, currentSessionToken)
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
      metadata: auditMetadata(metadata, { scope: 'self' }),
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
      metadata: auditMetadata(metadata, { scope: 'tenant' }),
    })
  }

  async revokeOrganizationSession(
    principal: Principal,
    tenantId: string,
    sessionId: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    await this.revokeTenantSession(principal, tenantId, sessionId, metadata)
  }

  async selfWorkspace(principal: Principal): Promise<Account | null> {
    const account = await this.users.findById(principal.userId, principal.tenantId)
    return account ? this.users.toAccount(account) : null
  }

  async selfOrganization(principal: Principal): Promise<Account | null> {
    return this.selfWorkspace(principal)
  }

  private async requireSystemOrganizationManagedByInternalAccount(
    principal: Principal,
    tenantId: string,
  ): Promise<void> {
    if (!(await this.accounts.isSystemTenant(tenantId))) return
    if (hasSystemOrganizationRole(principal.roles)) return
    throw new AppError(
      403,
      'SYSTEM_ORGANIZATION_PROTECTED',
      'System organization is reserved for platform internal accounts',
    )
  }

  private async requireSystemOrganizationMembershipWrite(
    principal: Principal,
    tenantId: string,
    roles: Role[],
  ): Promise<void> {
    if (!(await this.accounts.isSystemTenant(tenantId))) return
    if (!hasSystemOrganizationRole(principal.roles)) {
      throw new AppError(
        403,
        'SYSTEM_ORGANIZATION_PROTECTED',
        'System organization is reserved for platform internal accounts',
      )
    }
    if (!roles.every(isSystemOrganizationRole)) {
      throw new AppError(
        409,
        'SYSTEM_ORGANIZATION_PROTECTED',
        'System organization only allows owner, super_admin, and admin memberships',
      )
    }
  }

  private async rejectExternalSystemOrganizationRoles(tenantId: string, roles: Role[]): Promise<void> {
    if (!(await this.accounts.isSystemTenant(tenantId))) return
    if (roles.every(isSystemOrganizationRole)) return
    throw new AppError(
      409,
      'SYSTEM_ORGANIZATION_PROTECTED',
      'System organization only allows owner, super_admin, and admin memberships',
    )
  }

  private async rejectSystemOrganizationLifecycleChange(tenantId: string, message: string): Promise<void> {
    if (!(await this.accounts.isSystemTenant(tenantId))) return
    throw new AppError(409, 'SYSTEM_ORGANIZATION_PROTECTED', message)
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
    this.mirrorWorkspace(created)
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

  private async createInvitationWithScope(
    principal: Principal,
    tenantId: string,
    input: CreateTenantInvitationInput,
  ): Promise<CreatedTenantInvitation> {
    await this.requireCurrentAccount(principal)
    const roles = normalizeRoles(input.roles)
    this.requireAssignableRoles(principal, roles)
    await this.requireGlobalRoleCapacity(roles)
    await this.requireSystemOrganizationMembershipWrite(principal, tenantId, roles)
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
    await this.sendInvitationEmail(invitation)
    return invitation
  }

  private requireAdminTenantScope(principal: Principal, tenantId: string): void {
    if (isPlatformAdmin(principal)) return
    this.requireTenantScope(principal, tenantId)
  }

  private requireAssignableRoles(principal: Principal, roles: Role[]): void {
    if (roles.includes(ROLES.OWNER) && !isOwner(principal)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only owners can assign owner role')
    }
    if (roles.includes(ROLES.SUPER_ADMIN) && !isOwner(principal)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only owners can assign super admin role')
    }
    if (roles.includes(ROLES.ADMIN) && !isPlatformAdmin(principal)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only owners or super admins can assign admin role')
    }
    if (roles.includes(ROLES.ORGANIZATION_ADMIN) && !isPlatformAdmin(principal)) {
      throw new AppError(
        403,
        'PERMISSION_DENIED',
        'Only owners or super admins can assign organization admin role',
      )
    }
    if (
      roles.includes(ROLES.ORGANIZATION_MEMBER) &&
      !isPlatformAdmin(principal) &&
      !principal.roles.includes(ROLES.ORGANIZATION_ADMIN)
    ) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only administrators can assign organization member role')
    }
    if (
      roles.includes(ROLES.MEMBER) &&
      !isPlatformAdmin(principal) &&
      !principal.roles.includes(ROLES.ADMIN)
    ) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only platform administrators can assign member role')
    }
  }

  private requireTenantManager(principal: Principal): void {
    if (isTenantManager(principal)) return
    throw new AppError(403, 'PERMISSION_DENIED', 'Only owners or administrators can manage workspaces')
  }

  private async requireGlobalRoleCapacity(roles: Role[], targetUserId?: string): Promise<void> {
    if (roles.includes(ROLES.OWNER)) {
      const owners = await this.accounts.countActiveUsersWithRole(ROLES.OWNER, targetUserId)
      if (owners >= 1) {
        throw new AppError(409, 'OWNER_LIMIT_REACHED', 'Only one active owner account is allowed')
      }
    }
    if (roles.includes(ROLES.SUPER_ADMIN)) {
      const superAdmins = await this.accounts.countActiveUsersWithRole(ROLES.SUPER_ADMIN, targetUserId)
      if (superAdmins >= 5) {
        throw new AppError(
          409,
          'SUPER_ADMIN_LIMIT_REACHED',
          'At most five active super admin accounts are allowed',
        )
      }
    }
  }

  private requireOwner(principal: Principal, message: string): void {
    if (isOwner(principal)) return
    throw new AppError(403, 'OWNER_REQUIRED', message)
  }

  private requireCanManageMembership(
    principal: Principal,
    target: Membership,
    action: 'roles' | 'disable',
  ): void {
    if (!isTenantManager(principal)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only administrators can manage memberships')
    }
    if (principal.userId === target.userId) {
      const code = action === 'roles' ? 'CANNOT_CHANGE_SELF_ROLES' : 'CANNOT_DISABLE_SELF_MEMBERSHIP'
      const message =
        action === 'roles'
          ? 'Cannot change your own membership roles'
          : 'Cannot disable your current membership'
      throw new AppError(400, code, message)
    }
    if (isOwner(principal)) return
    if (isPlatformAdmin(principal) && !hasOwnerRole(target.roles) && !hasSuperAdminRole(target.roles)) {
      return
    }
    if (hasOwnerRole(target.roles) || hasSuperAdminRole(target.roles)) {
      throw new AppError(
        403,
        'ELEVATED_MEMBERSHIP_REQUIRES_OWNER',
        'Only owners can manage owner or super admin memberships',
      )
    }
    if (hasAdminRole(target.roles)) {
      throw new AppError(
        403,
        'ELEVATED_MEMBERSHIP_REQUIRES_PLATFORM_ADMIN',
        'Only owners or super admins can manage admin memberships',
      )
    }
    if (principal.roles.includes(ROLES.ORGANIZATION_ADMIN) && target.roles.includes(ROLES.MEMBER)) {
      throw new AppError(
        403,
        'PLATFORM_MEMBER_REQUIRES_PLATFORM_ADMIN',
        'Only platform administrators can manage member memberships',
      )
    }
    if (principal.roles.includes(ROLES.ADMIN) && target.roles.includes(ROLES.ORGANIZATION_MEMBER)) {
      throw new AppError(
        403,
        'ORGANIZATION_MEMBER_REQUIRES_ORGANIZATION_ADMIN',
        'Only organization administrators can manage organization member memberships',
      )
    }
    if (hasOrganizationAdminRole(target.roles)) {
      throw new AppError(
        403,
        'ELEVATED_MEMBERSHIP_REQUIRES_PLATFORM_ADMIN',
        'Only owners or super admins can manage organization admin memberships',
      )
    }
  }

  private requireCanManageSession(principal: Principal, target: SessionSummary): void {
    if (!isTenantManager(principal)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only administrators can manage tenant sessions')
    }
    if (principal.userId === target.userId) {
      throw new AppError(400, 'CANNOT_REVOKE_SELF_SESSION', 'Use the current account session API to sign out')
    }
    if (isOwner(principal)) return
    if (isPlatformAdmin(principal) && !hasOwnerRole(target.roles) && !hasSuperAdminRole(target.roles)) {
      return
    }
    if (hasOwnerRole(target.roles) || hasSuperAdminRole(target.roles)) {
      throw new AppError(
        403,
        'ELEVATED_SESSION_REQUIRES_OWNER',
        'Only owners can revoke owner or super admin sessions',
      )
    }
    if (hasAdminRole(target.roles)) {
      throw new AppError(
        403,
        'ELEVATED_SESSION_REQUIRES_PLATFORM_ADMIN',
        'Only owners or super admins can revoke admin sessions',
      )
    }
    if (principal.roles.includes(ROLES.ORGANIZATION_ADMIN) && target.roles.includes(ROLES.MEMBER)) {
      throw new AppError(
        403,
        'PLATFORM_MEMBER_REQUIRES_PLATFORM_ADMIN',
        'Only platform administrators can revoke member sessions',
      )
    }
    if (principal.roles.includes(ROLES.ADMIN) && target.roles.includes(ROLES.ORGANIZATION_MEMBER)) {
      throw new AppError(
        403,
        'ORGANIZATION_MEMBER_REQUIRES_ORGANIZATION_ADMIN',
        'Only organization administrators can revoke organization member sessions',
      )
    }
    if (hasOrganizationAdminRole(target.roles)) {
      throw new AppError(
        403,
        'ELEVATED_SESSION_REQUIRES_PLATFORM_ADMIN',
        'Only owners or super admins can revoke organization admin sessions',
      )
    }
  }

  private mirrorWorkspace(workspace: AccountWorkspace): void {
    this.store.mutateAccountRuntimeCache((state) => {
      const next = {
        id: workspace.account.id,
        email: normalizeEmail(workspace.account.email),
        name: workspace.account.name,
        passwordHash: workspace.account.passwordHash,
        tenantId: workspace.account.tenantId,
        roles: workspace.account.roles,
        plan: workspace.account.plan,
        credits: workspace.account.credits,
        passwordResetRequired: workspace.account.passwordResetRequired,
        emailVerified: workspace.account.emailVerified,
      }
      const existing = state.users.find((item) => item.id === next.id && item.tenantId === next.tenantId)
      if (existing) {
        Object.assign(existing, next)
      } else {
        state.users.push(next)
      }
    })
  }

  private mirrorMembership(membership: Membership, passwordHash?: string): void {
    this.store.mutateAccountRuntimeCache((state) => {
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
          passwordResetRequired: account?.passwordResetRequired ?? false,
          emailVerified: account?.emailVerified ?? false,
        })
      }
    })
  }

  private removeTenantFromRuntimeCache(tenantId: string): void {
    this.store.mutateAccountRuntimeCache((state) => {
      state.users = state.users.filter((item) => item.tenantId !== tenantId)
      state.ledger = state.ledger.filter((item) => item.tenantId !== tenantId)
    })
  }

  private removeMembershipFromRuntimeCache(userId: string, tenantId: string): void {
    this.store.mutateAccountRuntimeCache((state) => {
      state.users = state.users.filter((item) => !(item.id === userId && item.tenantId === tenantId))
    })
  }

  private removeAccountFromRuntimeCache(userId: string): void {
    this.store.mutateAccountRuntimeCache((state) => {
      state.users = state.users.filter((item) => item.id !== userId)
      state.ledger = state.ledger.filter((item) => item.userId !== userId)
    })
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeName(name: string): string {
  return name.trim()
}

function auditMetadata(
  metadata: SessionMetadata | undefined,
  value: Record<string, unknown>,
): Record<string, unknown> {
  return traceMetadata(value, metadata?.traceId ?? null)
}

function normalizeRoles(roles: Role[]): Role[] {
  return [...new Set(roles)]
}

function isSystemOrganizationRole(role: Role): boolean {
  return systemOrganizationRoles.has(role)
}

function isOrganizationScopedRole(role: Role): boolean {
  return role === ROLES.ORGANIZATION_ADMIN || role === ROLES.ORGANIZATION_MEMBER
}

function hasSystemOrganizationRole(roles: readonly Role[]): boolean {
  return roles.some(isSystemOrganizationRole)
}

function personalOrganizationName(name: string, email: string): string {
  const base = normalizeName(name) || normalizeEmail(email).split('@')[0] || '用户'
  return `${base} 的个人空间`.slice(0, 80)
}

function issueInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function currentSessionIdFromToken(token: string | undefined, secret: string): string | null {
  if (!token) return null
  const payload = parseIssuedSessionToken(token, secret)
  return payload?.sessionId ?? null
}
