import { execFile, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import pg from 'pg'
import type { Pool as PgPool } from 'pg'
import { AccountDatabase } from '../infra/postgres.js'

const { Pool } = pg as typeof import('pg')

const execFileAsync = promisify(execFile)
const postgresImage = 'postgres:16-alpine'
const postgresDatabase = 'seqora_auth'
const postgresPassword = 'postgres'
const sharedContainerName = `seqora-test-postgres-${process.pid}`
const defaultComposeConnectionString = 'postgres://seqora:seqora_test_password@127.0.0.1:5433/seqora_test'
const composeFilePath = fileURLToPath(new URL('../../../../compose.local.yml', import.meta.url))
const dockerLogTail = 160
const dockerDiagnosticMaxBuffer = 1024 * 1024 * 8

let sharedPostgresPromise: Promise<SharedPostgresServer> | null = null
let sharedContainerCleanupRegistered = false

type SharedPostgresServer = {
  connectionString: string
  containerName?: string
}

export type PostgresAuthFixture = {
  connectionString: string
  reset(): Promise<void>
  close(): Promise<void>
}

export async function startPostgresAuthFixture(): Promise<PostgresAuthFixture> {
  let server: SharedPostgresServer | null = null
  let schemaName = ''
  let adminPool: PgPool | null = null
  let database: AccountDatabase | null = null

  try {
    server = await getSharedPostgresServer()
    schemaName = `seqora_test_${process.pid}_${randomUUID().replace(/-/g, '')}`
    adminPool = new Pool({ connectionString: server.connectionString, max: 1 })
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`)
    const connectionString = withSearchPath(server.connectionString, schemaName)
    database = new AccountDatabase(connectionString)
    await database.migrate()

    return {
      connectionString,
      async reset() {
        await database?.query(
          `
          TRUNCATE TABLE
            audit_log_entries,
            password_reset_tokens,
            sessions,
            organization_billing_ledger_entries,
            organization_billing_accounts,
            billing_accounts,
            tenant_invitations,
            tenant_memberships,
            tenants,
            auth_identities,
            users
          RESTART IDENTITY CASCADE
          `,
        )
      },
      async close() {
        await database?.close()
        database = null
        await adminPool?.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`)
        await adminPool?.end()
        adminPool = null
      },
    }
  } catch (error) {
    await database?.close().catch(() => {})
    if (schemaName) {
      await adminPool?.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`).catch(() => {})
    }
    await adminPool?.end().catch(() => {})
    await logPostgresFixtureDiagnostics(error, server).catch(() => {})
    throw error
  }
}

async function getSharedPostgresServer(): Promise<SharedPostgresServer> {
  sharedPostgresPromise ??= resolveSharedPostgresServer()
  return sharedPostgresPromise
}

async function resolveSharedPostgresServer(): Promise<SharedPostgresServer> {
  const configuredConnectionString =
    process.env.SEQORA_TEST_DATABASE_URL?.trim() || process.env.TEST_DATABASE_URL?.trim()
  if (configuredConnectionString) {
    await waitForConnectionString(configuredConnectionString)
    return { connectionString: configuredConnectionString }
  }

  if (await canConnect(defaultComposeConnectionString)) {
    return { connectionString: defaultComposeConnectionString }
  }

  const connectionString = await ensureSharedDockerPostgres()
  await waitForConnectionString(connectionString)
  return { connectionString, containerName: sharedContainerName }
}

async function ensureSharedDockerPostgres(): Promise<string> {
  const state = await dockerContainerState(sharedContainerName)
  if (state && state !== 'running') {
    await execFileAsync('docker', ['rm', '-f', sharedContainerName]).catch(() => {})
  }

  if (state !== 'running') {
    await execFileAsync('docker', [
      'run',
      '--rm',
      '-d',
      '--name',
      sharedContainerName,
      '-e',
      `POSTGRES_PASSWORD=${postgresPassword}`,
      '-e',
      `POSTGRES_DB=${postgresDatabase}`,
      '-P',
      postgresImage,
    ])
  }

  registerSharedContainerCleanup()
  const { stdout } = await execFileAsync('docker', ['port', sharedContainerName, '5432/tcp'])
  const port = parsePublishedPort(stdout)
  return `postgres://postgres:${postgresPassword}@127.0.0.1:${port}/${postgresDatabase}`
}

async function dockerContainerState(containerName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('docker', ['inspect', '-f', '{{.State.Status}}', containerName])
    return stdout.trim() || null
  } catch {
    return null
  }
}

function registerSharedContainerCleanup(): void {
  if (sharedContainerCleanupRegistered) return
  sharedContainerCleanupRegistered = true
  const cleanup = () => {
    spawnSync('docker', ['rm', '-f', sharedContainerName], { stdio: 'ignore' })
  }
  process.once('exit', cleanup)
  process.once('SIGINT', () => {
    cleanup()
    process.exit(130)
  })
  process.once('SIGTERM', () => {
    cleanup()
    process.exit(143)
  })
}

async function logPostgresFixtureDiagnostics(
  error: unknown,
  server: SharedPostgresServer | null,
): Promise<void> {
  const containers = await postgresDiagnosticContainers(server)
  const lines = [
    '',
    '[seqora-postgres-fixture] startPostgresAuthFixture failed.',
    `[seqora-postgres-fixture] Error: ${errorMessage(error)}`,
  ]

  if (!containers.length) {
    lines.push('[seqora-postgres-fixture] No Postgres Docker container found for diagnostics.')
    process.stderr.write(`${lines.join('\n')}\n`)
    return
  }

  for (const container of containers) {
    lines.push('')
    lines.push(`[seqora-postgres-fixture] docker logs --tail ${dockerLogTail} ${container}`)
    lines.push(await dockerDiagnosticOutput(['logs', '--tail', String(dockerLogTail), container]))
    lines.push('')
    lines.push(`[seqora-postgres-fixture] docker inspect ${container}`)
    lines.push(await dockerDiagnosticOutput(['inspect', container]))
  }

  process.stderr.write(`${lines.join('\n')}\n`)
}

async function postgresDiagnosticContainers(server: SharedPostgresServer | null): Promise<string[]> {
  const containers: string[] = []
  if (server?.containerName) containers.push(server.containerName)
  if (!containers.includes(sharedContainerName) && (await dockerContainerState(sharedContainerName))) {
    containers.push(sharedContainerName)
  }
  const composeContainer = await composePostgresTestContainerId()
  if (composeContainer && !containers.includes(composeContainer)) containers.push(composeContainer)
  return containers
}

async function composePostgresTestContainerId(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['compose', '-f', composeFilePath, 'ps', '-q', 'postgres-test'],
      { maxBuffer: dockerDiagnosticMaxBuffer },
    )
    return stdout.trim().split(/\s+/)[0] || null
  } catch {
    return null
  }
}

async function dockerDiagnosticOutput(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('docker', args, {
      maxBuffer: dockerDiagnosticMaxBuffer,
    })
    return truncateDiagnosticOutput([stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || '(empty)')
  } catch (error) {
    return `(unavailable: ${errorMessage(error)})`
  }
}

function truncateDiagnosticOutput(value: string): string {
  const limit = 20_000
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n... truncated ${value.length - limit} chars`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error)
}

function withSearchPath(connectionString: string, schemaName: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schemaName},public`)
  return url.toString()
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function parsePublishedPort(output: string): string {
  const match = output.match(/:(\d+)\s*$/m)
  if (!match?.[1]) throw new Error(`Could not parse Postgres published port: ${output}`)
  return match[1]
}

async function canConnect(connectionString: string): Promise<boolean> {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 500, max: 1 })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => {})
  }
}

async function waitForConnectionString(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 })
  try {
    await waitForPostgres(pool)
  } finally {
    await pool.end().catch(() => {})
  }
}

async function waitForPostgres(pool: PgPool): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await pool.query('SELECT 1')
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Postgres test fixture did not become ready')
}
