import { setTimeout as wait } from 'node:timers/promises'

const origin = (
  process.env.PROVIDER_ACCEPTANCE_API_ORIGIN ??
  process.env.E2E_API_ORIGIN ??
  'http://127.0.0.1:8787'
).replace(/\/+$/, '')
const apiBase = `${origin}/api/v1`
const email = process.env.PROVIDER_ACCEPTANCE_EMAIL ?? process.env.E2E_EMAIL ?? 'creator@seqora.local'
const password = process.env.PROVIDER_ACCEPTANCE_PASSWORD ?? process.env.E2E_PASSWORD ?? 'Creator123!'
const requestedProjectId = process.env.PROVIDER_ACCEPTANCE_PROJECT_ID ?? ''
const timeoutMs = integerEnv('PROVIDER_ACCEPTANCE_TIMEOUT_MS', 900_000)
const pollMs = integerEnv('PROVIDER_ACCEPTANCE_POLL_MS', 5_000)
const runSeedance = process.env.PROVIDER_ACCEPTANCE_VIDEO !== '0'
const runImg2 = process.env.PROVIDER_ACCEPTANCE_IMG2 !== '0'
const runAudio = process.env.PROVIDER_ACCEPTANCE_AUDIO !== '0'

if (process.env.PROVIDER_ACCEPTANCE !== '1') {
  throw new Error('Provider acceptance is disabled. Set PROVIDER_ACCEPTANCE=1 to run real provider tasks.')
}

const health = await request('/health')
assertProviderConfigured(health, 'seedance', runSeedance)
assertProviderConfigured(health, 'img2', runImg2)
assertProviderConfigured(health, 'audio', runAudio)
if (health.taskQueue !== 'bullmq') {
  throw new Error(`Provider acceptance expects TASK_QUEUE_DRIVER=bullmq, got ${health.taskQueue}`)
}
if (health.storage === 'local') {
  throw new Error('Provider acceptance expects platform object storage, not STORAGE_DRIVER=local')
}

const cookie = await login()
const projects = await request('/projects', { cookie })
const project = selectProject(projects)
const workspace = await request(`/projects/${encodeURIComponent(project.id)}`, { cookie })
const character = workspace.assets.find((asset) => asset.kind === 'character')
const audio = workspace.assets.find((asset) => asset.kind === 'audio')
const shot = workspace.shots[0]

if (runImg2 && !character) throw new Error('No character asset found for Img2 acceptance')
if (runAudio && !audio) throw new Error('No audio asset found for audio acceptance')
if (runSeedance && !shot) throw new Error('No shot found for Seedance acceptance')

const summary = []
await verifyCancelRefund(project.id, cookie, summary)
await verifyFailedRetry(project.id, cookie, summary)

if (runImg2) {
  const turnaround = await createAndWait(
    project.id,
    cookie,
    imageTaskInput(project, character, {
      label: `${character.name} provider acceptance turnaround`,
      clientRequestId: clientRequestId('provider-acceptance-img2-turnaround'),
      estimatedCredits: 18,
      outputViews: ['front', 'side', 'back'],
    }),
  )
  assertOutputViews(turnaround, ['front', 'side', 'back'])
  await verifyPlatformOutputs(turnaround, cookie)
  await assertTaskLogs(turnaround.id, cookie, ['task.created', 'provider.submitted', 'task.completed'])
  summary.push(`Img2 turnaround completed: ${turnaround.outputs.map((output) => output.url).join(', ')}`)

  const side = await createAndWait(
    project.id,
    cookie,
    imageTaskInput(project, character, {
      label: `${character.name} provider acceptance side regenerate`,
      clientRequestId: clientRequestId('provider-acceptance-img2-side'),
      estimatedCredits: 6,
      outputViews: ['side'],
      regenerateView: 'side',
    }),
  )
  assertOutputViews(side, ['side'])
  await verifyPlatformOutputs(side, cookie)
  await assertTaskLogs(side.id, cookie, ['task.created', 'provider.submitted', 'task.completed'])
  summary.push(`Img2 single-view regeneration completed: ${side.outputs[0]?.url}`)
}

if (runAudio) {
  const audioTask = await createAndWait(project.id, cookie, audioTaskInput(audio))
  assertMediaType(audioTask, 'audio')
  await verifyPlatformOutputs(audioTask, cookie)
  await assertTaskLogs(audioTask.id, cookie, ['task.created', 'provider.submitted', 'task.completed'])
  summary.push(`Audio completed: ${audioTask.outputs[0]?.url}`)
}

if (runSeedance) {
  const videoTask = await createAndWait(project.id, cookie, videoTaskInput(project, shot))
  assertMediaType(videoTask, 'video')
  await verifyPlatformOutputs(videoTask, cookie)
  await assertTaskLogs(videoTask.id, cookie, ['task.created', 'provider.submitted', 'task.completed'])
  summary.push(`Seedance video completed: ${videoTask.outputs[0]?.url}`)
}

process.stdout.write(`Provider acceptance passed.\n${summary.map((item) => `- ${item}`).join('\n')}\n`)

async function verifyCancelRefund(projectId, cookie, summary) {
  const task = await createTask(
    {
      clientRequestId: clientRequestId('provider-acceptance-cancel'),
      projectId,
      kind: 'video',
      label: 'Provider acceptance cancel refund',
      prompt: 'Short cancellation acceptance task',
      negativePrompt: defaultNegativePrompt(),
      provider: 'seedance',
      estimatedCredits: 18,
      metadata: {
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
        generateAudio: false,
      },
    },
    cookie,
  )
  const cancelled = await request(`/generation/tasks/${encodeURIComponent(task.id)}/cancel`, {
    method: 'POST',
    cookie,
  })
  if (cancelled.status !== 'cancelled') {
    throw new Error(`Cancel acceptance expected cancelled, got ${cancelled.status}`)
  }
  if (cancelled.metadata?.refundCredits !== 18) {
    throw new Error(`Cancel acceptance expected refundCredits=18, got ${cancelled.metadata?.refundCredits}`)
  }
  await assertTaskLogs(task.id, cookie, ['task.created', 'task.cancelled'])
  summary.push('Cancel refund completed: refundCredits=18')
}

async function verifyFailedRetry(projectId, cookie, summary) {
  const task = await createTask(
    {
      clientRequestId: clientRequestId('provider-acceptance-failed-retry'),
      projectId,
      kind: 'image',
      label: 'Provider acceptance failed retry',
      prompt: '',
      negativePrompt: '',
      provider: 'img2',
      estimatedCredits: 1,
      metadata: {
        generationStage: 'face',
        aspectRatio: '1:1',
      },
    },
    cookie,
  )
  const failed = await waitForTask(projectId, task.id, cookie, ['failed'])
  if (!failed.error) throw new Error('Failed retry acceptance expected a failure reason')
  const retried = await request(`/generation/tasks/${encodeURIComponent(task.id)}/retry`, {
    method: 'POST',
    cookie,
  })
  if (retried.status !== 'queued' && retried.status !== 'running' && retried.status !== 'failed') {
    throw new Error(`Retry acceptance expected queued/running/failed, got ${retried.status}`)
  }
  await assertTaskLogs(task.id, cookie, ['task.failed', 'task.retried'])
  summary.push(`Failed retry completed: ${failed.error}`)
}

async function createAndWait(projectId, cookie, input) {
  const task = await createTask(input, cookie)
  return waitForTask(projectId, task.id, cookie, ['completed'])
}

async function createTask(input, cookie) {
  return request('/generation/tasks', {
    method: 'POST',
    cookie,
    json: input,
  })
}

async function waitForTask(projectId, taskId, cookie, expectedStatuses) {
  const deadline = Date.now() + timeoutMs
  let lastTask = null
  while (Date.now() < deadline) {
    const tasks = await request(`/projects/${encodeURIComponent(projectId)}/generation/tasks`, { cookie })
    lastTask = tasks.find((task) => task.id === taskId) ?? null
    if (lastTask && expectedStatuses.includes(lastTask.status)) return lastTask
    if (lastTask?.status === 'failed' && !expectedStatuses.includes('failed')) {
      const logs = await taskLogs(taskId, cookie).catch(() => [])
      throw new Error(
        `Task ${taskId} failed: ${lastTask.error ?? 'unknown'}\n${logs
          .map((log) => `${log.event}: ${log.message}`)
          .join('\n')}`,
      )
    }
    await wait(pollMs)
  }
  throw new Error(
    `Task ${taskId} did not reach ${expectedStatuses.join('/')} before timeout. Last status: ${
      lastTask?.status ?? 'not found'
    }`,
  )
}

function imageTaskInput(project, asset, options) {
  return {
    clientRequestId: options.clientRequestId,
    projectId: project.id,
    kind: 'image',
    label: options.label,
    prompt: asset.prompt || 'Cinematic character turnaround reference sheet',
    negativePrompt: asset.negativePrompt || defaultNegativePrompt(),
    provider: 'img2',
    estimatedCredits: options.estimatedCredits,
    metadata: {
      assetId: asset.id,
      assetKind: asset.kind,
      generationStage: 'turnaround',
      aspectRatio: '16:9',
      sourceMode: asset.sourceMode,
      references: referencesForAsset(asset),
      attributes: asset.attributes,
      turnaround: true,
      outputLayout: asset.attributes?.turnaroundLayout ?? 'separate',
      outputViews: options.outputViews,
      ...(options.regenerateView ? { regenerateView: options.regenerateView } : {}),
    },
  }
}

function audioTaskInput(asset) {
  return {
    clientRequestId: clientRequestId('provider-acceptance-audio'),
    projectId: asset.projectId,
    kind: 'audio',
    label: `${asset.name} provider acceptance audio`,
    prompt: asset.prompt || 'Short cinematic ambient sound, clean loop',
    negativePrompt: asset.negativePrompt || 'noise, clipping, distortion, abrupt cut, broken loop',
    provider: 'audio',
    estimatedCredits: 6,
    metadata: {
      assetId: asset.id,
      assetKind: asset.kind,
      generationStage: 'audio',
      audioType: asset.attributes?.audioType ?? 'ambience',
      duration: Math.min(15, Math.max(3, Number(asset.attributes?.duration ?? 8))),
      loop: Boolean(asset.attributes?.loop),
      attributes: asset.attributes,
    },
  }
}

function videoTaskInput(project, shot) {
  return {
    clientRequestId: clientRequestId('provider-acceptance-seedance'),
    projectId: project.id,
    kind: 'video',
    label: `${shot.title} provider acceptance video`,
    prompt: shot.prompt || 'Cinematic short shot with stable camera movement',
    negativePrompt: defaultNegativePrompt(),
    provider: 'seedance',
    estimatedCredits: 18,
    metadata: {
      shotId: shot.id,
      aspectRatio: project.aspectRatio || '16:9',
      duration: Math.min(8, Math.max(3, Number(shot.duration ?? 5))),
      resolution: '720p',
      generateAudio: false,
      cameraFixed: false,
    },
  }
}

function referencesForAsset(asset) {
  const values = [
    ...(Array.isArray(asset.references) ? asset.references : []),
    asset.attributes?.faceReference,
    asset.attributes?.bodyReference,
  ]
  return values.filter((item) => item && typeof item.url === 'string').slice(0, 3)
}

async function verifyPlatformOutputs(task, cookie) {
  if (!task.outputs?.length) throw new Error(`Task ${task.id} completed without outputs`)
  for (const output of task.outputs) {
    if (!isPlatformUrl(output.url)) {
      throw new Error(`Task ${task.id} output is not a platform URL: ${output.url}`)
    }
    const response = await fetch(`${origin}${output.url}`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`Media ${output.url} failed (${response.status})`)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith(`${output.mediaType}/`)) {
      throw new Error(`Media ${output.url} expected ${output.mediaType}/*, got ${contentType}`)
    }
    const bytes = await readSampleBytes(response)
    if (bytes <= 0) throw new Error(`Media ${output.url} returned an empty body`)
  }
}

async function readSampleBytes(response) {
  if (!response.body) return (await response.arrayBuffer()).byteLength
  const reader = response.body.getReader()
  try {
    const chunk = await reader.read()
    return chunk.done ? 0 : chunk.value.byteLength
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function assertOutputViews(task, expectedViews) {
  const actual = task.outputs.map((output) => output.view).sort()
  const expected = [...expectedViews].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Task ${task.id} expected views ${expected.join(',')}, got ${actual.join(',')}`)
  }
}

function assertMediaType(task, mediaType) {
  if (!task.outputs.some((output) => output.mediaType === mediaType)) {
    throw new Error(`Task ${task.id} expected ${mediaType} output`)
  }
}

async function assertTaskLogs(taskId, cookie, expectedEvents) {
  const logs = await taskLogs(taskId, cookie)
  for (const event of expectedEvents) {
    if (!logs.some((log) => log.event === event)) {
      throw new Error(`Task ${taskId} logs missing ${event}`)
    }
  }
  return logs
}

async function taskLogs(taskId, cookie) {
  const payload = await request(`/generation/tasks/${encodeURIComponent(taskId)}/logs`, { cookie })
  return payload.logs || []
}

async function login() {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Login failed (${response.status}): ${await response.text()}`)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('Login did not return a session cookie')
  return cookie
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
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = data?.error?.message ?? text
    throw new Error(`${path} failed (${response.status}): ${message}`)
  }
  return data
}

function selectProject(projects) {
  if (!Array.isArray(projects) || projects.length === 0) throw new Error('No projects available')
  if (!requestedProjectId) return projects[0]
  const project = projects.find((item) => item.id === requestedProjectId)
  if (!project) throw new Error(`Project ${requestedProjectId} was not found`)
  return project
}

function assertProviderConfigured(health, provider, enabled) {
  if (!enabled) return
  if (health.providers?.[provider] !== 'configured') {
    throw new Error(`Provider ${provider} is not configured in API health response`)
  }
}

function isPlatformUrl(url) {
  return /^\/api\/v1\/media\/[^/?#]+$/.test(url)
}

function clientRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function integerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function defaultNegativePrompt() {
  return [
    'no text',
    'no watermark',
    'no logo',
    'no UI',
    'no extra people',
    'no camera rig',
    'no lighting equipment',
    'no flicker',
    'no overexposure',
    'no distorted face',
    'no malformed hands',
    'no broken limbs',
    'no plastic skin',
    'no low resolution',
  ].join(', ')
}
