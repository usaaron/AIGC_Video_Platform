import { adminConsoleSchema, sessionSchema } from '@seqora/contracts'

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
const emptyJsonPost = () => json('POST', {})

export const api = {
  login: async (input) => sessionSchema.parse(await request('/auth/login', json('POST', input))),
  logout: () => request('/auth/logout', emptyJsonPost()),
  session: async () => sessionSchema.parse(await request('/auth/me')),
  adminConsole: async () => adminConsoleSchema.parse(await request('/admin/console?limit=100&offset=0')),
  updateUserStatus: (userId, status) =>
    request(`/admin/users/${encodeURIComponent(userId)}/status`, json('PATCH', { status })),
  revokeSession: (sessionId) =>
    request(`/admin/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  grantCredits: (input) => request('/admin/billing/grants', json('POST', input)),
  adjustCredits: (membershipId, input) =>
    request(
      `/admin/billing/memberships/${encodeURIComponent(membershipId)}/adjustments`,
      json('POST', input),
    ),
}
