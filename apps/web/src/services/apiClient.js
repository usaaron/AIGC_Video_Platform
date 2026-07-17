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
  createTask: (input) => request('/generation/tasks', json('POST', input)),
  clearTasks: (projectId) =>
    request(`/projects/${projectId}/generation/tasks/completed`, { method: 'DELETE' }),
  billing: () => request('/billing/summary'),
  updatePlan: (plan) => request('/billing/plan', json('PUT', { plan })),
  adminOverview: () => request('/admin/overview'),
}
