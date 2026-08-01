import type { Principal } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { AppError } from '../errors.js'
import type { AuthProvider } from './provider.js'

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null
  }
}

export function installAuth(app: FastifyInstance, provider: AuthProvider): void {
  app.decorateRequest('principal', null)
  app.addHook('onRequest', async (request) => {
    request.principal = await provider.resolvePrincipal(request)
    if (request.principal?.passwordResetRequired && !isPasswordResetAllowedRequest(request.method, request.url)) {
      throw new AppError(403, 'PASSWORD_RESET_REQUIRED', 'Password reset is required before continuing')
    }
  })
}

function isPasswordResetAllowedRequest(method: string, url: string): boolean {
  if (method === 'OPTIONS') return true
  const path = url.split('?', 1)[0]
  if (path === '/api/v1/health') return true
  if (path === '/api/v1/health/readiness') return true
  if (path === '/api/v1/auth/me') return true
  if (path === '/api/v1/auth/logout') return true
  if (path === '/api/v1/auth/login') return true
  if (path === '/api/v1/auth/password') return true
  if (path === '/api/v1/auth/password/reset') return true
  if (path === '/api/v1/auth/password/reset-request') return true
  return false
}
