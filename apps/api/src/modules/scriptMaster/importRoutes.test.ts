import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { createProjectSchema, type Principal } from '@seqora/contracts'
import { loadConfig } from '../../config.js'
import { AppStore } from '../../infra/store.js'
import { AppError } from '../../core/errors.js'
import { ProjectRepository } from '../projects/repository.js'
import { ProjectService } from '../projects/service.js'
import { ScriptMasterImportRepository } from './importRepository.js'
import { registerScriptMasterRoutes, signClaims } from './routes.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
const secret = 'script-master-test-secret'
const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})
async function setup() {
  const store = new AppStore(null)
  await store.initialize()
  const repository = new ProjectRepository(store)
  const project = await repository.create(createProjectSchema.parse({ name: '导入目标' }), principal)
  const app = Fastify()
  apps.push(app)
  app.decorateRequest('principal', null)
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(error instanceof AppError ? error.statusCode : 500)
      .send({ code: error instanceof AppError ? error.code : 'ERROR' }),
  )
  await app.register(
    async (api) =>
      registerScriptMasterRoutes(
        api,
        loadConfig({ NODE_ENV: 'test', SCRIPT_MASTER_SHARED_SECRET: secret }),
        new ProjectService(repository),
        undefined,
        new ScriptMasterImportRepository(store),
      ),
    { prefix: '/api/v1' },
  )
  const token = (
    scope: string | null = null,
    roles = ['member'],
    expiresAt = Math.floor(Date.now() / 1000) + 300,
  ) =>
    `Bearer ${signClaims({ version: 1, issuer: 'seqora', audience: 'script-master', issuedAt: Math.floor(Date.now() / 1000), expiresAt, tokenId: 'test-token', tenantId: principal.tenantId, actorId: principal.userId, roles, permissions: ['project.write'], projectId: scope }, secret)}`
  const payload = {
    contractVersion: 'script_master_delivery.v2',
    targetProjectId: project.id,
    sourceProjectId: 'source-project',
    sourceRevision: 1,
    idempotencyKey: 'import-http-1',
    assets: [{ sourceAssetId: 'character:林岚', kind: 'character', name: '林岚' }],
  }
  return { app, token, payload, project }
}
describe('import ticket authorization', () => {
  it('accepts a valid ticket and only lists writable targets', async () => {
    const { app, token, payload, project } = await setup()
    const headers = { authorization: token(project.id) }
    const list = await app.inject({ method: 'GET', url: '/api/v1/script-master/targets', headers })
    expect(list.json()).toEqual([{ id: project.id, name: project.name }])
    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/script-master/imports',
      headers,
      payload,
    })
    expect(imported.statusCode).toBe(201)
    expect(imported.json()).toMatchObject({ importedAssets: 1 })
  })
  it('rejects an expired, absent or differently scoped ticket before importing', async () => {
    const { app, token, payload } = await setup()
    for (const [authorization, expected] of [
      ['', 401],
      [token(null, ['member'], 1), 401],
      [token('another-project'), 403],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/script-master/imports',
        headers: { authorization },
        payload,
      })
      expect(response.statusCode).toBe(expected)
    }
  })
  it('filters a scoped ticket target list and rejects a role without project.write', async () => {
    const { app, token, payload } = await setup()
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/script-master/targets',
          headers: { authorization: token('another-project') },
        })
      ).json(),
    ).toEqual([])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/script-master/imports',
      headers: { authorization: token(null, []) },
      payload,
    })
    expect(response.statusCode).toBe(403)
  })
})
