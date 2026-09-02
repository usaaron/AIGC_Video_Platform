import {
  AlertTriangle,
  Check,
  CreditCard,
  Crown,
  Filter,
  LoaderCircle,
  PencilLine,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import {
  canManageBillingAccount,
  canReadOrganizationBilling,
  canUpdateMembershipPlan,
  classifyOrganization,
  formatDate,
  formatSignedAmount,
  ledgerTypeName,
  membershipIdFor,
  planName,
  shortId,
  summarizeBillingAdjustments,
  organizationTypeName,
} from '../adminConsole'
import {
  disabledButtonProps,
  billingAdjustmentDisabledReason,
  compactJson,
  DataSection,
  IdentityCell,
  StatusBadge,
  paymentStatusName,
  PaymentStatusBadge,
  AlertStatusBadge,
  AlertSeverityBadge,
  StatusPair,
  OrganizationTypeBadge,
  EmptyRow,
} from './AdminUi'
import {
  MetricBlock,
  organizationNameFor,
  organizationIdFromRow,
  summarizeReconciliationAlerts,
} from './adminDataHelpers'

export function BillingPanel({
  accounts,
  entries,
  reconciliation,
  alerts,
  organizations,
  session,
  canManage,
  busy,
  onAdjust,
  onUpdatePlan,
  onGrant,
  onUpdateAlert,
  onOpenAlertsPage,
}) {
  const openAlerts = alerts.filter((alert) => alert.status !== 'resolved')
  const visibleAlerts = openAlerts.length ? openAlerts : alerts.slice(0, 5)
  return (
    <div className="stack">
      <DataSection title="账单账户" count={accounts.length}>
        <div className="section-actions">
          <button className="row-button" type="button" disabled={!canManage} onClick={onGrant}>
            <Plus size={14} />
            当前账号充值
          </button>
        </div>
        <table className="data-table wide">
          <thead>
            <tr>
              <th>账号</th>
              <th>组织</th>
              <th>套餐</th>
              <th>积分</th>
              <th>状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.membershipId}>
                <td>
                  <IdentityCell name={account.name} detail={account.email ?? account.userId} />
                </td>
                <td>{account.tenantName}</td>
                <td>{planName(account.plan)}</td>
                <td>{account.credits}</td>
                <td>
                  <StatusPair primary={account.membershipStatus} secondary={account.userStatus} />
                </td>
                <td>{formatDate(account.updatedAt)}</td>
                <td>
                  <button
                    className="row-button"
                    type="button"
                    disabled={!canUpdateMembershipPlan(session, account)}
                    onClick={() => onUpdatePlan(account)}
                  >
                    <Crown size={14} />
                    改套餐/冲会员
                  </button>
                  <button
                    className="row-button"
                    type="button"
                    disabled={!canManage || !canManageBillingAccount(session, account)}
                    onClick={() => onAdjust(account)}
                  >
                    <PencilLine size={14} />
                    调账
                  </button>
                </td>
              </tr>
            ))}
            <EmptyRow visible={!accounts.length} columns={7} />
          </tbody>
        </table>
      </DataSection>

      <DataSection title="对账告警" count={alerts.length}>
        <div className="section-actions">
          <button className="row-button" type="button" onClick={onOpenAlertsPage}>
            <AlertTriangle size={14} />
            查看全部告警
          </button>
        </div>
        <ReconciliationAlertsTable
          alerts={visibleAlerts}
          reconciliation={reconciliation}
          organizations={organizations}
          canManage={canManage}
          busy={busy}
          onUpdateAlert={onUpdateAlert}
        />
      </DataSection>

      <DataSection title="账单流水" count={entries.length}>
        <table className="data-table ledger">
          <thead>
            <tr>
              <th>类型</th>
              <th>金额</th>
              <th>余额</th>
              <th>描述</th>
              <th>Reference</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{ledgerTypeName(entry.type)}</td>
                <td className={entry.amount >= 0 ? 'amount positive' : 'amount negative'}>
                  {formatSignedAmount(entry.amount)}
                </td>
                <td>{entry.balance}</td>
                <td>{entry.description}</td>
                <td>{shortId(entry.referenceId)}</td>
                <td>{formatDate(entry.createdAt)}</td>
              </tr>
            ))}
            <EmptyRow visible={!entries.length} columns={6} />
          </tbody>
        </table>
      </DataSection>

      <DataSection title="支付对账" count={reconciliation.length}>
        <table className="data-table wide">
          <thead>
            <tr>
              <th>Provider</th>
              <th>事件</th>
              <th>状态</th>
              <th>积分</th>
              <th>Membership</th>
              <th>Ledger</th>
              <th>消息</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {reconciliation.map((item) => (
              <tr key={item.id}>
                <td>{item.provider}</td>
                <td>
                  <div className="stacked-cell">
                    <strong>{item.eventType}</strong>
                    <small>{shortId(item.providerEventId)}</small>
                  </div>
                </td>
                <td>
                  <PaymentStatusBadge status={item.status} />
                </td>
                <td className={(item.amount ?? 0) >= 0 ? 'amount positive' : 'amount negative'}>
                  {item.amount === null ? '-' : formatSignedAmount(item.amount)}
                </td>
                <td>{shortId(item.membershipId)}</td>
                <td>{shortId(item.ledgerEntryId)}</td>
                <td>{item.message}</td>
                <td>{formatDate(item.createdAt)}</td>
              </tr>
            ))}
            <EmptyRow visible={!reconciliation.length} columns={8} />
          </tbody>
        </table>
      </DataSection>
    </div>
  )
}

export function BillingAdjustmentPage({
  accounts,
  entries,
  organizations,
  session,
  selectedMembershipId,
  form,
  canManage,
  busy,
  onSelectMembership,
  onFormChange,
  onSubmit,
  onGrant,
  onOpenOrganizationBilling,
}) {
  const selectedAccount =
    accounts.find((account) => membershipIdFor(account) === selectedMembershipId) ?? accounts[0] ?? null
  const selectedId = selectedAccount ? membershipIdFor(selectedAccount) : ''
  const amount = Number(form.amount)
  const validAmount = Number.isInteger(amount) && amount !== 0
  const projectedBalance = selectedAccount && validAmount ? selectedAccount.credits + amount : null
  const submitDisabled =
    !canManage ||
    !selectedAccount ||
    !canManageBillingAccount(session, selectedAccount) ||
    !validAmount ||
    !form.reason.trim() ||
    projectedBalance < 0 ||
    busy === `adjust-page:${selectedId}`
  const submitDisabledReason = billingAdjustmentDisabledReason({
    canManage,
    selectedAccount,
    canManageTarget: selectedAccount ? canManageBillingAccount(session, selectedAccount) : false,
    validAmount,
    hasReason: Boolean(form.reason.trim()),
    projectedBalance,
    busy: busy === `adjust-page:${selectedId}`,
  })
  const adjustmentEntries = entries.filter((entry) => entry.type === 'adjustment' || entry.type === 'grant')
  const summary = summarizeBillingAdjustments(adjustmentEntries)
  const readableOrganizationPools = organizations.filter((organization) =>
    canReadOrganizationBilling(session, organization),
  )

  return (
    <div className="adjustment-page">
      <section className="adjustment-workbench">
        <header>
          <div>
            <span className="eyebrow">Billing Operations</span>
            <h2>账单调账</h2>
          </div>
          <button className="row-button" type="button" disabled={!canManage} onClick={onGrant}>
            <Plus size={14} />
            当前账号充值
          </button>
        </header>
        <form className="adjustment-form" onSubmit={onSubmit}>
          <label>
            <span>目标 membership</span>
            <select
              value={selectedId}
              onChange={(event) => onSelectMembership(event.target.value)}
              disabled={!accounts.length}
            >
              {accounts.map((account) => (
                <option key={membershipIdFor(account)} value={membershipIdFor(account)}>
                  {account.name} · {account.tenantName} · {account.email ?? account.userId}
                </option>
              ))}
            </select>
          </label>
          {selectedAccount && (
            <>
              <div className="adjustment-target-card">
                <IdentityCell
                  name={selectedAccount.name}
                  detail={`${selectedAccount.tenantName} · ${selectedAccount.email ?? selectedAccount.userId}`}
                />
                <div>
                  <span>当前余额</span>
                  <strong>{selectedAccount.credits}</strong>
                </div>
                <div>
                  <span>预计余额</span>
                  <strong>{projectedBalance === null ? '-' : projectedBalance}</strong>
                </div>
                <StatusPair
                  primary={selectedAccount.membershipStatus}
                  secondary={selectedAccount.userStatus}
                />
              </div>
              <BillingOwnershipHint target={selectedAccount} />
            </>
          )}
          <div className="adjustment-fields">
            <label>
              <span>积分变化</span>
              <input
                type="number"
                value={form.amount}
                onChange={(event) => onFormChange({ ...form, amount: event.target.value })}
                min="-1000000"
                max="1000000"
                required
              />
            </label>
            <label>
              <span>调账原因</span>
              <input
                value={form.reason}
                onChange={(event) => onFormChange({ ...form, reason: event.target.value })}
                maxLength={200}
                required
              />
            </label>
          </div>
          <button
            className="primary-button"
            type="submit"
            {...disabledButtonProps(submitDisabled, submitDisabledReason)}
          >
            {busy === `adjust-page:${selectedId}` ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <PencilLine size={15} />
            )}
            提交调账
          </button>
        </form>
      </section>

      <DataSection title="组织共享积分池" count={readableOrganizationPools.length}>
        <table className="data-table wide">
          <thead>
            <tr>
              <th>组织</th>
              <th>类型</th>
              <th>状态</th>
              <th>成员</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {readableOrganizationPools.map((organization) => (
              <tr key={organization.id}>
                <td>
                  <IdentityCell name={organization.name} detail={organization.id} />
                </td>
                <td>
                  <OrganizationTypeBadge organizationType={classifyOrganization(organization)} />
                </td>
                <td>
                  <StatusBadge status={organization.status} />
                </td>
                <td>
                  {organization.activeMembershipCount} / {organization.membershipCount}
                </td>
                <td>
                  <button
                    className="row-button"
                    type="button"
                    onClick={() => onOpenOrganizationBilling(organization)}
                  >
                    <CreditCard size={14} />
                    查询余额/组织充积分
                  </button>
                </td>
              </tr>
            ))}
            <EmptyRow visible={!readableOrganizationPools.length} columns={5} />
          </tbody>
        </table>
      </DataSection>

      <section className="summary-strip">
        <MetricBlock icon={PencilLine} label="调账流水" value={summary.adjustments} />
        <MetricBlock icon={Plus} label="充值流水" value={summary.grants} />
        <MetricBlock icon={CreditCard} label="增加积分" value={summary.positiveCredits} />
        <MetricBlock icon={AlertTriangle} label="扣减积分" value={summary.negativeCredits} />
      </section>

      <DataSection title="最近充值与调账" count={adjustmentEntries.length}>
        <table className="data-table ledger">
          <thead>
            <tr>
              <th>类型</th>
              <th>金额</th>
              <th>余额</th>
              <th>账号归属</th>
              <th>描述</th>
              <th>Reference</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {adjustmentEntries.map((entry) => (
              <tr key={entry.id}>
                <td>{ledgerTypeName(entry.type)}</td>
                <td className={entry.amount >= 0 ? 'amount positive' : 'amount negative'}>
                  {formatSignedAmount(entry.amount)}
                </td>
                <td>{entry.balance}</td>
                <td>{shortId(entry.membershipId)}</td>
                <td>{entry.description}</td>
                <td>{shortId(entry.referenceId)}</td>
                <td>{formatDate(entry.createdAt)}</td>
              </tr>
            ))}
            <EmptyRow visible={!adjustmentEntries.length} columns={7} />
          </tbody>
        </table>
      </DataSection>
    </div>
  )
}

export function ReconciliationAlertsPage({
  alerts,
  reconciliation,
  organizations,
  statusFilter,
  severityFilter,
  canManage,
  busy,
  onStatusFilterChange,
  onSeverityFilterChange,
  onUpdateAlert,
}) {
  const visibleAlerts = alerts.filter((alert) => {
    const statusMatch = statusFilter === 'all' || alert.status === statusFilter
    const severityMatch = severityFilter === 'all' || alert.severity === severityFilter
    return statusMatch && severityMatch
  })
  const summary = summarizeReconciliationAlerts(alerts)

  return (
    <div className="alert-page">
      <section className="summary-strip">
        <MetricBlock icon={AlertTriangle} label="未处理" value={summary.open} tone="high" />
        <MetricBlock icon={ShieldCheck} label="已确认" value={summary.acknowledged} tone="medium" />
        <MetricBlock icon={Check} label="已解决" value={summary.resolved} />
        <MetricBlock icon={AlertTriangle} label="高优先级" value={summary.critical} tone="high" />
      </section>

      <DataSection title="对账告警" count={visibleAlerts.length}>
        <div className="inline-filter-bar">
          <label>
            <Filter size={14} />
            <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="open">未处理</option>
              <option value="acknowledged">已确认</option>
              <option value="resolved">已解决</option>
            </select>
          </label>
          <label>
            <AlertTriangle size={14} />
            <select value={severityFilter} onChange={(event) => onSeverityFilterChange(event.target.value)}>
              <option value="all">全部严重性</option>
              <option value="warning">警告</option>
              <option value="critical">严重</option>
            </select>
          </label>
        </div>
        <ReconciliationAlertsTable
          alerts={visibleAlerts}
          reconciliation={reconciliation}
          organizations={organizations}
          canManage={canManage}
          busy={busy}
          onUpdateAlert={onUpdateAlert}
        />
      </DataSection>

      <DataSection title="最近支付对账" count={reconciliation.length}>
        <table className="data-table wide alert-table">
          <thead>
            <tr>
              <th>事件</th>
              <th>状态</th>
              <th>组织</th>
              <th>Membership</th>
              <th>积分</th>
              <th>消息</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {reconciliation.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="stacked-cell">
                    <strong>{item.eventType}</strong>
                    <small>{shortId(item.providerEventId)}</small>
                  </div>
                </td>
                <td>
                  <PaymentStatusBadge status={item.status} />
                </td>
                <td>{organizationNameFor(organizations, organizationIdFromRow(item))}</td>
                <td>{shortId(item.membershipId)}</td>
                <td className={(item.amount ?? 0) >= 0 ? 'amount positive' : 'amount negative'}>
                  {item.amount === null ? '-' : formatSignedAmount(item.amount)}
                </td>
                <td>{item.message}</td>
                <td>{formatDate(item.createdAt)}</td>
              </tr>
            ))}
            <EmptyRow visible={!reconciliation.length} columns={7} />
          </tbody>
        </table>
      </DataSection>
    </div>
  )
}

export function ReconciliationAlertsTable({
  alerts,
  reconciliation,
  organizations,
  canManage,
  busy,
  onUpdateAlert,
}) {
  const reconciliationById = new Map(reconciliation.map((item) => [item.id, item]))
  return (
    <table className="data-table wide alert-table">
      <thead>
        <tr>
          <th>告警</th>
          <th>严重性</th>
          <th>状态</th>
          <th>组织</th>
          <th>Membership</th>
          <th>对账项</th>
          <th>备注</th>
          <th>时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {alerts.map((alert) => {
          const linked = alert.reconciliationItemId
            ? reconciliationById.get(alert.reconciliationItemId)
            : null
          return (
            <tr key={alert.id}>
              <td>
                <div className="stacked-cell">
                  <strong>{alert.alertType}</strong>
                  <small>
                    {alert.provider} · {shortId(alert.providerEventId)}
                  </small>
                </div>
              </td>
              <td>
                <AlertSeverityBadge severity={alert.severity} />
              </td>
              <td>
                <AlertStatusBadge status={alert.status} />
              </td>
              <td>{organizationNameFor(organizations, organizationIdFromRow(alert))}</td>
              <td>{shortId(alert.membershipId)}</td>
              <td>
                <div className="stacked-cell">
                  <strong>{shortId(linked?.id ?? alert.reconciliationItemId)}</strong>
                  <small>{linked?.status ? paymentStatusName(linked.status) : '-'}</small>
                </div>
              </td>
              <td>
                <div className="stacked-cell">
                  <strong>{alert.message}</strong>
                  <small>{compactJson(alert.metadata)}</small>
                </div>
              </td>
              <td>{formatDate(alert.createdAt)}</td>
              <td>
                <div className="row-actions">
                  <button
                    className="row-button"
                    type="button"
                    disabled={
                      !canManage ||
                      alert.status !== 'open' ||
                      busy === `reconciliation-alert:${alert.id}:acknowledged`
                    }
                    onClick={() => onUpdateAlert(alert, 'acknowledged')}
                  >
                    {busy === `reconciliation-alert:${alert.id}:acknowledged` ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <ShieldCheck size={14} />
                    )}
                    确认
                  </button>
                  <button
                    className="row-button"
                    type="button"
                    disabled={
                      !canManage ||
                      alert.status === 'resolved' ||
                      busy === `reconciliation-alert:${alert.id}:resolved`
                    }
                    onClick={() => onUpdateAlert(alert, 'resolved')}
                  >
                    {busy === `reconciliation-alert:${alert.id}:resolved` ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    解决
                  </button>
                </div>
              </td>
            </tr>
          )
        })}
        <EmptyRow visible={!alerts.length} columns={9} />
      </tbody>
    </table>
  )
}

export function BillingOwnershipHint({ target, scope = 'membership' }) {
  const organizationType = target ? classifyOrganization(target) : null
  const isEnterprise = organizationType?.type === 'enterprise'
  const title = scope === 'organization' ? '企业组织共享池' : '个人账号 / membership 余额'
  const detail =
    scope === 'organization'
      ? '这里给企业组织共享池充值或扣减，组织成员共用；B 端公账付款应优先走这里。'
      : isEnterprise
        ? '当前目标是企业组织内的某个成员余额；不要把企业公账付款误充到管理员或成员个人余额。'
        : '当前目标是个人账号余额；只适用于 C 端个人付款、补偿或个人套餐交付。'
  return (
    <section className={`billing-ownership-hint ${scope === 'organization' ? 'organization' : 'membership'}`}>
      <CreditCard size={15} />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {target && (
        <code>
          {target.tenantName ?? target.name ?? target.organizationName} ·{' '}
          {organizationTypeName(organizationType?.type ?? target.organizationType ?? 'standard')}
        </code>
      )}
    </section>
  )
}
