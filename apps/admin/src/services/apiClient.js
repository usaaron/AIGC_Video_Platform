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

export const api = {
  login: (input) => request('/auth/login', json('POST', input)),
  logout: () => request('/auth/logout', { method: 'POST' }),
  session: () => request('/auth/me'),
  adminOverview: () => request('/admin/overview'),
  adminAuditLogs: (limit = 50) => request(`/admin/audit-logs?limit=${encodeURIComponent(limit)}`),
  healthReady: () => request('/health/ready'),
}
