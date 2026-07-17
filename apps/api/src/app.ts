import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import type { AppConfig } from './config.js'
import { installAuth } from './core/auth/installAuth.js'
import { createAuthProvider } from './core/auth/provider.js'
import { AppError } from './core/errors.js'
import { DemoTaskDispatcher, type TaskDispatcher } from './core/jobs/taskDispatcher.js'
import { registerAdminRoutes } from './modules/admin/routes.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { DemoCreditLedger, type CreditLedger } from './modules/billing/creditLedger.js'
import { registerGenerationRoutes } from './modules/generation/routes.js'
import {
  InMemoryGenerationTaskRepository,
  type GenerationTaskRepository,
} from './modules/generation/repository.js'
import { GenerationService } from './modules/generation/service.js'

type BuildAppOptions = {
  config: AppConfig
  logger?: boolean
  taskRepository?: GenerationTaskRepository
  creditLedger?: CreditLedger
  taskDispatcher?: TaskDispatcher
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false })
  await app.register(cors, { origin: options.config.WEB_ORIGIN, credentials: true })

  installAuth(app, createAuthProvider(options.config))

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
    }
    request.log.error(error)
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  })

  const generationService = new GenerationService(
    options.taskRepository ?? new InMemoryGenerationTaskRepository(),
    options.creditLedger ?? new DemoCreditLedger(),
    options.taskDispatcher ?? new DemoTaskDispatcher(),
  )

  app.get('/api/v1/health', async () => ({ status: 'ok', service: 'seqora-api' }))
  await app.register(
    async (api) => {
      await registerAuthRoutes(api)
      await registerGenerationRoutes(api, generationService)
      await registerAdminRoutes(api)
    },
    { prefix: '/api/v1' },
  )

  return app
}
