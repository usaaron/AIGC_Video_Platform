import type {
  ChangePasswordInput,
  LoginInput,
  Principal,
  RequestEmailVerificationInput,
  RequestEmailVerificationResult,
  RequestPasswordResetInput,
  RequestPasswordResetResult,
  ResetPasswordInput,
  Session,
  VerifyEmailInput,
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
import { NoopMailer, tokenUrl, type Mailer } from '../../core/email/mailer.js'
import { AppError } from '../../core/errors.js'
import type { AuthAccounts, SessionMetadata } from './accounts.js'

const passwordResetLifetimeSeconds = 60 * 30
const emailVerificationLifetimeSeconds = 60 * 60 * 24

type AuthServiceOptions = {
  exposePasswordResetTokens?: boolean
  exposeEmailVerificationTokens?: boolean
  mailer?: Mailer
  passwordResetUrl?: string
  emailVerificationUrl?: string
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

    const principal: Principal = {
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      emailVerified: user.emailVerified,
    }
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
    if (created) {
      await this.sendPasswordResetEmail(input.email.toLowerCase(), token, created.expiresAt, metadata)
    }
    if (created && this.options.exposePasswordResetTokens) {
      return { ok: true, resetToken: token, expiresAt: created.expiresAt }
    }
    return { ok: true }
  }

  async requestEmailVerification(
    input: RequestEmailVerificationInput,
    metadata?: SessionMetadata,
  ): Promise<RequestEmailVerificationResult> {
    const token = issueEmailVerificationToken()
    const expiresAt = new Date(Date.now() + emailVerificationLifetimeSeconds * 1_000).toISOString()
    const created = await this.users.createEmailVerificationToken({
      email: input.email.toLowerCase(),
      tokenSecretHash: hashEmailVerificationToken(token),
      expiresAt,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
    })
    if (created) {
      await this.sendEmailVerificationEmail(input.email.toLowerCase(), token, created.expiresAt, metadata)
    }
    if (created && this.options.exposeEmailVerificationTokens) {
      return { ok: true, verificationToken: token, expiresAt: created.expiresAt }
    }
    return { ok: true }
  }

  async verifyEmail(input: VerifyEmailInput, metadata?: SessionMetadata): Promise<void> {
    const verified = await this.users.verifyEmailWithToken({
      tokenSecretHash: hashEmailVerificationToken(input.token),
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
    })
    if (!verified) {
      throw new AppError(
        400,
        'EMAIL_VERIFICATION_TOKEN_INVALID',
        'Email verification token is invalid, expired or already used',
      )
    }
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

  private async sendPasswordResetEmail(
    email: string,
    token: string,
    expiresAt: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    const resetUrl = tokenUrl(this.options.passwordResetUrl ?? '', token)
    const text = [
      '请通过以下链接重置你的序幕TV密码。',
      '',
      resetUrl,
      '',
      `This link expires at ${expiresAt}.`,
      'If you did not request this change, you can ignore this email.',
    ].join('\n')
    try {
      await (this.options.mailer ?? new NoopMailer()).send({
        to: email,
        subject: '重置序幕TV密码',
        text,
        html: [
          '<p>请通过以下链接重置你的序幕TV密码。</p>',
          `<p><a href="${escapeHtml(resetUrl)}">Reset password</a></p>`,
          `<p>This link expires at ${escapeHtml(expiresAt)}.</p>`,
          '<p>If you did not request this change, you can ignore this email.</p>',
        ].join(''),
        purpose: 'password_reset',
        idempotencyKey: `password-reset:${hashAuditValue(token)}`,
      })
    } catch (error) {
      await this.users.recordAuditLog({
        tenantId: null,
        userId: null,
        actorUserId: null,
        action: 'auth.email.delivery_failed',
        resourceType: 'email',
        resourceId: null,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: {
          purpose: 'password_reset',
          emailHash: hashAuditValue(email),
          reason: error instanceof Error ? error.message : String(error),
        },
      })
      throw new AppError(502, 'EMAIL_DELIVERY_FAILED', 'Could not send password reset email')
    }
  }

  private async sendEmailVerificationEmail(
    email: string,
    token: string,
    expiresAt: string,
    metadata?: SessionMetadata,
  ): Promise<void> {
    const verifyUrl = tokenUrl(this.options.emailVerificationUrl ?? '', token)
    const text = [
      '请通过以下链接验证你的序幕TV邮箱。',
      '',
      verifyUrl,
      '',
      `This link expires at ${expiresAt}.`,
      'If you did not create this account, you can ignore this email.',
    ].join('\n')
    try {
      await (this.options.mailer ?? new NoopMailer()).send({
        to: email,
        subject: '验证序幕TV邮箱',
        text,
        html: [
          '<p>请通过以下链接验证你的序幕TV邮箱。</p>',
          `<p><a href="${escapeHtml(verifyUrl)}">Verify email</a></p>`,
          `<p>This link expires at ${escapeHtml(expiresAt)}.</p>`,
          '<p>If you did not create this account, you can ignore this email.</p>',
        ].join(''),
        purpose: 'email_verification',
        idempotencyKey: `email-verification:${hashAuditValue(token)}`,
      })
      await this.users.recordAuditLog({
        tenantId: null,
        userId: null,
        actorUserId: null,
        action: 'auth.email.delivery_succeeded',
        resourceType: 'email',
        resourceId: null,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: { purpose: 'email_verification', emailHash: hashAuditValue(email) },
      })
    } catch (error) {
      await this.users.recordAuditLog({
        tenantId: null,
        userId: null,
        actorUserId: null,
        action: 'auth.email.delivery_failed',
        resourceType: 'email',
        resourceId: null,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: {
          purpose: 'email_verification',
          emailHash: hashAuditValue(email),
          reason: error instanceof Error ? error.message : String(error),
        },
      })
      throw new AppError(502, 'EMAIL_DELIVERY_FAILED', 'Could not send email verification email')
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

function issueEmailVerificationToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function hashEmailVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function hashAuditValue(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
