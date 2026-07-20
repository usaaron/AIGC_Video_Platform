import type { LoginInput, Principal, Session } from '@seqora/contracts'
import { permissionsFor } from '../../core/auth/authorization.js'
import { verifyPassword } from '../../core/auth/password.js'
import { createSessionToken } from '../../core/auth/sessionToken.js'
import { AppError } from '../../core/errors.js'
import type { UserReader } from '../users/repository.js'

export class AuthService {
  constructor(
    private readonly users: UserReader,
    private readonly secret: string,
  ) {}

  async login(input: LoginInput): Promise<{ session: Session; token: string }> {
    const user = await this.users.findByEmail(input.email)
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new AppError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误')
    }

    const principal: Principal = { userId: user.id, tenantId: user.tenantId, roles: user.roles }
    return {
      token: createSessionToken(user.id, this.secret),
      session: {
        account: this.users.toAccount(user),
        permissions: [...permissionsFor(principal)],
      },
    }
  }

  async session(principal: Principal): Promise<Session> {
    const user = await this.users.findById(principal.userId)
    if (!user) throw new AppError(401, 'SESSION_INVALID', '登录状态已失效')
    return {
      account: this.users.toAccount(user),
      permissions: [...permissionsFor(principal)],
    }
  }
}
