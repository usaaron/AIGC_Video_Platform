import { PERMISSIONS } from '../../packages/contracts/dist/permissions.js'

const SILENT_AUDIO = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='

export function createMockApi() {
  const state = {
    eventsHits: 0,
    authMode: 'creator',
    projectVersion: 1,
    projects: [projectSummary()],
    workspace: workspaceSnapshot(),
    billing: {
      credits: 286,
      plan: 'free',
      concurrency: 1,
      entries: [
        {
          id: 'ledger-initial',
          amount: 286,
          balance: 286,
          description: '新用户体验积分',
          createdAt: '2026-07-21T00:00:00.000Z',
        },
      ],
    },
    tasks: initialTasks(),
    createdTaskPayloads: [],
    cancelledTaskIds: [],
    retryTaskIds: [],
    exportTaskId: '',
    auditLogs: [
      audit('GET', '/api/v1/projects', 'success'),
      audit('GET', '/api/v1/admin/overview', 'success'),
    ],
  }

  async function install(page) {
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const { pathname, searchParams } = url
      const method = request.method()

      if (pathname === '/api/v1/auth/me') {
        return fulfillAuthMe(route, state)
      }
      if (pathname === '/api/v1/auth/login' && method === 'POST') {
        const payload = safeJson(request)
        state.authMode = payload.email?.startsWith('admin') ? 'admin' : 'creator'
        return fulfillJson(route, 200, sessionFor(state.authMode))
      }
      if (pathname === '/api/v1/auth/logout' && method === 'POST') {
        state.authMode = 'creator'
        return fulfillJson(route, 204, null)
      }
      if (pathname === '/api/v1/projects' && method === 'GET') {
        return fulfillJson(route, 200, state.projects)
      }
      if (pathname === '/api/v1/projects/project-midnight-film' && method === 'GET') {
        return fulfillJson(route, 200, state.workspace)
      }
      if (pathname === '/api/v1/projects/project-midnight-film' && method === 'PATCH') {
        const payload = safeJson(request)
        state.workspace.project = { ...state.workspace.project, ...payload, updatedAt: now() }
        return fulfillJson(route, 200, state.workspace.project)
      }
      if (pathname === '/api/v1/projects/project-midnight-film/versions' && method === 'POST') {
        state.workspace.project.version += 1
        state.workspace.project.updatedAt = now()
        return fulfillJson(route, 200, state.workspace.project)
      }
      if (pathname === '/api/v1/projects/project-midnight-film/assets' && method === 'POST') {
        const payload = safeJson(request)
        const asset = {
          id: `asset-${state.workspace.assets.length + 1}`,
          projectId: 'project-midnight-film',
          tenantId: 'tenant-seqora-demo',
          status: 'draft',
          createdAt: now(),
          updatedAt: now(),
          imageUrl: null,
          references: [],
          promptMode: 'standard',
          customPromptMode: 'append',
          customPrompt: '',
          negativePrompt: '',
          sourceMode: 'generate',
          ...payload,
        }
        state.workspace.assets.push(asset)
        return fulfillJson(route, 201, asset)
      }
      if (pathname.startsWith('/api/v1/projects/project-midnight-film/assets/') && method === 'PATCH') {
        const assetId = pathname.split('/').at(-1)
        const payload = safeJson(request)
        const asset = state.workspace.assets.find((item) => item.id === assetId)
        if (asset) Object.assign(asset, payload, { updatedAt: now() })
        return fulfillJson(route, 200, asset || {})
      }
      if (pathname.startsWith('/api/v1/projects/project-midnight-film/assets/') && method === 'DELETE') {
        const assetId = pathname.split('/').at(-1)
        state.workspace.assets = state.workspace.assets.filter((item) => item.id !== assetId)
        return fulfillJson(route, 204, null)
      }
      if (pathname === '/api/v1/projects/project-midnight-film/media' && method === 'POST') {
        return fulfillJson(route, 201, {
          id: 'media-upload-1',
          projectId: 'project-midnight-film',
          tenantId: 'tenant-seqora-demo',
          kind: 'image',
          name: 'reference.png',
          contentType: 'image/png',
          size: 18,
          storageKey: 'mock/reference.png',
          createdAt: now(),
          url: '/api/v1/media/media-upload-1',
        })
      }
      if (pathname === '/api/v1/projects/project-midnight-film/shots' && method === 'POST') {
        const payload = safeJson(request)
        const shot = {
          id: `shot-${state.workspace.shots.length + 1}`,
          projectId: 'project-midnight-film',
          tenantId: 'tenant-seqora-demo',
          order: state.workspace.shots.length + 1,
          createdAt: now(),
          updatedAt: now(),
          imageUrl: '/demo/station.jpg',
          assetIds: [],
          ...payload,
        }
        state.workspace.shots.push(shot)
        return fulfillJson(route, 201, shot)
      }
      if (pathname.startsWith('/api/v1/projects/project-midnight-film/shots/') && method === 'PATCH') {
        const shotId = pathname.split('/').at(-1)
        const payload = safeJson(request)
        const shot = state.workspace.shots.find((item) => item.id === shotId)
        if (shot) Object.assign(shot, payload, { updatedAt: now() })
        return fulfillJson(route, 200, shot || {})
      }
      if (pathname === '/api/v1/projects/project-midnight-film/shots/generate' && method === 'POST') {
        return fulfillJson(route, 200, state.workspace.shots)
      }
      if (pathname === '/api/v1/projects/project-midnight-film/generation/tasks' && method === 'GET') {
        return fulfillJson(route, 200, state.tasks)
      }
      if (
        pathname === '/api/v1/projects/project-midnight-film/generation/tasks/completed' &&
        method === 'DELETE'
      ) {
        const before = state.tasks.length
        state.tasks = state.tasks.filter((task) => task.status === 'queued' || task.status === 'running')
        return fulfillJson(route, 200, { cleared: before - state.tasks.length })
      }
      if (pathname === '/api/v1/projects/project-midnight-film/generation/tasks/events' && method === 'GET') {
        state.eventsHits += 1
        return route.fulfill({
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
          },
          body: `event: tasks\ndata: ${JSON.stringify({ tasks: state.tasks, emittedAt: now() })}\n\n`,
        })
      }
      if (pathname === '/api/v1/generation/tasks' && method === 'POST') {
        const payload = safeJson(request)
        const task = createdTaskFromPayload(payload)
        state.createdTaskPayloads.push(payload)
        state.tasks.unshift(task)
        if (task.kind === 'video' && task.provider === 'film-export') {
          state.exportTaskId = task.id
        }
        if (task.kind === 'audio') {
          state.billing.credits -= task.estimatedCredits
        }
        return fulfillJson(route, 202, task)
      }
      if (
        pathname.startsWith('/api/v1/generation/tasks/') &&
        pathname.endsWith('/retry') &&
        method === 'POST'
      ) {
        const taskId = pathname.split('/').at(-2)
        const task = state.tasks.find((item) => item.id === taskId)
        if (task) {
          task.status = 'queued'
          task.progress = 0
          task.error = null
          task.outputs = []
          task.resultUrl = null
          task.updatedAt = now()
          state.retryTaskIds.push(taskId)
        }
        return fulfillJson(route, 202, task || {})
      }
      if (
        pathname.startsWith('/api/v1/generation/tasks/') &&
        pathname.endsWith('/cancel') &&
        method === 'POST'
      ) {
        const taskId = pathname.split('/').at(-2)
        const task = state.tasks.find((item) => item.id === taskId)
        if (task) {
          task.status = 'cancelled'
          task.progress = 100
          task.error = 'Task cancelled by user'
          task.updatedAt = now()
          state.cancelledTaskIds.push(taskId)
        }
        return fulfillJson(route, 202, task || {})
      }
      if (
        pathname.startsWith('/api/v1/generation/tasks/') &&
        pathname.endsWith('/content') &&
        method === 'GET'
      ) {
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
          body: 'mock-video-content',
        })
      }
      if (pathname === '/api/v1/billing/summary' && method === 'GET') {
        return fulfillJson(route, 200, state.billing)
      }
      if (pathname === '/api/v1/billing/plan' && method === 'PUT') {
        const payload = safeJson(request)
        state.billing.plan = payload.plan
        state.billing.concurrency = payload.plan === 'member' ? 3 : 1
        return fulfillJson(route, 200, state.billing)
      }
      if (pathname === '/api/v1/admin/overview' && method === 'GET') {
        return fulfillJson(route, 200, {
          users: 2,
          activeTasks: state.tasks.filter((task) => task.status === 'queued' || task.status === 'running')
            .length,
          creditsConsumedToday: 34,
          generatedAt: now(),
        })
      }
      if (pathname === '/api/v1/admin/audit-logs' && method === 'GET') {
        const limit = Number(searchParams.get('limit') || '20')
        return fulfillJson(route, 200, { logs: state.auditLogs.slice(0, limit) })
      }
      if (pathname === '/api/v1/health/ready' && method === 'GET') {
        return fulfillJson(route, 200, {
          status: 'ok',
          checks: { database: 'ok', queue: 'ok' },
          dataStore: 'json',
          taskQueue: 'inline',
        })
      }

      return route.fulfill({ status: 404, body: 'Not mocked' })
    })

    await page.route('**/*.mp4', async (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
        body: 'mock-video-content',
      }),
    )
  }

  return {
    state,
    install,
    setTaskStatus(taskId, status, overrides = {}) {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return null
      Object.assign(task, overrides, { status, updatedAt: now() })
      return task
    },
    getLastCreatedTaskPayload(kind = null) {
      if (!kind) return state.createdTaskPayloads.at(-1) || null
      return [...state.createdTaskPayloads].reverse().find((payload) => payload.kind === kind) || null
    },
    get eventsHits() {
      return state.eventsHits
    },
  }
}

function fulfillAuthMe(route, state) {
  if (state.authMode === 'admin') return fulfillJson(route, 200, sessionFor('admin'))
  if (state.authMode === 'creator') return fulfillJson(route, 200, sessionFor('creator'))
  return fulfillJson(route, 401, {
    error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录' },
  })
}

function fulfillJson(route, status, data) {
  return route.fulfill({
    status,
    headers: { 'Content-Type': 'application/json' },
    body: data === null ? '' : JSON.stringify(data),
  })
}

function safeJson(request) {
  try {
    return request.postDataJSON()
  } catch {
    return {}
  }
}

function projectSummary() {
  return {
    id: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    ownerId: 'user-creator',
    name: '午夜胶片',
    contentType: 'short-drama',
    aspectRatio: '9:16',
    status: 'producing',
    synopsis: '雨夜，一卷能预见明天的胶片，正等待被打开。',
    script: '雨夜，临港市旧火车站。林夏收到一封没有署名的信，约她午夜来取回父亲留下的胶片。',
    version: 1,
    createdAt: now(),
    updatedAt: now(),
  }
}

function workspaceSnapshot() {
  return {
    project: projectSummary(),
    assets: [characterAsset(), sceneAsset(), audioAsset()],
    shots: [
      {
        id: 'shot-1',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        order: 1,
        title: '雨夜空镜',
        framing: '大全景',
        duration: 4,
        prompt: '临港市雨夜，镜头缓慢推向废弃火车站，冷色调',
        assetIds: ['asset-station'],
        imageUrl: '/demo/station.jpg',
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: 'shot-2',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        order: 2,
        title: '林夏抵达',
        framing: '中近景',
        duration: 5,
        prompt: '林夏撑透明雨伞走入站台，侧逆光，雨滴清晰',
        assetIds: ['asset-lin', 'asset-rain'],
        imageUrl: '/demo/lin.jpg',
        createdAt: now(),
        updatedAt: now(),
      },
    ],
  }
}

function characterAsset() {
  return {
    id: 'asset-lin',
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    kind: 'character',
    sourceMode: 'generate',
    name: '林夏',
    description: '纪录片导演 · 28岁',
    prompt: '东亚女性，短发，深色风衣，透明雨伞，克制而敏锐，电影感全身照',
    promptMode: 'standard',
    customPromptMode: 'append',
    customPrompt: '',
    negativePrompt: '',
    references: [],
    attributes: {
      type: 'character',
      subjectType: 'human',
      gender: 'female',
      ageGroup: 'young',
      exactAge: null,
      species: '',
      anthropomorphic: false,
      visualStyle: 'cinematic-cg',
      framing: 'full',
      bodyType: 'balanced',
      background: 'solid',
      faceStatus: 'approved',
      bodyStatus: 'approved',
      faceReference: { id: 'face-ref', url: '/demo/lin.jpg', name: '林夏-面部基准' },
      bodyReference: { id: 'body-ref', url: '/demo/lin.jpg', name: '林夏-全身基准' },
      legStretch: false,
      faceBrightening: true,
      turnaround: true,
      turnaroundReferences: [
        { id: 'turn-front', url: '/demo/lin.jpg', mediaType: 'image', view: 'front' },
        { id: 'turn-side', url: '/demo/station.jpg', mediaType: 'image', view: 'side' },
        { id: 'turn-back', url: '/demo/room.jpg', mediaType: 'image', view: 'back' },
      ],
      turnaroundLayout: 'separate',
    },
    imageUrl: '/demo/lin.jpg',
    status: 'confirmed',
    createdAt: now(),
    updatedAt: now(),
  }
}

function sceneAsset() {
  return {
    id: 'asset-station',
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    kind: 'scene',
    sourceMode: 'generate',
    name: '三号站台',
    description: '主场景',
    prompt: '废弃海边火车站，雨夜，湿润铁轨，远处暖色信号灯，宽银幕电影构图',
    promptMode: 'standard',
    customPromptMode: 'append',
    customPrompt: '',
    negativePrompt: '',
    references: [],
    attributes: {
      type: 'scene',
      space: 'exterior',
      sceneType: 'street',
      era: 'modern',
      time: 'night',
      weather: 'clear',
      mood: 'mystery',
      camera: 'wide',
      visualStyle: 'cinematic-cg',
      emptyScene: true,
      activitySpace: true,
    },
    imageUrl: '/demo/station.jpg',
    status: 'confirmed',
    createdAt: now(),
    updatedAt: now(),
  }
}

function audioAsset() {
  return {
    id: 'asset-rain',
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    kind: 'audio',
    sourceMode: 'generate',
    name: '雨夜站台',
    description: '环境音 · 48秒',
    prompt: '密集雨声，远处列车低鸣，偶尔金属震动',
    promptMode: 'standard',
    customPromptMode: 'append',
    customPrompt: '',
    negativePrompt: '',
    references: [{ id: 'audio-ref', url: SILENT_AUDIO, name: '雨夜站台-audio' }],
    attributes: {
      type: 'audio',
      audioType: 'ambience',
      gender: 'unspecified',
      ageGroup: 'young',
      emotion: 'neutral',
      tone: 'warm',
      speed: 'normal',
      language: 'mandarin',
      duration: 48,
      loop: true,
    },
    imageUrl: null,
    status: 'confirmed',
    createdAt: now(),
    updatedAt: now(),
  }
}

function initialTasks() {
  const base = now()
  return [
    task({
      id: 'task-audio-complete',
      kind: 'audio',
      provider: 'audio',
      label: '雨夜站台 · 音频',
      prompt: '环境音',
      negativePrompt: '',
      projectId: 'project-midnight-film',
      userId: 'user-creator',
      status: 'completed',
      progress: 100,
      estimatedCredits: 6,
      metadata: { assetId: 'asset-rain', generationStage: 'audio' },
      outputs: [
        {
          id: 'audio-output-1',
          url: SILENT_AUDIO,
          mediaType: 'audio',
          view: 'single',
        },
      ],
      resultUrl: SILENT_AUDIO,
      createdAt: base,
      updatedAt: base,
    }),
    task({
      id: 'task-turnaround-complete',
      kind: 'image',
      provider: 'img2',
      label: '林夏 · 三视图',
      prompt: '三视图设定',
      negativePrompt: '',
      projectId: 'project-midnight-film',
      userId: 'user-creator',
      status: 'completed',
      progress: 100,
      estimatedCredits: 18,
      metadata: {
        assetId: 'asset-lin',
        generationStage: 'turnaround',
        turnaround: true,
        outputViews: ['front', 'side', 'back'],
      },
      outputs: [
        { id: 'turn-front', url: '/demo/lin.jpg', mediaType: 'image', view: 'front' },
        { id: 'turn-side', url: '/demo/station.jpg', mediaType: 'image', view: 'side' },
        { id: 'turn-back', url: '/demo/room.jpg', mediaType: 'image', view: 'back' },
      ],
      resultUrl: '/demo/lin.jpg',
      createdAt: base,
      updatedAt: base,
    }),
    task({
      id: 'task-audio-failed',
      kind: 'audio',
      provider: 'audio',
      label: '幽灵列车 · 音频',
      prompt: '低频列车声',
      negativePrompt: '',
      projectId: 'project-midnight-film',
      userId: 'user-creator',
      status: 'failed',
      progress: 100,
      estimatedCredits: 6,
      metadata: { assetId: 'asset-rain', generationStage: 'audio' },
      outputs: [],
      resultUrl: null,
      error: 'Audio provider timeout',
      createdAt: base,
      updatedAt: base,
    }),
    task({
      id: 'task-shot-1',
      kind: 'video',
      provider: 'seedance',
      label: '镜头 01 · 雨夜空镜',
      prompt: '雨夜空镜',
      negativePrompt: '',
      projectId: 'project-midnight-film',
      userId: 'user-creator',
      status: 'completed',
      progress: 100,
      estimatedCredits: 18,
      metadata: { shotId: 'shot-1', providerName: 'aideos-seedance' },
      outputs: [{ id: 'shot-1-output', url: '/demo/shot-1.mp4', mediaType: 'video', view: 'single' }],
      resultUrl: '/demo/shot-1.mp4',
      createdAt: base,
      updatedAt: base,
    }),
    task({
      id: 'task-shot-2',
      kind: 'video',
      provider: 'seedance',
      label: '镜头 02 · 林夏抵达',
      prompt: '林夏抵达',
      negativePrompt: '',
      projectId: 'project-midnight-film',
      userId: 'user-creator',
      status: 'completed',
      progress: 100,
      estimatedCredits: 18,
      metadata: { shotId: 'shot-2', providerName: 'aideos-seedance' },
      outputs: [{ id: 'shot-2-output', url: '/demo/shot-2.mp4', mediaType: 'video', view: 'single' }],
      resultUrl: '/demo/shot-2.mp4',
      createdAt: base,
      updatedAt: base,
    }),
  ]
}

function createdTaskFromPayload(payload) {
  const id = `task-created-${Math.random().toString(36).slice(2, 8)}`
  return task({
    id,
    clientRequestId: payload.clientRequestId,
    projectId: payload.projectId,
    tenantId: 'tenant-seqora-demo',
    userId: 'user-creator',
    kind: payload.kind,
    label: payload.label,
    prompt: payload.prompt || '',
    negativePrompt: payload.negativePrompt || '',
    provider: payload.provider || 'local',
    model: payload.model ?? null,
    metadata: payload.metadata || {},
    status: 'queued',
    progress: 0,
    estimatedCredits: payload.estimatedCredits,
    outputs: [],
    resultUrl: null,
    error: null,
    createdAt: now(),
    updatedAt: now(),
  })
}

function task(overrides) {
  const base = now()
  return {
    id: 'task',
    clientRequestId: 'client-task',
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-creator',
    kind: 'video',
    label: 'Task',
    prompt: '',
    negativePrompt: '',
    provider: 'local',
    model: null,
    metadata: {},
    status: 'queued',
    progress: 0,
    estimatedCredits: 1,
    createdAt: base,
    updatedAt: base,
    resultUrl: null,
    outputs: [],
    error: null,
    ...overrides,
  }
}

function sessionFor(mode) {
  if (mode === 'admin') {
    return {
      account: {
        id: 'user-admin',
        email: 'admin@seqora.local',
        name: '平台管理员',
        tenantId: 'tenant-seqora-demo',
        roles: ['admin'],
        plan: 'member',
      },
      permissions: Object.values(PERMISSIONS),
    }
  }

  return {
    account: {
      id: 'user-creator',
      email: 'creator@seqora.local',
      name: '林夏',
      tenantId: 'tenant-seqora-demo',
      roles: ['creator'],
      plan: 'free',
    },
    permissions: [
      PERMISSIONS.PROJECT_READ,
      PERMISSIONS.PROJECT_WRITE,
      PERMISSIONS.GENERATION_TASK_CREATE,
      PERMISSIONS.GENERATION_TASK_READ,
      PERMISSIONS.ASSET_READ,
      PERMISSIONS.ASSET_WRITE,
      PERMISSIONS.BILLING_READ_SELF,
    ],
  }
}

function audit(method, path, outcome) {
  return {
    id: `audit-${method.toLowerCase()}-${path.replace(/[^a-z0-9]+/gi, '-')}`,
    requestId: `request-${method.toLowerCase()}`,
    traceId: `trace-${method.toLowerCase()}`,
    tenantId: 'tenant-seqora-demo',
    userId: 'user-creator',
    roles: ['creator'],
    method,
    routePattern: path,
    path,
    action: path,
    statusCode: 200,
    outcome,
    ip: '127.0.0.1',
    userAgent: 'Playwright',
    details: {},
    createdAt: now(),
  }
}

function now() {
  return new Date('2026-07-21T08:00:00.000Z').toISOString()
}
