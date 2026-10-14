import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { AppStore } from './infra/store.js'
import { testConfig } from './testing/appConfig.js'

const trustedOrigin = 'https://studio.example.test'
const scriptOrigin = 'https://script.example.test'
let app: FastifyInstance
const fetchGuard = vi.fn(() => {
  throw new Error('CORS fixture must never invoke an external provider')
})

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchGuard)
  app = await buildApp({
    config: {
      ...testConfig,
      DATABASE_URL: '',
      REDIS_URL: '',
      DATA_FILE: ':memory:',
      WEB_ORIGIN: trustedOrigin,
      SCRIPT_MASTER_URL: scriptOrigin + '/workspace',
      BOOTSTRAP_ACCOUNTS_ON_START: false,
      BOOTSTRAP_DEMO_WORKSPACE: false,
    },
    store: new AppStore(null),
    startWorker: false,
    filmPreviewComposer: null,
  })
  app.get('/cors-download-fixture', async (_request, reply) =>
    reply
      .header('Content-Disposition', 'attachment; filename="synthetic.png"')
      .header('X-Delivery-Receipt-Id', 'synthetic-receipt')
      .header('X-Delivery-Sha256', 'a'.repeat(64))
      .header('ETag', 'synthetic-etag')
      .send('synthetic content'),
  )
})

afterAll(async () => {
  await app?.close()
  vi.unstubAllGlobals()
})

describe('download receipt CORS response headers', () => {
  it.each([trustedOrigin, scriptOrigin])(
    'exposes download proof only to the trusted origin %s',
    async (origin) => {
      const response = await app.inject({ method: 'GET', url: '/cors-download-fixture', headers: { origin } })
      expect(response.statusCode).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBe(origin)
      expect(response.headers['access-control-allow-credentials']).toBe('true')
      expect(
        String(response.headers['access-control-expose-headers'])
          .toLowerCase()
          .split(',')
          .map((name) => name.trim()),
      ).toEqual(['etag', 'content-disposition', 'x-delivery-receipt-id', 'x-delivery-sha256'])
      expect(response.headers['content-disposition']).toContain('synthetic.png')
      expect(response.headers['x-delivery-receipt-id']).toBe('synthetic-receipt')
      expect(response.headers['x-delivery-sha256']).toBe('a'.repeat(64))
      expect(fetchGuard).not.toHaveBeenCalled()
    },
  )

  it('permits a credentialed formal-download preflight from the configured web origin', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/generation/tasks/synthetic-task/delivery-download',
      headers: {
        origin: trustedOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })
    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(trustedOrigin)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers['access-control-allow-methods']).toContain('POST')
    expect(fetchGuard).not.toHaveBeenCalled()
  })

  it('withholds all CORS access and exposed headers from an untrusted origin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/cors-download-fixture',
      headers: { origin: 'https://untrusted.example.test' },
    })
    // Existing behavior rejects browser access through absent CORS permission, not an HTTP error.
    expect(response.statusCode).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(response.headers['access-control-allow-credentials']).toBeUndefined()
    expect(response.headers['access-control-expose-headers']).toBeUndefined()
    expect(fetchGuard).not.toHaveBeenCalled()
  })
})
