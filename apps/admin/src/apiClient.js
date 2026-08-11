import {
  adminAuditLogEntryListSchema,
  adminBillingReconciliationAlertSchema,
  adminCompliancePromptItemSchema,
  adminCompliancePromptListSchema,
  adminConsoleSchema,
  createdTenantInvitationSchema,
  organizationBillingSummarySchema,
  sessionSchema,
  tenantInvitationSchema,
  usageSummarySchema,
} from '@seqora/contracts'

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
const buildQueryString = (params = {}) => {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    query.set(key, String(value))
  })
  const text = query.toString()
  return text ? `?${text}` : ''
}
const createOrganization = (input) => request('/admin/organizations', json('POST', input))
const updateOrganization = (organizationId, input) =>
  request(`/admin/organizations/${encodeURIComponent(organizationId)}`, json('PATCH', input))
const disableOrganization = (organizationId) =>
  request(`/admin/organizations/${encodeURIComponent(organizationId)}`, { method: 'DELETE' })
const createPlatformUser = (input) => request('/admin/users', json('POST', input))
const createPlatformInvitation = (input) => request('/admin/invitations', json('POST', input))
const listPlatformInvitations = () => request('/admin/invitations')
const revokePlatformInvitation = (invitationId) =>
  request(`/admin/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' })
const createOrganizationUser = (organizationId, input) =>
  request(`/admin/organizations/${encodeURIComponent(organizationId)}/users`, json('POST', input))
const addExistingOrganizationMember = (organizationId, input) =>
  request(`/admin/organizations/${encodeURIComponent(organizationId)}/members`, json('POST', input))
const createOrganizationInvitation = (organizationId, input) =>
  request(`/admin/organizations/${encodeURIComponent(organizationId)}/invitations`, json('POST', input))
const listOrganizationInvitations = (organizationId) =>
  request(`/admin/organizations/${encodeURIComponent(organizationId)}/invitations`)
const revokeOrganizationInvitation = (organizationId, invitationId) =>
  request(
    `/admin/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
    { method: 'DELETE' },
  )
const leaveOrganization = (organizationId) =>
  request(`/organizations/${encodeURIComponent(organizationId)}/leave`, emptyJsonPost())
const updateReconciliationAlert = (alertId, input) =>
  request(`/admin/billing/reconciliation-alerts/${encodeURIComponent(alertId)}`, json('PATCH', input))

export const api = {
  login: async (input) => sessionSchema.parse(await request('/auth/login', json('POST', input))),
  logout: () => request('/auth/logout', emptyJsonPost()),
  session: async () => sessionSchema.parse(await request('/auth/me')),
  adminConsole: async (params = {}) =>
    adminConsoleSchema.parse(await request(`/admin/console${buildQueryString(params)}`)),
  adminUsage: async (params = {}) =>
    usageSummarySchema.parse(await request(`/admin/usage${buildQueryString(params)}`)),
  createOrganization,
  updateOrganization,
  disableOrganization,
  createPlatformUser,
  createPlatformInvitation: async (input) =>
    createdTenantInvitationSchema.parse(await createPlatformInvitation(input)),
  listPlatformInvitations: async () => tenantInvitationSchema.array().parse(await listPlatformInvitations()),
  revokePlatformInvitation,
  transferOrganizationAdmin: (organizationId, input) =>
    request(`/admin/organizations/${encodeURIComponent(organizationId)}/admin-transfer`, json('POST', input)),
  createOrganizationUser,
  addExistingOrganizationMember,
  createOrganizationInvitation: async (organizationId, input) =>
    createdTenantInvitationSchema.parse(await createOrganizationInvitation(organizationId, input)),
  listOrganizationInvitations: async (organizationId) =>
    tenantInvitationSchema.array().parse(await listOrganizationInvitations(organizationId)),
  revokeOrganizationInvitation,
  leaveOrganization: async (organizationId) => {
    const result = await leaveOrganization(organizationId)
    return result ? sessionSchema.parse(result) : null
  },
  updateReconciliationAlert: async (alertId, input) =>
    adminBillingReconciliationAlertSchema.parse(await updateReconciliationAlert(alertId, input)),
  updateMemberRoles: (membershipId, roles) =>
    request(`/admin/memberships/${encodeURIComponent(membershipId)}/roles`, json('PATCH', { roles })),
  disableMembership: (membershipId) =>
    request(`/admin/memberships/${encodeURIComponent(membershipId)}`, { method: 'DELETE' }),
  updateUserStatus: (userId, status) =>
    request(`/admin/users/${encodeURIComponent(userId)}/status`, json('PATCH', { status })),
  updatePasswordResetRequirement: (userId, input) =>
    request(`/admin/users/${encodeURIComponent(userId)}/password-reset-requirement`, json('PATCH', input)),
  setUserPassword: (userId, input) =>
    request(`/admin/users/${encodeURIComponent(userId)}/password`, json('PUT', input)),
  revokeUserSessions: (userId) =>
    request(`/admin/users/${encodeURIComponent(userId)}/sessions`, { method: 'DELETE' }),
  revokeSession: (sessionId) =>
    request(`/admin/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  adminAuditLogs: async (params = {}) =>
    adminAuditLogEntryListSchema.parse(await request(`/admin/audit-logs${buildQueryString(params)}`)),
  adminCompliancePrompts: async (params = {}) =>
    adminCompliancePromptListSchema.parse(
      await request(`/admin/compliance/prompts${buildQueryString(params)}`),
    ),
  recordCompliancePromptAction: async (source, sourceId, input) =>
    adminCompliancePromptItemSchema.parse(
      await request(
        `/admin/compliance/prompts/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}/actions`,
        json('POST', input),
      ),
    ),
  grantCredits: (input) => request('/admin/billing/grants', json('POST', input)),
  adjustCredits: (membershipId, input) =>
    request(
      `/admin/billing/memberships/${encodeURIComponent(membershipId)}/adjustments`,
      json('POST', input),
    ),
  organizationBillingSummary: async (organizationId) =>
    organizationBillingSummarySchema.parse(
      await request(`/admin/billing/organizations/${encodeURIComponent(organizationId)}`),
    ),
  adjustOrganizationCredits: (organizationId, input) =>
    request(
      `/admin/billing/organizations/${encodeURIComponent(organizationId)}/adjustments`,
      json('POST', input),
    ),
  updateMembershipPlan: (membershipId, input) =>
    request(`/admin/billing/memberships/${encodeURIComponent(membershipId)}/plan`, json('PATCH', input)),
}
