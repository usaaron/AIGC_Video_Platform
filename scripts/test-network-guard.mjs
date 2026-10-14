// Preloaded only in the API test process and its workers, never in the runner,
// Docker commands, browser tests, or the local preview.
import net from 'node:net'

const sharedServicePorts = new Set([5432, 5433, 6379, 6380])

export function createTestNetworkPolicy(env) {
  const endpoints = new Set([
    serviceEndpoint(
      env.SEQORA_TEST_DATABASE_URL || env.TEST_DATABASE_URL,
      ['postgres:', 'postgresql:'],
      5432,
    ),
    serviceEndpoint(env.TEST_REDIS_URL, ['redis:', 'rediss:'], 6379),
  ])
  return (host, port) => {
    const normalized = normalizeHost(host)
    const numericPort = Number(port)
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) return false
    if (endpoints.has(`${normalized}:${numericPort}`)) return true
    // HTTP fixtures use ephemeral loopback listeners. The known shared DB and
    // Redis ports still require an explicit test endpoint, even on loopback.
    const loopback =
      normalized === 'localhost' || normalized === '::1' || /^127\.\d+\.\d+\.\d+$/.test(normalized)
    return loopback && !sharedServicePorts.has(numericPort)
  }
}

function serviceEndpoint(value, protocols, defaultPort) {
  try {
    const url = new URL(value)
    if (!protocols.includes(url.protocol) || !url.hostname) throw new Error('Invalid service URL')
    const port = Number(url.port || defaultPort)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid service port')
    return `${normalizeHost(url.hostname)}:${port}`
  } catch {
    // Do not include the URL: external test-service credentials may be private.
    throw new Error('API network isolation requires valid explicit test database and Redis URLs.')
  }
}

function normalizeHost(value) {
  return String(value || 'localhost')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/, '')
    .replace(/\.$/, '')
}

function connectionTarget(args) {
  // net.connect/createConnection pass their normalized [options, callback]
  // tuple to Socket.connect; clients may also call Socket.connect directly.
  if (Array.isArray(args[0])) return connectionTarget(args[0])
  const first = args[0]
  if (typeof first === 'object' && first !== null) {
    return { host: first.host || first.hostname, port: first.port, path: first.path }
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { path: first }
  return { host: typeof args[1] === 'string' ? args[1] : undefined, port: first }
}

if (process.env.SEQORA_TEST_NETWORK_GUARD === '1') {
  const allowed = createTestNetworkPolicy(process.env)
  const originalConnect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const target = connectionTarget(args)
    // Preserve IPC used by test workers; this guard governs outbound TCP.
    if (target.path || allowed(target.host, target.port)) return originalConnect.apply(this, args)
    const error = new Error(
      `API test network blocked ${normalizeHost(target.host)}:${target.port}; use an explicit test fixture.`,
    )
    error.code = 'SEQORA_TEST_NETWORK_BLOCKED'
    // Match asynchronous socket errors so pg, Redis and HTTP clients can close
    // their requests normally, without opening the prohibited connection.
    // TLS finishes setting up its socket after connect returns. Defer teardown
    // until then, just as a real asynchronous connection failure would do.
    process.nextTick(() => this.destroy(error))
    return this
  }
}
