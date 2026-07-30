import type { ChangePasswordInput, LoginInput, Principal, Session } from '@seqora/contracts'
import { permissionsFor } from '../../core/auth/authorization.js'
import { hashPassword, verifyPassword } from '../../core/auth/password.js'
import {
  createSessionToken,
  hashSessionSecret,
  issueSessionToken,
  parseIssuedSessionToken,
} from '../../core/auth/sessionToken.js'
import { AppError } from '../../core/errors.js'
import type { AuthAccounts } from './accounts.js'

export class AuthService {
  constructor(
    private readonly users: AuthAccounts,
    private readonly secret: string,
  ) {}

  async login(input: LoginInput): Promise<{ session: Session; token: string }> {
    const user = await this.users.findByEmail(input.email)
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new AppError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误')
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
      )
      if (!created) {
        throw new AppError(500, 'SESSION_CREATE_FAILED', '会话创建失败')
      }
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
    if (!user) throw new AppError(401, 'SESSION_INVALID', '登录状态已失效')
    return {
      account: this.users.toAccount(user),
      permissions: [...permissionsFor(principal)],
    }
  }

  async changePassword(principal: Principal, input: ChangePasswordInput): Promise<void> {
    const user = await this.users.findById(principal.userId, principal.tenantId)
    if (!user || user.tenantId !== principal.tenantId) {
      throw new AppError(401, 'SESSION_INVALID', '登录状态已失效')
    }
    if (!verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new AppError(401, 'CURRENT_PASSWORD_INVALID', '当前密码错误')
    }
    if (!(await this.users.updatePassword(user.id, user.tenantId, hashPassword(input.newPassword)))) {
      throw new AppError(401, 'SESSION_INVALID', '登录状态已失效')
    }
    if (this.users.hasDatabase) {
      await this.users.revokeSessionsForUser(user.id, user.tenantId)
    }
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token || !this.users.hasDatabase) return
    const payload = parseIssuedSessionToken(token, this.secret)
    if (!payload) return
    await this.users.revokeSession(payload.sessionId)
  }
}
