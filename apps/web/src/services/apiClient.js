const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

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
    const error = new Error(data?.error?.message || '请求失败，请稍后重试')
    error.code = data?.error?.code || 'REQUEST_FAILED'
    error.status = response.status
    throw error
  }
  return data
}

const json = (method, body) => ({ method, body: JSON.stringify(body) })

const upload = (file) => {
  const body = new FormData()
  body.append('file', file)
  return { method: 'POST', body }
}

function subscribeTaskEvents(projectId, onTasks, onError) {
  if (typeof EventSource === 'undefined') return null

  const source = new EventSource(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/generation/tasks/events`,
    { withCredentials: true },
  )
  source.addEventListener('tasks', (event) => {
    try {
      const payload = JSON.parse(event.data)
      onTasks(payload.tasks || [])
    } catch (error) {
      onError?.(error)
    }
  })
  source.addEventListener('error', () => {
    onError?.(new Error('任务推送暂时不可用，正在使用轮询同步'))
  })
  return () => source.close()
}

export const api = {
  login: (input) => request('/auth/login', json('POST', input)),
  logout: () => request('/auth/logout', { method: 'POST' }),
  session: () => request('/auth/me'),
  projects: () => request('/projects'),
  project: (id) => request(`/projects/${id}`),
  createProject: (input) => request('/projects', json('POST', input)),
  updateProject: (id, input) => request(`/projects/${id}`, json('PATCH', input)),
  saveVersion: (id) => request(`/projects/${id}/versions`, { method: 'POST' }),
  createAsset: (projectId, input) => request(`/projects/${projectId}/assets`, json('POST', input)),
  updateAsset: (projectId, assetId, input) =>
    request(`/projects/${projectId}/assets/${assetId}`, json('PATCH', input)),
  deleteAsset: (projectId, assetId) =>
    request(`/projects/${projectId}/assets/${assetId}`, { method: 'DELETE' }),
  uploadMedia: (projectId, file) => request(`/projects/${projectId}/media`, upload(file)),
  createShot: (projectId, input) => request(`/projects/${projectId}/shots`, json('POST', input)),
  updateShot: (projectId, shotId, input) =>
    request(`/projects/${projectId}/shots/${shotId}`, json('PATCH', input)),
  generateShots: (projectId) => request(`/projects/${projectId}/shots/generate`, { method: 'POST' }),
  tasks: (projectId) => request(`/projects/${projectId}/generation/tasks`),
  subscribeTasks: subscribeTaskEvents,
  createTask: (input) => request('/generation/tasks', json('POST', input)),
  retryTask: (taskId) => request(`/generation/tasks/${taskId}/retry`, { method: 'POST' }),
  cancelTask: (taskId) => request(`/generation/tasks/${taskId}/cancel`, { method: 'POST' }),
  clearTasks: (projectId) =>
    request(`/projects/${projectId}/generation/tasks/completed`, { method: 'DELETE' }),
  billing: () => request('/billing/summary'),
  updatePlan: (plan) => request('/billing/plan', json('PUT', { plan })),
  adminOverview: () => request('/admin/overview'),
  adminAuditLogs: (limit = 50) => request(`/admin/audit-logs?limit=${encodeURIComponent(limit)}`),
  healthReady: () => request('/health/ready'),
}
