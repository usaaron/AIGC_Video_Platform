import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import pg from 'pg'
import { AccountDatabase } from '../infra/postgres.js'

const { Pool } = pg as typeof import('pg')

const execFileAsync = promisify(execFile)
const postgresImage = 'postgres:16-alpine'
const postgresDatabase = 'seqora_auth'
const postgresPassword = 'postgres'

export type PostgresAuthFixture = {
  connectionString: string
  reset(): Promise<void>
  close(): Promise<void>
}

export async function startPostgresAuthFixture(): Promise<PostgresAuthFixture> {
  const containerName = `seqora-auth-${process.pid}-${randomUUID()}`
  let waitPool: Pool | null = null
  let database: AccountDatabase | null = null
  try {
    await execFileAsync('docker', [
      'run',
      '--rm',
      '-d',
      '--name',
      containerName,
      '-e',
      `POSTGRES_PASSWORD=${postgresPassword}`,
      '-e',
      `POSTGRES_DB=${postgresDatabase}`,
      '-P',
      postgresImage,
    ])
    const { stdout } = await execFileAsync('docker', ['port', containerName, '5432/tcp'])
    const port = parsePublishedPort(stdout)
    const connectionString = `postgres://postgres:${postgresPassword}@127.0.0.1:${port}/${postgresDatabase}`
    waitPool = new Pool({ connectionString, max: 1 })
    await waitForPostgres(waitPool)
    await waitPool.end()
    waitPool = null
    database = new AccountDatabase(connectionString)
    await database.initialize()

    return {
      connectionString,
      async reset() {
        await database?.query(
          `
          TRUNCATE TABLE
            sessions,
            tenant_invitations,
            billing_accounts,
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
        await execFileAsync('docker', ['rm', '-f', containerName]).catch(() => {})
      },
    }
  } catch (error) {
    await database?.close().catch(() => {})
    await waitPool?.end().catch(() => {})
    await execFileAsync('docker', ['rm', '-f', containerName]).catch(() => {})
    throw error
  }
}

function parsePublishedPort(output: string): string {
  const match = output.match(/:(\d+)\s*$/m)
  if (!match?.[1]) throw new Error(`Could not parse Postgres published port: ${output}`)
  return match[1]
}

async function waitForPostgres(pool: Pool): Promise<void> {
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
