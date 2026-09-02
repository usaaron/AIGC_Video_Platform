import {
  AlertTriangle,
  Check,
  FileText,
  KeyRound,
  LoaderCircle,
  Power,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useId } from 'react'
import {
  formatDate,
  formatSignedAmount,
  ledgerTypeName,
  membershipIdFor,
  planName,
  roleName,
  shortId,
} from '../adminConsole'
import {
  complianceCategoryLabels,
  disabledButtonProps,
  useOverlayControls,
  DrawerSection,
  AuditActivityList,
  IdentityCell,
  ComplianceRiskTags,
  ComplianceRuleEngineExplanation,
  ComplianceReviewBadge,
  complianceReviewActionName,
  StatusBadge,
  PaymentStatusBadge,
  AlertStatusBadge,
  AlertSeverityBadge,
  complianceSourceName,
  PasswordResetBadge,
  StatusPair,
  RolePills,
  EmptyRow,
} from './AdminUi'
import {
  userAgentSummary,
  organizationNameFor,
  organizationIdFromRow,
  rowMatchesUser,
  rowMatchesAnyMembership,
  sortByRecent,
} from './adminDataHelpers'

export function CompliancePromptDetailDrawer({
  item,
  busy,
  currentUserId,
  onClose,
  onReview,
  onWarn,
  onDisableUser,
}) {
  const actionBusy = busy.startsWith(`compliance:${item.id}`)
  const accountBusy = busy === `user:${item.userId}`
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
            <span className="eyebrow">Compliance Review</span>
            <h2 id={titleId}>提示词审查详情</h2>
            <p>
              {complianceSourceName(item.source)} · {item.sourceId}
            </p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="drawer-summary-grid">
          <div>
            <span>账号</span>
            <strong>{item.email ?? item.userId}</strong>
          </div>
          <div>
            <span>归属</span>
            <strong>{item.organizationName ?? item.organizationId}</strong>
          </div>
          <div>
            <span>风险</span>
            <strong>{item.riskTags.length ? `命中 ${item.riskTags.length} 类` : '未命中'}</strong>
          </div>
          <div>
            <span>状态</span>
            <strong>{item.userStatus}</strong>
          </div>
          <div>
            <span>审查状态</span>
            <strong>
              <ComplianceReviewBadge item={item} />
            </strong>
          </div>
        </div>

        <div className="drawer-actions">
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(actionBusy, '正在记录审查动作')}
            onClick={() => onReview(item)}
          >
            {actionBusy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
            标记已审查
          </button>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(actionBusy, '正在记录审查动作')}
            onClick={() => onWarn(item)}
          >
            <AlertTriangle size={14} />
            发送警告
          </button>
          <button
            className="row-button danger"
            type="button"
            {...disabledButtonProps(
              item.userStatus !== 'active' || item.userId === currentUserId || accountBusy,
              item.userStatus !== 'active'
                ? '账号已禁用'
                : item.userId === currentUserId
                  ? '不能封禁当前登录账号'
                  : '正在更新账号状态',
            )}
            onClick={() => onDisableUser(item)}
          >
            {accountBusy ? <LoaderCircle size={14} className="spin" /> : <Power size={14} />}
            禁用账号
          </button>
        </div>

        <DrawerSection title="风险标签" count={item.riskTags.length}>
          <ComplianceRiskTags tags={item.riskTags} expanded />
        </DrawerSection>

        <DrawerSection
          title="规则引擎解释"
          count={(item.riskPolicyMatches?.length ?? 0) + (item.suppressedRiskTags?.length ?? 0)}
        >
          <ComplianceRuleEngineExplanation item={item} />
        </DrawerSection>

        <DrawerSection title="审查动作历史" count={item.reviewActions?.length ?? 0}>
          <div className="compliance-review-history">
            {(item.reviewActions ?? []).map((action) => (
              <article key={`${action.action}:${action.createdAt}`}>
                <strong>{complianceReviewActionName(action.action)}</strong>
                <span>{formatDate(action.createdAt)}</span>
                <p>{action.reason ?? '-'}</p>
                <small>
                  {action.category ? complianceCategoryLabels[action.category] : '未指定类别'} ·{' '}
                  {action.actorUserId ? shortId(action.actorUserId) : '未知处理人'}
                </small>
              </article>
            ))}
            {!(item.reviewActions ?? []).length && <p className="panel-empty compact">暂无人工处理动作。</p>}
          </div>
        </DrawerSection>

        <DrawerSection title="提示词输入" count={item.promptText ? 1 : 0}>
          <pre className="prompt-text-block">{item.promptText || '-'}</pre>
        </DrawerSection>

        <DrawerSection title="任务信息" count={5}>
          <div className="key-value-grid">
            <span>来源</span>
            <strong>{complianceSourceName(item.source)}</strong>
            <span>类型</span>
            <strong>{item.kind}</strong>
            <span>Provider</span>
            <strong>{item.provider}</strong>
            <span>创建时间</span>
            <strong>{formatDate(item.createdAt)}</strong>
            <span>Input keys</span>
            <strong>{item.inputKeys.length ? item.inputKeys.join('、') : '-'}</strong>
          </div>
        </DrawerSection>
      </aside>
    </div>
  )
}

export function UserDetailDrawer({
  user,
  organizations,
  memberships,
  billingAccounts,
  ledgerEntries,
  sessions,
  alerts,
  reconciliation,
  auditLogs,
  currentUserId,
  canManage,
  busy,
  onClose,
  onSetStatus,
  onDeleteUser,
  onOpenPasswordReset,
  onForcePasswordReset,
  onOpenMembership,
}) {
  const userMemberships = sortByRecent(memberships.filter((membership) => membership.userId === user.id))
  const userMembershipIds = new Set(userMemberships.map(membershipIdFor))
  const userBillingRows = sortByRecent(
    billingAccounts.filter(
      (account) => account.userId === user.id || userMembershipIds.has(membershipIdFor(account)),
    ),
  )
  const userLedgerRows = sortByRecent(
    ledgerEntries.filter(
      (entry) => rowMatchesUser(entry, user.id) || rowMatchesAnyMembership(entry, userMembershipIds),
    ),
  )
  const userSessionRows = sortByRecent(sessions.filter((item) => item.userId === user.id))
  const userAlertRows = sortByRecent(
    alerts.filter(
      (alert) => rowMatchesUser(alert, user.id) || rowMatchesAnyMembership(alert, userMembershipIds),
    ),
  )
  const userReconciliationRows = sortByRecent(
    reconciliation.filter(
      (item) => rowMatchesUser(item, user.id) || rowMatchesAnyMembership(item, userMembershipIds),
    ),
  )
  const userAuditRows = sortByRecent(
    auditLogs.filter(
      (entry) => rowMatchesUser(entry, user.id) || rowMatchesAnyMembership(entry, userMembershipIds),
    ),
  )
  const titleId = useId()
  useOverlayControls(onClose)
  const activeSessions = userSessionRows.filter((item) => item.status === 'active').length
  const totalCredits = userBillingRows.reduce((total, account) => total + Number(account.credits ?? 0), 0)
  const openAlerts = userAlertRows.filter((alert) => alert.status !== 'resolved').length
  const canEditUser = canManage && user.id !== currentUserId
  const deleted = user.status === 'deleted'

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
            <span className="eyebrow">用户详情</span>
            <h2 id={titleId}>{user.name}</h2>
            <p>{user.email ?? user.id}</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭用户详情" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="drawer-summary-grid">
          <div>
            <span>账号状态</span>
            <strong>
              <StatusBadge status={user.status} />
            </strong>
          </div>
          <div>
            <span>安全状态</span>
            <strong>
              <PasswordResetBadge required={user.passwordResetRequired} />
            </strong>
          </div>
          <div>
            <span>平台身份</span>
            <strong>{user.roles.map(roleName).join(' / ')}</strong>
          </div>
          <div>
            <span>组织关系</span>
            <strong>
              {user.activeMembershipCount} / {user.membershipCount}
            </strong>
          </div>
          <div>
            <span>账单积分</span>
            <strong className={totalCredits >= 0 ? 'amount positive' : 'amount negative'}>
              {formatSignedAmount(totalCredits)}
            </strong>
          </div>
          <div>
            <span>活跃 Session</span>
            <strong>{activeSessions}</strong>
          </div>
          <div>
            <span>未解决告警</span>
            <strong>{openAlerts}</strong>
          </div>
          <div>
            <span>创建时间</span>
            <strong>{formatDate(user.createdAt)}</strong>
          </div>
          <div>
            <span>更新时间</span>
            <strong>{formatDate(user.updatedAt)}</strong>
          </div>
        </div>

        <div className="drawer-actions">
          <button
            className="row-button"
            type="button"
            disabled={!canEditUser || deleted || busy === `password:${user.id}`}
            onClick={() => onOpenPasswordReset(user)}
          >
            {busy === `password:${user.id}` ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <KeyRound size={14} />
            )}
            临时密码
          </button>
          <button
            className="row-button danger"
            type="button"
            disabled={
              !canEditUser || deleted || user.passwordResetRequired || busy === `force-password:${user.id}`
            }
            onClick={() => onForcePasswordReset(user)}
          >
            {busy === `force-password:${user.id}` ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <ShieldCheck size={14} />
            )}
            强制改密
          </button>
          <button
            className={user.status === 'active' ? 'row-button danger' : 'row-button'}
            type="button"
            disabled={!canEditUser || deleted || busy === `user:${user.id}`}
            onClick={() => onSetStatus(user)}
          >
            {busy === `user:${user.id}` ? <LoaderCircle size={14} className="spin" /> : <Power size={14} />}
            {deleted ? '已删除' : user.status === 'active' ? '禁用账号' : '启用账号'}
          </button>
          <button
            className="row-button danger"
            type="button"
            disabled={!canEditUser || deleted || busy === `delete-user:${user.id}`}
            onClick={() => onDeleteUser(user)}
          >
            {busy === `delete-user:${user.id}` ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Trash2 size={14} />
            )}
            删除账号
          </button>
        </div>

        <DrawerSection title="所属组织" count={userMemberships.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>组织</th>
                <th>角色</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {userMemberships.map((membership) => (
                <tr key={membership.id}>
                  <td>
                    <IdentityCell
                      name={organizationNameFor(organizations, organizationIdFromRow(membership))}
                      detail={organizationIdFromRow(membership)}
                      compact
                    />
                  </td>
                  <td>
                    <RolePills roles={membership.roles} />
                  </td>
                  <td>
                    <StatusPair primary={membership.status} secondary={membership.userStatus} />
                  </td>
                  <td>
                    <button className="row-button" type="button" onClick={() => onOpenMembership(membership)}>
                      <FileText size={14} />
                      详情
                    </button>
                  </td>
                </tr>
              ))}
              <EmptyRow visible={!userMemberships.length} columns={4} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="账单账户" count={userBillingRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>组织</th>
                <th>套餐</th>
                <th>积分</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {userBillingRows.map((account) => (
                <tr key={membershipIdFor(account)}>
                  <td>{organizationNameFor(organizations, organizationIdFromRow(account))}</td>
                  <td>{planName(account.plan)}</td>
                  <td className={account.credits >= 0 ? 'amount positive' : 'amount negative'}>
                    {account.credits}
                  </td>
                  <td>{formatDate(account.updatedAt)}</td>
                </tr>
              ))}
              <EmptyRow visible={!userBillingRows.length} columns={4} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="最近账单流水" count={userLedgerRows.length}>
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
              {userLedgerRows.slice(0, 10).map((entry) => (
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
              <EmptyRow visible={!userLedgerRows.length} columns={5} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="Session 设备" count={userSessionRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>组织</th>
                <th>设备</th>
                <th>IP</th>
                <th>状态</th>
                <th>最近活跃</th>
              </tr>
            </thead>
            <tbody>
              {userSessionRows.slice(0, 10).map((item) => (
                <tr key={item.sessionId}>
                  <td>{organizationNameFor(organizations, organizationIdFromRow(item))}</td>
                  <td>{item.deviceLabel ?? userAgentSummary(item.userAgent)}</td>
                  <td>{item.ipAddress ?? '-'}</td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td>{formatDate(item.lastSeenAt ?? item.createdAt)}</td>
                </tr>
              ))}
              <EmptyRow visible={!userSessionRows.length} columns={5} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="对账告警" count={userAlertRows.length}>
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
              {userAlertRows.slice(0, 8).map((alert) => (
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
              <EmptyRow visible={!userAlertRows.length} columns={4} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="最近支付对账" count={userReconciliationRows.length}>
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
              {userReconciliationRows.slice(0, 8).map((item) => (
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
              <EmptyRow visible={!userReconciliationRows.length} columns={4} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="最近操作 / 审计" count={userAuditRows.length}>
          <AuditActivityList entries={userAuditRows} />
        </DrawerSection>
      </aside>
    </div>
  )
}
