import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import { resolve } from 'node:path'
import type { AppConfig } from './config.js'
import { installAuth } from './core/auth/installAuth.js'
import { createAuthProvider } from './core/auth/provider.js'
import { AppError } from './core/errors.js'
import { LocalTaskRunner } from './core/jobs/taskDispatcher.js'
import { AppStore } from './infra/store.js'
import { registerAdminRoutes } from './modules/admin/routes.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { AuthService } from './modules/auth/service.js'
import { registerBillingRoutes } from './modules/billing/routes.js'
import { StoreCreditLedger } from './modules/billing/creditLedger.js'
import { registerGenerationRoutes } from './modules/generation/routes.js'
import { GenerationTaskRepository } from './modules/generation/repository.js'
import { GenerationService } from './modules/generation/service.js'
import { registerProjectRoutes } from './modules/projects/routes.js'
import { ProjectRepository } from './modules/projects/repository.js'
import { ProjectService } from './modules/projects/service.js'
import { UserRepository } from './modules/users/repository.js'

type BuildAppOptions = {
  config: AppConfig
  logger?: boolean
  store?: AppStore
  startWorker?: boolean
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false })
  const store =
    options.store ??
    new AppStore(options.config.DATA_FILE === ':memory:' ? null : resolve(options.config.DATA_FILE))
  await store.initialize()

  await app.register(cookie)
  await app.register(cors, { origin: options.config.WEB_ORIGIN, credentials: true })

  const users = new UserRepository(store)
  const authService = new AuthService(users, options.config.AUTH_SECRET)
  const creditLedger = new StoreCreditLedger(store)
  const taskRunner = new LocalTaskRunner(store)
  const generationService = new GenerationService(
    new GenerationTaskRepository(store),
    creditLedger,
    taskRunner,
  )
  const projectService = new ProjectService(new ProjectRepository(store))

  installAuth(app, createAuthProvider(options.config, users))

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
    }
    request.log.error(error)
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } })
  })

  app.get('/api/v1/health', async () => ({ status: 'ok', service: 'seqora-api' }))
  await app.register(
    async (api) => {
      await registerAuthRoutes(api, authService, options.config.NODE_ENV === 'production')
      await registerProjectRoutes(api, projectService)
      await registerGenerationRoutes(api, generationService)
      await registerBillingRoutes(api, creditLedger)
      await registerAdminRoutes(api, store)
    },
    { prefix: '/api/v1' },
  )

  if (options.startWorker !== false) taskRunner.start()
  app.addHook('onClose', async () => taskRunner.stop())
  return app
}
