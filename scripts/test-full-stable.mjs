import { spawn, spawnSync } from 'node:child_process'
import { platform } from 'node:os'

const isWindows = platform() === 'win32'
const pnpmCommand = isWindows ? 'pnpm.cmd' : 'pnpm'
const dockerComposeTestArgs = ['compose', '-p', 'seqora-test', '-f', 'compose.local.yml', '--profile', 'test']
const testEnv = {
  ...process.env,
  SEQORA_TEST_DATABASE_URL:
    process.env.SEQORA_TEST_DATABASE_URL ||
    process.env.TEST_DATABASE_URL ||
    'postgres://seqora:seqora_test_password@127.0.0.1:5433/seqora_test',
  TEST_DATABASE_URL:
    process.env.TEST_DATABASE_URL ||
    process.env.SEQORA_TEST_DATABASE_URL ||
    'postgres://seqora:seqora_test_password@127.0.0.1:5433/seqora_test',
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6380',
}

const phases = [
  ['contracts tests', ['--filter', '@seqora/contracts', 'test']],
  ['prompting tests', ['--filter', '@seqora/prompting', 'test']],
  ['shared build', ['build:shared']],
  ['admin tests', ['--filter', '@seqora/admin', 'test']],
  ['web tests', ['--filter', '@seqora/web', 'test']],
  ['api unit tests', ['--filter', '@seqora/api', 'test:unit']],
]

let testDbStarted = false

try {
  assertDockerAvailable()
  for (const [name, args] of phases) {
    await runPnpm(name, args)
  }
  await runDocker('start shared test database', [
    ...dockerComposeTestArgs,
    'up',
    '-d',
    'postgres-test',
    'redis-test',
  ])
  testDbStarted = true
  await runPnpm('api db integration tests', ['--filter', '@seqora/api', 'test:integration'], {
    env: testEnv,
  })
} finally {
  if (testDbStarted) {
    await runDocker('stop shared test database', [...dockerComposeTestArgs, 'down', '-v'], {
      allowFailure: true,
    })
  }
}

function assertDockerAvailable() {
  const configuredTimeout = Number(process.env.SEQORA_DOCKER_PREFLIGHT_TIMEOUT_MS)
  const timeout = Number.isFinite(configuredTimeout)
    ? Math.max(1_000, Math.min(60_000, configuredTimeout))
    : 10_000
  process.stdout.write(`\n[test:full:stable] docker preflight (timeout ${timeout}ms)\n`)
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    windowsHide: true,
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

function runPnpm(name, args, { env = process.env, allowFailure = false } = {}) {
  process.stdout.write(`\n[test:full:stable] ${name}\n`)
  return new Promise((resolve, reject) => {
    const child = spawnPnpm(args, { stdio: 'inherit', env })
    child.on('error', (error) => {
      if (allowFailure) {
        process.stderr.write(`[test:full:stable] ${name} failed during cleanup: ${error.message}\n`)
        resolve()
        return
      }
      reject(error)
    })
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      const error = new Error(`${name} exited with ${signal ?? code}`)
      if (allowFailure) {
        process.stderr.write(`[test:full:stable] ${error.message}\n`)
        resolve()
        return
      }
      reject(error)
    })
  })
}

function runDocker(name, args, { allowFailure = false } = {}) {
  process.stdout.write(`\n[test:full:stable] ${name}\n`)
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: 'inherit', windowsHide: false })
    child.on('error', (error) => {
      if (allowFailure) {
        process.stderr.write(`[test:full:stable] ${name} failed during cleanup: ${error.message}\n`)
        resolve()
        return
      }
      reject(error)
    })
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      const error = new Error(`${name} exited with ${signal ?? code}`)
      if (allowFailure) {
        process.stderr.write(`[test:full:stable] ${error.message}\n`)
        resolve()
        return
      }
      reject(error)
    })
  })
}

function spawnPnpm(args, options) {
  if (!isWindows) return spawn(pnpmCommand, args, options)
  const command = [pnpmCommand, ...args].map(quoteWindowsArgument).join(' ')
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    ...options,
    windowsHide: false,
  })
}

function quoteWindowsArgument(value) {
  if (/^[A-Za-z0-9_@./:+-]+$/.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}
