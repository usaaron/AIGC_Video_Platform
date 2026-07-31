import { PERMISSIONS } from '@seqora/contracts'

export const roleLabels = {
  owner: '所有者',
  super_admin: '超级管理员',
  admin: '管理员',
  member: '普通会员',
}

export const statusLabels = {
  active: '启用',
  disabled: '禁用',
  revoked: '已撤销',
  expired: '已过期',
}

export const planLabels = {
  free: '免费',
  member: '会员',
}

export const ledgerTypeLabels = {
  grant: '充值',
  generation: '扣费',
  adjustment: '调账',
}

export function canReadAdminConsole(session) {
  return session?.permissions?.includes(PERMISSIONS.ADMIN_DASHBOARD_READ) ?? false
}

export function canManageBilling(session) {
  return session?.permissions?.includes(PERMISSIONS.BILLING_MANAGE) ?? false
}

export function canManageUsers(session) {
  return session?.permissions?.includes(PERMISSIONS.USER_MANAGE) ?? false
}

export function roleName(role) {
  return roleLabels[role] ?? role
}

export function statusName(status) {
  return statusLabels[status] ?? status
}

export function planName(plan) {
  return planLabels[plan] ?? plan
}

export function ledgerTypeName(type) {
  return ledgerTypeLabels[type] ?? type
}

export function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function formatSignedAmount(amount) {
  return amount > 0 ? `+${amount}` : String(amount)
}

export function shortId(id) {
  if (!id) return '-'
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id
}

export function filterRows(rows, query) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return rows
  return rows.filter((row) => rowMatches(row, normalized))
}

export function rowMatches(value, query) {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.some((item) => rowMatches(item, query))
  if (typeof value === 'object') return Object.values(value).some((item) => rowMatches(item, query))
  return String(value).toLowerCase().includes(query)
}

export function summarizeConsole(snapshot) {
  return {
    users: snapshot?.users?.meta?.total ?? snapshot?.overview?.users ?? 0,
    tenants: snapshot?.tenants?.meta?.total ?? 0,
    memberships: snapshot?.memberships?.meta?.total ?? 0,
    sessions: snapshot?.sessions?.meta?.total ?? 0,
    billingAccounts: snapshot?.billingAccounts?.meta?.total ?? 0,
    auditLogs: snapshot?.auditLogs?.meta?.total ?? 0,
  }
}
