import { AlertTriangle, Clock, FileText, Power, ShieldAlert, ShieldCheck } from 'lucide-react'
import { createDefaultConsoleFilters } from '../adminViewState'

export function usageRangeName(range) {
  const labels = {
    today: '今日',
    week: '本周',
    month: '本月',
  }
  return labels[range] ?? range
}

export function formatUsageNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number.isFinite(value) ? value : 0)
}

export function formatUsageRatio(value) {
  const ratio = Number.isFinite(value) ? value : 0
  return `${Math.round(ratio * 1000) / 10}%`
}

export function usageRowKey(row) {
  return row.userId ?? row.organizationId ?? row.subjectType
}

export function tabCount(tabId, summary, derivedCounts = {}) {
  const counts = {
    overview: '',
    'usage-realtime': '',
    'usage-users': '',
    'usage-organizations': '',
    users: summary.users,
    'personal-accounts': derivedCounts.personalAccounts,
    organizations: derivedCounts.enterpriseOrganizations,
    tenants: summary.organizations,
    memberships: summary.memberships,
    compliance: '',
    invitations: '',
    billing: summary.billingAccounts,
    'reconciliation-alerts': summary.reconciliationAlerts,
    adjustments: summary.billingAccounts,
    sessions: summary.sessions,
    'session-risk': summary.sessions,
    audit: summary.auditLogs,
  }
  return counts[tabId] ?? ''
}

export function activeConsoleListMeta(snapshot, activeTab) {
  if (!snapshot) return null
  const metaByTab = {
    users: snapshot.users?.meta,
    organizations: snapshot.organizations?.meta ?? snapshot.tenants?.meta,
    memberships: snapshot.memberships?.meta,
    billing: snapshot.billingLedgerEntries?.meta,
    'reconciliation-alerts': snapshot.billingReconciliationAlerts?.meta,
    adjustments: snapshot.billingAccounts?.meta,
    sessions: snapshot.sessions?.meta,
    'session-risk': snapshot.sessions?.meta,
    audit: snapshot.auditLogs?.meta,
  }
  return metaByTab[activeTab] ?? null
}

export function clientListMeta(total, filters) {
  const offset = clientPageOffset(total, filters)
  return {
    limit: filters.limit,
    offset,
    total,
  }
}

export function clientPageOffset(total, filters) {
  const limit = Math.max(1, Number(filters.limit) || createDefaultConsoleFilters().limit)
  const requestedOffset = Math.max(0, Number(filters.offset) || 0)
  if (!total) return 0
  const maxOffset = Math.floor((total - 1) / limit) * limit
  return Math.min(requestedOffset, maxOffset)
}

export function paginateClientRows(rows, filters) {
  const offset = clientPageOffset(rows.length, filters)
  const limit = Math.max(1, Number(filters.limit) || createDefaultConsoleFilters().limit)
  return rows.slice(offset, offset + limit)
}

export function organizationOptionsForFilter(organizations, selectedOrganizationId) {
  const options = [...organizations]
  if (selectedOrganizationId && !options.some((organization) => organization.id === selectedOrganizationId)) {
    options.unshift({
      id: selectedOrganizationId,
      name: selectedOrganizationId,
      status: 'active',
      isSystem: false,
      createdByUserId: null,
      createdByEmail: null,
      createdByName: null,
      membershipCount: 0,
      activeMembershipCount: 0,
      activeOrganizationAdminCount: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
  }
  return options
}

export function membershipOrganizationOptionsForFilter(memberships, selectedOrganizationId) {
  const optionsById = new Map()
  memberships.forEach((membership) => {
    const id = membership.tenantId ?? membership.organizationId
    if (!id || optionsById.has(id)) return
    optionsById.set(id, {
      id,
      name: membership.tenantName ?? id,
      status: membership.membershipStatus ?? membership.status ?? 'active',
      organizationType: membership.organizationType,
      isSystem: membership.isSystem,
      createdByUserId: null,
      createdByEmail: null,
      createdByName: null,
      membershipCount: 0,
      activeMembershipCount: 0,
      activeOrganizationAdminCount: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: membership.updatedAt ?? new Date(0).toISOString(),
    })
  })
  return organizationOptionsForFilter([...optionsById.values()], selectedOrganizationId)
}

export function summarizeInvitationStatuses(invitations) {
  return invitations.reduce(
    (summary, invitation) => ({
      ...summary,
      [invitation.status]: (summary[invitation.status] ?? 0) + 1,
    }),
    { pending: 0, accepted: 0, revoked: 0, expired: 0 },
  )
}

export function summarizeComplianceQueues(items) {
  return items.reduce(
    (summary, item) => ({
      all: summary.all + 1,
      highRisk: summary.highRisk + (complianceQueueMatches(item, 'high-risk') ? 1 : 0),
      pending: summary.pending + (complianceQueueMatches(item, 'pending') ? 1 : 0),
      warned: summary.warned + (complianceQueueMatches(item, 'warned') ? 1 : 0),
      reviewed: summary.reviewed + (complianceQueueMatches(item, 'reviewed') ? 1 : 0),
      disabled: summary.disabled + (complianceQueueMatches(item, 'disabled') ? 1 : 0),
    }),
    { all: 0, highRisk: 0, pending: 0, warned: 0, reviewed: 0, disabled: 0 },
  )
}

export function complianceQueueCards(summary) {
  return [
    { id: 'all', label: '全部', value: summary.all, icon: FileText },
    { id: 'high-risk', label: '高风险', value: summary.highRisk, icon: ShieldAlert },
    { id: 'pending', label: '待审查', value: summary.pending, icon: Clock },
    { id: 'warned', label: '已警告', value: summary.warned, icon: AlertTriangle },
    { id: 'reviewed', label: '已审查', value: summary.reviewed, icon: ShieldCheck },
    { id: 'disabled', label: '已封号', value: summary.disabled, icon: Power },
  ]
}

export function complianceQueueMatches(item, queue) {
  if (queue === 'all') return true
  if (queue === 'high-risk') {
    return item.riskTags.some((tag) => tag.severity === 'high' || tag.severity === 'critical')
  }
  if (queue === 'pending')
    return item.userStatus === 'active' && (item.reviewStatus ?? 'pending') === 'pending'
  if (queue === 'warned') return (item.reviewStatus ?? 'pending') === 'warned'
  if (queue === 'reviewed') return (item.reviewStatus ?? 'pending') === 'reviewed'
  if (queue === 'disabled') return item.userStatus !== 'active'
  return true
}

export function parseEmailLines(value) {
  const valid = []
  const invalid = []
  const seen = new Set()
  for (const raw of value.split(/[\s,;，；]+/u)) {
    const email = raw.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      valid.push(email)
    } else {
      invalid.push(email)
    }
  }
  return { valid, invalid }
}
