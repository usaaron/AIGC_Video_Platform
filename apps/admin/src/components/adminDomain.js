import { assignableRoleOptions } from '../adminConsole'

export const consolePageSizeOptions = [25, 50, 100]
export const consoleRoleFilterOptions = [
  'owner',
  'super_admin',
  'admin',
  'member',
  'organization_admin',
  'organization_member',
]
export const consoleStatusFilterOptions = ['active', 'disabled', 'deleted']

export const WEB_ORIGIN = (
  import.meta.env.VITE_WEB_ORIGIN ||
  window.location.origin ||
  'http://localhost:5173'
).replace(/\/+$/, '')
export const organizationScopedRoles = new Set(['organization_admin', 'organization_member'])
export const systemAccountRoleOrder = ['admin', 'super_admin']
export const usageTabIds = new Set(['usage-realtime', 'usage-users', 'usage-organizations'])
export const workflowTabIds = new Set(['delivery'])

export function isUsageTab(tabId) {
  return usageTabIds.has(tabId)
}

export function usesConsoleServerControls(tabId) {
  return !isUsageTab(tabId) && tabId !== 'compliance' && !workflowTabIds.has(tabId)
}

export function roleRequiresOrganization(role) {
  return organizationScopedRoles.has(role)
}

export function personalAccountRoleOptions(session) {
  return assignableRoleOptions(session, null).filter((role) => role === 'member')
}

export function systemAccountRoleOptions(session) {
  return assignableRoleOptions(session, null).filter((role) => systemAccountRoleOrder.includes(role))
}

export function accountScopeDescription(scope) {
  const descriptions = {
    personal: 'C 端个人空间（自动创建）',
    system: '平台内部系统组织',
    organization: '指定企业组织',
  }
  return descriptions[scope] ?? '请选择账号范围'
}

export function canCreatePlatformInvitation(session) {
  return assignableRoleOptions(session, null).includes('member')
}

export function organizationInvitationRoleOptions(session, organization) {
  if (!organization) return []
  return assignableRoleOptions(session, organization).filter(roleRequiresOrganization)
}

export function invitationScopeName(scope) {
  const labels = {
    platform_registration: '普通成员邀请',
    organization_membership: '企业组织邀请',
    system_account: '系统账号邀请',
  }
  return labels[scope] ?? '邀请'
}

export function invitationUrlFor(token) {
  return `${WEB_ORIGIN}/register?token=${encodeURIComponent(token)}`
}
