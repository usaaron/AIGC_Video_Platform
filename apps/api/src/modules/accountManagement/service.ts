import type {
  Account,
  AddTenantMemberInput,
  CreateWorkspaceInput,
  Membership,
  Principal,
  Role,
  RegisterAccountInput,
  Session,
  SessionSummary,
  UpdateMembershipRolesInput,
  Workspace,
  WorkspaceMembership,
} from '@seqora/contracts'
import { ROLES } from '@seqora/contracts'
import { permissionsFor } from '../../core/auth/authorization.js'
import { hashPassword } from '../../core/auth/password.js'
import {
  hashSessionSecret,
  issueSessionToken,
  parseIssuedSessionToken,
} from '../../core/auth/sessionToken.js'
import { AppError } from '../../core/errors.js'
import type { AppStore } from '../../infra/store.js'
import type { UserRepository } from '../users/repository.js'
import { AccountManagementRepository, type AccountWorkspace } from './repository.js'

export class AccountManagementService {
  constructor(
    private readonly accounts: AccountManagementRepository,
    private readonly users: UserRepository,
    private readonly store: AppStore,
    private readonly secret: string,
    _webOrigin: string,
  ) {}

  async register(
    input: RegisterAccountInput,
  ): Promise<{ session: Session; token: string; workspace: Workspace }> {
    const created = await this.accounts.registerAccount({
      name: normalizeName(input.name),
      email: normalizeEmail(input.email),
      passwordHash: hashPassword(input.password),
      workspaceName: normalizeName(input.workspaceName ?? input.name),
    })
    if (!created) {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'Email is already registered')
    }
    return await this.issueSession(created)
  }

  async createWorkspace(
    principal: Principal,
    input: CreateWorkspaceInput,
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
    return await this.issueSession(created)
  }

  async listWorkspaces(principal: Principal): Promise<WorkspaceMembership[]> {
    await this.requireCurrentAccount(principal)
    return await this.accounts.listUserWorkspaces(principal.userId)
  }

  async switchWorkspace(
    principal: Principal,
    tenantId: string,
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
    return await this.issueSession(workspace)
  }

  async addMember(principal: Principal, tenantId: string, input: AddTenantMemberInput): Promise<Membership> {
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
    return member
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
    return updated
  }

  async disableMembership(principal: Principal, tenantId: string, userId: string): Promise<void> {
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
  }

  async disableAccount(principal: Principal, tenantId: string, userId: string): Promise<void> {
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

  async revokeCurrentTenantSession(principal: Principal, sessionId: string): Promise<void> {
    await this.requireCurrentAccount(principal)
    if (!(await this.accounts.revokeUserSession(principal.userId, principal.tenantId, sessionId))) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session does not exist')
    }
  }

  async revokeTenantSession(principal: Principal, tenantId: string, sessionId: string): Promise<void> {
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
  }

  async selfWorkspace(principal: Principal): Promise<Account | null> {
    const account = await this.users.findById(principal.userId, principal.tenantId)
    return account ? this.users.toAccount(account) : null
  }

  private async issueSession(
    created: AccountWorkspace,
  ): Promise<{ session: Session; token: string; workspace: Workspace }> {
    const issued = issueSessionToken(this.secret)
    const createdSession = await this.users.createSession(
      created.account.id,
      created.account.tenantId,
      issued.payload.sessionId,
      hashSessionSecret(issued.payload.tokenSecret),
      new Date(issued.payload.expiresAt * 1_000).toISOString(),
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

  private async mirrorMembership(membership: Membership): Promise<void> {
    await this.store.mutate((state) => {
      const existing = state.users.find(
        (item) => item.id === membership.userId && item.tenantId === membership.tenantId,
      )
      if (existing) {
        existing.email = normalizeEmail(membership.email)
        existing.name = membership.name
        existing.roles = membership.roles
      } else if (membership.status === 'active') {
        const account = state.users.find((item) => item.id === membership.userId)
        state.users.push({
          id: membership.userId,
          email: normalizeEmail(membership.email),
          name: membership.name,
          passwordHash: account?.passwordHash ?? '',
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

function hasElevatedRole(roles: Role[]): boolean {
  return roles.includes(ROLES.OWNER) || roles.includes(ROLES.ADMIN)
}

function currentSessionIdFromToken(token: string | undefined, secret: string): string | null {
  if (!token) return null
  const payload = parseIssuedSessionToken(token, secret)
  return payload?.sessionId ?? null
}
