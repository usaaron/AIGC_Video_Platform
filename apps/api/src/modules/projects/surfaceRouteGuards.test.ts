import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Principal } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import { registerGenerationRoutes } from '../generation/routes.js'
import { registerImage2Routes } from '../image2/routes.js'
import { registerLibraryRoutes } from '../library/routes.js'

const principal: Principal = {
  userId: 'user-test',
  tenantId: 'tenant-test',
  organizationId: 'tenant-test',
  roles: ['member'],
}

let app: ReturnType<typeof Fastify> | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('main-project body surface guards', () => {
  it('rejects an independent id nested in a generation task payload', async () => {
    const createTask = vi.fn()
    app = await buildRouteApp()
    await registerGenerationRoutes(app, { createTask } as never)

    const response = await app.inject({
      method: 'POST',
      url: '/generation/tasks',
      payload: {
        clientRequestId: 'request-1',
        projectId: 'project-main',
        kind: 'text',
        label: 'Script',
        estimatedCredits: 1,
        metadata: { source_snapshot: { target_project_id: 'sm-standalone-private' } },
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('PROJECT_SURFACE_DENIED')
    expect(createTask).not.toHaveBeenCalled()
  })

  it('rejects an independent id in an image2 batch body', async () => {
    const createBatch = vi.fn()
    app = await buildRouteApp()
    await registerImage2Routes(app, { createBatch } as never)

    const response = await app.inject({
      method: 'POST',
      url: '/image2/batches',
      payload: {
        clientRequestId: 'request-2',
        projectId: 'sm-standalone-private',
        prompt: 'A quiet room',
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('PROJECT_SURFACE_DENIED')
    expect(createBatch).not.toHaveBeenCalled()
  })

  it('rejects an independent source id in the asset-library query', async () => {
    const list = vi.fn()
    app = await buildRouteApp()
    await registerLibraryRoutes(app, { list } as never)

    const response = await app.inject({
      method: 'GET',
      url: '/library/items?sourceProjectId=sm-standalone-private',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('PROJECT_SURFACE_DENIED')
    expect(list).not.toHaveBeenCalled()
  })
})

async function buildRouteApp() {
  const instance = Fastify({ logger: false })
  instance.decorateRequest('principal', null)
  instance.addHook('onRequest', async (request) => {
    request.principal = principal
  })
  instance.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
    }
    throw error
  })
  return instance
}
