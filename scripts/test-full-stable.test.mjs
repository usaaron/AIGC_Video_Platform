import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runFullStableTests } from './test-full-stable.mjs'

function commandFixture({ failAt, failures = {}, output = {} } = {}) {
  const calls = []
  const failure = new Error('simulated command failure')
  const record = (kind) => async (name, args, options) => {
    calls.push({ kind, name, args, options })
    if (failures[name]) throw failures[name]
    if (name === failAt) throw failure
    if (name === 'read test database port') return output.postgres ?? '127.0.0.1:49152\n'
    if (name === 'read test Redis port') return output.redis ?? '127.0.0.1:49153\n'
    return ''
  }
  return {
    calls,
    failure,
    commands: {
      node: record('node'),
      pnpm: record('pnpm'),
      docker: record('docker'),
      preflight(env) {
        calls.push({ kind: 'preflight', env })
      },
    },
  }
}

test('runs every release suite and API typecheck against only this run’s managed services', async () => {
  const fixture = commandFixture()
  const env = {
    POSTGRES_TEST_PORT: '5433',
    REDIS_TEST_PORT: '6380',
    NODE_ENV: 'development',
    DATA_FILE: 'data/development.json',
    DATABASE_URL: 'postgres://dev:5432/development',
    REDIS_URL: 'redis://dev:6379',
    NODE_OPTIONS: '--max-old-space-size=2048 --enable-source-maps',
  }
  const originalEnv = { ...env }
  await runFullStableTests({ env, commands: fixture.commands })
  assert.deepEqual(
    fixture.calls.filter(({ kind }) => kind === 'pnpm').map(({ args }) => args),
    [
      ['--filter', '@seqora/contracts', 'test'],
      ['--filter', '@seqora/prompting', 'test'],
      ['build:shared'],
      ['--filter', '@seqora/api', 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json'],
      ['--filter', '@seqora/admin', 'test'],
      ['--filter', '@seqora/web', 'test'],
      ['--filter', '@seqora/api', 'test'],
      ['test:e2e'],
    ],
  )
  assert.equal(fixture.calls[0].name, 'test runner regression tests')
  assert.deepEqual(fixture.calls[0].args, [
    '--test',
    'scripts/test-full-stable.test.mjs',
    'scripts/test-network-guard.test.mjs',
  ])
  const dockerCalls = fixture.calls.filter(({ kind }) => kind === 'docker')
  const project = dockerCalls[0].args[2]
  assert.match(project, /^seqora-test-\d+-[a-f0-9]{8}$/)
  for (const call of dockerCalls) {
    assert.deepEqual(call.args.slice(0, 3), ['compose', '-p', project])
    assert.equal(call.options.env.POSTGRES_TEST_PORT, '127.0.0.1:0')
    assert.equal(call.options.env.REDIS_TEST_PORT, '127.0.0.1:0')
  }
  assert.deepEqual(dockerCalls[0].args.slice(-7), [
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '120',
    'postgres-test',
    'redis-test',
  ])
  const apiEnv = fixture.calls.find(({ name }) => name === 'all api tests').options.env
  assert.equal(apiEnv.SEQORA_TEST_NETWORK_GUARD, '1')
  assert.equal(
    apiEnv.NODE_OPTIONS,
    `${env.NODE_OPTIONS} --import=${new URL('./test-network-guard.mjs', import.meta.url).href}`,
  )
  assert.equal(apiEnv.NODE_ENV, 'test')
  assert.equal(apiEnv.DATA_FILE, ':memory:')
  assert.equal(
    apiEnv.SEQORA_TEST_DATABASE_URL,
    'postgres://seqora:seqora_test_password@127.0.0.1:49152/seqora_test',
  )
  assert.equal(apiEnv.TEST_DATABASE_URL, apiEnv.SEQORA_TEST_DATABASE_URL)
  assert.equal(apiEnv.DATABASE_URL, apiEnv.SEQORA_TEST_DATABASE_URL)
  assert.equal(apiEnv.TEST_REDIS_URL, 'redis://127.0.0.1:49153')
  assert.equal(apiEnv.REDIS_URL, apiEnv.TEST_REDIS_URL)
  assert.deepEqual(env, originalEnv)
  for (const call of fixture.calls.filter(({ name }) => name !== 'all api tests')) {
    const callEnv = call.options?.env || call.env
    assert.equal(callEnv.SEQORA_TEST_NETWORK_GUARD, undefined, call.name || call.kind)
    assert.equal(callEnv.NODE_OPTIONS, env.NODE_OPTIONS, call.name || call.kind)
    assert.equal(callEnv.DATABASE_URL, env.DATABASE_URL, call.name || call.kind)
    assert.equal(callEnv.DATA_FILE, env.DATA_FILE, call.name || call.kind)
    assert.equal(callEnv.NODE_ENV, env.NODE_ENV, call.name || call.kind)
  }
  assert.equal(fixture.calls.at(-1).name, 'stop shared test database')
  assert.deepEqual(fixture.calls.at(-1).args.slice(-2), ['down', '-v'])
})

test('uses distinct Compose projects for simultaneous or repeated full checks', async () => {
  const first = commandFixture()
  const second = commandFixture()
  await Promise.all([
    runFullStableTests({ env: {}, commands: first.commands }),
    runFullStableTests({ env: {}, commands: second.commands }),
  ])
  const project = (fixture) => fixture.calls.find(({ kind }) => kind === 'docker').args[2]
  assert.notEqual(project(first), project(second))
})

test('external services bypass Docker and use one canonical database address', async () => {
  const fixture = commandFixture()
  const databaseUrl = 'postgres://fixture:password@db.example/test'
  const env = {
    SEQORA_TEST_DATABASE_URL: ` ${databaseUrl} `,
    TEST_DATABASE_URL: 'postgres://unused.example/old',
    TEST_REDIS_URL: ' redis://redis.example:6379/3 ',
  }
  await runFullStableTests({ env, commands: fixture.commands })
  assert.equal(
    fixture.calls.some(({ kind }) => kind === 'docker' || kind === 'preflight'),
    false,
  )
  const apiEnv = fixture.calls.find(({ name }) => name === 'all api tests').options.env
  assert.equal(apiEnv.SEQORA_TEST_DATABASE_URL, databaseUrl)
  assert.equal(apiEnv.TEST_DATABASE_URL, databaseUrl)
  assert.equal(apiEnv.DATABASE_URL, databaseUrl)
  assert.equal(apiEnv.TEST_REDIS_URL, 'redis://redis.example:6379/3')
  assert.equal(apiEnv.REDIS_URL, apiEnv.TEST_REDIS_URL)
  assert.equal(apiEnv.SEQORA_TEST_NETWORK_GUARD, '1')
  assert.equal(apiEnv.NODE_ENV, 'test')
  assert.equal(apiEnv.DATA_FILE, ':memory:')
  assert.equal(apiEnv.NODE_OPTIONS, `--import=${new URL('./test-network-guard.mjs', import.meta.url).href}`)
  assert.equal(fixture.calls.at(-1).options.env, env)
  assert.equal(fixture.calls.at(-1).name, 'browser regression tests')
})

test('supports the legacy test database alias with external Redis', async () => {
  const fixture = commandFixture()
  const env = { TEST_DATABASE_URL: 'postgres://db.example/test', TEST_REDIS_URL: 'redis://redis.example' }
  await runFullStableTests({ env, commands: fixture.commands })
  const apiEnv = fixture.calls.find(({ name }) => name === 'all api tests').options.env
  assert.equal(apiEnv.SEQORA_TEST_DATABASE_URL, env.TEST_DATABASE_URL)
  assert.equal(
    fixture.calls.some(({ kind }) => kind === 'docker'),
    false,
  )
})

for (const env of [
  { TEST_DATABASE_URL: 'postgres://db.example/test' },
  { TEST_REDIS_URL: 'redis://redis.example' },
  { SEQORA_TEST_DATABASE_URL: ' ', TEST_REDIS_URL: 'redis://redis.example' },
]) {
  test(`rejects a partially configured external service pair: ${Object.keys(env).join(', ')}`, async () => {
    const fixture = commandFixture()
    await assert.rejects(runFullStableTests({ env, commands: fixture.commands }), /Configure both/)
    assert.equal(fixture.calls.length, 0)
  })
}

for (const failAt of ['test runner regression tests', 'shared build', 'api source and test typecheck']) {
  test(`does not start or remove containers when ${failAt} fails`, async () => {
    const fixture = commandFixture({ failAt })
    await assert.rejects(runFullStableTests({ env: {}, commands: fixture.commands }), fixture.failure)
    assert.equal(
      fixture.calls.some(({ kind }) => kind === 'docker'),
      false,
    )
    assert.equal(fixture.calls.at(-1).name, failAt)
  })
}

for (const failAt of ['start shared test database', 'all api tests', 'browser regression tests']) {
  test(`cleans its own Compose project and preserves failure when ${failAt} fails`, async () => {
    const fixture = commandFixture({ failAt })
    await assert.rejects(runFullStableTests({ env: {}, commands: fixture.commands }), fixture.failure)
    const start = fixture.calls.find(({ name }) => name === 'start shared test database')
    const cleanup = fixture.calls.at(-1)
    assert.equal(cleanup.name, 'stop shared test database')
    assert.equal(cleanup.options.allowFailure, undefined)
    assert.deepEqual(cleanup.args.slice(0, -2), start.args.slice(0, start.args.indexOf('up')))
    if (failAt !== 'browser regression tests') {
      assert.equal(
        fixture.calls.some(({ name }) => name === 'browser regression tests'),
        false,
      )
    }
  })
}

test('invalid published ports fail before API tests and still clean the partial environment', async () => {
  const fixture = commandFixture({ output: { postgres: '127.0.0.1:0\n' } })
  await assert.rejects(runFullStableTests({ env: {}, commands: fixture.commands }), /valid published/)
  assert.equal(
    fixture.calls.some(({ name }) => name === 'all api tests'),
    false,
  )
  assert.equal(fixture.calls.at(-1).name, 'stop shared test database')
})

test('fails when cleanup of the managed Compose project fails', async () => {
  const fixture = commandFixture({ failAt: 'stop shared test database' })
  await assert.rejects(runFullStableTests({ env: {}, commands: fixture.commands }), fixture.failure)
  assert.equal(fixture.calls.at(-1).name, 'stop shared test database')
})

for (const invalidService of ['database', 'Redis']) {
  test(`rejects invalid external ${invalidService} URLs without exposing credentials`, async () => {
    const fixture = commandFixture()
    const invalidUrl = 'https://private-user:private-password@fixture.invalid/private-database'
    const env = {
      SEQORA_TEST_DATABASE_URL:
        invalidService === 'database' ? invalidUrl : 'postgres://fixture.example/test',
      TEST_REDIS_URL: invalidService === 'Redis' ? invalidUrl : 'redis://fixture.example:6379',
    }
    await assert.rejects(runFullStableTests({ env, commands: fixture.commands }), (error) => {
      assert.match(error.message, /valid explicit test database and Redis URLs/)
      assert.doesNotMatch(
        String(error.stack),
        /private-user|private-password|fixture\.invalid|private-database/,
      )
      assert.equal(error.cause, undefined)
      return true
    })
    assert.equal(
      fixture.calls.some(({ kind, name }) => kind === 'docker' || name === 'all api tests'),
      false,
    )
    assert.equal(
      fixture.calls.some(({ name }) => name === 'browser regression tests'),
      false,
    )
  })
}

for (const failAt of ['start shared test database', 'all api tests']) {
  test(`retains both failures and the original cause when ${failAt} and cleanup fail`, async () => {
    const primaryFailure = new Error('primary test failure')
    const cleanupFailure = new Error('cleanup failure')
    const fixture = commandFixture({
      failures: {
        [failAt]: primaryFailure,
        'stop shared test database': cleanupFailure,
      },
    })
    await assert.rejects(runFullStableTests({ env: {}, commands: fixture.commands }), (error) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [primaryFailure, cleanupFailure])
      assert.equal(error.cause, primaryFailure)
      return true
    })
    assert.equal(fixture.calls.at(-1).name, 'stop shared test database')
    assert.equal(fixture.calls.filter(({ name }) => name === 'stop shared test database').length, 1)
  })
}
