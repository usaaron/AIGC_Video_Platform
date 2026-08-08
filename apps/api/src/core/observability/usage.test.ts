import Fastify from 'fastify'
import { describe, expect, it, beforeEach } from 'vitest'
import { installObservabilityHooks } from './hooks.js'
import { observeProviderCall } from './metrics.js'
import { providerTokenUsageFromPayload, recordTextProviderUsage, usageCollector } from './usage.js'

describe('usageCollector', () => {
  beforeEach(() => {
    usageCollector.resetForTests()
  })

  it('tracks active API requests and rolling RPM by user', () => {
    usageCollector.startApiRequest({ requestId: 'request-1', method: 'GET', route: '/api/v1/test', now: 1_000 })
    usageCollector.bindApiRequestIdentity('request-1', {
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      userId: 'user-1',
    })

    expect(usageCollector.snapshot({ userId: 'user-1' }, 1_500)).toMatchObject({
      apiConcurrency: 1,
      rpm: 0,
    })

    usageCollector.finishApiRequest({
      requestId: 'request-1',
      method: 'GET',
      route: '/api/v1/test',
      statusCode: 200,
      durationMs: 120,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      userId: 'user-1',
      now: 2_000,
    })

    expect(usageCollector.snapshot({ userId: 'user-1' }, 2_500)).toMatchObject({
      apiConcurrency: 0,
      rpm: 1,
      requestCount: 1,
      errorCount: 0,
      errorRate: 0,
    })
  })

  it('tracks provider concurrency and token usage', async () => {
    const running = observeProviderCall(
      {
        provider: 'test-provider',
        operation: 'text.generate',
        tenantId: 'tenant-1',
        organizationId: 'organization-1',
        userId: 'user-1',
        traceId: 'trace-1',
      },
      async () => {
        expect(usageCollector.snapshot({ userId: 'user-1' })).toMatchObject({ providerConcurrency: 1 })
        usageCollector.recordProviderTokenUsage({
          provider: 'test-provider',
          operation: 'text.generate',
          tenantId: 'tenant-1',
          organizationId: 'organization-1',
          userId: 'user-1',
          inputTokens: 10,
          outputTokens: 15,
          totalTokens: 25,
        })
        return 'ok'
      },
    )

    await expect(running).resolves.toBe('ok')
    expect(usageCollector.snapshot({ userId: 'user-1' })).toMatchObject({
      providerConcurrency: 0,
      tpm: 25,
      inputTokens: 10,
      outputTokens: 15,
      totalTokens: 25,
    })
  })

  it('parses compatible provider usage payloads for TPM collection', () => {
    expect(
      providerTokenUsageFromPayload({
        usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 15, totalTokens: 25 })
    expect(
      providerTokenUsageFromPayload({
        data: { usage: { inputTokens: '7', outputTokens: '8', totalTokens: '15' } },
      }),
    ).toEqual({ inputTokens: 7, outputTokens: 8, totalTokens: 15 })
    expect(
      providerTokenUsageFromPayload({
        usage_metadata: { prompt_token_count: 3, candidates_token_count: 4, total_token_count: 7 },
      }),
    ).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 })
  })

  it('records text provider usage by context and keeps TPM as a rolling 60s metric', () => {
    recordTextProviderUsage({
      provider: 'test-provider',
      model: 'test-model',
      usageContext: {
        tenantId: 'tenant-1',
        organizationId: 'organization-1',
        userId: 'user-1',
        traceId: 'trace-1',
      },
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      now: 1_000,
    })

    expect(usageCollector.snapshot({ userId: 'user-1' }, 2_000)).toMatchObject({
      tpm: 7,
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    })
    expect(usageCollector.snapshot({ organizationId: 'organization-1' }, 61_001)).toMatchObject({
      tpm: 0,
      totalTokens: 7,
    })
  })

  it('tracks job concurrency and credits used separately from API error rate', () => {
    usageCollector.startJob({
      jobId: 'task-1',
      source: 'generation_task',
      kind: 'image',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      userId: 'user-1',
    })
    expect(usageCollector.snapshot({ userId: 'user-1' })).toMatchObject({ jobConcurrency: 1 })

    usageCollector.finishJob({
      jobId: 'task-1',
      source: 'generation_task',
      kind: 'image',
      status: 'completed',
      creditsUsed: 7,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      userId: 'user-1',
    })
    usageCollector.finishJob({
      jobId: 'task-2',
      source: 'ai_job',
      kind: 'novel.summary',
      status: 'failed',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      userId: 'user-1',
    })

    expect(usageCollector.snapshot({ userId: 'user-1' })).toMatchObject({
      jobConcurrency: 0,
      jobCount: 2,
      jobFailedCount: 1,
      jobFailureRate: 0.5,
      creditsUsed: 7,
      requestCount: 0,
      errorCount: 0,
      errorRate: 0,
    })
  })
})

describe('installObservabilityHooks usage collection', () => {
  beforeEach(() => {
    usageCollector.resetForTests()
  })

  it('records request identity, route, status, and RPM after response', async () => {
    const app = Fastify({ logger: false })
    installObservabilityHooks(app)
    app.decorateRequest('principal', null)
    app.addHook('onRequest', async (request) => {
      request.principal = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'organization-1',
        roles: ['member'],
        passwordResetRequired: false,
        emailVerified: true,
      }
    })
    app.get('/api/v1/test', async () => ({ ok: true }))

    const response = await app.inject({ method: 'GET', url: '/api/v1/test' })

    expect(response.statusCode).toBe(200)
    expect(usageCollector.snapshot({ userId: 'user-1' })).toMatchObject({
      apiConcurrency: 0,
      rpm: 1,
      requestCount: 1,
      errorCount: 0,
    })
    await app.close()
  })

  it('records API request concurrency, request count, RPM, and error rate', async () => {
    const app = Fastify({ logger: false })
    installObservabilityHooks(app)
    app.decorateRequest('principal', null)
    app.addHook('onRequest', async (request) => {
      request.principal = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'organization-1',
        roles: ['member'],
        passwordResetRequired: false,
        emailVerified: true,
      }
    })

    let releaseSlowRequest!: () => void
    let markSlowRequestStarted!: () => void
    const slowRequestStarted = new Promise<void>((resolve) => {
      markSlowRequestStarted = resolve
    })
    const slowRequestReleased = new Promise<void>((resolve) => {
      releaseSlowRequest = resolve
    })

    app.get('/api/v1/slow', async () => {
      markSlowRequestStarted()
      await slowRequestReleased
      return { ok: true }
    })
    app.get('/api/v1/fail', async (_request, reply) => reply.code(500).send({ ok: false }))

    const pendingSlowRequest = app.inject({ method: 'GET', url: '/api/v1/slow' })
    await slowRequestStarted

    expect(usageCollector.snapshot({ userId: 'user-1' })).toMatchObject({
      apiConcurrency: 1,
      requestCount: 0,
      rpm: 0,
      errorCount: 0,
      errorRate: 0,
    })

    releaseSlowRequest()
    await expect(pendingSlowRequest).resolves.toMatchObject({ statusCode: 200 })

    const failed = await app.inject({ method: 'GET', url: '/api/v1/fail' })
    expect(failed.statusCode).toBe(500)

    expect(usageCollector.snapshot({ userId: 'user-1' })).toMatchObject({
      apiConcurrency: 0,
      requestCount: 2,
      rpm: 2,
      errorCount: 1,
      errorRate: 0.5,
    })

    await app.close()
  })
})
