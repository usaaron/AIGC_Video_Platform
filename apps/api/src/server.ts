import 'dotenv/config'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { noopTaskDispatcher } from './core/jobs/taskDispatcher.js'

const config = loadConfig()
const app = await buildApp({ config, logger: true, taskDispatcher: noopTaskDispatcher, startWorker: false })

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ host: config.API_HOST, port: config.API_PORT })
