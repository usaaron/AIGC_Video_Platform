import {
  AlertTriangle,
  CreditCard,
  Filter,
  FileText,
  KeyRound,
  LoaderCircle,
  LogOut,
  Monitor,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { useId } from 'react'
import {
  auditLogTone,
  buildSessionRiskRows,
  classifyOrganization,
  formatDate,
  membershipIdFor,
  roleName,
  shortId,
  summarizeAuditLogs,
  summarizeSessionRisks,
  organizationTypeName,
} from '../adminConsole'
import {
  tooltipProps,
  disabledButtonProps,
  useOverlayControls,
  compactJson,
  DataSection,
  DrawerSection,
  IdentityCell,
  StatusBadge,
  EmptyRow,
} from './AdminUi'
import {
  MetricBlock,
  userAgentSummary,
  RiskBadge,
  ReasonPills,
  DeviceCell,
  formatInactiveHours,
  uniqueValues,
  prettyJson,
  auditRelatedReferences,
  referenceCount,
  auditBillingReferenceItems,
  organizationIdFromRow,
  objectMetadata,
  sortByRecent,
} from './adminDataHelpers'
import { RowMoreMenu } from './AdminConsoleControls'

export function SessionsTable({ sessions, canManage, busy, onRevoke }) {
  return (
    <DataSection title="Session 设备信息" count={sessions.length}>
      <table className="data-table wide">
        <thead>
          <tr>
            <th>用户</th>
            <th>组织</th>
            <th>状态</th>
            <th>设备</th>
            <th>IP</th>
            <th>最近活跃</th>
            <th>过期时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.sessionId}>
              <td>
                <IdentityCell name={session.name} detail={session.email ?? session.userId} />
              </td>
              <td>{session.tenantName}</td>
              <td>
                <StatusBadge status={session.status} />
              </td>
              <td>{session.deviceLabel ?? userAgentSummary(session.userAgent)}</td>
              <td>{session.ipAddress ?? '-'}</td>
              <td>{formatDate(session.lastSeenAt ?? session.createdAt)}</td>
              <td>{formatDate(session.expiresAt)}</td>
              <td>
                <div className="row-actions">
                  <RowMoreMenu title="打开更多 Session 操作">
                    <button
                      className="row-button danger"
                      type="button"
                      {...disabledButtonProps(
                        !canManage ||
                          session.current ||
                          session.status !== 'active' ||
                          busy === `session:${session.sessionId}`,
                        session.current
                          ? '不能撤销当前登录 Session'
                          : session.status !== 'active'
                            ? '该 Session 不是启用状态'
                            : busy === `session:${session.sessionId}`
                              ? '正在撤销 Session'
                              : '不能撤销该 Session',
                        '撤销该会话',
                      )}
                      onClick={() => onRevoke(session)}
                    >
                      {busy === `session:${session.sessionId}` ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <LogOut size={14} />
                      )}
                      {session.current ? '当前' : '撤销'}
                    </button>
                  </RowMoreMenu>
                </div>
              </td>
            </tr>
          ))}
          <EmptyRow visible={!sessions.length} columns={8} />
        </tbody>
      </table>
    </DataSection>
  )
}

export function SessionRiskDetailDrawer({
  session,
  sessions,
  auditLogs,
  auditLoading,
  auditError,
  canManage,
  busy,
  currentUserId,
  onClose,
  onRevoke,
  onRevokeUserSessions,
  onForcePasswordReset,
}) {
  const userSessions = sortByRecent(sessions.filter((item) => item.userId === session.userId))
  const riskRows = buildSessionRiskRows(userSessions)
  const activeCount = session.activeCount ?? userSessions.filter((item) => item.status === 'active').length
  const targetIsCurrentUser = session.userId === currentUserId
  const canManageTargetUser = canManage && !targetIsCurrentUser
  const revokeSessionBusy = busy === `session:${session.sessionId}`
  const revokeUserBusy = busy === `user-sessions:${session.userId}`
  const forcePasswordBusy = busy === `force-password:${session.userId}`
  const organizationId = organizationIdFromRow(session)
  const organizationName = session.organizationName ?? session.tenantName
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
            <span className="eyebrow">Session 风险详情</span>
            <h2 id={titleId}>{session.name}</h2>
            <p>{session.email ?? session.userId}</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭 Session 风险详情" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="drawer-summary-grid">
          <div>
            <span>风险等级</span>
            <strong>
              <RiskBadge level={session.riskLevel} />
            </strong>
          </div>
          <div>
            <span>Session 状态</span>
            <strong>
              <StatusBadge status={session.status} />
            </strong>
          </div>
          <div>
            <span>活跃 Session</span>
            <strong>{activeCount}</strong>
          </div>
          <div>
            <span>组织</span>
            <strong>{organizationName}</strong>
          </div>
          <div>
            <span>最后活跃</span>
            <strong>{formatDate(session.lastSeenAt ?? session.createdAt)}</strong>
          </div>
          <div>
            <span>过期时间</span>
            <strong>{formatDate(session.expiresAt)}</strong>
          </div>
        </div>

        <div className="drawer-actions">
          <button
            className="row-button danger"
            type="button"
            disabled={!canManage || session.current || session.status !== 'active' || revokeSessionBusy}
            onClick={() => onRevoke(session)}
          >
            {revokeSessionBusy ? <LoaderCircle size={14} className="spin" /> : <LogOut size={14} />}
            {session.current ? '当前 Session' : '撤销当前 Session'}
          </button>
          <button
            className="row-button danger"
            type="button"
            disabled={!canManageTargetUser || activeCount < 1 || revokeUserBusy}
            onClick={() => onRevokeUserSessions(session)}
          >
            {revokeUserBusy ? <LoaderCircle size={14} className="spin" /> : <LogOut size={14} />}
            踢该用户下线
          </button>
          <button
            className="row-button danger"
            type="button"
            disabled={!canManageTargetUser || forcePasswordBusy}
            onClick={() => onForcePasswordReset(session)}
          >
            {forcePasswordBusy ? <LoaderCircle size={14} className="spin" /> : <ShieldCheck size={14} />}
            强制改密
          </button>
        </div>

        <DrawerSection title="风险原因" count={session.reasons?.length ?? 0}>
          <ReasonPills reasons={session.reasons ?? []} />
        </DrawerSection>

        <DrawerSection title="设备与请求上下文" count={1}>
          <div className="session-context-grid">
            <div>
              <span>Session ID</span>
              <code>{session.sessionId}</code>
            </div>
            <div>
              <span>Membership ID</span>
              <code>{session.membershipId}</code>
            </div>
            <div>
              <span>用户 ID</span>
              <code>{session.userId}</code>
            </div>
            <div>
              <span>组织 ID</span>
              <code>{organizationId}</code>
            </div>
            <div>
              <span>设备</span>
              <strong>{session.deviceLabel ?? userAgentSummary(session.userAgent)}</strong>
            </div>
            <div>
              <span>IP</span>
              <strong>{session.ipAddress ?? '-'}</strong>
            </div>
            <div>
              <span>角色</span>
              <strong>{session.roles.map(roleName).join(' / ')}</strong>
            </div>
            <div>
              <span>创建时间</span>
              <strong>{formatDate(session.createdAt)}</strong>
            </div>
          </div>
          <div className="code-field">
            <span>完整 userAgent</span>
            <pre className="code-block">{session.userAgent ?? '-'}</pre>
          </div>
        </DrawerSection>

        <DrawerSection title="同用户 Session" count={riskRows.length}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>风险</th>
                <th>状态</th>
                <th>设备</th>
                <th>IP</th>
                <th>最后活跃</th>
                <th>过期时间</th>
              </tr>
            </thead>
            <tbody>
              {riskRows.slice(0, 12).map((item) => (
                <tr key={item.sessionId}>
                  <td>
                    <RiskBadge level={item.riskLevel} />
                  </td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td>{item.deviceLabel ?? userAgentSummary(item.userAgent)}</td>
                  <td>{item.ipAddress ?? '-'}</td>
                  <td>{formatDate(item.lastSeenAt ?? item.createdAt)}</td>
                  <td>{formatDate(item.expiresAt)}</td>
                </tr>
              ))}
              <EmptyRow visible={!riskRows.length} columns={6} />
            </tbody>
          </table>
        </DrawerSection>

        <DrawerSection title="审计上下文" count={auditLogs.length}>
          {auditLoading && <p className="panel-empty">正在读取审计上下文...</p>}
          {auditError && <p className="notice error">{auditError}</p>}
          {!auditLoading && !auditError && (
            <div className="audit-context-list">
              {auditLogs.slice(0, 12).map((entry) => (
                <article key={entry.id} className={`audit-context-entry ${auditLogTone(entry)}`}>
                  <div>
                    <strong>{entry.action}</strong>
                    <small>
                      {entry.resourceType} · {entry.resourceId ? shortId(entry.resourceId) : '-'} ·{' '}
                      {formatDate(entry.createdAt)}
                    </small>
                    <small>
                      Actor {entry.actorUserId ? shortId(entry.actorUserId) : '-'} · User{' '}
                      {entry.userId ? shortId(entry.userId) : '-'} · IP {entry.ipAddress ?? '-'}
                    </small>
                    <span>userAgent</span>
                    <pre className="code-block compact">{entry.userAgent ?? '-'}</pre>
                    <span>metadata</span>
                    <pre className="code-block compact">{prettyJson(entry.metadata)}</pre>
                  </div>
                </article>
              ))}
              {!auditLogs.length && <p className="panel-empty">暂无审计上下文。</p>}
            </div>
          )}
        </DrawerSection>
      </aside>
    </div>
  )
}

export function SessionRiskView({
  sessions,
  riskFilter,
  canManage,
  busy,
  currentUserId,
  onRiskFilterChange,
  onRevoke,
  onRevokeUserSessions,
  onForcePasswordReset,
  onOpenDetail,
}) {
  const rows = buildSessionRiskRows(sessions)
  const summary = summarizeSessionRisks(rows)
  const visibleRows = riskFilter === 'all' ? rows : rows.filter((row) => row.riskLevel === riskFilter)

  return (
    <div className="risk-page">
      <section className="summary-strip">
        <MetricBlock icon={AlertTriangle} label="高风险" value={summary.high} tone="high" />
        <MetricBlock icon={ShieldCheck} label="需关注" value={summary.medium} tone="medium" />
        <MetricBlock icon={KeyRound} label="活跃 Session" value={summary.active} />
        <MetricBlock icon={Monitor} label="已纳入评估" value={rows.length} />
      </section>

      <DataSection title="Session 风险视图" count={visibleRows.length}>
        <div className="inline-filter-bar">
          <label>
            <Filter size={14} />
            <select value={riskFilter} onChange={(event) => onRiskFilterChange(event.target.value)}>
              <option value="all">全部风险</option>
              <option value="high">高风险</option>
              <option value="medium">需关注</option>
              <option value="low">正常</option>
            </select>
          </label>
        </div>
        <table className="data-table risk-table">
          <thead>
            <tr>
              <th>风险</th>
              <th>用户</th>
              <th>组织</th>
              <th>设备 / IP</th>
              <th>活跃数</th>
              <th>未活跃</th>
              <th>原因</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((session) => {
              const targetIsCurrentUser = session.userId === currentUserId
              const canManageTargetUser = canManage && !targetIsCurrentUser
              const revokeSessionBusy = busy === `session:${session.sessionId}`
              const revokeUserBusy = busy === `user-sessions:${session.userId}`
              const forcePasswordBusy = busy === `force-password:${session.userId}`

              return (
                <tr key={session.sessionId}>
                  <td>
                    <RiskBadge level={session.riskLevel} />
                  </td>
                  <td>
                    <IdentityCell name={session.name} detail={session.email ?? session.userId} />
                  </td>
                  <td>{session.tenantName}</td>
                  <td>
                    <DeviceCell session={session} />
                  </td>
                  <td>{session.activeCount}</td>
                  <td>{formatInactiveHours(session.inactiveHours)}</td>
                  <td>
                    <ReasonPills reasons={session.reasons} />
                  </td>
                  <td>
                    <div className="row-actions risk-actions">
                      <button
                        className="row-button"
                        type="button"
                        {...tooltipProps('查看该 Session 的完整风险详情')}
                        onClick={() => onOpenDetail(session)}
                      >
                        <FileText size={14} />
                        详情
                      </button>
                      <RowMoreMenu title="打开更多风险操作">
                        <button
                          className="row-button danger"
                          type="button"
                          {...disabledButtonProps(
                            !canManageTargetUser || session.activeCount < 1 || revokeUserBusy,
                            !canManageTargetUser
                              ? '不能踢下线当前登录用户'
                              : session.activeCount < 1
                                ? '该用户没有可踢下线的 Session'
                                : '正在踢下线该用户的 Session',
                            '踢下线该用户的所有活跃 Session',
                          )}
                          onClick={() => onRevokeUserSessions(session)}
                        >
                          {revokeUserBusy ? (
                            <LoaderCircle size={14} className="spin" />
                          ) : (
                            <LogOut size={14} />
                          )}
                          踢用户
                        </button>
                        <button
                          className="row-button danger"
                          type="button"
                          {...disabledButtonProps(
                            !canManageTargetUser || forcePasswordBusy,
                            !canManageTargetUser ? '不能强制当前用户改密' : '正在强制该用户改密',
                            '要求该用户下次登录修改密码',
                          )}
                          onClick={() => onForcePasswordReset(session)}
                        >
                          {forcePasswordBusy ? (
                            <LoaderCircle size={14} className="spin" />
                          ) : (
                            <ShieldCheck size={14} />
                          )}
                          强制改密
                        </button>
                        <button
                          className="row-button danger"
                          type="button"
                          {...disabledButtonProps(
                            !canManage || session.current || session.status !== 'active' || revokeSessionBusy,
                            session.current
                              ? '不能撤销当前登录 Session'
                              : session.status !== 'active'
                                ? '该 Session 不是启用状态'
                                : '正在撤销 Session',
                            '撤销该会话',
                          )}
                          onClick={() => onRevoke(session)}
                        >
                          {revokeSessionBusy ? (
                            <LoaderCircle size={14} className="spin" />
                          ) : (
                            <LogOut size={14} />
                          )}
                          撤销
                        </button>
                      </RowMoreMenu>
                    </div>
                  </td>
                </tr>
              )
            })}
            <EmptyRow visible={!visibleRows.length} columns={8} />
          </tbody>
        </table>
      </DataSection>
    </div>
  )
}

export function AuditLogPage({
  entries,
  allEntries,
  actionFilter,
  resourceFilter,
  onActionFilterChange,
  onResourceFilterChange,
  onOpenDetail,
}) {
  const actions = uniqueValues(allEntries, 'action')
  const resourceTypes = uniqueValues(allEntries, 'resourceType')
  const visibleEntries = entries.filter(
    (entry) =>
      (actionFilter === 'all' || entry.action === actionFilter) &&
      (resourceFilter === 'all' || entry.resourceType === resourceFilter),
  )
  const summary = summarizeAuditLogs(visibleEntries)

  return (
    <div className="audit-page">
      <section className="summary-strip">
        <MetricBlock icon={FileText} label="日志" value={summary.total} />
        <MetricBlock icon={UsersRound} label="账号事件" value={summary.accountEvents} />
        <MetricBlock icon={KeyRound} label="Session 事件" value={summary.sessionEvents} />
        <MetricBlock icon={CreditCard} label="账单事件" value={summary.billingEvents} />
      </section>

      <DataSection title="审计日志页面" count={visibleEntries.length}>
        <div className="inline-filter-bar">
          <label>
            <Filter size={14} />
            <select value={actionFilter} onChange={(event) => onActionFilterChange(event.target.value)}>
              <option value="all">全部动作</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>
          <label>
            <FileText size={14} />
            <select value={resourceFilter} onChange={(event) => onResourceFilterChange(event.target.value)}>
              <option value="all">全部资源</option>
              {resourceTypes.map((resourceType) => (
                <option key={resourceType} value={resourceType}>
                  {resourceType}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="audit-timeline">
          {visibleEntries.map((entry) => (
            <article key={entry.id} className={`audit-event ${auditLogTone(entry)}`}>
              <div className="audit-event-icon">
                <FileText size={15} />
              </div>
              <div className="audit-event-main">
                <div>
                  <strong>{entry.action}</strong>
                  <time>{formatDate(entry.createdAt)}</time>
                </div>
                <p>
                  {entry.resourceType} · {entry.resourceId ? shortId(entry.resourceId) : '-'}
                </p>
                <div className="audit-event-meta">
                  <span>Actor {entry.actorUserId ? shortId(entry.actorUserId) : '-'}</span>
                  <span>User {entry.userId ? shortId(entry.userId) : '-'}</span>
                  <span>IP {entry.ipAddress ?? '-'}</span>
                </div>
                <div className="audit-event-footer">
                  <code>{compactJson(entry.metadata)}</code>
                  <button className="row-button" type="button" onClick={() => onOpenDetail(entry)}>
                    <FileText size={14} />
                    详情
                  </button>
                </div>
              </div>
            </article>
          ))}
          {!visibleEntries.length && <p className="empty-table">没有匹配的审计日志。</p>}
        </div>
      </DataSection>
    </div>
  )
}

export function AuditLogDetailDrawer({
  entry,
  users,
  organizations,
  memberships,
  billingAccounts,
  ledgerEntries,
  sessions,
  reconciliation,
  alerts,
  onClose,
  onOpenUser,
  onOpenOrganization,
  onOpenMembership,
  onOpenBilling,
  onOpenSession,
}) {
  const metadata = objectMetadata(entry)
  const references = auditRelatedReferences(entry)
  const userItems = references.users.map((reference) => {
    const user = users.find((item) => item.id === reference.id)
    return {
      ...reference,
      title: user?.name ?? reference.id,
      detail: user?.email ?? (user ? user.id : '当前快照未加载，点击后搜索'),
      actionLabel: user ? '打开' : '搜索',
      onOpen: () => onOpenUser(reference.id),
    }
  })
  const organizationItems = references.organizations.map((reference) => {
    const organization = organizations.find((item) => item.id === reference.id)
    return {
      ...reference,
      title: organization?.name ?? reference.id,
      detail: organization
        ? organizationTypeName(classifyOrganization(organization).type)
        : '当前快照未加载，点击后搜索',
      actionLabel: organization ? '打开' : '搜索',
      onOpen: () => onOpenOrganization(reference.id),
    }
  })
  const membershipItems = references.memberships.map((reference) => {
    const membership = memberships.find((item) => membershipIdFor(item) === reference.id)
    return {
      ...reference,
      title: membership?.name ?? reference.id,
      detail: membership
        ? `${membership.tenantName} · ${membership.email ?? membership.userId}`
        : '当前快照未加载，点击后搜索',
      actionLabel: membership ? '打开' : '搜索',
      onOpen: () => onOpenMembership(reference.id),
    }
  })
  const sessionItems = references.sessions.map((reference) => {
    const targetSession = sessions.find((item) => item.sessionId === reference.id)
    return {
      ...reference,
      title: targetSession?.name ?? reference.id,
      detail: targetSession
        ? `${targetSession.tenantName} · ${targetSession.deviceLabel ?? userAgentSummary(targetSession.userAgent)}`
        : '当前快照未加载，点击后搜索',
      actionLabel: targetSession ? '打开' : '搜索',
      onOpen: () => onOpenSession(reference.id),
    }
  })
  const billingItems = auditBillingReferenceItems({
    references,
    billingAccounts,
    ledgerEntries,
    reconciliation,
    alerts,
    onOpenBilling,
  })
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
            <span className="eyebrow">审计日志详情</span>
            <h2 id={titleId}>{entry.action}</h2>
            <p>
              {entry.resourceType} · {entry.resourceId ? shortId(entry.resourceId) : '-'}
            </p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭审计日志详情" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="drawer-summary-grid">
          <div>
            <span>动作</span>
            <strong>{entry.action}</strong>
          </div>
          <div>
            <span>资源</span>
            <strong>{entry.resourceType}</strong>
          </div>
          <div>
            <span>资源 ID</span>
            <strong>{entry.resourceId ?? '-'}</strong>
          </div>
          <div>
            <span>组织</span>
            <strong>{entry.organizationId ?? entry.tenantId ?? '-'}</strong>
          </div>
          <div>
            <span>IP</span>
            <strong>{entry.ipAddress ?? '-'}</strong>
          </div>
          <div>
            <span>时间</span>
            <strong>{formatDate(entry.createdAt)}</strong>
          </div>
        </div>

        <DrawerSection title="关联对象" count={referenceCount(references)}>
          <div className="audit-reference-grid">
            <AuditReferenceGroup title="用户" items={userItems} emptyLabel="没有关联用户。" />
            <AuditReferenceGroup title="组织" items={organizationItems} emptyLabel="没有关联组织。" />
            <AuditReferenceGroup
              title="Membership"
              items={membershipItems}
              emptyLabel="没有关联 membership。"
            />
            <AuditReferenceGroup title="Session" items={sessionItems} emptyLabel="没有关联 session。" />
            <AuditReferenceGroup title="账单记录" items={billingItems} emptyLabel="没有关联账单记录。" />
          </div>
        </DrawerSection>

        <DrawerSection title="请求上下文" count={1}>
          <div className="session-context-grid">
            <div>
              <span>Audit ID</span>
              <code>{entry.id}</code>
            </div>
            <div>
              <span>Actor User ID</span>
              <code>{entry.actorUserId ?? '-'}</code>
            </div>
            <div>
              <span>User ID</span>
              <code>{entry.userId ?? '-'}</code>
            </div>
            <div>
              <span>Organization ID</span>
              <code>{entry.organizationId ?? entry.tenantId ?? '-'}</code>
            </div>
          </div>
          <div className="code-field">
            <span>完整 userAgent</span>
            <pre className="code-block">{entry.userAgent ?? '-'}</pre>
          </div>
        </DrawerSection>

        <DrawerSection title="完整 metadata" count={Object.keys(metadata).length}>
          <pre className="code-block large">{prettyJson(metadata)}</pre>
        </DrawerSection>
      </aside>
    </div>
  )
}

export function AuditReferenceGroup({ title, items, emptyLabel }) {
  return (
    <section className="audit-reference-group">
      <header>
        <h4>{title}</h4>
        <span>{items.length}</span>
      </header>
      <div>
        {items.map((item) => (
          <article key={`${item.label}:${item.id}`} className="audit-reference-item">
            <div>
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </div>
            <button className="row-button" type="button" onClick={item.onOpen}>
              <FileText size={14} />
              {item.actionLabel}
            </button>
          </article>
        ))}
        {!items.length && <p className="panel-empty compact">{emptyLabel}</p>}
      </div>
    </section>
  )
}
