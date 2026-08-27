import { PERMISSIONS } from '@seqora/contracts'

export const roleLabels = {
  owner: '所有者',
  super_admin: '超级管理员',
  admin: '管理员',
  member: '普通成员',
  organization_admin: '组织管理员',
  organization_member: '组织成员',
}

export const statusLabels = {
  active: '启用',
  disabled: '禁用',
  deleted: '已删除',
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

export const organizationTypeLabels = {
  all: '全部类型',
  system: '系统组织',
  test: '测试组织',
  enterprise: '企业组织',
  personal: '个人空间',
  standard: '其他空间',
}

const systemOrganizationRoles = new Set(['owner', 'super_admin', 'admin'])
const organizationScopedRoles = new Set(['organization_admin', 'organization_member'])

export function canReadAdminConsole(session) {
  return session?.permissions?.includes(PERMISSIONS.ADMIN_DASHBOARD_READ) ?? false
}

export function canManageBilling(session) {
  return session?.permissions?.includes(PERMISSIONS.BILLING_MANAGE) ?? false
}

export function canReadBillingAll(session) {
  return session?.permissions?.includes(PERMISSIONS.BILLING_READ_ALL) ?? false
}

export function canManageUsers(session) {
  return session?.permissions?.includes(PERMISSIONS.USER_MANAGE) ?? false
}

export function isOwnerSession(session) {
  return session?.account?.roles?.includes('owner') ?? false
}

export function isPlatformAdminSession(session) {
  const roles = session?.account?.roles ?? []
  return roles.includes('owner') || roles.includes('super_admin')
}

export function isPlatformInternalSession(session) {
  const roles = session?.account?.roles ?? []
  return roles.some((role) => systemOrganizationRoles.has(role))
}

export function isOrganizationManagerSession(session) {
  const roles = session?.account?.roles ?? []
  return isPlatformAdminSession(session) || roles.includes('admin') || roles.includes('organization_admin')
}

export function canManageOrganization(session, organization) {
  if (!canManageUsers(session)) return false
  const organizationId = organizationIdFor(organization)
  if (isSystemOrganization(organization) && !isPlatformInternalSession(session)) return false
  if (isPlatformAdminSession(session)) return true
  return isOrganizationManagerSession(session) && session?.account?.tenantId === organizationId
}

export function canDisableOrganization(session, organization) {
  if (isSystemOrganization(organization)) return false
  return isOwnerSession(session) && canManageOrganization(session, organization)
}

export function canTransferOrganizationAdmin(session, organization) {
  if (isSystemOrganization(organization)) return false
  return isPlatformAdminSession(session) && canManageOrganization(session, organization)
}

export function canCreateOrganization(session) {
  return canManageUsers(session) && isPlatformAdminSession(session)
}

export function addExistingOrganizationMemberRoleOptions(session, organization) {
  const roles = assignableRoleOptions(session, organization)
  if (isSystemOrganization(organization)) return roles
  return roles.filter((role) => role === 'organization_admin' || role === 'organization_member')
}

export function canAddExistingOrganizationMember(session, organization) {
  return (
    organization?.status === 'active' &&
    canManageOrganization(session, organization) &&
    addExistingOrganizationMemberRoleOptions(session, organization).length > 0
  )
}

export function canLeaveOrganization(session, organization, memberships = []) {
  const organizationId = organizationIdFor(organization)
  if (!organizationId || isSystemOrganization(organization) || organization?.status !== 'active') return false
  if (session?.account?.tenantId !== organizationId) return false
  if (!memberships.length) return true
  return memberships.some(
    (membership) =>
      organizationIdFor(membership) === organizationId &&
      membership.userId === session?.account?.id &&
      (membership.status === 'active' || membership.membershipStatus === 'active'),
  )
}

export function canAssignRole(session, role, organization) {
  if (isSystemOrganization(organization) && !systemOrganizationRoles.has(role)) return false
  if (role === 'owner' || role === 'super_admin') return isOwnerSession(session)
  if (role === 'admin' || role === 'organization_admin') return isPlatformAdminSession(session)
  if (role === 'organization_member') return isOrganizationManagerSession(session)
  if (role === 'member') {
    return isPlatformAdminSession(session) || session?.account?.roles?.includes('admin')
  }
  return false
}

export function assignableRoleOptions(session, organization) {
  const filterSystemRoles = (roles) =>
    isSystemOrganization(organization) ? roles.filter((role) => systemOrganizationRoles.has(role)) : roles
  if (isOwnerSession(session)) {
    return filterSystemRoles(['member', 'admin', 'organization_member', 'organization_admin', 'super_admin'])
  }
  if (isPlatformAdminSession(session))
    return filterSystemRoles(['member', 'admin', 'organization_member', 'organization_admin'])
  if (session?.account?.roles?.includes('admin')) return filterSystemRoles(['member'])
  if (session?.account?.roles?.includes('organization_admin'))
    return filterSystemRoles(['organization_member'])
  return []
}

export function canCreateOrganizationUser(session, organization) {
  return (
    canManageOrganization(session, organization) && assignableRoleOptions(session, organization).length > 0
  )
}

export function canManageMembership(session, membership) {
  if (!canManageOrganization(session, membership)) return false
  if (session?.account?.id === membership?.userId) return false
  const roles = membership?.roles ?? []
  if (roles.includes('owner') || roles.includes('super_admin')) return isOwnerSession(session)
  if (roles.includes('admin') || roles.includes('organization_admin')) return isPlatformAdminSession(session)
  if (roles.includes('member'))
    return isPlatformAdminSession(session) || session?.account?.roles?.includes('admin')
  if (roles.includes('organization_member')) {
    return isPlatformAdminSession(session) || session?.account?.roles?.includes('organization_admin')
  }
  return false
}

export function canReadOrganizationBilling(session, organization) {
  if (!canReadBillingAll(session)) return false
  if (!isEnterpriseOrganization(organization)) return false
  const organizationId = organizationIdFor(organization)
  if (isPlatformAdminSession(session)) return true
  const roles = session?.account?.roles ?? []
  return session?.account?.tenantId === organizationId && roles.includes('organization_admin')
}

export function canManageOrganizationBilling(session, organization) {
  if (!canManageBilling(session)) return false
  if (!isEnterpriseOrganization(organization)) return false
  const organizationId = organizationIdFor(organization)
  if (isPlatformAdminSession(session)) return true
  const roles = session?.account?.roles ?? []
  return session?.account?.tenantId === organizationId && roles.includes('organization_admin')
}

export function canManageBillingAccount(session, account) {
  if (!canManageBilling(session)) return false
  const roles = account?.roles ?? []
  if (!roles.length) return false
  if (isPlatformAdminSession(session)) return true

  const organizationType = account?.organizationType
  if (session?.account?.roles?.includes('admin')) {
    return (
      roles.includes('member') &&
      !roles.some((role) => organizationScopedRoles.has(role)) &&
      organizationType !== 'enterprise'
    )
  }

  if (session?.account?.roles?.includes('organization_admin')) {
    return (
      organizationIdFor(account) === session.account.tenantId &&
      roles.includes('organization_member') &&
      organizationType !== 'personal' &&
      organizationType !== 'system'
    )
  }

  return false
}

export function canUpdateMembershipPlan(session, membership) {
  return canManageBillingAccount(session, membership)
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

export function organizationTypeName(type) {
  return organizationTypeLabels[type] ?? type
}

export function classifyOrganization(organization) {
  const id = organization?.id ?? ''
  const name = organization?.name ?? ''
  const createdByEmail = organization?.createdByEmail ?? ''
  const explicitType = organization?.organizationType
  const normalizedName = name.trim().toLowerCase()
  const normalizedEmail = createdByEmail.trim().toLowerCase()

  if (explicitType === 'system' || isSystemOrganization(organization) || normalizedName === 'seqora local') {
    return {
      type: 'system',
      label: organizationTypeName('system'),
      description: '平台内部使用，不作为企业业务组织',
    }
  }
  if (explicitType === 'enterprise') {
    return {
      type: 'enterprise',
      label: organizationTypeName('enterprise'),
      description: 'Enterprise organization',
    }
  }
  if (explicitType === 'personal') {
    return {
      type: 'personal',
      label: organizationTypeName('personal'),
      description: '个人创作、个人积分和个人会员所在的工作区',
    }
  }
  if (explicitType === 'synthetic') {
    return {
      type: 'test',
      label: organizationTypeName('test'),
      description: '本地测试或自动化验证创建的工作区',
    }
  }
  if (explicitType) {
    return {
      type: 'standard',
      label: organizationTypeName('standard'),
      description: '未归类的工作区',
    }
  }
  if (
    normalizedName.includes('test') ||
    normalizedName.includes('测试') ||
    normalizedEmail.includes('test') ||
    normalizedEmail.endsWith('@example.com') ||
    id.includes('test')
  ) {
    return {
      type: 'test',
      label: organizationTypeName('test'),
      description: '由本地测试或调试流程创建',
    }
  }
  if (
    normalizedName.includes('enterprise') ||
    normalizedName.includes('企业') ||
    normalizedName.includes('company') ||
    normalizedName.includes('corp')
  ) {
    return {
      type: 'enterprise',
      label: organizationTypeName('enterprise'),
      description: '面向 B 端客户、团队或企业组织',
    }
  }
  return {
    type: 'standard',
    label: organizationTypeName('standard'),
    description: '未归类的工作区',
  }
}

export function isSystemOrganization(organization) {
  if (!organization) return false
  if (typeof organization === 'string') return organization === 'tenant-seqora-demo'
  const id = organization.id ?? organization.tenantId
  return organization.isSystem === true || id === 'tenant-seqora-demo'
}

export function isEnterpriseOrganization(organization) {
  return classifyOrganization(organization).type === 'enterprise'
}

export function isPersonalAccountMembership(membership) {
  const roles = membership?.roles ?? []
  if (!roles.some((role) => role === 'member' || role === 'admin')) return false
  return !roles.some(
    (role) => role === 'owner' || role === 'super_admin' || organizationScopedRoles.has(role),
  )
}

function organizationIdFor(organization) {
  if (typeof organization === 'string') return organization
  return organization?.organizationId ?? organization?.tenantId ?? organization?.id ?? ''
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
  const organizationTotal = snapshot?.organizations?.meta?.total ?? snapshot?.tenants?.meta?.total ?? 0
  return {
    users: snapshot?.users?.meta?.total ?? snapshot?.overview?.users ?? 0,
    organizations: organizationTotal,
    tenants: organizationTotal,
    memberships: snapshot?.memberships?.meta?.total ?? 0,
    sessions: snapshot?.sessions?.meta?.total ?? 0,
    billingAccounts: snapshot?.billingAccounts?.meta?.total ?? 0,
    paymentReconciliation: snapshot?.billingPaymentReconciliation?.meta?.total ?? 0,
    reconciliationAlerts: snapshot?.billingReconciliationAlerts?.meta?.total ?? 0,
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
      const elevated = session.roles.some((role) =>
        ['owner', 'super_admin', 'admin', 'organization_admin'].includes(role),
      )
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
