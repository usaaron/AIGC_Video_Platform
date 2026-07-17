import { roleSchema, type Principal } from '@seqora/contracts'
import type { FastifyRequest } from 'fastify'
import type { AppConfig } from '../../config.js'

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

function getHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export function createAuthProvider(config: AppConfig): AuthProvider {
  if (config.AUTH_MODE === 'demo') return new DemoAuthProvider()

  throw new Error('OIDC auth provider is not configured. See docs/AUTHORIZATION.md.')
}
