import 'dotenv/config'
import { loadConfig } from '../config.js'
import { AccountDatabase } from '../infra/postgres.js'
import { anonymizePreprodDatabase, formatPreprodAnonymizationReport } from './preprodAnonymization.js'

const supportedOptions = new Set(['--dry-run'])
const cliOptions = process.argv.slice(2)
const unsupportedOptions = cliOptions.filter((option) => !supportedOptions.has(option))

if (unsupportedOptions.length) {
  throw new Error(`Unsupported option(s): ${unsupportedOptions.join(', ')}`)
}

const config = loadConfig()

if (!config.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for pnpm --filter @seqora/api db:anonymize-preprod')
}

const database = new AccountDatabase(config.DATABASE_URL)

try {
  await database.ensureLatestMigrations()
  const report = await anonymizePreprodDatabase(database, config, {
    dryRun: cliOptions.includes('--dry-run'),
  })
  process.stdout.write(`${formatPreprodAnonymizationReport(report)}\n`)
} finally {
  await database.close()
}
