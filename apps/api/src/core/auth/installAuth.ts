import type { Principal } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
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
  })
}
