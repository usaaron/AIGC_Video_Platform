import Fastify from 'fastify'
import { expect, it, vi } from 'vitest'
import { AppError } from '../../core/errors.js'
import { registerLibraryRoutes } from './routes.js'

it('returns a disabled response without invoking external sync and keeps normal listing available', async () => {
  const app = Fastify()
  const principal = { userId: 'boundary-user', tenantId: 'boundary-tenant', roles: ['member'] }
  const service = {
    syncExternal: vi.fn(),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 12 })),
  }
  app.decorateRequest('principal', null)
  app.addHook('onRequest', async (request) => {
    request.principal = principal as never
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ code: error.code })
    throw error
  })
  await app.register(async (api) => registerLibraryRoutes(api, service as never), { prefix: '/api/v1' })
  try {
    const disabled = await app.inject({ method: 'POST', url: '/api/v1/library/sync-script-master' })
    expect(disabled.statusCode).toBe(410)
    expect(disabled.json()).toEqual({ code: 'SCRIPT_MASTER_LIBRARY_SYNC_DISABLED' })
    expect(service.syncExternal).not.toHaveBeenCalled()
    const listing = await app.inject({ method: 'GET', url: '/api/v1/library/items' })
    expect(listing.statusCode).toBe(200)
    expect(service.list).toHaveBeenCalledOnce()
  } finally {
    await app.close()
  }
})
