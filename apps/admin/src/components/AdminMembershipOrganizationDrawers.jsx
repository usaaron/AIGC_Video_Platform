import {
  AlertTriangle,
  CreditCard,
  Crown,
  LoaderCircle,
  LogOut,
  MailPlus,
  PencilLine,
  Plus,
  Power,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react'
import { useId } from 'react'
import {
  canAddExistingOrganizationMember,
  canCreateOrganizationUser,
  canDisableOrganization,
  canLeaveOrganization,
  canManageBillingAccount,
  canManageMembership,
  canManageOrganization,
  canReadOrganizationBilling,
  canTransferOrganizationAdmin,
  canUpdateMembershipPlan,
  classifyOrganization,
  formatDate,
  formatSignedAmount,
  ledgerTypeName,
  membershipIdFor,
  planName,
  roleName,
  shortId,
} from '../adminConsole'
import {
  useOverlayControls,
  DrawerSection,
  AuditActivityList,
  IdentityCell,
  StatusBadge,
  PaymentStatusBadge,
  AlertStatusBadge,
  AlertSeverityBadge,
  StatusPair,
  RolePills,
  RoleEditor,
  OrganizationTypeBadge,
  EmptyRow,
} from './AdminUi'
import {
  userAgentSummary,
  organizationIdFromRow,
  rowMatchesUser,
  rowMatchesMembership,
  sortByRecent,
} from './adminDataHelpers'
import { organizationInvitationRoleOptions } from './adminDomain'

export function MembershipDetailDrawer({
  membership,
  billingAccounts,
  ledgerEntries,
  sessions,
  alerts,
  reconciliation,
  auditLogs,
  session,
  canAdjustBilling,
  busy,
  onClose,
  onUpdateRole,
  onDisableMembership,
  onAdjust,
  onUpdatePlan,
}) {
  const membershipId = membershipIdFor(membership)
  const organizationId = organizationIdFromRow(membership)
  const account = billingAccounts.find((item) => membershipIdFor(item) === membershipId) ?? null
  const ledgerRows = sortByRecent(ledgerEntries.filter((entry) => rowMatchesMembership(entry, membershipId)))
  const sessionRows = sortByRecent(sessions.filter((item) => rowMatchesMembership(item, membershipId)))
  const alertRows = sortByRecent(alerts.filter((alert) => rowMatchesMembership(alert, membershipId)))
  const reconciliationRows = sortByRecent(
    reconciliation.filter((item) => rowMatchesMembership(item, membershipId)),
  )
  const auditRows = sortByRecent(
    auditLogs.filter(
      (entry) =>
        rowMatchesMembership(entry, membershipId) ||
        (rowMatchesUser(entry, membership.userId) && organizationIdFromRow(entry) === organizationId),
    ),
  )
  const activeSessions = sessionRows.filter((item) => item.status === 'active').length
  const titleId = useId()
  useOverlayControls(onClose)

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="side-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div>
            <span className="eyebrow">Membership 详情</span>
            <h2 id={titleId}>{membership.name}</h2>
            <p>
              {membership.email ?? membership.userId} · {membershipId}
            </p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭 membership 详情" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="drawer-summary-grid">
          <div>
            <span>组织</span>
            <strong>{membership.tenantName ?? organizationId}</strong>
          </div>
          <div>
            <span>成员状态</span>
            <strong>
              <StatusPair primary={membership.status} secondary={membership.userStatus} />
            </strong>
          </div>
          <div>
            <span>角色</span>
            <strong>{membership.roles.map(roleName).join(' / ')}</strong>
          </div>
          <div>
            <span>套餐</span>
            <strong>{planName(account?.plan ?? membership.plan)}</strong>
          </div>
          <div>
            <span>积分</span>
            <strong
              className={
                (account?.credits ?? membership.credits ?? 0) >= 0 ? 'amount positive' : 'amount negative'
              }
            >
              {account?.credits ?? membership.credits ?? 0}
            </strong>
          </div>
          <div>
            <span>活跃 Session</span>
            <strong>{activeSessions}</strong>
          </div>
          <div>
            <span>是否主组织</span>
            <strong>{membership.isPrimary ? '是' : '否'}</strong>
          </div>
          <div>
            <span>创建时间</span>
            <strong>{formatDate(membership.createdAt)}</strong>
          </div>
          <div>
            <span>更新时间</span>
            <strong>{formatDate(membership.updatedAt)}</strong>
          </div>
        </div>

        <div className="drawer-actions">
          <RoleEditor
            membership={membership}
            session={session}
            busy={busy === `member-role:${membership.id}`}
            onUpdateRole={onUpdateRole}
          />
          <button
            className="row-button"
            type="button"
            disabled={!canAdjustBilling || !canManageBillingAccount(session, membership)}
            onClick={() => onAdjust(membership)}
          >
            <PencilLine size={14} />
            调账
          </button>
          <button
            className="row-button"
            type="button"
            disabled={!canUpdateMembershipPlan(session, membership)}
            onClick={() => onUpdatePlan(membership)}
          >
            <Crown size={14} />
            改套餐/冲会员
          </button>
          <button
            className="row-button danger"
            type="button"
            disabled={
              membership.status !== 'active' ||
              !canManageMembership(session, membership) ||
              busy === `member-disable:${membership.id}`
            }
            onClick={() => onDisableMembership(membership)}
          >
            {busy === `member-disable:${membership.id}` ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Power size={14} />
            )}
            移除 membership
          </button>
        </div>

        <DrawerSection title="用户与组织" count={1}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>组织</th>
                <th>角色</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <IdentityCell
                    name={membership.name}
                    detail={membership.email ?? membership.userId}
                    compact
                  />
                </td>
                <td>
                  <IdentityCell name={membership.tenantName} detail={organizationId} compact />
                </td>
                <td>
                  <RolePills roles={membership.roles} />
                </td>
                <td>
                  <StatusPair primary={membership.status} secondary={membership.userStatus} />
                </td>
              </tr>
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="账单账户" count={account ? 1 : 0}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>套餐</th>
                <th>积分</th>
                <th>状态</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {account && (
                <tr>
                  <td>{planName(account.plan)}</td>
                  <td className={account.credits >= 0 ? 'amount positive' : 'amount negative'}>
                    {account.credits}
                  </td>
                  <td>
                    <StatusPair primary={account.membershipStatus} secondary={account.userStatus} />
                  </td>
                  <td>{formatDate(account.updatedAt)}</td>
                </tr>
              )}
              <EmptyRow visible={!account} columns={4} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="最近账单流水" count={ledgerRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>积分</th>
                <th>余额</th>
                <th>说明</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.slice(0, 10).map((entry) => (
                <tr key={entry.id}>
                  <td>{ledgerTypeName(entry.type)}</td>
                  <td className={entry.amount >= 0 ? 'amount positive' : 'amount negative'}>
                    {formatSignedAmount(entry.amount)}
                  </td>
                  <td>{entry.balance ?? '-'}</td>
                  <td>{entry.description ?? shortId(entry.referenceId)}</td>
                  <td>{formatDate(entry.createdAt)}</td>
                </tr>
              ))}
              <EmptyRow visible={!ledgerRows.length} columns={5} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="Session 设备" count={sessionRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>设备</th>
                <th>IP</th>
                <th>状态</th>
                <th>最近活跃</th>
                <th>过期时间</th>
              </tr>
            </thead>
            <tbody>
              {sessionRows.slice(0, 10).map((item) => (
                <tr key={item.sessionId}>
                  <td>{item.deviceLabel ?? userAgentSummary(item.userAgent)}</td>
                  <td>{item.ipAddress ?? '-'}</td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td>{formatDate(item.lastSeenAt ?? item.createdAt)}</td>
                  <td>{formatDate(item.expiresAt)}</td>
                </tr>
              ))}
              <EmptyRow visible={!sessionRows.length} columns={5} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="对账告警" count={alertRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>严重性</th>
                <th>状态</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {alertRows.slice(0, 8).map((alert) => (
                <tr key={alert.id}>
                  <td>{alert.alertType}</td>
                  <td>
                    <AlertSeverityBadge severity={alert.severity} />
                  </td>
                  <td>
                    <AlertStatusBadge status={alert.status} />
                  </td>
                  <td>{formatDate(alert.createdAt ?? alert.updatedAt)}</td>
                </tr>
              ))}
              <EmptyRow visible={!alertRows.length} columns={4} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="最近支付对账" count={reconciliationRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>事件</th>
                <th>状态</th>
                <th>积分</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {reconciliationRows.slice(0, 8).map((item) => (
                <tr key={item.id}>
                  <td>{item.eventType}</td>
                  <td>
                    <PaymentStatusBadge status={item.status} />
                  </td>
                  <td className={(item.amount ?? 0) >= 0 ? 'amount positive' : 'amount negative'}>
                    {item.amount === null ? '-' : formatSignedAmount(item.amount)}
                  </td>
                  <td>{formatDate(item.createdAt)}</td>
                </tr>
              ))}
              <EmptyRow visible={!reconciliationRows.length} columns={4} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="最近操作 / 审计" count={auditRows.length}>
          <AuditActivityList entries={auditRows} />
        </DrawerSection>
      </aside>
    </div>
  )
}

export function OrganizationDetailDrawer({
  organization,
  memberships,
  billingAccounts,
  sessions,
  alerts,
  reconciliation,
  auditLogs,
  session,
  busy,
  onClose,
  onRename,
  onDisable,
  onTransferOrganizationAdmin,
  onCreateUser,
  onAddExistingMember,
  onCreateInvitation,
  onManageInvitations,
  onLeaveOrganization,
  onOpenOrganizationBilling,
  onOpenAlertPage,
}) {
  const organizationType = classifyOrganization(organization)
  const organizationId = organization.id
  const memberRows = memberships.filter((membership) => organizationIdFromRow(membership) === organizationId)
  const billingRows = billingAccounts.filter((account) => organizationIdFromRow(account) === organizationId)
  const sessionRows = sessions.filter((item) => organizationIdFromRow(item) === organizationId)
  const alertRows = alerts.filter((item) => organizationIdFromRow(item) === organizationId)
  const reconciliationRows = reconciliation.filter((item) => organizationIdFromRow(item) === organizationId)
  const auditRows = auditLogs.filter((item) => organizationIdFromRow(item) === organizationId)
  const canCreate = organization.status === 'active' && canCreateOrganizationUser(session, organization)
  const canManage = canManageOrganization(session, organization)
  const canTransfer = canTransferOrganizationAdmin(session, organization)
  const canDisableTarget = canDisableOrganization(session, organization)
  const canAddExisting = canAddExistingOrganizationMember(session, organization)
  const invitationRoles = organizationInvitationRoleOptions(session, organization)
  const canInviteOrganizationMember =
    organization.status === 'active' && invitationRoles.includes('organization_member')
  const canInviteOrganizationAdmin =
    organization.status === 'active' && invitationRoles.includes('organization_admin')
  const canLeaveTarget = canLeaveOrganization(session, organization, memberRows)
  const canReadBillingPool = canReadOrganizationBilling(session, organization)
  const titleId = useId()
  useOverlayControls(onClose)

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="side-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div>
            <span className="eyebrow">组织详情</span>
            <h2 id={titleId}>{organization.name}</h2>
            <p>{organization.id}</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭组织详情" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="drawer-summary-grid">
          <div>
            <span>类型</span>
            <strong>
              <OrganizationTypeBadge organizationType={organizationType} />
            </strong>
          </div>
          <div>
            <span>状态</span>
            <strong>
              <StatusBadge status={organization.status} />
            </strong>
          </div>
          <div>
            <span>成员</span>
            <strong>
              {organization.activeMembershipCount} / {organization.membershipCount}
            </strong>
          </div>
          <div>
            <span>组织管理员</span>
            <strong>{organization.activeOrganizationAdminCount}</strong>
          </div>
          <div>
            <span>创建者</span>
            <strong>{organization.createdByEmail ?? organization.createdByName ?? '-'}</strong>
          </div>
          <div>
            <span>更新时间</span>
            <strong>{formatDate(organization.updatedAt)}</strong>
          </div>
        </div>

        <div className="drawer-actions">
          <button
            className="row-button"
            type="button"
            disabled={!canManage}
            onClick={() => onRename(organization)}
          >
            <PencilLine size={14} />
            改名
          </button>
          <button
            className="row-button"
            type="button"
            disabled={!canCreate}
            onClick={() => onCreateUser(organization.id)}
          >
            <Plus size={14} />
            直接创建组织账号
          </button>
          <button
            className="row-button"
            type="button"
            disabled={!canAddExisting || busy === 'add-existing-member'}
            onClick={() => onAddExistingMember(organization.id)}
          >
            {busy === 'add-existing-member' ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <UserPlus size={14} />
            )}
            加入已有账号
          </button>
          <button
            className="row-button"
            type="button"
            disabled={!canInviteOrganizationMember}
            onClick={() => onCreateInvitation(organization.id, 'organization_member')}
          >
            <MailPlus size={14} />
            邀请组织成员
          </button>
          <button
            className="row-button"
            type="button"
            disabled={!canInviteOrganizationAdmin}
            onClick={() => onCreateInvitation(organization.id, 'organization_admin')}
          >
            <Crown size={14} />
            邀请组织管理员
          </button>
          <button
            className="row-button"
            type="button"
            disabled={!canManage}
            onClick={() => onManageInvitations(organization)}
          >
            <MailPlus size={14} />
            邀请管理
          </button>
          <button
            className="row-button"
            type="button"
            disabled={!canReadBillingPool}
            onClick={() => onOpenOrganizationBilling(organization)}
          >
            <CreditCard size={14} />
            组织共享池
          </button>
          <button
            className="row-button"
            type="button"
            disabled={!canTransfer || organization.activeOrganizationAdminCount < 1}
            onClick={() => onTransferOrganizationAdmin(organization)}
          >
            <ShieldCheck size={14} />
            更换负责人
          </button>
          <button
            className="row-button danger"
            type="button"
            disabled={!canDisableTarget}
            onClick={() => onDisable(organization)}
          >
            <Power size={14} />
            禁用组织
          </button>
          <button
            className="row-button danger"
            type="button"
            disabled={!canLeaveTarget || busy === `organization-leave:${organization.id}`}
            onClick={() => onLeaveOrganization(organization)}
          >
            {busy === `organization-leave:${organization.id}` ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <LogOut size={14} />
            )}
            退出组织
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              onOpenAlertPage()
              onClose()
            }}
          >
            <AlertTriangle size={14} />
            查看对账告警
          </button>
        </div>

        <DrawerSection title="成员" count={memberRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>角色</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {memberRows.map((membership) => (
                <tr key={membership.id}>
                  <td>
                    <IdentityCell
                      name={membership.name}
                      detail={membership.email ?? membership.userId}
                      compact
                    />
                  </td>
                  <td>
                    <RolePills roles={membership.roles} />
                  </td>
                  <td>
                    <StatusPair primary={membership.status} secondary={membership.userStatus} />
                  </td>
                </tr>
              ))}
              <EmptyRow visible={!memberRows.length} columns={3} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="账单账户" count={billingRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>套餐</th>
                <th>积分</th>
              </tr>
            </thead>
            <tbody>
              {billingRows.map((account) => (
                <tr key={account.membershipId}>
                  <td>
                    <IdentityCell name={account.name} detail={account.email ?? account.userId} compact />
                  </td>
                  <td>{planName(account.plan)}</td>
                  <td className={account.credits >= 0 ? 'amount positive' : 'amount negative'}>
                    {account.credits}
                  </td>
                </tr>
              ))}
              <EmptyRow visible={!billingRows.length} columns={3} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="Session" count={sessionRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>设备</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {sessionRows.slice(0, 8).map((item) => (
                <tr key={item.sessionId}>
                  <td>
                    <IdentityCell name={item.name} detail={item.email ?? item.userId} compact />
                  </td>
                  <td>{item.deviceLabel ?? userAgentSummary(item.userAgent)}</td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                </tr>
              ))}
              <EmptyRow visible={!sessionRows.length} columns={3} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="告警" count={alertRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>严重性</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {alertRows.slice(0, 8).map((alert) => (
                <tr key={alert.id}>
                  <td>
                    <div className="stacked-cell">
                      <strong>{alert.alertType}</strong>
                      <small>{shortId(alert.providerEventId)}</small>
                    </div>
                  </td>
                  <td>
                    <AlertSeverityBadge severity={alert.severity} />
                  </td>
                  <td>
                    <AlertStatusBadge status={alert.status} />
                  </td>
                </tr>
              ))}
              <EmptyRow visible={!alertRows.length} columns={3} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="最近对账" count={reconciliationRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>事件</th>
                <th>状态</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {reconciliationRows.slice(0, 8).map((item) => (
                <tr key={item.id}>
                  <td>{item.eventType}</td>
                  <td>
                    <PaymentStatusBadge status={item.status} />
                  </td>
                  <td>{formatDate(item.createdAt)}</td>
                </tr>
              ))}
              <EmptyRow visible={!reconciliationRows.length} columns={3} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="审计" count={auditRows.length}>
          <div className="drawer-activity-list">
            {auditRows.slice(0, 6).map((entry) => (
              <article key={entry.id} className="drawer-activity">
                <div>
                  <strong>{entry.action}</strong>
                  <small>
                    {entry.resourceType} · {shortId(entry.resourceId)}
                  </small>
                </div>
                <span>{formatDate(entry.createdAt)}</span>
              </article>
            ))}
            {!auditRows.length && <p className="panel-empty">暂无审计记录。</p>}
          </div>
        </DrawerSection>
      </aside>
    </div>
  )
}
