#!/usr/bin/env node

const INTERNAL_SYSTEM_ORGANIZATION_IDS = new Set(['tenant-seqora-demo'])
const PROBE_MODES = new Set(['readonly', 'write', 'all'])

let context = null

try {
  context = buildContext()
  await runProbe(context)
  console.log(`Synthetic ${context.mode} probe passed for ${context.baseUrl}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const alertContext = context ?? buildPartialContext()
  console.error(`Synthetic ${alertContext.mode} probe failed: ${message}`)
  await notifyFailure(alertContext, message).catch((notifyError) => {
    console.error(
      `Synthetic alert webhook failed: ${
        notifyError instanceof Error ? notifyError.message : String(notifyError)
      }`,
    )
  })
  process.exit(1)
}

async function runProbe(probe) {
  let cookie = null

  if (probe.mode === 'readonly' || probe.mode === 'all') {
    cookie = await runReadOnlyProbe(probe)
  }

  if (probe.mode === 'write' || probe.mode === 'all') {
    if (!cookie) {
      await expectJson(probe, 'GET', '/api/v1/health', { name: 'health' })
      await expectJson(probe, 'GET', '/api/v1/health/readiness', { name: 'readiness' })
      cookie = await login(probe)
    }
    await runWriteProbe(probe, cookie)
  }
}

async function runReadOnlyProbe(probe) {
  await expectJson(probe, 'GET', '/api/v1/health', { name: 'health' })
  await expectJson(probe, 'GET', '/api/v1/health/readiness', { name: 'readiness' })

  const cookie = await login(probe)

  await expectJson(probe, 'GET', '/api/v1/auth/me', { name: 'auth/me', cookie })
  const projects = await expectJson(probe, 'GET', '/api/v1/projects', { name: 'projects', cookie })
  if (!Array.isArray(projects.json)) {
    throw new Error('projects response is not an array')
  }

  const billing = await expectJson(probe, 'GET', '/api/v1/billing/summary', {
    name: 'billing summary',
    cookie,
  })
  if (typeof billing.json?.credits !== 'number') {
    throw new Error('billing summary response is missing numeric credits')
  }

  return cookie
}

async function runWriteProbe(probe, cookie) {
  const organizationId = requireSyntheticOrganizationId(probe)
  if (INTERNAL_SYSTEM_ORGANIZATION_IDS.has(organizationId)) {
    throw new Error(
      'SYNTHETIC_ORGANIZATION_ID must point to a dedicated synthetic organization, not the internal system organization',
    )
  }

  await assertSyntheticOrganizationAvailable(probe, cookie, organizationId)
  const switchedCookie = await switchOrganization(probe, cookie, organizationId)

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const project = await createSyntheticProject(probe, switchedCookie, organizationId, suffix)
  let primaryError = null

  try {
    await updateSyntheticProject(probe, switchedCookie, organizationId, project.id)
    const asset = await createSyntheticAsset(probe, switchedCookie, organizationId, project.id, suffix)
    await updateSyntheticAsset(probe, switchedCookie, organizationId, project.id, asset.id)
    const shot = await createSyntheticShot(probe, switchedCookie, organizationId, project.id, suffix)
    await updateSyntheticShot(probe, switchedCookie, organizationId, project.id, shot.id)
    await saveSyntheticVersion(probe, switchedCookie, organizationId, project.id)
  } catch (error) {
    primaryError = error
  } finally {
    try {
      await archiveSyntheticProject(probe, switchedCookie, organizationId, project.id)
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError
      console.error(
        `Synthetic write probe cleanup failed: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`,
      )
    }
  }

  if (primaryError) {
    throw primaryError
  }
}

async function login(probe) {
  const loginResult = await expectJson(probe, 'POST', '/api/v1/auth/login', {
    name: 'login',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: probe.email, password: probe.password }),
  })
  return sessionCookie(loginResult.response)
}

async function assertSyntheticOrganizationAvailable(probe, cookie, organizationId) {
  const organizations = await expectJson(probe, 'GET', '/api/v1/organizations', {
    name: 'organizations',
    cookie,
  })
  if (!Array.isArray(organizations.json)) {
    throw new Error('organizations response is not an array')
  }

  const membership = organizations.json.find(
    (item) => item?.organization?.id === organizationId || item?.workspace?.id === organizationId,
  )
  if (!membership) {
    throw new Error(`synthetic account is not a member of organization ${organizationId}`)
  }
  const status = membership.organization?.status ?? membership.workspace?.status
  if (status !== 'active') {
    throw new Error(`synthetic organization ${organizationId} is not active`)
  }
}

async function switchOrganization(probe, cookie, organizationId) {
  const switched = await expectJson(
    probe,
    'POST',
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/switch`,
    {
      name: 'switch synthetic organization',
      cookie,
    },
  )
  const activeOrganizationId = switched.json?.organization?.id ?? switched.json?.account?.organizationId
  if (activeOrganizationId !== organizationId) {
    throw new Error(`switch organization returned ${activeOrganizationId || 'no organization id'}`)
  }
  return sessionCookie(switched.response)
}

async function createSyntheticProject(probe, cookie, organizationId, suffix) {
  const result = await expectJson(probe, 'POST', '/api/v1/projects', {
    name: 'create synthetic project',
    cookie,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `[synthetic] write probe ${suffix}`,
      contentType: 'short-drama',
      aspectRatio: '9:16',
    }),
  })
  assertTenant(result.json, organizationId, 'created project')
  assertStringId(result.json?.id, 'created project')
  return result.json
}

async function updateSyntheticProject(probe, cookie, organizationId, projectId) {
  const result = await expectJson(probe, 'PATCH', `/api/v1/projects/${encodeURIComponent(projectId)}`, {
    name: 'update synthetic project',
    cookie,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      synopsis: 'Synthetic write probe validates project persistence without invoking generation providers.',
      script:
        'Scene 1: Synthetic monitor opens a project. Scene 2: It saves a script, asset, and shot. Scene 3: It archives the probe project.',
    }),
  })
  assertTenant(result.json, organizationId, 'updated project')
}

async function createSyntheticAsset(probe, cookie, organizationId, projectId, suffix) {
  const result = await expectJson(probe, 'POST', `/api/v1/projects/${encodeURIComponent(projectId)}/assets`, {
    name: 'create synthetic asset',
    cookie,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'prop',
      sourceMode: 'generate',
      name: `[synthetic] marker ${suffix}`,
      description: 'Synthetic marker prop used by the write-path probe.',
      prompt: 'A simple labeled synthetic probe marker card on a neutral background.',
      promptMode: 'standard',
      customPromptMode: 'append',
      customPrompt: '',
      negativePrompt: '',
      references: [],
      attributes: {
        type: 'prop',
        category: 'daily',
        material: 'mixed',
        condition: 'new',
        view: 'front',
        background: 'solid',
        visualStyle: 'cinematic-cg',
      },
      imageUrl: null,
    }),
  })
  assertTenant(result.json, organizationId, 'created asset')
  assertStringId(result.json?.id, 'created asset')
  return result.json
}

async function updateSyntheticAsset(probe, cookie, organizationId, projectId, assetId) {
  const result = await expectJson(
    probe,
    'PATCH',
    `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
    {
      name: 'update synthetic asset',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'confirmed',
        description: 'Synthetic marker prop updated by the write-path probe.',
      }),
    },
  )
  assertTenant(result.json, organizationId, 'updated asset')
}

async function createSyntheticShot(probe, cookie, organizationId, projectId, suffix) {
  const result = await expectJson(probe, 'POST', `/api/v1/projects/${encodeURIComponent(projectId)}/shots`, {
    name: 'create synthetic shot',
    cookie,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `[synthetic] shot ${suffix}`,
      framing: 'medium shot',
      duration: 4,
      prompt: 'Synthetic write probe frame with a project marker card on screen.',
      negativePrompt: '',
      imageUrl: null,
      continuityMode: 'independent',
      continuityNote: 'Synthetic write probe only; no generation task is created.',
    }),
  })
  assertTenant(result.json, organizationId, 'created shot')
  assertStringId(result.json?.id, 'created shot')
  return result.json
}

async function updateSyntheticShot(probe, cookie, organizationId, projectId, shotId) {
  const result = await expectJson(
    probe,
    'PATCH',
    `/api/v1/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}`,
    {
      name: 'update synthetic shot',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        duration: 5,
        prompt: 'Synthetic write probe frame updated after initial insert.',
      }),
    },
  )
  assertTenant(result.json, organizationId, 'updated shot')
}

async function saveSyntheticVersion(probe, cookie, organizationId, projectId) {
  const result = await expectJson(
    probe,
    'POST',
    `/api/v1/projects/${encodeURIComponent(projectId)}/versions`,
    {
      name: 'save synthetic project version',
      cookie,
    },
  )
  assertTenant(result.json, organizationId, 'versioned project')
  if (typeof result.json?.version !== 'number' || result.json.version < 2) {
    throw new Error('versioned project response did not increment version')
  }
}

async function archiveSyntheticProject(probe, cookie, organizationId, projectId) {
  const result = await expectJson(probe, 'PATCH', `/api/v1/projects/${encodeURIComponent(projectId)}`, {
    name: 'archive synthetic project',
    cookie,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'archived' }),
  })
  assertTenant(result.json, organizationId, 'archived project')
  if (result.json?.status !== 'archived') {
    throw new Error('synthetic project was not archived')
  }
}

async function expectJson(probe, method, path, options = {}) {
  const response = await request(probe, method, path, options)
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

async function request(probe, method, path, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), probe.timeoutMs)
  try {
    return await fetch(`${probe.baseUrl}${path}`, {
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
      throw new Error(`${options.name ?? path} timed out after ${probe.timeoutMs}ms`)
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
  if (!cookie) throw new Error('response is missing seqora_session cookie')
  return cookie.split(';', 1)[0]
}

function assertTenant(value, organizationId, name) {
  if (value?.tenantId !== organizationId) {
    throw new Error(`${name} returned tenant ${value?.tenantId || 'missing'}, expected ${organizationId}`)
  }
}

function assertStringId(value, name) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${name} response is missing id`)
  }
}

async function notifyFailure(probe, message) {
  if (!probe.alertWebhookUrl) return
  const response = await fetch(probe.alertWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      service: 'seqora-api',
      baseUrl: probe.baseUrl || 'unknown',
      probeMode: probe.mode,
      syntheticOrganizationId: probe.organizationId || null,
      status: 'failed',
      message,
      checkedAt: new Date().toISOString(),
    }),
  })
  if (!response.ok) {
    throw new Error(`alert webhook returned ${response.status}`)
  }
}

function buildContext() {
  const mode = normalizeProbeMode(argValue('--mode') ?? process.env.SYNTHETIC_PROBE_MODE ?? 'readonly')
  const context = {
    mode,
    baseUrl: requiredEnv(['SYNTHETIC_BASE_URL', 'BASE_URL', 'PUBLIC_API_BASE_URL']).replace(/\/+$/, ''),
    email: requiredEnv(['SYNTHETIC_EMAIL', 'EMAIL']),
    password: requiredEnv(['SYNTHETIC_PASSWORD', 'PASSWORD']),
    timeoutMs: numberEnv('SYNTHETIC_TIMEOUT_MS', 10_000),
    alertWebhookUrl: process.env.SYNTHETIC_ALERT_WEBHOOK_URL?.trim() || '',
    organizationId: optionalEnv(['SYNTHETIC_ORGANIZATION_ID', 'SYNTHETIC_WRITE_ORGANIZATION_ID']),
    requireAlertWebhook: booleanEnv('SYNTHETIC_REQUIRE_ALERT_WEBHOOK', false),
  }
  if (context.requireAlertWebhook && !context.alertWebhookUrl) {
    throw new Error('SYNTHETIC_ALERT_WEBHOOK_URL is required when SYNTHETIC_REQUIRE_ALERT_WEBHOOK=true')
  }
  if ((mode === 'write' || mode === 'all') && !context.organizationId) {
    throw new Error('SYNTHETIC_ORGANIZATION_ID is required for write-path synthetic probes')
  }
  return context
}

function buildPartialContext() {
  const timeoutValue = Number(process.env.SYNTHETIC_TIMEOUT_MS)
  return {
    mode: safeProbeMode(process.env.SYNTHETIC_PROBE_MODE ?? argValue('--mode') ?? 'readonly'),
    baseUrl:
      optionalEnv(['SYNTHETIC_BASE_URL', 'BASE_URL', 'PUBLIC_API_BASE_URL'])?.replace(/\/+$/, '') || '',
    email: optionalEnv(['SYNTHETIC_EMAIL', 'EMAIL']) || '',
    password: '',
    timeoutMs: Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 10_000,
    alertWebhookUrl: process.env.SYNTHETIC_ALERT_WEBHOOK_URL?.trim() || '',
    organizationId: optionalEnv(['SYNTHETIC_ORGANIZATION_ID', 'SYNTHETIC_WRITE_ORGANIZATION_ID']),
    requireAlertWebhook: booleanEnv('SYNTHETIC_REQUIRE_ALERT_WEBHOOK', false),
  }
}

function requireSyntheticOrganizationId(probe) {
  if (!probe.organizationId) {
    throw new Error('SYNTHETIC_ORGANIZATION_ID is required for write-path synthetic probes')
  }
  return probe.organizationId
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index >= 0) return process.argv[index + 1]
  const prefix = `${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : null
}

function normalizeProbeMode(value) {
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'read' || normalized === 'read-only') return 'readonly'
  if (!PROBE_MODES.has(normalized)) {
    throw new Error(`SYNTHETIC_PROBE_MODE must be one of: ${[...PROBE_MODES].join(', ')}`)
  }
  return normalized
}

function safeProbeMode(value) {
  try {
    return normalizeProbeMode(value)
  } catch {
    return 'readonly'
  }
}

function requiredEnv(names) {
  const value = optionalEnv(names)
  if (value) return value
  throw new Error(`Missing required environment variable: ${names.join(' or ')}`)
}

function optionalEnv(names) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
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

function booleanEnv(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  if (/^(1|true|yes|on)$/i.test(value)) return true
  if (/^(0|false|no|off)$/i.test(value)) return false
  throw new Error(`${name} must be a boolean`)
}
