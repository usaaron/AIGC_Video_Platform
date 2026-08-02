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
const organizations = () => request('/organizations')
const switchOrganization = (organizationId) =>
  request(`/organizations/${encodeURIComponent(organizationId)}/switch`, emptyJsonPost())

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
  health: () => request('/health'),
  login: (input) => request('/auth/login', json('POST', input)),
  register: (input) => request('/auth/register', json('POST', input)),
  requestRegistrationCode: (input) => request('/auth/registration-code/request', json('POST', input)),
  requestEmailVerification: (input) => request('/auth/email-verification/request', json('POST', input)),
  verifyEmail: (input) => request('/auth/email-verification/verify', json('POST', input)),
  requestPasswordReset: (input) => request('/auth/password/reset-request', json('POST', input)),
  resetPassword: (input) => request('/auth/password/reset', json('POST', input)),
  logout: () => request('/auth/logout', emptyJsonPost()),
  session: () => request('/auth/me'),
  changePassword: (input) => request('/auth/password', json('PUT', input)),
  organizations,
  switchOrganization,
  authSessions: () => request('/auth/sessions'),
  revokeAuthSession: (sessionId) => request(`/auth/sessions/${sessionId}`, { method: 'DELETE' }),
  projects: () => request('/projects'),
  project: (id) => request(`/projects/${id}`),
  createProject: (input) => request('/projects', json('POST', input)),
  updateProject: (id, input) => request(`/projects/${id}`, json('PATCH', input)),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
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
    request(`/projects/${id}/novels/${documentId}/summary-queue/${queueId}/pause`, { method: 'POST' }),
  resumeNovelSummaryQueue: (id, documentId, queueId) =>
    request(`/projects/${id}/novels/${documentId}/summary-queue/${queueId}/resume`, { method: 'POST' }),
  retryNovelSummaryQueueItem: (id, documentId, queueId, itemId) =>
    request(`/projects/${id}/novels/${documentId}/summary-queue/${queueId}/items/${itemId}/retry`, {
      method: 'POST',
    }),
  skipNovelSummaryQueueItem: (id, documentId, queueId, itemId) =>
    request(`/projects/${id}/novels/${documentId}/summary-queue/${queueId}/items/${itemId}/skip`, {
      method: 'POST',
    }),
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
  suggestScriptAssets: (
    id,
    script,
    direction,
    modelOrClientRequestId,
    clientRequestId = crypto.randomUUID(),
  ) => {
    const modelValues = new Set([
      'seqora-5.6',
      'seqora-op-5',
      'kimi-3',
      'deepseek-v3',
      'qwen3.8',
      'gpt-5.6-terra',
      'kimi-k3',
      'glm-5.2',
      'glm-5.2-fast',
    ])
    const hasModel = modelValues.has(modelOrClientRequestId)
    return request(
      `/projects/${id}/script/asset-suggestions`,
      json('POST', {
        clientRequestId: hasModel ? clientRequestId : modelOrClientRequestId || crypto.randomUUID(),
        script,
        direction,
        ...(hasModel ? { model: modelOrClientRequestId } : {}),
      }),
    )
  },
  generateScript: (id, draft, direction, clientRequestId = crypto.randomUUID(), options = {}) =>
    request(
      `/projects/${id}/script/generate`,
      json('POST', { clientRequestId, draft, direction, ...options }),
    ),
  generateScriptSegment: (
    id,
    draft,
    direction,
    segment,
    clientRequestId = crypto.randomUUID(),
    options = {},
  ) =>
    request(
      `/projects/${id}/script/generate`,
      json('POST', { clientRequestId, draft, direction, mode: 'segment', segment, ...options }),
    ),
  enrichScript: (id, script, direction, clientRequestId = crypto.randomUUID(), options = {}) =>
    request(
      `/projects/${id}/script/enrich`,
      json('POST', { clientRequestId, script, direction, ...options }),
    ),
  reviewScript: (id, script, direction, clientRequestId = crypto.randomUUID(), options = {}) =>
    request(
      `/projects/${id}/script/review`,
      json('POST', { clientRequestId, script, direction, ...options }),
    ),
  planQuickStart: (id, model) => request(`/projects/${id}/quick-start/plan`, json('POST', { model })),
  executeQuickStart: (id, input) => request(`/projects/${id}/quick-start/execute`, json('POST', input)),
  saveVersion: (id) => request(`/projects/${id}/versions`, { method: 'POST' }),
  createAsset: (projectId, input) => request(`/projects/${projectId}/assets`, json('POST', input)),
  updateAsset: (projectId, assetId, input) =>
    request(`/projects/${projectId}/assets/${assetId}`, json('PATCH', input)),
  deleteAsset: (projectId, assetId) =>
    request(`/projects/${projectId}/assets/${assetId}`, { method: 'DELETE' }),
  trustedAssetConfiguration: () => request('/trusted-assets/configuration'),
  trustedPortraits: (groupType) =>
    request(`/trusted-assets/portraits?groupType=${encodeURIComponent(groupType)}`),
  registerVirtualPortrait: (projectId, assetId) =>
    request(`/projects/${projectId}/assets/${assetId}/trusted-portrait/register`, { method: 'POST' }),
  bindTrustedPortrait: (projectId, assetId, providerAssetId) =>
    request(
      `/projects/${projectId}/assets/${assetId}/trusted-portrait/bind`,
      json('POST', { providerAssetId }),
    ),
  refreshTrustedPortrait: (projectId, assetId) =>
    request(`/projects/${projectId}/assets/${assetId}/trusted-portrait/refresh`, { method: 'POST' }),
  uploadMedia: (projectId, file) => request(`/projects/${projectId}/media`, upload(file)),
  createShot: (projectId, input) => request(`/projects/${projectId}/shots`, json('POST', input)),
  updateShot: (projectId, shotId, input) =>
    request(`/projects/${projectId}/shots/${shotId}`, json('PATCH', input)),
  generateShots: (projectId, input = {}) =>
    request(`/projects/${projectId}/shots/generate`, json('POST', input)),
  autoSplitShotEpisodes: (projectId, input) =>
    request(`/projects/${projectId}/shots/auto-episodes`, json('POST', input)),
  tasks: (projectId) => request(`/projects/${projectId}/generation/tasks`),
  recentTasks: () => request('/generation/tasks/recent'),
  createTask: (input) => request('/generation/tasks', json('POST', input)),
  createFilmPreview: (projectId, mode = 'full', force = false, episodeNumber = null) =>
    request(`/projects/${projectId}/film-preview`, json('POST', { mode, force, episodeNumber })),
  pauseTask: (taskId) => request(`/generation/tasks/${taskId}/pause`, { method: 'POST' }),
  resumeTask: (taskId) => request(`/generation/tasks/${taskId}/resume`, { method: 'POST' }),
  deleteTask: (taskId) => request(`/generation/tasks/${taskId}`, { method: 'DELETE' }),
  clearTasks: (projectId) =>
    request(`/projects/${projectId}/generation/tasks/completed`, { method: 'DELETE' }),
  billing: () => request('/billing/summary'),
  updatePlan: (plan) => request('/billing/plan', json('PUT', { plan })),
  billingPaymentConfiguration: () => request('/billing/payment/configuration'),
  createMemberSubscriptionCheckout: () => request('/billing/checkout/subscription', emptyJsonPost()),
  createCreditCheckout: (input = {}) => request('/billing/checkout/credits', json('POST', input)),
  adminOverview: () => request('/admin/overview'),
}
