import type {
  ChangePasswordInput,
  LoginInput,
  Principal,
  RequestPasswordResetInput,
  RequestPasswordResetResult,
  ResetPasswordInput,
  Session,
} from '@seqora/contracts'
import { createHash, randomBytes } from 'node:crypto'
import { permissionsFor } from '../../core/auth/authorization.js'
import { hashPassword, verifyPassword } from '../../core/auth/password.js'
import {
  createSessionToken,
  hashSessionSecret,
  issueSessionToken,
  parseIssuedSessionToken,
} from '../../core/auth/sessionToken.js'
import { AppError } from '../../core/errors.js'
import type { AuthAccounts, SessionMetadata } from './accounts.js'

const passwordResetLifetimeSeconds = 60 * 30

type AuthServiceOptions = {
  exposePasswordResetTokens?: boolean
}

export class AuthService {
  constructor(
    private readonly users: AuthAccounts,
    private readonly secret: string,
    private readonly options: AuthServiceOptions = {},
  ) {}

  async login(input: LoginInput, metadata?: SessionMetadata): Promise<{ session: Session; token: string }> {
    const user = await this.users.findByEmail(input.email)
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      await this.users.recordAuditLog({
        tenantId: user?.tenantId ?? null,
        userId: user?.id ?? null,
        actorUserId: null,
        action: 'auth.login.failed',
        resourceType: user ? 'user' : 'email',
        resourceId: user?.id ?? null,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: {
          emailHash: hashAuditValue(input.email.toLowerCase()),
          reason: 'invalid_credentials',
        },
      })
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
    }

    const principal: Principal = { userId: user.id, tenantId: user.tenantId, roles: user.roles }
    if (this.users.hasDatabase) {
      const issued = issueSessionToken(this.secret)
      const created = await this.users.createSession(
        user.id,
        user.tenantId,
        issued.payload.sessionId,
        hashSessionSecret(issued.payload.tokenSecret),
        new Date(issued.payload.expiresAt * 1_000).toISOString(),
        metadata,
      )
      if (!created) {
        throw new AppError(500, 'SESSION_CREATE_FAILED', 'Could not create session')
      }
      await this.users.recordAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        actorUserId: user.id,
        action: 'auth.login.succeeded',
        resourceType: 'session',
        resourceId: issued.payload.sessionId,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: { deviceLabel: metadata?.deviceLabel ?? null },
      })
      return {
        token: issued.token,
        session: {
          account: this.users.toAccount(user),
          permissions: [...permissionsFor(principal)],
        },
      }
    }

    return {
      token: createSessionToken(user.id, this.secret),
      session: {
        account: this.users.toAccount(user),
        permissions: [...permissionsFor(principal)],
      },
    }
  }

  async session(principal: Principal): Promise<Session> {
    const user = await this.users.findById(principal.userId, principal.tenantId)
    if (!user) throw new AppError(401, 'SESSION_INVALID', 'Session is no longer valid')
    return {
      account: this.users.toAccount(user),
      permissions: [...permissionsFor(principal)],
    }
  }

  async changePassword(
    principal: Principal,
    input: ChangePasswordInput,
    metadata?: SessionMetadata,
  ): Promise<void> {
    const user = await this.users.findById(principal.userId, principal.tenantId)
    if (!user || user.tenantId !== principal.tenantId) {
      throw new AppError(401, 'SESSION_INVALID', 'Session is no longer valid')
    }
    if (!verifyPassword(input.currentPassword, user.passwordHash)) {
      await this.users.recordAuditLog({
        tenantId: principal.tenantId,
        userId: principal.userId,
        actorUserId: principal.userId,
        action: 'auth.password_change.failed',
        resourceType: 'user',
        resourceId: principal.userId,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: { reason: 'current_password_invalid' },
      })
      throw new AppError(401, 'CURRENT_PASSWORD_INVALID', '当前密码错误')
    }
    if (!(await this.users.updatePassword(user.id, user.tenantId, hashPassword(input.newPassword)))) {
      throw new AppError(401, 'SESSION_INVALID', 'Session is no longer valid')
    }
    if (this.users.hasDatabase) {
      await this.users.revokeSessionsForUser(user.id, user.tenantId)
    }
    await this.users.recordAuditLog({
      tenantId: principal.tenantId,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'auth.password.changed',
      resourceType: 'user',
      resourceId: principal.userId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: {},
    })
  }

  async requestPasswordReset(
    input: RequestPasswordResetInput,
    metadata?: SessionMetadata,
  ): Promise<RequestPasswordResetResult> {
    const token = issuePasswordResetToken()
    const expiresAt = new Date(Date.now() + passwordResetLifetimeSeconds * 1_000).toISOString()
    const created = await this.users.createPasswordResetToken({
      email: input.email.toLowerCase(),
      tokenSecretHash: hashPasswordResetToken(token),
      expiresAt,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
    })
    if (created && this.options.exposePasswordResetTokens) {
      return { ok: true, resetToken: token, expiresAt: created.expiresAt }
    }
    return { ok: true }
  }

  async resetPassword(input: ResetPasswordInput, metadata?: SessionMetadata): Promise<void> {
    const updated = await this.users.resetPasswordWithToken({
      tokenSecretHash: hashPasswordResetToken(input.token),
      passwordHash: hashPassword(input.newPassword),
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
    })
    if (!updated) {
      throw new AppError(
        400,
        'PASSWORD_RESET_TOKEN_INVALID',
        'Password reset token is invalid, expired or already used',
      )
    }
  }

  async logout(token: string | undefined, metadata?: SessionMetadata): Promise<void> {
    if (!token || !this.users.hasDatabase) return
    const payload = parseIssuedSessionToken(token, this.secret)
    if (!payload) return
    const session = await this.users.resolveSession(payload.sessionId)
    await this.users.revokeSession(payload.sessionId)
    if (!session) return
    await this.users.recordAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      actorUserId: session.userId,
      action: 'auth.logout',
      resourceType: 'session',
      resourceId: payload.sessionId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: {},
    })
  }
}

function issuePasswordResetToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function hashAuditValue(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}
