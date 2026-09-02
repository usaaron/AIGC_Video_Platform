import { Clock, Globe, Monitor } from 'lucide-react'
import {
  formatDate,
  formatSignedAmount,
  ledgerTypeName,
  membershipIdFor,
  planName,
  riskLevelName,
} from '../adminConsole'
import { paymentStatusName, reconciliationAlertStatusName } from './AdminUi'

export function MetricBlock({ icon: Icon, label, value, tone = '' }) {
  return (
    <div className={tone ? `metric-block ${tone}` : 'metric-block'}>
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function userAgentSummary(userAgent) {
  if (!userAgent) return '-'
  if (userAgent.includes('Chrome')) return 'Chrome'
  if (userAgent.includes('Firefox')) return 'Firefox'
  if (userAgent.includes('Safari')) return 'Safari'
  return userAgent.slice(0, 34)
}

export function RiskBadge({ level }) {
  return <span className={`risk-badge ${level}`}>{riskLevelName(level)}</span>
}

export function ReasonPills({ reasons }) {
  return (
    <div className="reason-pills">
      {reasons.map((reason) => (
        <span key={reason}>{reason}</span>
      ))}
    </div>
  )
}

export function DeviceCell({ session }) {
  return (
    <div className="device-cell">
      <span>
        <Monitor size={13} />
        {session.deviceLabel ?? userAgentSummary(session.userAgent)}
      </span>
      <span>
        <Globe size={13} />
        {session.ipAddress ?? '-'}
      </span>
      <span>
        <Clock size={13} />
        {formatDate(session.lastSeenAt ?? session.createdAt)}
      </span>
    </div>
  )
}

export function formatInactiveHours(hours) {
  if (hours < 1) return '1 小时内'
  if (hours < 24) return `${Math.floor(hours)} 小时`
  return `${Math.floor(hours / 24)} 天`
}

export function uniqueValues(rows, field) {
  return Array.from(new Set(rows.map((row) => row[field]).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )
}

export function prettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2)
}

export function auditRelatedReferences(entry) {
  const metadata = objectMetadata(entry)
  const references = {
    users: [],
    organizations: [],
    memberships: [],
    sessions: [],
    billingAccounts: [],
    ledgerEntries: [],
    reconciliationItems: [],
    reconciliationAlerts: [],
  }

  addAuditReference(references.users, '操作者', entry.actorUserId)
  addAuditReference(references.users, '受影响用户', entry.userId)
  addAuditReference(references.organizations, '组织', entry.organizationId ?? entry.tenantId)

  if (entry.resourceType === 'user') addAuditReference(references.users, '资源用户', entry.resourceId)
  if (entry.resourceType === 'tenant')
    addAuditReference(references.organizations, '资源组织', entry.resourceId)
  if (entry.resourceType === 'tenant_membership' || entry.resourceType === 'membership') {
    addAuditReference(references.memberships, '资源 membership', entry.resourceId)
  }
  if (entry.resourceType === 'session')
    addAuditReference(references.sessions, '资源 session', entry.resourceId)
  if (entry.resourceType === 'billing_account')
    addAuditReference(references.billingAccounts, '资源账单账户', entry.resourceId)
  if (entry.resourceType === 'billing_ledger_entry') {
    addAuditReference(references.ledgerEntries, '资源账单流水', entry.resourceId)
  }
  if (entry.resourceType === 'billing_reconciliation_alert') {
    addAuditReference(references.reconciliationAlerts, '资源对账告警', entry.resourceId)
  }

  addAuditMetadataReferences(references.users, metadata, {
    userId: 'metadata.userId',
    actorUserId: 'metadata.actorUserId',
    createdByUserId: 'metadata.createdByUserId',
    invitedByUserId: 'metadata.invitedByUserId',
    targetUserId: 'metadata.targetUserId',
    currentOrganizationAdminUserId: 'metadata.currentOrganizationAdminUserId',
  })
  addAuditMetadataReferences(references.organizations, metadata, {
    tenantId: 'metadata.tenantId',
    organizationId: 'metadata.organizationId',
    targetTenantId: 'metadata.targetTenantId',
    targetOrganizationId: 'metadata.targetOrganizationId',
  })
  addAuditMetadataReferences(references.memberships, metadata, {
    membershipId: 'metadata.membershipId',
    targetMembershipId: 'metadata.targetMembershipId',
  })
  addAuditMetadataReferences(references.sessions, metadata, {
    sessionId: 'metadata.sessionId',
    targetSessionId: 'metadata.targetSessionId',
  })
  addAuditMetadataReferences(references.billingAccounts, metadata, {
    billingAccountId: 'metadata.billingAccountId',
  })
  addAuditMetadataReferences(references.ledgerEntries, metadata, {
    ledgerEntryId: 'metadata.ledgerEntryId',
    relatedEntryId: 'metadata.relatedEntryId',
  })
  addAuditMetadataReferences(references.reconciliationItems, metadata, {
    reconciliationItemId: 'metadata.reconciliationItemId',
    paymentReconciliationItemId: 'metadata.paymentReconciliationItemId',
    paymentSessionId: 'metadata.paymentSessionId',
  })
  addAuditMetadataReferences(references.reconciliationAlerts, metadata, {
    alertId: 'metadata.alertId',
    reconciliationAlertId: 'metadata.reconciliationAlertId',
  })

  for (const reference of references.memberships) {
    addAuditReference(references.billingAccounts, `账单账户：${reference.label}`, reference.id)
  }

  return references
}

export function addAuditMetadataReferences(target, metadata, keyLabels) {
  for (const [key, label] of Object.entries(keyLabels)) {
    addAuditReference(target, label, metadata[key])
  }
}

export function addAuditReference(target, label, value) {
  if (typeof value !== 'string') return
  const id = value.trim()
  if (!id || target.some((item) => item.id === id && item.label === label)) return
  target.push({ label, id })
}

export function referenceCount(references) {
  return Object.values(references).reduce((total, items) => total + items.length, 0)
}

export function auditBillingReferenceItems({
  references,
  billingAccounts,
  ledgerEntries,
  reconciliation,
  alerts,
  onOpenBilling,
}) {
  const items = []

  for (const reference of references.billingAccounts) {
    const account = billingAccounts.find((item) => membershipIdFor(item) === reference.id)
    items.push({
      ...reference,
      label: reference.label,
      title: account?.name ?? reference.id,
      detail: account
        ? `${account.tenantName} · ${planName(account.plan)} · ${account.credits} 积分`
        : '当前快照未加载，点击后搜索',
      actionLabel: account ? '打开' : '搜索',
      onOpen: () => onOpenBilling(reference.id),
    })
  }

  for (const reference of references.ledgerEntries) {
    const entry = ledgerEntries.find((item) => item.id === reference.id || item.referenceId === reference.id)
    items.push({
      ...reference,
      title: entry ? `${ledgerTypeName(entry.type)} ${formatSignedAmount(entry.amount)}` : reference.id,
      detail: entry
        ? `${entry.description ?? entry.referenceId} · ${formatDate(entry.createdAt)}`
        : '当前快照未加载，点击后搜索',
      actionLabel: entry ? '打开' : '搜索',
      onOpen: () => onOpenBilling(reference.id),
    })
  }

  for (const reference of references.reconciliationItems) {
    const item = reconciliation.find(
      (candidate) =>
        candidate.id === reference.id ||
        candidate.providerEventId === reference.id ||
        candidate.paymentSessionId === reference.id,
    )
    items.push({
      ...reference,
      title: item ? item.eventType : reference.id,
      detail: item ? `${paymentStatusName(item.status)} · ${item.message}` : '当前快照未加载，点击后搜索',
      actionLabel: item ? '打开' : '搜索',
      onOpen: () => onOpenBilling(reference.id),
    })
  }

  for (const reference of references.reconciliationAlerts) {
    const alert = alerts.find(
      (candidate) => candidate.id === reference.id || candidate.providerEventId === reference.id,
    )
    items.push({
      ...reference,
      title: alert ? alert.alertType : reference.id,
      detail: alert
        ? `${reconciliationAlertStatusName(alert.status)} · ${alert.message}`
        : '当前快照未加载，点击后搜索',
      actionLabel: alert ? '打开' : '搜索',
      onOpen: () => onOpenBilling(reference.id),
    })
  }

  return items
}

export function organizationAdminTransferCandidates(memberships, tenantId) {
  return memberships.filter(
    (membership) =>
      membership.tenantId === tenantId &&
      membership.status === 'active' &&
      membership.userStatus === 'active' &&
      membership.roles.includes('organization_member'),
  )
}

export function organizationNameFor(organizations, organizationId) {
  if (!organizationId) return '-'
  return organizations.find((organization) => organization.id === organizationId)?.name ?? organizationId
}

export function organizationIdFromRow(row) {
  return row?.organizationId ?? row?.tenantId ?? ''
}

export function objectMetadata(row) {
  return row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}
}

export function rowMatchesUser(row, userId) {
  if (!userId) return false
  const metadata = objectMetadata(row)
  return [
    row?.userId,
    row?.actorUserId,
    row?.createdByUserId,
    metadata.userId,
    metadata.actorUserId,
    metadata.createdByUserId,
    metadata.targetUserId,
    row?.resourceType === 'user' ? row?.resourceId : '',
  ].includes(userId)
}

export function rowMatchesMembership(row, membershipId) {
  if (!membershipId) return false
  const metadata = objectMetadata(row)
  return [
    row?.membershipId,
    row?.targetMembershipId,
    metadata.membershipId,
    metadata.targetMembershipId,
    row?.resourceType === 'membership' ? row?.resourceId : '',
  ].includes(membershipId)
}

export function rowMatchesAnyMembership(row, membershipIds) {
  if (!membershipIds.size) return false
  const metadata = objectMetadata(row)
  return [
    row?.membershipId,
    row?.targetMembershipId,
    metadata.membershipId,
    metadata.targetMembershipId,
    row?.resourceType === 'membership' ? row?.resourceId : '',
  ].some((id) => id && membershipIds.has(id))
}

export function sortByRecent(rows) {
  return [...rows].sort((left, right) => recentTime(right) - recentTime(left))
}

export function recentTime(row) {
  const value = row?.lastSeenAt ?? row?.updatedAt ?? row?.createdAt ?? row?.expiresAt
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

export function summarizeReconciliationAlerts(alerts) {
  return alerts.reduce(
    (summary, alert) => {
      summary.total += 1
      summary[alert.status] = (summary[alert.status] ?? 0) + 1
      if (alert.severity === 'critical') summary.critical += 1
      return summary
    },
    { total: 0, open: 0, acknowledged: 0, resolved: 0, critical: 0 },
  )
}
