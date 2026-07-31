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

export const riskLevelLabels = {
  high: '高风险',
  medium: '需关注',
  low: '正常',
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

export function riskLevelName(level) {
  return riskLevelLabels[level] ?? level
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

export function membershipIdFor(row) {
  return row?.membershipId ?? row?.id ?? ''
}

export function buildSessionRiskRows(sessions, now = new Date()) {
  const activeCountsByUser = sessions.reduce((counts, session) => {
    if (session.status !== 'active') return counts
    counts.set(session.userId, (counts.get(session.userId) ?? 0) + 1)
    return counts
  }, new Map())

  return sessions
    .map((session) => {
      const reasons = []
      let score = 0
      const elevated = session.roles.some((role) => ['owner', 'super_admin', 'admin'].includes(role))
      const activeCount = activeCountsByUser.get(session.userId) ?? 0
      const lastSeenAt = session.lastSeenAt ?? session.createdAt
      const inactiveHours = hoursBetween(lastSeenAt, now)

      if (session.status !== 'active') {
        reasons.push(statusName(session.status))
        return { ...session, riskLevel: 'low', riskScore: 0, reasons, inactiveHours, activeCount }
      }
      if (elevated) {
        score += session.current ? 1 : 2
        reasons.push('高权限账号')
      }
      if (activeCount >= 4) {
        score += 2
        reasons.push('同账号活跃 session 过多')
      } else if (activeCount >= 2) {
        score += 1
        reasons.push('同账号多个活跃 session')
      }
      if (!session.ipAddress) {
        score += 1
        reasons.push('缺少 IP')
      }
      if (!session.deviceLabel && !session.userAgent) {
        score += 1
        reasons.push('缺少设备信息')
      }
      if (inactiveHours >= 24 * 7) {
        score += 2
        reasons.push('超过 7 天未活跃')
      } else if (inactiveHours >= 24 * 3) {
        score += 1
        reasons.push('超过 3 天未活跃')
      }
      if (session.current) reasons.push('当前 session')
      if (!reasons.length) reasons.push('近期活跃')

      return {
        ...session,
        riskLevel: score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low',
        riskScore: score,
        reasons,
        inactiveHours,
        activeCount,
      }
    })
    .sort((left, right) => {
      const riskDelta = riskSortValue(right.riskLevel) - riskSortValue(left.riskLevel)
      if (riskDelta !== 0) return riskDelta
      return right.riskScore - left.riskScore
    })
}

export function summarizeSessionRisks(rows) {
  return rows.reduce(
    (summary, row) => {
      summary[row.riskLevel] += 1
      if (row.status === 'active') summary.active += 1
      return summary
    },
    { high: 0, medium: 0, low: 0, active: 0 },
  )
}

export function summarizeAuditLogs(entries) {
  const actors = new Set(entries.map((entry) => entry.actorUserId).filter(Boolean))
  return {
    total: entries.length,
    accountEvents: entries.filter((entry) => entry.resourceType === 'user').length,
    sessionEvents: entries.filter((entry) => entry.resourceType === 'session').length,
    billingEvents: entries.filter((entry) => entry.action.includes('billing')).length,
    actors: actors.size,
  }
}

export function auditLogTone(entry) {
  if (
    entry.action.includes('disabled') ||
    entry.action.includes('revoked') ||
    entry.action.includes('adjust')
  ) {
    return 'high'
  }
  if (
    entry.action.includes('role') ||
    entry.action.includes('owner') ||
    entry.action.includes('password') ||
    entry.action.includes('billing')
  ) {
    return 'medium'
  }
  return 'low'
}

export function summarizeBillingAdjustments(entries) {
  const adjustmentEntries = entries.filter((entry) => entry.type === 'adjustment')
  const grantEntries = entries.filter((entry) => entry.type === 'grant')
  return {
    adjustments: adjustmentEntries.length,
    grants: grantEntries.length,
    positiveCredits: entries
      .filter((entry) => entry.amount > 0)
      .reduce((total, entry) => total + entry.amount, 0),
    negativeCredits: Math.abs(
      entries.filter((entry) => entry.amount < 0).reduce((total, entry) => total + entry.amount, 0),
    ),
  }
}

function hoursBetween(value, now) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, (now.getTime() - timestamp) / 3_600_000)
}

function riskSortValue(level) {
  return { high: 3, medium: 2, low: 1 }[level] ?? 0
}
