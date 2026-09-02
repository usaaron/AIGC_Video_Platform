import {
  Activity,
  Building2,
  CreditCard,
  Crown,
  FileText,
  Gauge,
  Globe,
  IdCard,
  KeyRound,
  LoaderCircle,
  MailPlus,
  PencilLine,
  Plus,
  RefreshCw,
  UsersRound,
} from 'lucide-react'
import {
  canCreateOrganization,
  canManageUsers,
  filterRows,
  formatDate,
  isEnterpriseOrganization,
  isPersonalAccountMembership,
} from '../adminConsole'
import { disabledButtonProps, DataSection, IdentityCell, EmptyRow } from './AdminUi'
import { LoadingScreen } from './AppChrome'
import { usageRangeName, formatUsageNumber, formatUsageRatio, usageRowKey } from './adminViewHelpers'
import { MetricBlock } from './adminDataHelpers'
import { canCreatePlatformInvitation, organizationInvitationRoleOptions } from './adminDomain'

export function OverviewPanel({ snapshot, summary, setActiveTab }) {
  const enterpriseOrganizations = (snapshot?.organizations?.items ?? snapshot?.tenants?.items ?? []).filter(
    isEnterpriseOrganization,
  )
  const personalAccounts = (snapshot?.memberships?.items ?? []).filter(isPersonalAccountMembership)
  const stats = [
    { label: '用户', value: summary.users, icon: UsersRound, tab: 'users' },
    { label: '个人账号', value: personalAccounts.length, icon: IdCard, tab: 'personal-accounts' },
    { label: '企业组织', value: enterpriseOrganizations.length, icon: Building2, tab: 'organizations' },
    { label: '账号归属', value: summary.memberships, icon: IdCard, tab: 'memberships' },
    { label: 'Session', value: summary.sessions, icon: KeyRound, tab: 'sessions' },
    { label: '账单账户', value: summary.billingAccounts, icon: CreditCard, tab: 'billing' },
    { label: '审计日志', value: summary.auditLogs, icon: FileText, tab: 'audit' },
  ]
  return (
    <div className="overview-grid">
      {stats.map((stat) => (
        <button key={stat.label} type="button" className="metric-tile" onClick={() => setActiveTab(stat.tab)}>
          <stat.icon size={18} />
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
        </button>
      ))}
      <section className="system-strip">
        <Activity size={18} />
        <div>
          <strong>运行任务：{snapshot.overview.activeTasks}</strong>
          <span>今日积分消耗：{snapshot.overview.creditsConsumedToday}</span>
        </div>
        <time>{formatDate(snapshot.generatedAt)}</time>
      </section>
    </div>
  )
}

export function DeliveryWorkbench({
  session,
  organizations,
  personalAccounts,
  busy,
  onCreatePersonalAccount,
  onInvitePersonalAccount,
  onOpenPersonalAccounts,
  onOpenAdjustments,
  onCreateOrganization,
  onCreateOrganizationWithAdmin,
  onOpenOrganizations,
  onOpenInvitations,
  onOpenBatchOrganizationInvitation,
}) {
  const canCreatePersonal = canManageUsers(session) && busy !== 'create-user'
  const canInvitePersonal = canCreatePlatformInvitation(session) && busy !== 'create-invitation'
  const canCreateEnterprise = canCreateOrganization(session)
  const invitableOrganizations = organizations.filter(
    (organization) =>
      organization.status === 'active' &&
      organizationInvitationRoleOptions(session, organization).includes('organization_member'),
  )
  const latestOrganization = organizations[0] ?? null
  const latestPersonalAccount = personalAccounts[0] ?? null

  return (
    <div className="delivery-workbench">
      <section className="delivery-grid">
        <article className="delivery-lane">
          <header>
            <span className="eyebrow">C 端个人交付</span>
            <h2>个人账号</h2>
          </header>
          <ol>
            <li>确认公账或线下款项对应个人用户。</li>
            <li>选择邀请成员，或直接创建个人账号。</li>
            <li>在账单调账里给个人 membership 充值或改套餐。</li>
            <li>交付注册链接或临时密码，并确认用户首次登录。</li>
          </ol>
          <div className="delivery-actions">
            <button
              className="primary-button"
              type="button"
              {...disabledButtonProps(!canCreatePersonal, '当前身份不能直接创建个人账号')}
              onClick={onCreatePersonalAccount}
            >
              <Plus size={14} />
              直接创建个人账号
            </button>
            <button
              className="row-button"
              type="button"
              {...disabledButtonProps(!canInvitePersonal, '当前身份不能邀请成员')}
              onClick={onInvitePersonalAccount}
            >
              <MailPlus size={14} />
              邀请成员
            </button>
            <button className="row-button" type="button" onClick={onOpenAdjustments}>
              <PencilLine size={14} />
              个人充值/改套餐
            </button>
            <button className="row-button" type="button" onClick={onOpenPersonalAccounts}>
              <IdCard size={14} />
              查看个人账号
            </button>
          </div>
          <DeliveryRecentTarget title="最近个人账号" empty="暂无个人账号" target={latestPersonalAccount} />
        </article>

        <article className="delivery-lane">
          <header>
            <span className="eyebrow">B 端企业交付</span>
            <h2>企业组织</h2>
          </header>
          <ol>
            <li>创建企业组织，推荐用一步式向导创建首个组织管理员。</li>
            <li>邀请组织成员或把已有账号加入企业组织。</li>
            <li>在组织共享池充值，避免把企业款充到管理员个人账号。</li>
            <li>让组织管理员登录验收成员、共享池余额和套餐状态。</li>
          </ol>
          <div className="delivery-actions">
            <button
              className="primary-button"
              type="button"
              {...disabledButtonProps(
                !canCreateEnterprise || busy === 'create-organization-with-admin',
                '只有 owner 或 super_admin 可以创建企业组织',
              )}
              onClick={onCreateOrganizationWithAdmin}
            >
              <Crown size={14} />
              创建企业组织+首个管理员
            </button>
            <button
              className="row-button"
              type="button"
              {...disabledButtonProps(
                !canCreateEnterprise || busy === 'create-organization',
                '只有 owner 或 super_admin 可以创建企业组织',
              )}
              onClick={onCreateOrganization}
            >
              <Building2 size={14} />
              创建企业组织
            </button>
            <button
              className="row-button"
              type="button"
              {...disabledButtonProps(!invitableOrganizations.length, '没有当前身份可批量邀请的启用企业组织')}
              onClick={() => onOpenBatchOrganizationInvitation(invitableOrganizations[0]?.id ?? '')}
            >
              <MailPlus size={14} />
              批量邀请组织成员
            </button>
            <button className="row-button" type="button" onClick={onOpenOrganizations}>
              <Building2 size={14} />
              企业组织/共享池
            </button>
            <button className="row-button" type="button" onClick={onOpenInvitations}>
              <MailPlus size={14} />
              邀请管理
            </button>
          </div>
          <DeliveryRecentTarget title="最近企业组织" empty="暂无企业组织" target={latestOrganization} />
        </article>
      </section>
    </div>
  )
}

export function DeliveryRecentTarget({ title, empty, target }) {
  return (
    <section className="delivery-recent">
      <span>{title}</span>
      {target ? (
        <IdentityCell
          name={target.name}
          detail={target.email ?? target.userId ?? target.id ?? target.tenantId}
          compact
        />
      ) : (
        <p>{empty}</p>
      )}
    </section>
  )
}

export function UsageRealtimePage({ summary, loading, error, range, onRangeChange, onRefresh }) {
  const metrics = summary?.global?.metrics ?? null
  return (
    <div className="usage-page">
      <UsageControls
        range={range}
        generatedAt={summary?.generatedAt}
        loading={loading}
        onRangeChange={onRangeChange}
        onRefresh={onRefresh}
      />
      {error && <div className="notice error">{error}</div>}
      {loading && !summary && <LoadingScreen compact label="正在读取实时用量" />}
      {metrics && (
        <>
          <section className="usage-metric-grid">
            <MetricBlock icon={Activity} label="API 并发" value={formatUsageNumber(metrics.apiConcurrency)} />
            <MetricBlock icon={Gauge} label="任务并发" value={formatUsageNumber(metrics.jobConcurrency)} />
            <MetricBlock
              icon={Globe}
              label="Provider 并发"
              value={formatUsageNumber(metrics.providerConcurrency)}
            />
            <MetricBlock icon={RefreshCw} label="RPM" value={formatUsageNumber(metrics.rpm)} />
            <MetricBlock icon={FileText} label="TPM" value={formatUsageNumber(metrics.tpm)} />
            <MetricBlock icon={CreditCard} label="积分消耗" value={formatUsageNumber(metrics.creditsUsed)} />
          </section>
          <DataSection title={`${usageRangeName(summary.range)}汇总`} count={summary.global.name ?? 'global'}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>请求</th>
                  <th>任务</th>
                  <th>Token</th>
                  <th>积分</th>
                  <th>API 错误率</th>
                  <th>任务失败率</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{formatUsageNumber(metrics.requestCount)}</td>
                  <td>{formatUsageNumber(metrics.jobCount)}</td>
                  <td>{formatUsageNumber(metrics.totalTokens)}</td>
                  <td>{formatUsageNumber(metrics.creditsUsed)}</td>
                  <td>{formatUsageRatio(metrics.errorRate)}</td>
                  <td>{formatUsageRatio(metrics.jobFailureRate)}</td>
                </tr>
              </tbody>
            </table>
          </DataSection>
        </>
      )}
      {!loading && !metrics && !error && <p className="panel-empty">暂无用量数据。</p>}
    </div>
  )
}

export function UsageTablePage({
  title,
  subject,
  rows,
  loading,
  error,
  query,
  range,
  onRangeChange,
  onRefresh,
}) {
  const visibleRows = filterRows(rows, query)
  return (
    <div className="usage-page">
      <UsageControls
        range={range}
        generatedAt={rows[0]?.generatedAt}
        loading={loading}
        onRangeChange={onRangeChange}
        onRefresh={onRefresh}
      />
      {error && <div className="notice error">{error}</div>}
      {loading && !rows.length && <LoadingScreen compact label={`正在读取${title}`} />}
      <DataSection title={`${usageRangeName(range)}${title}`} count={visibleRows.length}>
        <table className="data-table wide">
          <thead>
            <tr>
              <th>{subject === 'user' ? '用户' : '组织'}</th>
              <th>实时并发</th>
              <th>RPM / TPM</th>
              <th>请求 / 任务</th>
              <th>Token</th>
              <th>积分</th>
              <th>错误 / 失败</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={usageRowKey(row)}>
                <td>
                  <IdentityCell
                    name={row.name ?? (subject === 'user' ? row.email : row.organizationId)}
                    detail={subject === 'user' ? row.email : row.organizationId}
                    compact
                  />
                </td>
                <td>
                  <div className="usage-stack">
                    <span>API {formatUsageNumber(row.metrics.apiConcurrency)}</span>
                    <span>任务 {formatUsageNumber(row.metrics.jobConcurrency)}</span>
                    <span>Provider {formatUsageNumber(row.metrics.providerConcurrency)}</span>
                  </div>
                </td>
                <td>
                  <div className="usage-stack">
                    <strong>{formatUsageNumber(row.metrics.rpm)} RPM</strong>
                    <span>{formatUsageNumber(row.metrics.tpm)} TPM</span>
                  </div>
                </td>
                <td>
                  <div className="usage-stack">
                    <strong>{formatUsageNumber(row.metrics.requestCount)} 请求</strong>
                    <span>{formatUsageNumber(row.metrics.jobCount)} 任务</span>
                  </div>
                </td>
                <td>
                  <div className="usage-stack">
                    <strong>{formatUsageNumber(row.metrics.totalTokens)}</strong>
                    <span>
                      入 {formatUsageNumber(row.metrics.inputTokens)} / 出{' '}
                      {formatUsageNumber(row.metrics.outputTokens)}
                    </span>
                  </div>
                </td>
                <td>{formatUsageNumber(row.metrics.creditsUsed)}</td>
                <td>
                  <div className="usage-stack">
                    <span>API {formatUsageRatio(row.metrics.errorRate)}</span>
                    <span>任务 {formatUsageRatio(row.metrics.jobFailureRate)}</span>
                  </div>
                </td>
              </tr>
            ))}
            <EmptyRow visible={!visibleRows.length && !loading} columns={7} />
          </tbody>
        </table>
      </DataSection>
    </div>
  )
}

export function UsageControls({ range, generatedAt, loading, onRangeChange, onRefresh }) {
  return (
    <section className="usage-controls">
      <div>
        <span className="eyebrow">Usage</span>
        <strong>{generatedAt ? `更新于 ${formatDate(generatedAt)}` : '等待用量快照'}</strong>
      </div>
      <div className="usage-control-actions">
        <div className="segmented-control" aria-label="用量范围">
          {['today', 'week', 'month'].map((value) => (
            <button
              key={value}
              type="button"
              className={range === value ? 'active' : ''}
              onClick={() => onRangeChange(value)}
            >
              {usageRangeName(value)}
            </button>
          ))}
        </div>
        <button className="icon-text-button" type="button" onClick={onRefresh} disabled={loading}>
          {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
          刷新
        </button>
      </div>
    </section>
  )
}
