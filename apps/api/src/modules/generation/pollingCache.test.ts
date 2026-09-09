import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import { expect, it, vi } from 'vitest'
import { registerGenerationRoutes } from './routes.js'
import type { GenerationService } from './service.js'

it('refreshes cached projections from the previous release and reuses current projections', async () => {
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.principal = { userId: 'member', tenantId: 'workspace', roles: ['member'] }
  })
  const taskVersion = '1:2026-09-08T00:00:00.000Z:123'
  const payload = [{ id: 'film', metadata: { sourceVideoTaskIds: ['video-1'] } }]
  const listProjectTaskPolling = vi.fn(async () => payload)
  await registerGenerationRoutes(app, {
    pollingVersion: async () => taskVersion,
    listProjectTaskPolling,
  } as unknown as GenerationService)
  try {
    const url = '/projects/project-1/generation/tasks/poll'
    const oldEtag = `"${createHash('sha256').update(taskVersion).digest('base64url')}"`
    const refreshed = await app.inject({ url, headers: { 'if-none-match': oldEtag } })
    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.json()).toEqual(payload)
    expect(refreshed.headers.etag).not.toBe(oldEtag)
    const unchanged = await app.inject({ url, headers: { 'if-none-match': refreshed.headers.etag } })
    expect(unchanged.statusCode).toBe(304)
    expect(unchanged.body).toBe('')
    expect(listProjectTaskPolling).toHaveBeenCalledTimes(1)
  } finally {
    await app.close()
  }
})
