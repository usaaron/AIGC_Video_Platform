import { roleSchema, type Principal } from '@seqora/contracts'
import type { FastifyRequest } from 'fastify'
import type { AppConfig } from '../../config.js'
import type { UserRepository } from '../../modules/users/repository.js'
import { verifySessionToken } from './sessionToken.js'

export const SESSION_COOKIE = 'seqora_session'

export interface AuthProvider {
  resolvePrincipal(request: FastifyRequest): Promise<Principal | null>
}

class DemoAuthProvider implements AuthProvider {
  async resolvePrincipal(request: FastifyRequest): Promise<Principal> {
    const requestedRole = getHeader(request, 'x-demo-role') ?? 'member'
    const role = roleSchema.parse(requestedRole)

    return {
      userId: getHeader(request, 'x-demo-user-id') ?? 'demo-user',
      tenantId: getHeader(request, 'x-demo-tenant-id') ?? 'demo-tenant',
      roles: [role],
    }
  }
}

class LocalAuthProvider implements AuthProvider {
  constructor(
    private readonly users: UserRepository,
    private readonly secret: string,
  ) {}

  async resolvePrincipal(request: FastifyRequest): Promise<Principal | null> {
    const token = request.cookies[SESSION_COOKIE]
    if (!token) return null
    const payload = verifySessionToken(token, this.secret)
    if (!payload) return null
    const user = this.users.findById(payload.userId)
    return user ? { userId: user.id, tenantId: user.tenantId, roles: user.roles } : null
  }
}

function getHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export function createAuthProvider(config: AppConfig, users: UserRepository): AuthProvider {
  if (config.AUTH_MODE === 'local') return new LocalAuthProvider(users, config.AUTH_SECRET)
  if (config.AUTH_MODE === 'demo') return new DemoAuthProvider()

  throw new Error('OIDC auth provider is not configured. See docs/AUTHORIZATION.md.')
}
