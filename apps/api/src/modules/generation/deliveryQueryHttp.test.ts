import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import { downloadPrincipal, downloadTask } from './deliveryDownload.fixture.js'
import { GenerationTaskRepository } from './repository.js'
import { GenerationService } from './service.js'
import { registerGenerationRoutes } from './routes.js'

const apps: FastifyInstance[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const app of apps.splice(0)) await app.close()
  vi.restoreAllMocks()
})
async function fixture() {
  const app = Fastify()
  apps.push(app)
  const store = new AppStore(null)
  await store.initialize()
  const task = downloadTask()
  const png = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex')
  const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-single.png`
  task.outputs = [{ id: 'main', mediaType: 'image', view: 'single', url: task.resultUrl! }]
  task.metadata.generatedOutputs = [
    {
      view: 'single',
      storageKey,
      size: png.length,
      contentType: 'image/png',
      sha256: createHash('sha256').update(png).digest('hex'),
    },
  ]
  await store.mutate((state) => {
    state.tasks = [task]
  })
  const initialState = store.read((state) => state)
  const streams: Readable[] = []
  const storage: ObjectStorage = {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    getStream: vi.fn(async () => {
      const stream = new Readable({ read() {} })
      streams.push(stream)
      return { stream, size: png.length }
    }),
  }
  const dispatch = vi.fn()
  const service = new GenerationService(
    new GenerationTaskRepository(store),
    { dispatch } as unknown as TaskDispatcher,
    null,
    'stringx-seedance',
    storage,
  )
  const requests: FastifyRequest[] = []
  app.addHook('onRequest', async (request) => {
    requests.push(request)
    const user = request.headers['x-test-user']
    if (user === 'member') request.principal = downloadPrincipal
    if (user === 'other') request.principal = { ...downloadPrincipal, tenantId: 'another-tenant' }
  })
  await registerGenerationRoutes(app, service)
  await app.ready()
  const query = (endpoint = 'delivery-verification', user = 'member') =>
    app.inject({
      method: 'GET',
      url: `/generation/tasks/${task.id}/${endpoint}`,
      headers: user ? { 'x-test-user': user } : {},
    })
  const awaitStreams = async (count: number) => {
    for (let attempt = 0; streams.length < count && attempt < 100; attempt += 1)
      await new Promise<void>((resolve) => setImmediate(resolve))
    expect(streams).toHaveLength(count)
  }
  const assertReadOnly = () => {
    expect(store.read((state) => state)).toEqual(initialState)
    for (const method of [dispatch, storage.put, storage.get, storage.delete])
      expect(method).not.toHaveBeenCalled()
  }
  return { app, requests, streams, query, awaitStreams, assertReadOnly }
}

describe('GET delivery query HTTP cancellation and capacity', () => {
  it.each(['delivery-verification', 'delivery-gate'])(
    'maps the whole %s query deadline to 503',
    async (endpoint) => {
      const test = await fixture()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const pending = test.query(endpoint).then((response) => response)
      await test.awaitStreams(1)
      await vi.advanceTimersByTimeAsync(15_001)
      const response = await pending
      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({ code: 'DELIVERY_QUERY_TIMEOUT' })
      expect(response.headers['cache-control']).toBe('private, no-store')
      expect(test.streams[0]!.destroyed).toBe(true)
      test.assertReadOnly()
    },
  )

  it.each(['delivery-verification', 'delivery-gate'])(
    'propagates a disconnected %s request to its storage reader',
    async (endpoint) => {
      const test = await fixture()
      const pending = test.query(endpoint).then((response) => response)
      await test.awaitStreams(1)
      test.requests[0]!.raw.emit('aborted')
      const response = await pending
      expect(response.statusCode).toBe(499)
      expect(response.json()).toMatchObject({ code: 'DELIVERY_QUERY_ABORTED' })
      expect(test.streams[0]!.destroyed).toBe(true)
      test.assertReadOnly()
    },
  )

  it('shares four slots across both GET endpoints and preserves authentication and scope checks at capacity', async () => {
    const test = await fixture()
    const pending = Array.from({ length: 4 }, (_, index) =>
      test.query(index % 2 ? 'delivery-gate' : 'delivery-verification').then((response) => response),
    )
    await test.awaitStreams(4)
    const response = await test.query()
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ code: 'DELIVERY_QUERY_BUSY' })
    expect((await test.query('delivery-gate', 'other')).statusCode).toBe(404)
    expect((await test.query('delivery-gate', '')).statusCode).toBe(401)
    expect(test.streams).toHaveLength(4)
    for (const request of test.requests.slice(0, 4)) request.raw.emit('aborted')
    expect((await Promise.all(pending)).every((item) => item.statusCode === 499)).toBe(true)
    expect(test.streams.every((stream) => stream.destroyed)).toBe(true)
    test.assertReadOnly()
  })
})
