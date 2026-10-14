import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { createTestNetworkPolicy } from './test-network-guard.mjs'

const execFileAsync = promisify(execFile)
const fixtureEnv = {
  SEQORA_TEST_DATABASE_URL: 'postgres://fixture:private@db.example:15432/test',
  TEST_REDIS_URL: 'rediss://fixture:private@redis.example/2',
}
const guardUrl = new URL('./test-network-guard.mjs', import.meta.url).href

test('allows only explicit service endpoints and ephemeral loopback fixture connections', () => {
  const allowed = createTestNetworkPolicy(fixtureEnv)
  for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1']) {
    assert.equal(allowed(host, 49152), true)
    for (const port of [5432, 5433, 6379, 6380]) assert.equal(allowed(host, port), false)
  }
  assert.equal(allowed('db.example', 15432), true)
  assert.equal(allowed('DB.EXAMPLE.', 15432), true)
  assert.equal(allowed('redis.example', 6379), true)
  assert.equal(allowed('db.example', 5432), false)
  assert.equal(allowed('redis.example', 443), false)
  assert.equal(allowed('provider.example', 443), false)
  assert.equal(allowed('192.168.1.2', 49152), false)
  for (const port of [0, -1, 65_536, NaN]) assert.equal(allowed('localhost', port), false)
})

test('explicit local fixtures may use standard ports and IPv6 addresses', () => {
  const allowed = createTestNetworkPolicy({
    TEST_DATABASE_URL: 'postgresql://fixture:private@[::1]/test',
    TEST_REDIS_URL: 'redis://127.0.0.1',
  })
  assert.equal(allowed('::1', 5432), true)
  assert.equal(allowed('[::1]', 5432), true)
  assert.equal(allowed('127.0.0.1', 6379), true)
  assert.equal(allowed('::ffff:127.0.0.1', 6379), true)
  assert.equal(allowed('127.0.0.1', 5432), false)
  assert.equal(allowed('::1', 6379), false)
})

test('invalid fixture URLs fail closed without exposing credentials', () => {
  for (const value of [
    undefined,
    'private-invalid-url',
    'https://fixture:private@db.example/test',
    'postgres://fixture:private@localhost:0/test',
  ]) {
    assert.throws(
      () => createTestNetworkPolicy({ ...fixtureEnv, SEQORA_TEST_DATABASE_URL: value }),
      (error) => /valid explicit test/.test(error.message) && !error.message.includes('private'),
    )
  }
})

// The same probe runs in an ordinary Node subprocess and in a real Vitest fork.
// Its only live connections are to the HTTP listener it creates itself.
const probeSource = `
import assert from 'node:assert/strict'
import net from 'node:net'
import { createServer } from 'node:http'
import { once } from 'node:events'
import pg from ${JSON.stringify(new URL('../apps/api/node_modules/pg/lib/index.js', import.meta.url).href)}
import Redis from ${JSON.stringify(new URL('../apps/api/node_modules/ioredis/built/index.js', import.meta.url).href)}

async function probe() {
  const blocked = async (socket) => {
    const [error] = await once(socket, 'error')
    assert.equal(error.code, 'SEQORA_TEST_NETWORK_BLOCKED')
    assert.equal(socket.destroyed, true)
  }
  await blocked(net.createConnection({ host: '127.0.0.1', port: 5432 }))
  await blocked(net.connect(6379, 'localhost'))
  await blocked(new net.Socket().connect({ host: '::1', port: 5433 }))
  await blocked(net.createConnection({ host: 'provider.example.invalid', port: 443 }))

  const client = new pg.Client({ connectionString: 'postgres://fixture:private@127.0.0.1:5432/test' })
  try {
    await assert.rejects(client.connect(), { code: 'SEQORA_TEST_NETWORK_BLOCKED' })
  } finally {
    await client.end()
  }
  const redisErrors = []
  const redis = new Redis({ host: '127.0.0.1', port: 6379, lazyConnect: true, retryStrategy: () => null })
  redis.on('error', (error) => redisErrors.push(error))
  try {
    await assert.rejects(redis.connect())
    assert.equal(redisErrors[0]?.code, 'SEQORA_TEST_NETWORK_BLOCKED')
  } finally {
    redis.disconnect()
  }
  await assert.rejects(fetch('https://provider.example.invalid'), (error) =>
    error.cause?.code === 'SEQORA_TEST_NETWORK_BLOCKED')

  const server = createServer((_request, response) => response.end('isolated fixture'))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const port = server.address().port
    const response = await fetch('http://127.0.0.1:' + port)
    assert.equal(await response.text(), 'isolated fixture')
    const socket = net.createConnection({ host: '127.0.0.1', port })
    await once(socket, 'connect')
    socket.end()
    await once(socket, 'close')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
`

function subprocessEnv() {
  return {
    ...process.env,
    ...fixtureEnv,
    SEQORA_TEST_NETWORK_GUARD: '1',
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${guardUrl}`].filter(Boolean).join(' '),
  }
}

test('the preload blocks net, pg, Redis and fetch before connection while permitting local HTTP', async () => {
  await execFileAsync(process.execPath, ['--input-type=module', '--eval', `${probeSource}\nawait probe()`], {
    env: subprocessEnv(),
    windowsHide: true,
    timeout: 20_000,
  })
})

test('Vitest fork workers inherit the API-only network preload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seqora-network-guard-'))
  try {
    await writeFile(
      join(directory, 'vitest.config.mjs'),
      `export default { test: { pool: 'forks', maxWorkers: 1, include: ['probe.test.mjs'] } }`,
    )
    const vitestUrl = new URL('../apps/api/node_modules/vitest/dist/index.js', import.meta.url).href
    await writeFile(
      join(directory, 'probe.test.mjs'),
      `${probeSource}\nimport { test } from ${JSON.stringify(vitestUrl)}\ntest('network isolation is inherited', probe)`,
    )
    const vitest = fileURLToPath(new URL('../apps/api/node_modules/vitest/vitest.mjs', import.meta.url))
    await execFileAsync(process.execPath, [vitest, 'run', '--config', join(directory, 'vitest.config.mjs')], {
      cwd: directory,
      env: subprocessEnv(),
      windowsHide: true,
      timeout: 30_000,
    })
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.equal(basename(directory).startsWith('seqora-network-guard-'), true)
    await rm(directory, { recursive: true, force: true })
  }
})
