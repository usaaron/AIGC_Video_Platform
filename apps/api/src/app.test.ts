import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import type { AppConfig } from './config.js'

const testConfig: AppConfig = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: 8787,
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_MODE: 'demo',
}

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('API authorization', () => {
  it('allows creators to submit generation tasks', async () => {
    app = await buildApp({ config: testConfig })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: { 'x-demo-role': 'creator' },
      payload: {
        clientRequestId: 'client-1',
        projectId: 'project-1',
        kind: 'image',
        label: '角色定妆',
        estimatedCredits: 6,
      },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ projectId: 'project-1', status: 'queued' })
  })

  it('denies the admin dashboard to member accounts', async () => {
    app = await buildApp({ config: testConfig })
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { 'x-demo-role': 'member' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })
  })

  it('allows admin accounts to read the admin dashboard', async () => {
    app = await buildApp({ config: testConfig })
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { 'x-demo-role': 'admin' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ users: 1, activeTasks: 0 })
  })
})
