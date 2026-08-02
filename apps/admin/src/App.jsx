import {
  Activity,
  AlertTriangle,
  Building2,
  Check,
  Clock,
  CreditCard,
  Filter,
  FileText,
  Gauge,
  Globe,
  IdCard,
  KeyRound,
  LoaderCircle,
  LogOut,
  Monitor,
  PencilLine,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from './apiClient'
import {
  assignableRoleOptions,
  auditLogTone,
  buildSessionRiskRows,
  canCreateOrganizationUser,
  canDisableOrganization,
  canManageBilling,
  canManageMembership,
  canManageOrganization,
  canManageUsers,
  canReadAdminConsole,
  canTransferOrganizationAdmin,
  classifyOrganization,
  filterRows,
  formatDate,
  formatSignedAmount,
  ledgerTypeName,
  membershipIdFor,
  planName,
  riskLevelName,
  roleName,
  shortId,
  statusName,
  summarizeAuditLogs,
  summarizeBillingAdjustments,
  summarizeConsole,
  summarizeSessionRisks,
  organizationTypeName,
} from './adminConsole'

const tabs = [
  { id: 'overview', label: '概览', icon: Gauge },
  { id: 'users', label: '用户', icon: UsersRound },
  { id: 'organizations', label: '组织', icon: Building2 },
  { id: 'memberships', label: '成员关系', icon: IdCard },
  { id: 'billing', label: '账单流水', icon: CreditCard },
  { id: 'adjustments', label: '账单调账', icon: PencilLine },
  { id: 'sessions', label: 'Session', icon: KeyRound },
  { id: 'session-risk', label: 'Session 风险', icon: AlertTriangle },
  { id: 'audit', label: '审计日志', icon: FileText },
]

const loginInitialState = { email: '', password: '' }
const adjustmentInitialState = { amount: '', reason: '' }
const grantInitialState = { amount: '', reason: '' }
const passwordInitialState = { newPassword: '', requireChange: true, revokeSessions: true }
const createUserInitialState = { organizationId: '', email: '', name: '', password: '', role: 'member' }
const organizationAdminTransferInitialState = {
  organizationId: '',
  currentOrganizationAdminUserId: '',
  targetUserId: '',
}

export function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [loginForm, setLoginForm] = useState(loginInitialState)
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [busy, setBusy] = useState('')
  const [adjustTarget, setAdjustTarget] = useState(null)
  const [adjustmentForm, setAdjustmentForm] = useState(adjustmentInitialState)
  const [adjustmentPageMembershipId, setAdjustmentPageMembershipId] = useState('')
  const [adjustmentPageForm, setAdjustmentPageForm] = useState(adjustmentInitialState)
  const [grantOpen, setGrantOpen] = useState(false)
  const [grantForm, setGrantForm] = useState(grantInitialState)
  const [auditActionFilter, setAuditActionFilter] = useState('all')
  const [auditResourceFilter, setAuditResourceFilter] = useState('all')
  const [sessionRiskFilter, setSessionRiskFilter] = useState('all')
  const [organizationTypeFilter, setOrganizationTypeFilter] = useState('all')
  const [passwordTarget, setPasswordTarget] = useState(null)
  const [passwordForm, setPasswordForm] = useState(passwordInitialState)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [createUserForm, setCreateUserForm] = useState(createUserInitialState)
  const [organizationAdminTransferTarget, setOrganizationAdminTransferTarget] = useState(null)
  const [organizationAdminTransferForm, setOrganizationAdminTransferForm] = useState(
    organizationAdminTransferInitialState,
  )

  useEffect(() => {
    let cancelled = false
    api
      .session()
      .then((nextSession) => {
        if (!cancelled) setSession(nextSession)
      })
      .catch(() => {
        if (!cancelled) setSession(null)
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const canReadConsole = canReadAdminConsole(session)
  const canManageAccountStatus = canManageUsers(session)
  const canAdjustBilling = canManageBilling(session)

  const loadConsole = async () => {
    setLoading(true)
    setError('')
    try {
      setSnapshot(await api.adminConsole())
    } catch (requestError) {
      if (requestError.status === 401) setSession(null)
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!session || !canReadConsole) return
    void loadConsole()
  }, [session?.account?.id, session?.account?.tenantId, canReadConsole])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const accounts = snapshot?.billingAccounts?.items ?? []
    if (!accounts.length) {
      setAdjustmentPageMembershipId('')
      return
    }
    setAdjustmentPageMembershipId((current) =>
      current && accounts.some((account) => membershipIdFor(account) === current)
        ? current
        : membershipIdFor(accounts[0]),
    )
  }, [snapshot?.generatedAt])

  const filtered = useMemo(() => {
    if (!snapshot) return null
    const organizationItems = snapshot.organizations?.items ?? snapshot.tenants.items
    return {
      users: filterRows(snapshot.users.items, query),
      organizations: filterRows(organizationItems, query),
      memberships: filterRows(snapshot.memberships.items, query),
      billingAccounts: filterRows(snapshot.billingAccounts.items, query),
      billingLedgerEntries: filterRows(snapshot.billingLedgerEntries.items, query),
      billingPaymentReconciliation: filterRows(snapshot.billingPaymentReconciliation?.items ?? [], query),
      sessions: filterRows(snapshot.sessions.items, query),
      auditLogs: filterRows(snapshot.auditLogs.items, query),
    }
  }, [snapshot, query])

  const summary = useMemo(() => summarizeConsole(snapshot), [snapshot])
  const createUserOrganization = useMemo(
    () =>
      (snapshot?.organizations?.items ?? snapshot?.tenants?.items ?? []).find(
        (organization) => organization.id === createUserForm.organizationId,
      ) ?? null,
    [snapshot, createUserForm.organizationId],
  )
  const createUserRoleOptions = useMemo(
    () => assignableRoleOptions(session, createUserOrganization),
    [session, createUserOrganization],
  )

  const login = async (event) => {
    event.preventDefault()
    setAuthError('')
    setBusy('login')
    try {
      const nextSession = await api.login({
        email: loginForm.email.trim(),
        password: loginForm.password,
      })
      setSession(nextSession)
      setLoginForm(loginInitialState)
    } catch (requestError) {
      setAuthError(requestError.message)
    } finally {
      setBusy('')
    }
  }

  const logout = async () => {
    await runAction('logout', async () => {
      await api.logout()
      setSession(null)
      setSnapshot(null)
    })
  }

  const setUserStatus = async (user) => {
    const nextStatus = user.status === 'active' ? 'disabled' : 'active'
    const confirmed = window.confirm(
      `确认${nextStatus === 'disabled' ? '禁用' : '启用'}账号 ${user.name}？\n\n账号：${user.email ?? user.id}`,
    )
    if (!confirmed) return
    await runAction(`user:${user.id}`, async () => {
      await api.updateUserStatus(user.id, nextStatus)
      await loadConsole()
      setNotice(`账号已${nextStatus === 'disabled' ? '禁用' : '启用'}`)
    })
  }

  const openPasswordReset = (user) => {
    setPasswordTarget(user)
    setPasswordForm(passwordInitialState)
  }

  const forcePasswordReset = async (user) => {
    const confirmed = window.confirm(
      `确认强制 ${user.name} 下次登录修改密码？\n\n账号：${user.email ?? user.id}\n现有 session 将被撤销。`,
    )
    if (!confirmed) return
    await runAction(`force-password:${user.id}`, async () => {
      await api.updatePasswordResetRequirement(user.id, { required: true, revokeSessions: true })
      await loadConsole()
      setNotice('已要求账号下次登录修改密码')
    })
  }

  const openCreateUser = (organizationId = '') => {
    const activeOrganizations = (snapshot?.organizations?.items ?? snapshot?.tenants?.items ?? []).filter(
      (item) => item.status === 'active' && canCreateOrganizationUser(session, item),
    )
    const organization =
      activeOrganizations.find((item) => item.id === organizationId) ?? activeOrganizations[0]
    const roles = assignableRoleOptions(session, organization)
    if (!organization || !roles.length) {
      setNotice('该组织不允许添加当前身份可分配的账号')
      return
    }
    setCreateUserForm({
      ...createUserInitialState,
      organizationId: organization?.id ?? '',
      role: roles[0] ?? 'member',
    })
    setCreateUserOpen(true)
  }

  const submitCreateUser = async (event) => {
    event.preventDefault()
    const confirmed = window.confirm(
      `确认创建 ${roleName(createUserForm.role)} 账号？\n\n邮箱：${createUserForm.email.trim()}\n组织：${createUserForm.organizationId}`,
    )
    if (!confirmed) return
    await runAction('create-user', async () => {
      await api.createOrganizationUser(createUserForm.organizationId, {
        email: createUserForm.email.trim(),
        name: createUserForm.name.trim(),
        password: createUserForm.password,
        role: createUserForm.role,
      })
      setCreateUserOpen(false)
      setCreateUserForm(createUserInitialState)
      await loadConsole()
      setNotice('账号已创建')
    })
  }

  const renameOrganization = async (organization) => {
    const nextName = window.prompt('输入新的组织名称', organization.name)
    const name = nextName?.trim()
    if (!name || name === organization.name) return
    const confirmed = window.confirm(`确认重命名组织？\n\n当前名称：${organization.name}\n新名称：${name}`)
    if (!confirmed) return
    await runAction(`organization-rename:${organization.id}`, async () => {
      await api.updateOrganization(organization.id, { name })
      await loadConsole()
      setNotice('组织已重命名')
    })
  }

  const disableOrganization = async (organization) => {
    const confirmed = window.confirm(
      `确认禁用组织 ${organization.name}？\n\n该组织下现有 session 将失效，创作端无法继续访问。`,
    )
    if (!confirmed) return
    await runAction(`organization-disable:${organization.id}`, async () => {
      await api.disableOrganization(organization.id)
      await loadConsole()
      setNotice('组织已禁用')
    })
  }

  const openOrganizationAdminTransfer = (organization) => {
    const candidates = organizationAdminTransferCandidates(
      snapshot?.memberships?.items ?? [],
      organization.id,
    )
    setOrganizationAdminTransferTarget(organization)
    setOrganizationAdminTransferForm({
      ...organizationAdminTransferInitialState,
      organizationId: organization.id,
      currentOrganizationAdminUserId:
        snapshot?.memberships?.items.find(
          (membership) =>
            membership.tenantId === organization.id &&
            membership.status === 'active' &&
            membership.userStatus === 'active' &&
            membership.roles.includes('organization_admin'),
        )?.userId ?? '',
      targetUserId: candidates[0]?.userId ?? '',
    })
  }

  const submitOrganizationAdminTransfer = async (event) => {
    event.preventDefault()
    if (!organizationAdminTransferTarget) return
    const target = snapshot?.memberships?.items.find(
      (membership) =>
        membership.tenantId === organizationAdminTransferTarget.id &&
        membership.userId === organizationAdminTransferForm.targetUserId,
    )
    const current = snapshot?.memberships?.items.find(
      (membership) =>
        membership.tenantId === organizationAdminTransferTarget.id &&
        membership.userId === organizationAdminTransferForm.currentOrganizationAdminUserId,
    )
    const confirmed = window.confirm(
      `确认更换组织负责人？\n\n组织：${organizationAdminTransferTarget.name}\n当前负责人：${current?.name ?? organizationAdminTransferForm.currentOrganizationAdminUserId}\n新负责人：${target?.name ?? organizationAdminTransferForm.targetUserId}\n当前负责人将降为组织成员`,
    )
    if (!confirmed) return
    await runAction(`organization-admin-change:${organizationAdminTransferTarget.id}`, async () => {
      await api.transferOrganizationAdmin(organizationAdminTransferTarget.id, {
        currentOrganizationAdminUserId: organizationAdminTransferForm.currentOrganizationAdminUserId,
        targetUserId: organizationAdminTransferForm.targetUserId,
      })
      setOrganizationAdminTransferTarget(null)
      setOrganizationAdminTransferForm(organizationAdminTransferInitialState)
      await loadConsole()
      setNotice('组织负责人已更换')
    })
  }

  const updateMembershipRole = async (membership, role) => {
    const confirmed = window.confirm(
      `确认修改成员角色？\n\n成员：${membership.name}\n组织：${membership.tenantName}\n新角色：${roleName(role)}`,
    )
    if (!confirmed) return
    await runAction(`member-role:${membership.id}`, async () => {
      await api.updateMemberRoles(membership.id, [role])
      await loadConsole()
      setNotice('成员角色已更新')
    })
  }

  const disableMembership = async (membership) => {
    const confirmed = window.confirm(
      `确认移除或禁用该成员？\n\n成员：${membership.name}\n组织：${membership.tenantName}\n角色：${membership.roles.map(roleName).join('、')}`,
    )
    if (!confirmed) return
    await runAction(`member-disable:${membership.id}`, async () => {
      await api.disableMembership(membership.id)
      await loadConsole()
      setNotice('成员关系已禁用')
    })
  }

  const submitPasswordReset = async (event) => {
    event.preventDefault()
    if (!passwordTarget) return
    const confirmed = window.confirm(
      `确认给 ${passwordTarget.name} 设置临时密码？\n\n账号：${passwordTarget.email ?? passwordTarget.id}\n${
        passwordForm.requireChange ? '登录后必须再次修改密码。' : '登录后不会强制再次修改密码。'
      }\n${passwordForm.revokeSessions ? '现有 session 将被撤销。' : '现有 session 将保留。'}`,
    )
    if (!confirmed) return
    await runAction(`password:${passwordTarget.id}`, async () => {
      await api.setUserPassword(passwordTarget.id, passwordForm)
      setPasswordTarget(null)
      setPasswordForm(passwordInitialState)
      await loadConsole()
      setNotice('临时密码已设置')
    })
  }

  const revokeSession = async (targetSession) => {
    const confirmed = window.confirm(
      `确认撤销 ${targetSession.name} 的 session？\n\n设备：${targetSession.deviceLabel ?? '未记录'}\nIP：${targetSession.ipAddress ?? '未记录'}`,
    )
    if (!confirmed) return
    await runAction(`session:${targetSession.sessionId}`, async () => {
      await api.revokeSession(targetSession.sessionId)
      await loadConsole()
      setNotice('Session 已撤销')
    })
  }

  const openAdjustment = (membership) => {
    setAdjustTarget(membership)
    setAdjustmentForm(adjustmentInitialState)
  }

  const submitAdjustment = async (event) => {
    event.preventDefault()
    if (!adjustTarget) return
    const membershipId = membershipIdFor(adjustTarget)
    const amount = Number(adjustmentForm.amount)
    const reason = adjustmentForm.reason.trim()
    const confirmed = window.confirm(
      `确认对 ${adjustTarget.name} 执行调账？\n\nMembership：${membershipId}\n积分变化：${formatSignedAmount(amount)}\n原因：${reason}`,
    )
    if (!confirmed) return
    await runAction(`adjust:${membershipId}`, async () => {
      await api.adjustCredits(membershipId, { amount, reason })
      setAdjustTarget(null)
      await loadConsole()
      setNotice('调账已提交')
    })
  }

  const submitPageAdjustment = async (event) => {
    event.preventDefault()
    const target = snapshot?.billingAccounts?.items.find(
      (account) => membershipIdFor(account) === adjustmentPageMembershipId,
    )
    if (!target) return
    const amount = Number(adjustmentPageForm.amount)
    const reason = adjustmentPageForm.reason.trim()
    const membershipId = membershipIdFor(target)
    const confirmed = window.confirm(
      `确认提交账单调账？\n\n目标：${target.name}\n组织：${target.tenantName}\nMembership：${membershipId}\n积分变化：${formatSignedAmount(amount)}\n原因：${reason}`,
    )
    if (!confirmed) return
    await runAction(`adjust-page:${membershipId}`, async () => {
      await api.adjustCredits(membershipId, { amount, reason })
      setAdjustmentPageForm(adjustmentInitialState)
      await loadConsole()
      setNotice('调账已提交')
    })
  }

  const submitGrant = async (event) => {
    event.preventDefault()
    const amount = Number(grantForm.amount)
    const reason = grantForm.reason.trim()
    const confirmed = window.confirm(`确认给当前后台账号充值？\n\n积分：+${amount}\n原因：${reason}`)
    if (!confirmed) return
    await runAction('grant', async () => {
      await api.grantCredits({ amount, reason })
      setGrantOpen(false)
      setGrantForm(grantInitialState)
      await loadConsole()
      setNotice('充值已提交')
    })
  }

  const runAction = async (id, action) => {
    setBusy(id)
    setError('')
    try {
      await action()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy('')
    }
  }

  if (authLoading) {
    return <LoadingScreen label="正在连接后台" />
  }

  if (!session) {
    return (
      <LoginScreen
        form={loginForm}
        busy={busy === 'login'}
        error={authError}
        onChange={setLoginForm}
        onSubmit={login}
      />
    )
  }

  if (!canReadConsole) {
    return <DeniedScreen session={session} busy={busy === 'logout'} onLogout={logout} />
  }

  return (
    <div className="admin-app">
      <header className="admin-topbar">
        <div className="brand-lockup">
          <span className="brand-mark">序</span>
          <div>
            <strong>SEQORA Admin</strong>
            <span>组织 {session.account.organizationId ?? session.account.tenantId}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="operator-chip">
            <span>{session.account.name.slice(0, 1)}</span>
            <div>
              <strong>{session.account.name}</strong>
              <small>{session.account.roles.map(roleName).join('、')}</small>
            </div>
          </div>
          <button className="icon-text-button" type="button" onClick={loadConsole} disabled={loading}>
            {loading ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
            刷新
          </button>
          <button className="icon-button" type="button" aria-label="退出" onClick={logout}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <nav>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon size={17} />
                <span>{tab.label}</span>
                <small>{tabCount(tab.id, summary)}</small>
              </button>
            ))}
          </nav>
        </aside>

        <main className="admin-main">
          <section className="console-toolbar">
            <div>
              <span className="eyebrow">Admin Console</span>
              <h1>{tabs.find((tab) => tab.id === activeTab)?.label ?? '概览'}</h1>
            </div>
            <label className="search-field">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索用户、组织、账单、session 或审计"
              />
            </label>
          </section>

          {notice && <div className="notice success">{notice}</div>}
          {error && <div className="notice error">{error}</div>}

          {!snapshot && loading && <LoadingScreen compact label="正在读取 console 快照" />}
          {snapshot && filtered && (
            <>
              {activeTab === 'overview' && (
                <OverviewPanel snapshot={snapshot} summary={summary} setActiveTab={setActiveTab} />
              )}
              {activeTab === 'users' && (
                <UsersTable
                  users={filtered.users}
                  currentUserId={session.account.id}
                  canManage={canManageAccountStatus}
                  busy={busy}
                  onSetStatus={setUserStatus}
                  onOpenPasswordReset={openPasswordReset}
                  onForcePasswordReset={forcePasswordReset}
                />
              )}
              {activeTab === 'organizations' && (
                <OrganizationsTable
                  organizations={filtered.organizations}
                  session={session}
                  busy={busy}
                  typeFilter={organizationTypeFilter}
                  onTypeFilterChange={setOrganizationTypeFilter}
                  onRename={renameOrganization}
                  onDisable={disableOrganization}
                  onTransferOrganizationAdmin={openOrganizationAdminTransfer}
                  onCreateUser={openCreateUser}
                />
              )}
              {activeTab === 'memberships' && (
                <MembershipsTable
                  memberships={filtered.memberships}
                  session={session}
                  canAdjustBilling={canAdjustBilling}
                  busy={busy}
                  onCreateUser={openCreateUser}
                  onUpdateRole={updateMembershipRole}
                  onDisableMembership={disableMembership}
                  onAdjust={openAdjustment}
                />
              )}
              {activeTab === 'billing' && (
                <BillingPanel
                  accounts={filtered.billingAccounts}
                  entries={filtered.billingLedgerEntries}
                  reconciliation={filtered.billingPaymentReconciliation}
                  canManage={canAdjustBilling}
                  onAdjust={openAdjustment}
                  onGrant={() => setGrantOpen(true)}
                />
              )}
              {activeTab === 'adjustments' && (
                <BillingAdjustmentPage
                  accounts={filtered.billingAccounts}
                  entries={filtered.billingLedgerEntries}
                  selectedMembershipId={adjustmentPageMembershipId}
                  form={adjustmentPageForm}
                  canManage={canAdjustBilling}
                  busy={busy}
                  onSelectMembership={setAdjustmentPageMembershipId}
                  onFormChange={setAdjustmentPageForm}
                  onSubmit={submitPageAdjustment}
                  onGrant={() => setGrantOpen(true)}
                />
              )}
              {activeTab === 'sessions' && (
                <SessionsTable
                  sessions={filtered.sessions}
                  canManage={canManageAccountStatus}
                  busy={busy}
                  onRevoke={revokeSession}
                />
              )}
              {activeTab === 'session-risk' && (
                <SessionRiskView
                  sessions={filtered.sessions}
                  riskFilter={sessionRiskFilter}
                  canManage={canManageAccountStatus}
                  busy={busy}
                  onRiskFilterChange={setSessionRiskFilter}
                  onRevoke={revokeSession}
                />
              )}
              {activeTab === 'audit' && (
                <AuditLogPage
                  entries={filtered.auditLogs}
                  allEntries={snapshot.auditLogs.items}
                  actionFilter={auditActionFilter}
                  resourceFilter={auditResourceFilter}
                  onActionFilterChange={setAuditActionFilter}
                  onResourceFilterChange={setAuditResourceFilter}
                />
              )}
            </>
          )}
        </main>
      </div>

      {adjustTarget && (
        <AdjustmentModal
          target={adjustTarget}
          form={adjustmentForm}
          busy={busy === `adjust:${membershipIdFor(adjustTarget)}`}
          onChange={setAdjustmentForm}
          onClose={() => setAdjustTarget(null)}
          onSubmit={submitAdjustment}
        />
      )}
      {grantOpen && (
        <GrantModal
          form={grantForm}
          busy={busy === 'grant'}
          onChange={setGrantForm}
          onClose={() => setGrantOpen(false)}
          onSubmit={submitGrant}
        />
      )}
      {passwordTarget && (
        <PasswordResetModal
          target={passwordTarget}
          form={passwordForm}
          busy={busy === `password:${passwordTarget.id}`}
          onChange={setPasswordForm}
          onClose={() => setPasswordTarget(null)}
          onSubmit={submitPasswordReset}
        />
      )}
      {createUserOpen && (
        <CreateOrganizationUserModal
          form={createUserForm}
          organizations={(snapshot?.organizations?.items ?? snapshot?.tenants?.items ?? []).filter(
            (organization) => canCreateOrganizationUser(session, organization),
          )}
          roleOptions={createUserRoleOptions}
          busy={busy === 'create-user'}
          onChange={setCreateUserForm}
          onClose={() => setCreateUserOpen(false)}
          onSubmit={submitCreateUser}
        />
      )}
      {organizationAdminTransferTarget && (
        <OrganizationAdminTransferModal
          organization={organizationAdminTransferTarget}
          memberships={snapshot?.memberships?.items ?? []}
          form={organizationAdminTransferForm}
          busy={busy === `organization-admin-change:${organizationAdminTransferTarget.id}`}
          onChange={setOrganizationAdminTransferForm}
          onClose={() => setOrganizationAdminTransferTarget(null)}
          onSubmit={submitOrganizationAdminTransfer}
        />
      )}
    </div>
  )
}

function LoadingScreen({ label, compact = false }) {
  return (
    <div className={compact ? 'loading-state compact' : 'loading-state'}>
      <LoaderCircle size={compact ? 20 : 28} className="spin" />
      <span>{label}</span>
    </div>
  )
}

function LoginScreen({ form, busy, error, onChange, onSubmit }) {
  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={onSubmit}>
        <div className="brand-lockup large">
          <span className="brand-mark">序</span>
          <div>
            <strong>SEQORA Admin</strong>
            <span>管理后台</span>
          </div>
        </div>
        <label>
          <span>邮箱</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            autoComplete="username"
            required
          />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            value={form.password}
            onChange={(event) => onChange({ ...form, password: event.target.value })}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="notice error">{error}</div>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
          登录
        </button>
      </form>
    </main>
  )
}

function DeniedScreen({ session, busy, onLogout }) {
  return (
    <main className="login-shell">
      <section className="login-panel denied">
        <ShieldCheck size={24} />
        <h1>当前账号无后台权限</h1>
        <p>{session.account.email}</p>
        <button className="primary-button" type="button" onClick={onLogout} disabled={busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <LogOut size={16} />}
          退出
        </button>
      </section>
    </main>
  )
}

function OverviewPanel({ snapshot, summary, setActiveTab }) {
  const stats = [
    { label: '用户', value: summary.users, icon: UsersRound, tab: 'users' },
    { label: '组织', value: summary.organizations, icon: Building2, tab: 'organizations' },
    { label: '成员关系', value: summary.memberships, icon: IdCard, tab: 'memberships' },
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

function UsersTable({
  users,
  currentUserId,
  canManage,
  busy,
  onSetStatus,
  onOpenPasswordReset,
  onForcePasswordReset,
}) {
  return (
    <DataSection title="用户列表" count={users.length}>
      <table className="data-table wide">
        <thead>
          <tr>
            <th>用户</th>
            <th>状态</th>
            <th>安全</th>
            <th>角色</th>
            <th>成员关系</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <IdentityCell name={user.name} detail={user.email ?? user.id} />
              </td>
              <td>
                <StatusBadge status={user.status} />
              </td>
              <td>
                <PasswordResetBadge required={user.passwordResetRequired} />
              </td>
              <td>
                <RolePills roles={user.roles} />
              </td>
              <td>
                {user.activeMembershipCount} / {user.membershipCount}
              </td>
              <td>{formatDate(user.updatedAt)}</td>
              <td>
                <div className="row-actions">
                  <button
                    className="row-button"
                    type="button"
                    disabled={!canManage || user.id === currentUserId || busy === `password:${user.id}`}
                    onClick={() => onOpenPasswordReset(user)}
                  >
                    {busy === `password:${user.id}` ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <KeyRound size={14} />
                    )}
                    重置临时密码
                  </button>
                  <button
                    className="row-button danger"
                    type="button"
                    disabled={
                      !canManage ||
                      user.id === currentUserId ||
                      user.passwordResetRequired ||
                      busy === `force-password:${user.id}`
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
                    disabled={!canManage || user.id === currentUserId || busy === `user:${user.id}`}
                    onClick={() => onSetStatus(user)}
                  >
                    {busy === `user:${user.id}` ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Power size={14} />
                    )}
                    {user.status === 'active' ? '禁用' : '启用'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
          <EmptyRow visible={!users.length} columns={7} />
        </tbody>
      </table>
    </DataSection>
  )
}

function OrganizationsTable({
  organizations,
  session,
  busy,
  typeFilter,
  onTypeFilterChange,
  onRename,
  onDisable,
  onTransferOrganizationAdmin,
  onCreateUser,
}) {
  const visibleOrganizations =
    typeFilter === 'all'
      ? organizations
      : organizations.filter((organization) => classifyOrganization(organization).type === typeFilter)
  const typeCounts = summarizeOrganizationTypes(organizations)

  return (
    <DataSection title="组织列表" count={visibleOrganizations.length}>
      <div className="inline-filter-bar organization-filter-bar">
        <label>
          <Building2 size={14} />
          <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)}>
            {['all', 'system', 'test', 'enterprise', 'standard'].map((type) => (
              <option key={type} value={type}>
                {organizationTypeName(type)} · {typeCounts[type] ?? 0}
              </option>
            ))}
          </select>
        </label>
      </div>
      <table className="data-table wide">
        <thead>
          <tr>
            <th>组织</th>
            <th>类型</th>
            <th>状态</th>
            <th>成员</th>
            <th>组织管理员</th>
            <th>创建者</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {visibleOrganizations.map((organization) => {
            const organizationType = classifyOrganization(organization)
            return (
              <tr key={organization.id}>
                <td>
                  <IdentityCell name={organization.name} detail={organization.id} />
                </td>
                <td>
                  <OrganizationTypeBadge organizationType={organizationType} />
                </td>
                <td>
                  <StatusBadge status={organization.status} />
                </td>
                <td>
                  {organization.activeMembershipCount} / {organization.membershipCount}
                </td>
                <td>{organization.activeOrganizationAdminCount}</td>
                <td>{organization.createdByEmail ?? organization.createdByName ?? '-'}</td>
                <td>{formatDate(organization.updatedAt)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="row-button"
                      type="button"
                      disabled={
                        !canManageOrganization(session, organization) ||
                        busy === `organization-rename:${organization.id}`
                      }
                      onClick={() => onRename(organization)}
                    >
                      {busy === `organization-rename:${organization.id}` ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <PencilLine size={14} />
                      )}
                      改名
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      disabled={
                        organization.status !== 'active' || !canCreateOrganizationUser(session, organization)
                      }
                      onClick={() => onCreateUser(organization.id)}
                    >
                      <Plus size={14} />
                      添加账号
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      disabled={
                        !canTransferOrganizationAdmin(session, organization) ||
                        organization.activeOrganizationAdminCount < 1 ||
                        busy === `organization-admin-change:${organization.id}`
                      }
                      onClick={() => onTransferOrganizationAdmin(organization)}
                    >
                      {busy === `organization-admin-change:${organization.id}` ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <ShieldCheck size={14} />
                      )}
                      更换组织负责人
                    </button>
                    <button
                      className="row-button danger"
                      type="button"
                      disabled={
                        organization.status !== 'active' ||
                        !canDisableOrganization(session, organization) ||
                        busy === `organization-disable:${organization.id}`
                      }
                      onClick={() => onDisable(organization)}
                    >
                      {busy === `organization-disable:${organization.id}` ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Power size={14} />
                      )}
                      禁用
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
          <EmptyRow visible={!visibleOrganizations.length} columns={8} />
        </tbody>
      </table>
    </DataSection>
  )
}

function MembershipsTable({
  memberships,
  session,
  canAdjustBilling,
  busy,
  onCreateUser,
  onUpdateRole,
  onDisableMembership,
  onAdjust,
}) {
  return (
    <DataSection title="成员关系查询" count={memberships.length}>
      <div className="section-actions">
        <button
          className="row-button"
          type="button"
          disabled={!canManageUsers(session)}
          onClick={() => onCreateUser()}
        >
          <Plus size={14} />
          添加账号
        </button>
      </div>
      <table className="data-table wide">
        <thead>
          <tr>
            <th>成员</th>
            <th>组织</th>
            <th>状态</th>
            <th>角色</th>
            <th>套餐</th>
            <th>积分</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {memberships.map((membership) => (
            <tr key={membership.id}>
              <td>
                <IdentityCell name={membership.name} detail={membership.email ?? membership.userId} />
              </td>
              <td>
                <IdentityCell name={membership.tenantName} detail={membership.tenantId} compact />
              </td>
              <td>
                <StatusPair
                  primary={membership.membershipStatus ?? membership.status}
                  secondary={membership.userStatus}
                />
              </td>
              <td>
                <RoleEditor
                  membership={membership}
                  session={session}
                  busy={busy === `member-role:${membership.id}`}
                  onUpdateRole={onUpdateRole}
                />
              </td>
              <td>{planName(membership.plan)}</td>
              <td>{membership.credits}</td>
              <td>{formatDate(membership.updatedAt)}</td>
              <td>
                <div className="row-actions">
                  <button
                    className="row-button"
                    type="button"
                    disabled={!canAdjustBilling}
                    onClick={() => onAdjust(membership)}
                  >
                    <PencilLine size={14} />
                    调账
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
                    移除
                  </button>
                </div>
              </td>
            </tr>
          ))}
          <EmptyRow visible={!memberships.length} columns={8} />
        </tbody>
      </table>
    </DataSection>
  )
}

function BillingPanel({ accounts, entries, reconciliation, canManage, onAdjust, onGrant }) {
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
                    disabled={!canManage}
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

function BillingAdjustmentPage({
  accounts,
  entries,
  selectedMembershipId,
  form,
  canManage,
  busy,
  onSelectMembership,
  onFormChange,
  onSubmit,
  onGrant,
}) {
  const selectedAccount =
    accounts.find((account) => membershipIdFor(account) === selectedMembershipId) ?? accounts[0] ?? null
  const selectedId = selectedAccount ? membershipIdFor(selectedAccount) : ''
  const amount = Number(form.amount)
  const validAmount = Number.isInteger(amount) && amount !== 0
  const projectedBalance = selectedAccount && validAmount ? selectedAccount.credits + amount : null
  const adjustmentEntries = entries.filter((entry) => entry.type === 'adjustment' || entry.type === 'grant')
  const summary = summarizeBillingAdjustments(adjustmentEntries)

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
              <StatusPair primary={selectedAccount.membershipStatus} secondary={selectedAccount.userStatus} />
            </div>
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
            disabled={
              !canManage ||
              !selectedAccount ||
              !validAmount ||
              !form.reason.trim() ||
              projectedBalance < 0 ||
              busy === `adjust-page:${selectedId}`
            }
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
              <th>成员关系</th>
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

function SessionsTable({ sessions, canManage, busy, onRevoke }) {
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
                <button
                  className="row-button danger"
                  type="button"
                  disabled={
                    !canManage ||
                    session.current ||
                    session.status !== 'active' ||
                    busy === `session:${session.sessionId}`
                  }
                  onClick={() => onRevoke(session)}
                >
                  {busy === `session:${session.sessionId}` ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <LogOut size={14} />
                  )}
                  {session.current ? '当前' : '撤销'}
                </button>
              </td>
            </tr>
          ))}
          <EmptyRow visible={!sessions.length} columns={8} />
        </tbody>
      </table>
    </DataSection>
  )
}

function SessionRiskView({ sessions, riskFilter, canManage, busy, onRiskFilterChange, onRevoke }) {
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
            {visibleRows.map((session) => (
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
                  <button
                    className="row-button danger"
                    type="button"
                    disabled={
                      !canManage ||
                      session.current ||
                      session.status !== 'active' ||
                      busy === `session:${session.sessionId}`
                    }
                    onClick={() => onRevoke(session)}
                  >
                    {busy === `session:${session.sessionId}` ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <LogOut size={14} />
                    )}
                    撤销
                  </button>
                </td>
              </tr>
            ))}
            <EmptyRow visible={!visibleRows.length} columns={8} />
          </tbody>
        </table>
      </DataSection>
    </div>
  )
}

function AuditLogPage({
  entries,
  allEntries,
  actionFilter,
  resourceFilter,
  onActionFilterChange,
  onResourceFilterChange,
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
                <code>{compactJson(entry.metadata)}</code>
              </div>
            </article>
          ))}
          {!visibleEntries.length && <p className="empty-table">没有匹配的审计日志。</p>}
        </div>
      </DataSection>
    </div>
  )
}

function AdjustmentModal({ target, form, busy, onChange, onClose, onSubmit }) {
  const amount = Number(form.amount)
  const valid = Number.isInteger(amount) && amount !== 0 && form.reason.trim().length > 0
  return (
    <Modal title="后台调账" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell name={target.name} detail={`${target.tenantName} · ${target.email ?? target.userId}`} />
        <label>
          <span>积分变化</span>
          <input
            type="number"
            value={form.amount}
            onChange={(event) => onChange({ ...form, amount: event.target.value })}
            min="-1000000"
            max="1000000"
            required
          />
        </label>
        <label>
          <span>原因</span>
          <input
            value={form.reason}
            onChange={(event) => onChange({ ...form, reason: event.target.value })}
            maxLength={200}
            required
          />
        </label>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="提交调账" />
      </form>
    </Modal>
  )
}

function GrantModal({ form, busy, onChange, onClose, onSubmit }) {
  const amount = Number(form.amount)
  const valid = Number.isInteger(amount) && amount > 0 && form.reason.trim().length > 0
  return (
    <Modal title="当前账号充值" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>积分</span>
          <input
            type="number"
            value={form.amount}
            onChange={(event) => onChange({ ...form, amount: event.target.value })}
            min="1"
            max="1000000"
            required
          />
        </label>
        <label>
          <span>原因</span>
          <input
            value={form.reason}
            onChange={(event) => onChange({ ...form, reason: event.target.value })}
            maxLength={200}
            required
          />
        </label>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="提交充值" />
      </form>
    </Modal>
  )
}

function PasswordResetModal({ target, form, busy, onChange, onClose, onSubmit }) {
  const passwordLength = form.newPassword.length
  const valid = passwordLength >= 12 && passwordLength <= 128
  return (
    <Modal title="设置临时密码" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell name={target.name} detail={target.email ?? target.id} />
        <label>
          <span>临时密码</span>
          <input
            type="password"
            value={form.newPassword}
            onChange={(event) => onChange({ ...form, newPassword: event.target.value })}
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.requireChange}
            onChange={(event) => onChange({ ...form, requireChange: event.target.checked })}
          />
          <span>要求用户登录后再次修改密码</span>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.revokeSessions}
            onChange={(event) => onChange({ ...form, revokeSessions: event.target.checked })}
          />
          <span>撤销该账号现有 session</span>
        </label>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="设置临时密码" />
      </form>
    </Modal>
  )
}

function CreateOrganizationUserModal({
  form,
  organizations,
  roleOptions,
  busy,
  onChange,
  onClose,
  onSubmit,
}) {
  const activeOrganizations = organizations.filter((organization) => organization.status === 'active')
  const valid =
    form.organizationId &&
    form.email.trim().includes('@') &&
    form.name.trim().length > 0 &&
    form.password.length >= 12 &&
    roleOptions.includes(form.role)

  return (
    <Modal title="添加账号" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>组织</span>
          <select
            value={form.organizationId}
            onChange={(event) => onChange({ ...form, organizationId: event.target.value })}
            disabled={!activeOrganizations.length}
            required
          >
            {activeOrganizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name} · {organization.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>邮箱</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span>姓名</span>
          <input
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            maxLength={80}
            required
          />
        </label>
        <label>
          <span>初始临时密码</span>
          <input
            type="password"
            value={form.password}
            onChange={(event) => onChange({ ...form, password: event.target.value })}
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
          <small>创建后交给用户首次登录；系统会立即要求用户设置自己的新密码。</small>
        </label>
        <label>
          <span>身份</span>
          <select
            value={form.role}
            onChange={(event) => onChange({ ...form, role: event.target.value })}
            required
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {roleName(role)}
              </option>
            ))}
          </select>
        </label>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="创建账号" />
      </form>
    </Modal>
  )
}

function OrganizationAdminTransferModal({
  organization,
  memberships,
  form,
  busy,
  onChange,
  onClose,
  onSubmit,
}) {
  const candidates = organizationAdminTransferCandidates(memberships, organization.id)
  const current = memberships.find(
    (membership) =>
      membership.tenantId === organization.id && membership.userId === form.currentOrganizationAdminUserId,
  )
  const valid = Boolean(form.currentOrganizationAdminUserId && form.targetUserId)
  return (
    <Modal title="更换组织负责人" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell name={organization.name} detail={organization.id} />
        <label>
          <span>当前负责人</span>
          <select
            value={form.currentOrganizationAdminUserId}
            onChange={(event) => onChange({ ...form, currentOrganizationAdminUserId: event.target.value })}
            disabled={!current}
            required
          >
            {current && (
              <option value={current.userId}>
                {current.name} · {current.email ?? current.userId}
              </option>
            )}
          </select>
        </label>
        <label>
          <span>新负责人</span>
          <select
            value={form.targetUserId}
            onChange={(event) => onChange({ ...form, targetUserId: event.target.value })}
            disabled={!candidates.length}
            required
          >
            {candidates.map((membership) => (
              <option key={membership.id} value={membership.userId}>
                {membership.name} · {membership.email ?? membership.userId}
              </option>
            ))}
          </select>
        </label>
        <p className="modal-hint">当前负责人将降为组织成员，平台所有者不会变化。</p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="确认更换" />
      </form>
    </Modal>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function ModalActions({ busy, valid, onClose, submitLabel }) {
  return (
    <div className="modal-actions">
      <button className="row-button" type="button" onClick={onClose} disabled={busy}>
        取消
      </button>
      <button className="primary-button" type="submit" disabled={busy || !valid}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}
        {submitLabel}
      </button>
    </div>
  )
}

function DataSection({ title, count, children }) {
  return (
    <section className="data-section">
      <header>
        <h2>{title}</h2>
        <span>{count}</span>
      </header>
      <div className="table-scroll">{children}</div>
    </section>
  )
}

function IdentityCell({ name, detail, compact = false }) {
  return (
    <div className={compact ? 'identity-cell compact' : 'identity-cell'}>
      <span>{name?.slice(0, 1) || '用'}</span>
      <div>
        <strong>{name || '-'}</strong>
        <small>{detail || '-'}</small>
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  return <span className={`status-badge ${status}`}>{statusName(status)}</span>
}

function PaymentStatusBadge({ status }) {
  const labels = {
    processed: '已处理',
    ignored: '已忽略',
    failed: '失败',
  }
  return <span className={`payment-status-badge ${status}`}>{labels[status] ?? status}</span>
}

function PasswordResetBadge({ required }) {
  return (
    <span
      className={required ? 'security-badge required' : 'security-badge'}
      title={required ? '账号状态：用户需使用管理员设置的临时密码登录并修改密码' : '密码状态正常'}
    >
      {required ? '首次登录需改密' : '正常'}
    </span>
  )
}

function StatusPair({ primary, secondary }) {
  return (
    <div className="status-pair">
      <StatusBadge status={primary} />
      {secondary && secondary !== primary && <small>{statusName(secondary)}</small>}
    </div>
  )
}

function RolePills({ roles }) {
  return (
    <div className="role-pills">
      {roles.map((role) => (
        <span key={role}>{roleName(role)}</span>
      ))}
    </div>
  )
}

function RoleEditor({ membership, session, busy, onUpdateRole }) {
  const options = assignableRoleOptions(session, membership)
  const currentRole = membership.roles[0] ?? 'member'
  const editable = canManageMembership(session, membership) && !membership.roles.includes('owner')
  const visibleOptions = options.includes(currentRole) ? options : [currentRole, ...options]

  if (!editable || visibleOptions.length < 2) return <RolePills roles={membership.roles} />

  return (
    <label className="role-editor">
      <select
        value={currentRole}
        disabled={busy}
        onChange={(event) => onUpdateRole(membership, event.target.value)}
      >
        {visibleOptions.map((role) => (
          <option key={role} value={role}>
            {roleName(role)}
          </option>
        ))}
      </select>
      {busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
    </label>
  )
}

function OrganizationTypeBadge({ organizationType }) {
  return (
    <span className={`organization-type-badge ${organizationType.type}`} title={organizationType.description}>
      {organizationType.label}
    </span>
  )
}

function EmptyRow({ visible, columns }) {
  if (!visible) return null
  return (
    <tr>
      <td colSpan={columns}>
        <p className="empty-table">没有匹配的数据。</p>
      </td>
    </tr>
  )
}

function tabCount(tabId, summary) {
  const counts = {
    overview: '',
    users: summary.users,
    organizations: summary.organizations,
    tenants: summary.organizations,
    memberships: summary.memberships,
    billing: summary.billingAccounts,
    adjustments: summary.billingAccounts,
    sessions: summary.sessions,
    'session-risk': summary.sessions,
    audit: summary.auditLogs,
  }
  return counts[tabId] ?? ''
}

function MetricBlock({ icon: Icon, label, value, tone = '' }) {
  return (
    <div className={tone ? `metric-block ${tone}` : 'metric-block'}>
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function userAgentSummary(userAgent) {
  if (!userAgent) return '-'
  if (userAgent.includes('Chrome')) return 'Chrome'
  if (userAgent.includes('Firefox')) return 'Firefox'
  if (userAgent.includes('Safari')) return 'Safari'
  return userAgent.slice(0, 34)
}

function RiskBadge({ level }) {
  return <span className={`risk-badge ${level}`}>{riskLevelName(level)}</span>
}

function ReasonPills({ reasons }) {
  return (
    <div className="reason-pills">
      {reasons.map((reason) => (
        <span key={reason}>{reason}</span>
      ))}
    </div>
  )
}

function DeviceCell({ session }) {
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

function formatInactiveHours(hours) {
  if (hours < 1) return '1 小时内'
  if (hours < 24) return `${Math.floor(hours)} 小时`
  return `${Math.floor(hours / 24)} 天`
}

function uniqueValues(rows, field) {
  return Array.from(new Set(rows.map((row) => row[field]).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )
}

function compactJson(value) {
  const text = JSON.stringify(value ?? {})
  return text.length > 96 ? `${text.slice(0, 93)}...` : text
}

function organizationAdminTransferCandidates(memberships, tenantId) {
  return memberships.filter(
    (membership) =>
      membership.tenantId === tenantId &&
      membership.status === 'active' &&
      membership.userStatus === 'active' &&
      membership.roles.includes('organization_member'),
  )
}

function summarizeOrganizationTypes(organizations) {
  return organizations.reduce(
    (summary, organization) => {
      summary.all += 1
      const type = classifyOrganization(organization).type
      summary[type] = (summary[type] ?? 0) + 1
      return summary
    },
    { all: 0, system: 0, test: 0, enterprise: 0, standard: 0 },
  )
}
