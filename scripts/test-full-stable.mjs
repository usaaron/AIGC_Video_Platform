import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { platform } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestNetworkPolicy } from './test-network-guard.mjs'

const isWindows = platform() === 'win32'
const pnpmCommand = isWindows ? 'pnpm.cmd' : 'pnpm'
const root = fileURLToPath(new URL('..', import.meta.url))
const phases = [
  ['contracts tests', ['--filter', '@seqora/contracts', 'test']],
  ['prompting tests', ['--filter', '@seqora/prompting', 'test']],
  ['shared build', ['build:shared']],
  [
    'api source and test typecheck',
    ['--filter', '@seqora/api', 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json'],
  ],
  ['admin tests', ['--filter', '@seqora/admin', 'test']],
  ['web tests', ['--filter', '@seqora/web', 'test']],
]

export async function runFullStableTests({
  env = process.env,
  commands = { pnpm: runPnpm, docker: runDocker, node: runNode, preflight: assertDockerAvailable },
} = {}) {
  const configuredDatabase = env.SEQORA_TEST_DATABASE_URL?.trim() || env.TEST_DATABASE_URL?.trim()
  const configuredRedis = env.TEST_REDIS_URL?.trim()
  if (Boolean(configuredDatabase) !== Boolean(configuredRedis)) {
    throw new Error(
      'Configure both SEQORA_TEST_DATABASE_URL (or TEST_DATABASE_URL) and TEST_REDIS_URL, or neither.',
    )
  }
  const externalTestServices = Boolean(configuredDatabase)
  const dockerComposeTestArgs = [
    'compose',
    '-p',
    `seqora-test-${process.pid}-${randomUUID().slice(0, 8)}`,
    '-f',
    fileURLToPath(new URL('../compose.local.yml', import.meta.url)),
    '--profile',
    'test',
  ]
  // Bind only this run's services, using ephemeral ports so another test run or
  // the local preview never needs to be stopped or reused.
  const dockerEnv = { ...env, POSTGRES_TEST_PORT: '127.0.0.1:0', REDIS_TEST_PORT: '127.0.0.1:0' }
  let databaseUrl = configuredDatabase
  let redisUrl = configuredRedis
  let testDbStartAttempted = false
  let failure = null

  try {
    await commands.node(
      'test runner regression tests',
      ['--test', 'scripts/test-full-stable.test.mjs', 'scripts/test-network-guard.test.mjs'],
      { env },
    )
    if (!externalTestServices) commands.preflight(env)
    for (const [name, args] of phases) await commands.pnpm(name, args, { env })
    if (!externalTestServices) {
      // Compose may create one service and fail on the next. Register cleanup
      // before starting so that partial starts also release this run's volumes.
      testDbStartAttempted = true
      await commands.docker(
        'start shared test database',
        [
          ...dockerComposeTestArgs,
          'up',
          '-d',
          '--wait',
          '--wait-timeout',
          '120',
          'postgres-test',
          'redis-test',
        ],
        { env: dockerEnv },
      )
      const postgresPort = publishedPort(
        await commands.docker(
          'read test database port',
          [...dockerComposeTestArgs, 'port', 'postgres-test', '5432'],
          { env: dockerEnv, captureOutput: true },
        ),
      )
      const redisPort = publishedPort(
        await commands.docker(
          'read test Redis port',
          [...dockerComposeTestArgs, 'port', 'redis-test', '6379'],
          { env: dockerEnv, captureOutput: true },
        ),
      )
      databaseUrl = `postgres://seqora:seqora_test_password@127.0.0.1:${postgresPort}/seqora_test`
      redisUrl = `redis://127.0.0.1:${redisPort}`
    }
    const apiTestEnv = {
      ...env,
      NODE_ENV: 'test',
      DATA_FILE: ':memory:',
      DATABASE_URL: databaseUrl,
      SEQORA_TEST_DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      TEST_REDIS_URL: redisUrl,
      REDIS_URL: redisUrl,
      SEQORA_TEST_NETWORK_GUARD: '1',
      NODE_OPTIONS: appendNodeOption(
        env.NODE_OPTIONS,
        `--import=${new URL('./test-network-guard.mjs', import.meta.url).href}`,
      ),
    }
    createTestNetworkPolicy(apiTestEnv)
    await commands.pnpm('all api tests', ['--filter', '@seqora/api', 'test'], {
      env: apiTestEnv,
    })
    await commands.pnpm('browser regression tests', ['test:e2e'], { env })
  } catch (error) {
    failure = error
  } finally {
    if (testDbStartAttempted) {
      try {
        await commands.docker('stop shared test database', [...dockerComposeTestArgs, 'down', '-v'], {
          env: dockerEnv,
        })
      } catch (cleanupError) {
        if (failure) {
          failure = new AggregateError(
            [failure, cleanupError],
            'Full checks and test-service cleanup both failed.',
            {
              cause: failure,
            },
          )
        } else {
          failure = cleanupError
        }
      }
    }
  }
  if (failure) throw failure
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ')
}

function publishedPort(output) {
  const match = String(output)
    .trim()
    .match(/:(\d+)\s*$/m)
  const port = Number(match?.[1])
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Docker Compose did not report a valid published test-service port.')
  }
  return port
}

function assertDockerAvailable(env) {
  const configuredTimeout = Number(env.SEQORA_DOCKER_PREFLIGHT_TIMEOUT_MS)
  const timeout = Number.isFinite(configuredTimeout)
    ? Math.max(1_000, Math.min(60_000, configuredTimeout))
    : 10_000
  process.stdout.write(`\n[test:full:stable] docker preflight (timeout ${timeout}ms)\n`)
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    windowsHide: true,
    env,
    cwd: root,
  })
  if (result.status === 0) return
  if (result.error?.code === 'ETIMEDOUT' || result.signal) {
    throw new Error(
      `Docker daemon did not respond within ${timeout}ms. Start Docker Desktop or set SEQORA_DOCKER_PREFLIGHT_TIMEOUT_MS.`,
    )
  }
  const detail = String(result.stderr || result.error?.message || `exit ${result.status}`).trim()
  throw new Error(`Docker daemon is unavailable: ${detail}`)
}

function runPnpm(name, args, options) {
  return runCommand(name, (spawnOptions) => spawnPnpm(args, spawnOptions), options)
}

function runDocker(name, args, options) {
  return runCommand(name, (spawnOptions) => spawn('docker', args, spawnOptions), options)
}

function runNode(name, args, options) {
  return runCommand(name, (spawnOptions) => spawn(process.execPath, args, spawnOptions), options)
}

function runCommand(name, start, { env = process.env, captureOutput = false } = {}) {
  process.stdout.write(`\n[test:full:stable] ${name}\n`)
  return new Promise((resolve, reject) => {
    let output = ''
    let spawnError = null
    const child = start({
      stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      windowsHide: true,
      cwd: root,
      env,
    })
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.once('error', (error) => {
      spawnError = error
    })
    // close waits for stdout too, so a successful `compose port` cannot race its
    // final output chunk. A failed spawn also emits close after error.
    child.once('close', (code, signal) => {
      const error = spawnError || (code === 0 ? null : new Error(`${name} exited with ${signal ?? code}`))
      if (!error) return resolve(output)
      reject(error)
    })
  })
}

function spawnPnpm(args, options) {
  if (!isWindows) return spawn(pnpmCommand, args, options)
  const command = [pnpmCommand, ...args].map(quoteWindowsArgument).join(' ')
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], options)
}

function quoteWindowsArgument(value) {
  if (/^[A-Za-z0-9_@./:+-]+$/.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runFullStableTests()
}
