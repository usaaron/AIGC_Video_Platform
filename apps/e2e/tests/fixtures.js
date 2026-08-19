export const now = '2026-08-19T08:00:00.000Z'
export const tinyImageDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

export function createWebE2EState(overrides = {}) {
  const project = {
    id: 'project-1',
    tenantId: 'tenant-1',
    ownerId: 'user-1',
    name: 'E2E 短剧项目',
    contentType: 'short-drama',
    visualStyle: 'cinematic-cg',
    episodeDurationSeconds: 60,
    aspectRatio: '9:16',
    status: 'draft',
    synopsis: '',
    script: '',
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
  return {
    session: {
      account: {
        id: 'user-1',
        email: 'creator@example.com',
        name: '创作者',
        tenantId: 'tenant-1',
        organizationId: 'tenant-1',
        roles: ['member'],
        plan: 'member',
        credits: 1910,
        passwordResetRequired: false,
        emailVerified: true,
      },
      permissions: [
        'project.read',
        'project.write',
        'generation.task.create',
        'generation.task.read',
        'asset.read',
        'asset.write',
        'asset.library.read',
        'asset.library.write',
        'billing.read.self',
        'usage.read.self',
      ],
    },
    projects: [project],
    workspace: { project, assets: [], shots: [] },
    billing: billingSummary(1910),
    health: { status: 'ok', providers: { img2: 'configured' }, imageModels: [] },
    tasks: [],
    libraryItems: [assetLibraryItem()],
    libraryImports: [],
    image2BatchRequests: [],
    deletedTasks: [],
    ...overrides,
  }
}

export async function mockWebApi(page, state = createWebE2EState()) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = request.method()

    if (method === 'GET' && path === '/auth/me') return fulfillJson(route, state.session)
    if (method === 'GET' && path === '/projects') return fulfillJson(route, state.projects)
    if (method === 'GET' && path === '/billing/summary') return fulfillJson(route, state.billing)
    if (method === 'GET' && path === '/health') return fulfillJson(route, state.health)
    if (method === 'GET' && path === `/projects/${state.workspace.project.id}`) {
      return fulfillJson(route, state.workspace)
    }
    if (method === 'GET' && path === `/projects/${state.workspace.project.id}/generation/tasks`) {
      return fulfillJson(route, state.tasks)
    }
    if (method === 'GET' && path === '/generation/tasks/recent') return fulfillJson(route, state.tasks)
    if (method === 'POST' && path === '/image2/batches') {
      const body = await request.postDataJSON()
      state.image2BatchRequests.push(body)
      const batchId = `image2-e2e-${state.image2BatchRequests.length}`
      const tasks = Array.from({ length: body.imageCount ?? 1 }, (_, index) =>
        generationTask({
          id: `${batchId}-task-${index + 1}`,
          clientRequestId: `${body.clientRequestId || batchId}-${index + 1}`,
          projectId: body.projectId,
          prompt: body.prompt,
          negativePrompt: body.negativePrompt ?? '',
          status: 'queued',
          estimatedCredits: 6,
          metadata: {
            image2BatchId: batchId,
            batchIndex: index + 1,
            batchSize: body.imageCount ?? 1,
            generationSnapshot: {
              prompt: body.prompt,
              originalPrompt: body.prompt,
              negativePrompt: body.negativePrompt ?? '',
              references: body.references ?? [],
              quality: body.quality,
              aspectRatio: body.aspectRatio,
              assist: body.assist,
            },
          },
        }),
      )
      state.tasks = [...tasks, ...state.tasks]
      return fulfillJson(route, {
        batchId,
        providerName: '生图大师',
        model: 'seqora-image2',
        creditsPerImage: 6,
        estimatedCredits: tasks.length * 6,
        tasks,
      })
    }
    if (method === 'DELETE' && path.startsWith('/generation/tasks/')) {
      const taskId = decodeURIComponent(path.split('/').pop() || '')
      state.deletedTasks.push(taskId)
      state.tasks = state.tasks.filter((task) => task.id !== taskId)
      return route.fulfill({ status: 204, body: '' })
    }
    if (method === 'GET' && path === '/library/items') {
      return fulfillJson(route, {
        items: state.libraryItems,
        page: Number(url.searchParams.get('page') || 1),
        pageSize: Number(url.searchParams.get('pageSize') || 24),
        total: state.libraryItems.length,
      })
    }
    if (method === 'GET' && path === '/library/stats') return fulfillJson(route, assetLibraryStats(state))
    if (method === 'GET' && path === '/library/duplicates') return fulfillJson(route, { groups: [] })
    if (method === 'GET' && path.match(/^\/library\/items\/[^/]+\/versions$/)) {
      return fulfillJson(route, { item: state.libraryItems[0], versions: [] })
    }
    if (method === 'POST' && path === `/projects/${state.workspace.project.id}/library/import`) {
      const body = await request.postDataJSON()
      state.libraryImports.push(body)
      const item =
        state.libraryItems.find((candidate) => candidate.id === body.itemId) ?? state.libraryItems[0]
      return fulfillJson(route, {
        item,
        imported: {
          type: 'media',
          media: {
            id: 'media-imported-1',
            projectId: state.workspace.project.id,
            kind: item.kind === 'audio' ? 'audio' : 'image',
            name: item.title,
            contentType: item.contentType,
            size: item.sizeBytes,
            url: item.downloadUrl,
            createdAt: now,
          },
        },
      })
    }

    return unhandled(route, method, path)
  })
  return state
}

export function createAdminE2EState(overrides = {}) {
  const adminUser = adminUserRecord({
    id: 'admin-user',
    email: 'owner@example.com',
    name: '平台所有者',
    roles: ['owner'],
  })
  const memberUser = adminUserRecord({
    id: 'user-member',
    email: 'member@example.com',
    name: '测试个人账号',
    roles: ['member'],
  })
  const membership = adminMembershipRecord({
    id: 'membership-member',
    tenantId: 'tenant-member',
    tenantName: '测试个人账号',
    userId: memberUser.id,
    email: memberUser.email,
    name: memberUser.name,
    plan: 'free',
    credits: 1910,
  })
  const state = {
    session: {
      account: {
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        tenantId: 'system-tenant',
        organizationId: 'system-tenant',
        roles: ['owner'],
        plan: 'member',
        credits: 9999,
        passwordResetRequired: false,
        emailVerified: true,
      },
      permissions: [
        'project.read',
        'project.write',
        'generation.task.create',
        'generation.task.read',
        'asset.read',
        'asset.write',
        'asset.library.read',
        'asset.library.write',
        'billing.read.self',
        'billing.read.all',
        'billing.manage',
        'usage.read.self',
        'usage.read.scoped',
        'usage.read.all',
        'user.read',
        'user.manage',
        'admin.dashboard.read',
        'system.config.manage',
      ],
    },
    snapshot: adminSnapshot({
      users: [adminUser, memberUser],
      memberships: [membership],
      tenants: [
        adminTenantRecord({
          id: 'tenant-member',
          name: '测试个人账号',
          organizationType: 'personal',
          createdByUserId: memberUser.id,
          createdByEmail: memberUser.email,
          createdByName: memberUser.name,
        }),
      ],
    }),
    createdUsers: [],
    planUpdates: [],
    deletedUsers: [],
    ...overrides,
  }
  return state
}

export async function mockAdminApi(page, state = createAdminE2EState()) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = request.method()

    if (method === 'GET' && path === '/auth/me') return fulfillJson(route, state.session)
    if (method === 'GET' && path === '/admin/console') return fulfillJson(route, state.snapshot)
    if (method === 'POST' && path === '/admin/users') {
      const body = await request.postDataJSON()
      state.createdUsers.push(body)
      const createdUser = adminUserRecord({
        id: 'user-created',
        email: body.email,
        name: body.name,
        roles: [body.role],
      })
      const createdMembership = adminMembershipRecord({
        id: 'membership-created',
        tenantId: 'tenant-created',
        tenantName: body.name,
        userId: createdUser.id,
        email: createdUser.email,
        name: createdUser.name,
        plan: 'free',
        credits: 0,
      })
      state.snapshot.users.items = [createdUser, ...state.snapshot.users.items]
      state.snapshot.users.meta.total += 1
      state.snapshot.memberships.items = [createdMembership, ...state.snapshot.memberships.items]
      state.snapshot.memberships.meta.total += 1
      state.snapshot.billingAccounts.items = [
        adminBillingAccountFromMembership(createdMembership),
        ...state.snapshot.billingAccounts.items,
      ]
      state.snapshot.billingAccounts.meta.total += 1
      state.snapshot.tenants.items = [
        adminTenantRecord({
          id: 'tenant-created',
          name: body.name,
          organizationType: 'personal',
          createdByUserId: createdUser.id,
          createdByEmail: createdUser.email,
          createdByName: createdUser.name,
        }),
        ...state.snapshot.tenants.items,
      ]
      state.snapshot.tenants.meta.total += 1
      state.snapshot.organizations = state.snapshot.tenants
      return fulfillJson(route, createdUser)
    }
    const planMatch = path.match(/^\/admin\/billing\/memberships\/([^/]+)\/plan$/)
    if (method === 'PATCH' && planMatch) {
      const membershipId = decodeURIComponent(planMatch[1])
      const body = await request.postDataJSON()
      state.planUpdates.push({ membershipId, body })
      updateAdminMembership(state, membershipId, {
        plan: body.plan,
        creditsDelta: body.plan === 'member' && body.grantMonthlyCredits ? 500 : 0,
      })
      return fulfillJson(route, { ok: true })
    }
    const deleteUserMatch = path.match(/^\/admin\/users\/([^/]+)$/)
    if (method === 'DELETE' && deleteUserMatch) {
      const userId = decodeURIComponent(deleteUserMatch[1])
      state.deletedUsers.push(userId)
      for (const user of state.snapshot.users.items) {
        if (user.id === userId) user.status = 'deleted'
      }
      for (const membership of state.snapshot.memberships.items) {
        if (membership.userId === userId) {
          membership.userStatus = 'deleted'
          membership.status = 'disabled'
          membership.membershipStatus = 'disabled'
        }
      }
      for (const account of state.snapshot.billingAccounts.items) {
        if (account.userId === userId) {
          account.userStatus = 'deleted'
          account.membershipStatus = 'disabled'
        }
      }
      return route.fulfill({ status: 204, body: '' })
    }

    return unhandled(route, method, path)
  })
  return state
}

export function generationTask(overrides = {}) {
  return {
    id: 'task-1',
    clientRequestId: 'client-task-1',
    projectId: 'project-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    kind: 'image',
    label: '生图大师',
    prompt: '默认提示词',
    negativePrompt: '',
    provider: 'img2',
    model: 'seqora-image2',
    metadata: {},
    status: 'completed',
    progress: 100,
    estimatedCredits: 6,
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    maxAttempts: 3,
    resultUrl: null,
    outputs: [],
    error: null,
    ...overrides,
  }
}

export function completedImage2Task(overrides = {}) {
  return generationTask({
    id: 'task-completed-1',
    prompt: '最终电影感提示词',
    metadata: {
      image2BatchId: 'batch-completed',
      batchIndex: 1,
      batchSize: 1,
      generationSnapshot: {
        prompt: '最终电影感提示词',
        originalPrompt: '最终电影感提示词',
        negativePrompt: '',
        references: [],
        quality: 'high',
        aspectRatio: '1536x864',
        assist: { promptOptimization: false, referenceVision: false },
      },
    },
    outputs: [{ id: 'output-1', url: tinyImageDataUrl, mediaType: 'image', view: 'single' }],
    ...overrides,
  })
}

export function failedImage2Task(overrides = {}) {
  return generationTask({
    id: 'task-failed-1',
    status: 'failed',
    progress: 100,
    error: 'Provider timeout',
    prompt: '失败任务提示词',
    metadata: {
      image2BatchId: 'batch-failed',
      batchIndex: 1,
      batchSize: 1,
      generationSnapshot: {
        prompt: '失败任务提示词',
        originalPrompt: '失败任务提示词',
        negativePrompt: '',
        references: [],
        quality: 'medium',
        aspectRatio: 'auto',
        assist: { promptOptimization: false, referenceVision: false },
      },
    },
    ...overrides,
  })
}

function fulfillJson(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  })
}

function unhandled(route, method, path) {
  return fulfillJson(
    route,
    {
      error: {
        code: 'E2E_UNHANDLED_ROUTE',
        message: `Unhandled E2E API route: ${method} ${path}`,
      },
    },
    500,
  )
}

function billingSummary(credits) {
  return {
    plan: 'member',
    credits,
    billingScope: 'membership',
    concurrency: 2,
    unlimitedConcurrency: false,
    planSelfServiceEnabled: false,
    monthlyUsage: {
      periodStart: now,
      consumedCredits: 0,
      refundedCredits: 0,
      netCredits: 0,
      generationCount: 0,
      includedCredits: 500,
    },
    entries: [],
  }
}

function assetLibraryItem(overrides = {}) {
  return {
    id: 'library-image-1',
    tenantId: 'tenant-1',
    ownerUserId: 'user-1',
    kind: 'image',
    title: '雨夜车站参考图',
    description: '生图大师生成结果',
    sourceProjectId: 'project-1',
    sourceProjectName: 'E2E 短剧项目',
    sourceAssetId: null,
    sourceTaskId: 'task-completed-1',
    sourceMediaId: 'media-1',
    sourceSnapshot: {
      prompt: '雨夜车站，电影感灯光',
      negativePrompt: 'blurry',
    },
    contentHash: 'hash-image-1',
    contentType: 'image/png',
    sizeBytes: 1024,
    duplicateOfItemId: null,
    currentVersion: 1,
    tags: ['image2'],
    createdAt: now,
    updatedAt: now,
    restoredAt: null,
    deletedAt: null,
    previewUrl: tinyImageDataUrl,
    downloadUrl: '/api/v1/library/items/library-image-1/download',
    packageUrl: '/api/v1/library/items/library-image-1/package',
    ...overrides,
  }
}

function assetLibraryStats(state) {
  return {
    totalItems: state.libraryItems.length,
    activeItems: state.libraryItems.length,
    trashedItems: 0,
    duplicateItems: 0,
    totalBytes: state.libraryItems.reduce((sum, item) => sum + item.sizeBytes, 0),
    activeBytes: state.libraryItems.reduce((sum, item) => sum + item.sizeBytes, 0),
    versionCount: 0,
    byKind: [
      {
        kind: 'image',
        count: state.libraryItems.length,
        trashed: 0,
        duplicates: 0,
        sizeBytes: state.libraryItems.reduce((sum, item) => sum + item.sizeBytes, 0),
        versions: 0,
      },
    ],
    bySourceProject: [
      {
        sourceProjectId: 'project-1',
        sourceProjectName: 'E2E 短剧项目',
        count: state.libraryItems.length,
        sizeBytes: state.libraryItems.reduce((sum, item) => sum + item.sizeBytes, 0),
      },
    ],
  }
}

function adminSnapshot({ users, memberships, tenants }) {
  return {
    overview: {
      users: users.length,
      activeTasks: 0,
      creditsConsumedToday: 0,
      generatedAt: now,
    },
    users: { items: users, meta: meta(users.length) },
    tenants: { items: tenants, meta: meta(tenants.length) },
    organizations: { items: tenants, meta: meta(tenants.length) },
    memberships: { items: memberships, meta: meta(memberships.length) },
    billingAccounts: {
      items: memberships.map(adminBillingAccountFromMembership),
      meta: meta(memberships.length),
    },
    billingLedgerEntries: { items: [], meta: meta(0) },
    billingPaymentReconciliation: { items: [], meta: meta(0) },
    billingReconciliationAlerts: { items: [], meta: meta(0) },
    sessions: { items: [], meta: meta(0) },
    auditLogs: { items: [], meta: meta(0) },
    generatedAt: now,
  }
}

function adminUserRecord(overrides = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: '测试用户',
    status: 'active',
    roles: ['member'],
    membershipCount: 1,
    activeMembershipCount: 1,
    passwordResetRequired: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function adminTenantRecord(overrides = {}) {
  return {
    id: 'tenant-1',
    name: '个人账号',
    status: 'active',
    isSystem: false,
    organizationType: 'personal',
    createdByUserId: null,
    createdByEmail: null,
    createdByName: null,
    membershipCount: 1,
    activeMembershipCount: 1,
    activeOrganizationAdminCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function adminMembershipRecord(overrides = {}) {
  return {
    id: 'membership-1',
    tenantId: 'tenant-1',
    tenantName: '个人账号',
    tenantStatus: 'active',
    organizationType: 'personal',
    organizationId: 'tenant-1',
    organizationName: '个人账号',
    organizationStatus: 'active',
    userId: 'user-1',
    email: 'user@example.com',
    name: '测试用户',
    userStatus: 'active',
    roles: ['member'],
    status: 'active',
    isPrimary: true,
    plan: 'free',
    credits: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function adminBillingAccountFromMembership(membership) {
  return {
    membershipId: membership.id,
    tenantId: membership.tenantId,
    tenantName: membership.tenantName,
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    userId: membership.userId,
    email: membership.email,
    name: membership.name,
    userStatus: membership.userStatus,
    membershipStatus: membership.status,
    roles: membership.roles,
    plan: membership.plan,
    credits: membership.credits,
    updatedAt: membership.updatedAt,
  }
}

function updateAdminMembership(state, membershipId, { plan, creditsDelta = 0 }) {
  for (const membership of state.snapshot.memberships.items) {
    if (membership.id !== membershipId) continue
    membership.plan = plan
    membership.credits += creditsDelta
    membership.updatedAt = now
  }
  for (const account of state.snapshot.billingAccounts.items) {
    if (account.membershipId !== membershipId) continue
    account.plan = plan
    account.credits += creditsDelta
    account.updatedAt = now
  }
}

function meta(total) {
  return { limit: 50, offset: 0, total }
}
