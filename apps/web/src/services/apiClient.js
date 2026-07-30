const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'
export const AUTH_EXPIRED_EVENT = 'seqora:auth-expired'

async function request(path, options = {}) {
  const hasJsonBody = options.body && !(options.body instanceof FormData)
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (response.status === 204) return null
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const sessionExpired = ['AUTHENTICATION_REQUIRED', 'SESSION_INVALID'].includes(data?.error?.code)
    if (response.status === 401 && sessionExpired && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    }
    const error = new Error(data?.error?.message || '请求失败，请稍后重试')
    error.code = data?.error?.code || 'REQUEST_FAILED'
    error.status = response.status
    throw error
  }
  return data
}

const json = (method, body) => ({ method, body: JSON.stringify(body) })
const emptyJsonPost = () => json('POST', {})

const upload = (file) => {
  const body = new FormData()
  body.append('file', file)
  return { method: 'POST', body }
}

export async function waitForProjectScriptUpdate(
  projectId,
  previousScript,
  { timeoutMs = 30_000, pollIntervalMs = 2_500 } = {},
) {
  const startedAt = Date.now()
  let elapsed = 0
  while (elapsed <= timeoutMs) {
    try {
      const workspace = await request(`/projects/${projectId}`)
      if (workspace?.project?.script && workspace.project.script !== previousScript) return workspace
    } catch (error) {
      if (error?.status === 401) throw error
    }
    elapsed = Date.now() - startedAt
    if (elapsed >= timeoutMs) return null
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    elapsed = Date.now() - startedAt
  }
  return null
}

export const api = {
  login: (input) => request('/auth/login', json('POST', input)),
  logout: () => request('/auth/logout', emptyJsonPost()),
  session: () => request('/auth/me'),
  changePassword: (input) => request('/auth/password', json('PUT', input)),
  workspaces: () => request('/workspaces'),
  switchWorkspace: (tenantId) => request(`/workspaces/${tenantId}/switch`, emptyJsonPost()),
  tenantMembers: (tenantId) => request(`/tenants/${tenantId}/members`),
  createTenantUser: (tenantId, input) => request(`/tenants/${tenantId}/users`, json('POST', input)),
  updateMemberRoles: (tenantId, userId, roles) =>
    request(`/tenants/${tenantId}/members/${userId}/roles`, json('PATCH', { roles })),
  disableMember: (tenantId, userId) =>
    request(`/tenants/${tenantId}/members/${userId}`, { method: 'DELETE' }),
  authSessions: () => request('/auth/sessions'),
  revokeAuthSession: (sessionId) => request(`/auth/sessions/${sessionId}`, { method: 'DELETE' }),
  tenantSessions: (tenantId) => request(`/tenants/${tenantId}/sessions`),
  revokeTenantSession: (tenantId, sessionId) =>
    request(`/tenants/${tenantId}/sessions/${sessionId}`, { method: 'DELETE' }),
  projects: () => request('/projects'),
  project: (id) => request(`/projects/${id}`),
  createProject: (input) => request('/projects', json('POST', input)),
  updateProject: (id, input) => request(`/projects/${id}`, json('PATCH', input)),
  novels: (id) => request(`/projects/${id}/novels`),
  novel: (id, documentId) => request(`/projects/${id}/novels/${documentId}`),
  previewNovelSplit: (id, input) => request(`/projects/${id}/novels/preview-split`, json('POST', input)),
  importNovel: (id, input) => request(`/projects/${id}/novels/import`, json('POST', input)),
  novelSummaries: (id, documentId) => request(`/projects/${id}/novels/${documentId}/summaries`),
  novelBoundaries: (id, documentId) => request(`/projects/${id}/novels/${documentId}/boundaries`),
  detectNovelBoundaries: (id, documentId, input = {}) =>
    request(`/projects/${id}/novels/${documentId}/boundaries/detect`, json('POST', input)),
  generateNovelBoundaryNotes: (id, documentId, input = {}) =>
    request(`/projects/${id}/novels/${documentId}/boundaries/notes/generate`, json('POST', input)),
  novelSummaryQueue: (id, documentId) => request(`/projects/${id}/novels/${documentId}/summary-queue`),
  createNovelSummaryQueue: (id, documentId, input = {}) =>
    request(`/projects/${id}/novels/${documentId}/summary-queue`, json('POST', input)),
  runNovelSummaryQueueBatch: (id, documentId, queueId, input = {}) =>
    request(`/projects/${id}/novels/${documentId}/summary-queue/${queueId}/run-batch`, json('POST', input)),
  pauseNovelSummaryQueue: (id, documentId, queueId) =>
    request(`/projects/${id}/novels/${documentId}/summary-queue/${queueId}/pause`, emptyJsonPost()),
  resumeNovelSummaryQueue: (id, documentId, queueId) =>
    request(`/projects/${id}/novels/${documentId}/summary-queue/${queueId}/resume`, emptyJsonPost()),
  retryNovelSummaryQueueItem: (id, documentId, queueId, itemId) =>
    request(
      `/projects/${id}/novels/${documentId}/summary-queue/${queueId}/items/${itemId}/retry`,
      emptyJsonPost(),
    ),
  skipNovelSummaryQueueItem: (id, documentId, queueId, itemId) =>
    request(
      `/projects/${id}/novels/${documentId}/summary-queue/${queueId}/items/${itemId}/skip`,
      emptyJsonPost(),
    ),
  commitNovelSummaryQueueResults: (id, documentId, queueId, input = {}) =>
    request(
      `/projects/${id}/novels/${documentId}/summary-queue/${queueId}/commit-results`,
      json('POST', input),
    ),
  generateNovelSummaries: (id, documentId, input = {}) =>
    request(`/projects/${id}/novels/${documentId}/summaries/generate`, json('POST', input)),
  novelStoryBible: (id, documentId) => request(`/projects/${id}/novels/${documentId}/story-bible`),
  generateNovelStoryBible: (id, documentId, input = {}) =>
    request(`/projects/${id}/novels/${documentId}/story-bible/generate`, json('POST', input)),
  suggestNovelAssets: (id, documentId, input = {}) =>
    request(`/projects/${id}/novels/${documentId}/asset-suggestions`, json('POST', input)),
  generateNovelChapterAdaptation: (id, documentId, input = {}) =>
    request(`/projects/${id}/novels/${documentId}/adapt-script`, json('POST', input)),
  suggestScriptAssets: (id, script, direction, clientRequestId = crypto.randomUUID(), model) =>
    request(
      `/projects/${id}/script/asset-suggestions`,
      json('POST', { clientRequestId, script, direction, ...(model ? { model } : {}) }),
    ),
  generateScript: (id, draft, direction, clientRequestId = crypto.randomUUID(), model) =>
    request(
      `/projects/${id}/script/generate`,
      json('POST', { clientRequestId, draft, direction, ...(model ? { model } : {}) }),
    ),
  generateScriptSegment: (id, draft, direction, segment, clientRequestId = crypto.randomUUID(), model) =>
    request(
      `/projects/${id}/script/generate`,
      json('POST', {
        clientRequestId,
        draft,
        direction,
        mode: 'segment',
        segment,
        ...(model ? { model } : {}),
      }),
    ),
  enrichScript: (id, script, direction, clientRequestId = crypto.randomUUID(), model) =>
    request(
      `/projects/${id}/script/enrich`,
      json('POST', { clientRequestId, script, direction, ...(model ? { model } : {}) }),
    ),
  planQuickStart: (id, model) =>
    request(`/projects/${id}/quick-start/plan`, json('POST', model ? { model } : {})),
  executeQuickStart: (id, input) => request(`/projects/${id}/quick-start/execute`, json('POST', input)),
  saveVersion: (id) => request(`/projects/${id}/versions`, emptyJsonPost()),
  createAsset: (projectId, input) => request(`/projects/${projectId}/assets`, json('POST', input)),
  updateAsset: (projectId, assetId, input) =>
    request(`/projects/${projectId}/assets/${assetId}`, json('PATCH', input)),
  deleteAsset: (projectId, assetId) =>
    request(`/projects/${projectId}/assets/${assetId}`, { method: 'DELETE' }),
  trustedAssetConfiguration: () => request('/trusted-assets/configuration'),
  trustedPortraits: (groupType) =>
    request(`/trusted-assets/portraits?groupType=${encodeURIComponent(groupType)}`),
  registerVirtualPortrait: (projectId, assetId) =>
    request(`/projects/${projectId}/assets/${assetId}/trusted-portrait/register`, emptyJsonPost()),
  bindTrustedPortrait: (projectId, assetId, providerAssetId) =>
    request(
      `/projects/${projectId}/assets/${assetId}/trusted-portrait/bind`,
      json('POST', { providerAssetId }),
    ),
  refreshTrustedPortrait: (projectId, assetId) =>
    request(`/projects/${projectId}/assets/${assetId}/trusted-portrait/refresh`, emptyJsonPost()),
  uploadMedia: (projectId, file) => request(`/projects/${projectId}/media`, upload(file)),
  createShot: (projectId, input) => request(`/projects/${projectId}/shots`, json('POST', input)),
  updateShot: (projectId, shotId, input) =>
    request(`/projects/${projectId}/shots/${shotId}`, json('PATCH', input)),
  generateShots: (projectId, input = {}) =>
    request(`/projects/${projectId}/shots/generate`, json('POST', input)),
  tasks: (projectId) => request(`/projects/${projectId}/generation/tasks`),
  createTask: (input) => request('/generation/tasks', json('POST', input)),
  createFilmPreview: (projectId, mode = 'full', force = false) =>
    request(`/projects/${projectId}/film-preview`, json('POST', { mode, force })),
  pauseTask: (taskId) => request(`/generation/tasks/${taskId}/pause`, emptyJsonPost()),
  resumeTask: (taskId) => request(`/generation/tasks/${taskId}/resume`, emptyJsonPost()),
  deleteTask: (taskId) => request(`/generation/tasks/${taskId}`, { method: 'DELETE' }),
  clearTasks: (projectId) =>
    request(`/projects/${projectId}/generation/tasks/completed`, { method: 'DELETE' }),
  billing: () => request('/billing/summary'),
  updatePlan: (plan) => request('/billing/plan', json('PUT', { plan })),
  adminOverview: () => request('/admin/overview'),
}
