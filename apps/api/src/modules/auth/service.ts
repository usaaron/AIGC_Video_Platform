import type { LoginInput, Principal, Session } from '@seqora/contracts'
import { permissionsFor } from '../../core/auth/authorization.js'
import { verifyPassword } from '../../core/auth/password.js'
import { createSessionToken } from '../../core/auth/sessionToken.js'
import { AppError } from '../../core/errors.js'
import type { UserRepository } from '../users/repository.js'

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly secret: string,
  ) {}

  login(input: LoginInput): { session: Session; token: string } {
    const user = this.users.findByEmail(input.email)
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

  session(principal: Principal): Session {
    const user = this.users.findById(principal.userId)
    if (!user) throw new AppError(401, 'SESSION_INVALID', '登录状态已失效')
    return {
      account: this.users.toAccount(user),
      permissions: [...permissionsFor(principal)],
    }
  }
}
