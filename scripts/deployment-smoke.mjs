import { setTimeout as wait } from 'node:timers/promises'

const origin = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:8787'
const apiBase = `${origin}/api/v1`
const email = process.env.E2E_EMAIL ?? 'creator@seqora.local'
const password = process.env.E2E_PASSWORD ?? 'Creator123!'

await waitForHealth()
const cookie = await login()
const projects = await request('/projects', { cookie })
const project = projects[0]
if (!project) throw new Error('Deployment smoke failed: no seed project found')

await verifyObjectStorage(project.id, cookie)
await verifyWorkerTask(project.id, cookie)

process.stdout.write('Deployment smoke passed: health, auth, mock storage and Redis worker are valid.\n')

async function waitForHealth() {
  const deadline = Date.now() + 30_000
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const health = await request('/health')
      assertEqual(health.status, 'ok', 'health.status')
      assertEqual(health.dataStore, 'postgres', 'health.dataStore')
      assertEqual(health.taskQueue, 'bullmq', 'health.taskQueue')
      assertEqual(health.storage, 'mock', 'health.storage')
      return
    } catch (error) {
      lastError = error
      await wait(500)
    }
  }
  throw new Error(`Deployment smoke failed: API health did not become ready. ${lastError?.message ?? ''}`)
}

async function login() {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`Login failed (${response.status}): ${await response.text()}`)
  const setCookie = response.headers.get('set-cookie')
  const cookie = setCookie?.split(';')[0]
  if (!cookie) throw new Error('Login did not return a session cookie')
  return cookie
}

async function verifyObjectStorage(projectId, cookie) {
  const body = new FormData()
  body.append('file', new Blob(['deployment-smoke-image'], { type: 'image/png' }), 'smoke.png')
  const uploaded = await request(`/projects/${projectId}/media`, { method: 'POST', body, cookie })
  if (!uploaded.url) throw new Error('Media upload did not return a platform URL')

  const media = await fetch(`${origin}${uploaded.url}`, { headers: { cookie } })
  if (!media.ok) throw new Error(`Media read failed (${media.status}): ${await media.text()}`)
  const content = await media.text()
  if (content !== 'deployment-smoke-image')
    throw new Error('Media content did not round-trip through storage')
}

async function verifyWorkerTask(projectId, cookie) {
  const clientRequestId = `deployment-smoke-${Date.now()}`
  await request('/generation/tasks', {
    method: 'POST',
    cookie,
    json: {
      clientRequestId,
      projectId,
      kind: 'image',
      label: 'Deployment smoke image',
      prompt: 'local deployment smoke test',
      provider: 'local',
      estimatedCredits: 1,
    },
  })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const tasks = await request(`/projects/${projectId}/generation/tasks`, { cookie })
    const task = tasks.find((item) => item.clientRequestId === clientRequestId)
    if (task?.status === 'completed') {
      if (!task.outputs?.length) throw new Error('Completed smoke task has no outputs')
      return
    }
    if (task?.status === 'failed') throw new Error(`Smoke task failed: ${task.error ?? 'unknown error'}`)
    await wait(500)
  }
  throw new Error('Deployment smoke failed: worker did not complete the queued task')
}

async function request(path, options = {}) {
  const headers = {}
  let body = options.body
  if (options.json) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  }
  if (options.cookie) headers.Cookie = options.cookie

  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = data?.error?.message ?? text
    throw new Error(`${path} failed (${response.status}): ${message}`)
  }
  return data
}

function assertEqual(actual, expected, name) {
  if (actual !== expected) throw new Error(`${name} expected ${expected}, got ${actual}`)
}
