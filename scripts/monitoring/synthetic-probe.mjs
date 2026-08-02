#!/usr/bin/env node

const baseUrl = requiredEnv(['SYNTHETIC_BASE_URL', 'BASE_URL', 'PUBLIC_API_BASE_URL']).replace(/\/+$/, '')
const email = requiredEnv(['SYNTHETIC_EMAIL', 'EMAIL'])
const password = requiredEnv(['SYNTHETIC_PASSWORD', 'PASSWORD'])
const timeoutMs = numberEnv('SYNTHETIC_TIMEOUT_MS', 10_000)

try {
  await runProbe()
  console.log(`Synthetic probe passed for ${baseUrl}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Synthetic probe failed: ${message}`)
  await notifyFailure(message).catch((notifyError) => {
    console.error(
      `Synthetic alert webhook failed: ${
        notifyError instanceof Error ? notifyError.message : String(notifyError)
      }`,
    )
  })
  process.exit(1)
}

async function runProbe() {
  await expectJson('GET', '/api/v1/health', { name: 'health' })
  await expectJson('GET', '/api/v1/health/readiness', { name: 'readiness' })

  const login = await expectJson('POST', '/api/v1/auth/login', {
    name: 'login',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const cookie = sessionCookie(login.response)

  await expectJson('GET', '/api/v1/auth/me', { name: 'auth/me', cookie })
  const projects = await expectJson('GET', '/api/v1/projects', { name: 'projects', cookie })
  if (!Array.isArray(projects.json)) {
    throw new Error('projects response is not an array')
  }

  const billing = await expectJson('GET', '/api/v1/billing/summary', { name: 'billing summary', cookie })
  if (typeof billing.json?.credits !== 'number') {
    throw new Error('billing summary response is missing numeric credits')
  }
}

async function expectJson(method, path, options = {}) {
  const response = await request(method, path, options)
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${options.name ?? path} returned non-JSON body`)
  }
  if (!response.ok) {
    throw new Error(`${options.name ?? path} returned ${response.status}: ${text}`)
  }
  return { response, json }
}

async function request(method, path, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${options.name ?? path} timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function sessionCookie(response) {
  const headerValues =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean)
  const cookie = headerValues.find((value) => value.startsWith('seqora_session='))
  if (!cookie) throw new Error('login response is missing seqora_session cookie')
  return cookie.split(';', 1)[0]
}

async function notifyFailure(message) {
  const webhookUrl = process.env.SYNTHETIC_ALERT_WEBHOOK_URL
  if (!webhookUrl) return
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      service: 'seqora-api',
      baseUrl,
      status: 'failed',
      message,
      checkedAt: new Date().toISOString(),
    }),
  })
  if (!response.ok) {
    throw new Error(`alert webhook returned ${response.status}`)
  }
}

function requiredEnv(names) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  throw new Error(`Missing required environment variable: ${names.join(' or ')}`)
}

function numberEnv(name, fallback) {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`)
  }
  return parsed
}
