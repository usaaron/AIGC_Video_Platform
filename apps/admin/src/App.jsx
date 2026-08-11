import {
  Activity,
  AlertTriangle,
  Building2,
  Check,
  Clock,
  Copy,
  CreditCard,
  Crown,
  Filter,
  FileText,
  Gauge,
  Globe,
  IdCard,
  KeyRound,
  LoaderCircle,
  LogOut,
  MailPlus,
  Monitor,
  PencilLine,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from './apiClient'
import {
  assignableRoleOptions,
  auditLogTone,
  addExistingOrganizationMemberRoleOptions,
  buildSessionRiskRows,
  canAddExistingOrganizationMember,
  canCreateOrganization,
  canCreateOrganizationUser,
  canDisableOrganization,
  canLeaveOrganization,
  canManageBilling,
  canManageBillingAccount,
  canManageMembership,
  canManageOrganization,
  canManageOrganizationBilling,
  canManageUsers,
  canReadAdminConsole,
  canReadOrganizationBilling,
  canTransferOrganizationAdmin,
  canUpdateMembershipPlan,
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
  isEnterpriseOrganization,
  isPersonalAccountMembership,
  isPlatformAdminSession,
  summarizeAuditLogs,
  summarizeBillingAdjustments,
  summarizeConsole,
  summarizeSessionRisks,
  organizationTypeName,
} from './adminConsole'

const tabs = [
  { id: 'overview', label: '概览', icon: Gauge },
  { id: 'usage-realtime', label: '实时用量', icon: Activity },
  { id: 'usage-users', label: '用户用量', icon: UsersRound },
  { id: 'usage-organizations', label: '组织用量', icon: Building2 },
  { id: 'users', label: '用户', icon: UsersRound },
  { id: 'personal-accounts', label: '个人账号', icon: IdCard },
  { id: 'organizations', label: '企业组织', icon: Building2 },
  { id: 'memberships', label: '账号归属', icon: IdCard },
  { id: 'compliance', label: '合规审查', icon: ShieldAlert, platformOnly: true },
  { id: 'invitations', label: '邀请', icon: MailPlus },
  { id: 'billing', label: '账单流水', icon: CreditCard },
  { id: 'reconciliation-alerts', label: '对账告警', icon: AlertTriangle },
  { id: 'adjustments', label: '账单调账', icon: PencilLine },
  { id: 'sessions', label: 'Session', icon: KeyRound },
  { id: 'session-risk', label: 'Session 风险', icon: AlertTriangle },
  { id: 'audit', label: '审计日志', icon: FileText },
]

const loginInitialState = { email: '', password: '' }
const adjustmentInitialState = { amount: '', reason: '' }
const grantInitialState = { amount: '', reason: '' }
const organizationBillingAdjustmentInitialState = { amount: '', reason: '' }
const membershipPlanInitialState = { plan: 'free', grantMonthlyCredits: true, reason: '' }
const passwordInitialState = { newPassword: '', requireChange: true, revokeSessions: true }
const reconciliationAlertMessageDefaults = {
  acknowledged: '已确认，正在处理',
  resolved: '已解决，已完成对账',
}
const createOrganizationInitialState = { name: '' }
const createUserInitialState = { organizationId: '', email: '', name: '', password: '', role: 'member' }
const addExistingMemberInitialState = { organizationId: '', email: '', role: 'organization_member' }
const createInvitationInitialState = { organizationId: '', email: '', role: 'member' }
const sessionRiskAuditInitialState = { userId: '', items: [], loading: false, error: '' }
const consoleFilterInitialState = { tenantId: '', role: '', status: '', limit: 50, offset: 0 }
const complianceFilterInitialState = {
  q: '',
  userId: '',
  tenantId: '',
  source: '',
  category: 'all',
  limit: 50,
  offset: 0,
  sample: false,
}
const complianceActionInitialState = { action: 'reviewed', reason: '', category: '' }
const consolePageSizeOptions = [25, 50, 100]
const complianceSourceLabels = {
  generation_task: '生成任务',
  ai_job: 'AI Job',
}
const complianceSeverityLabels = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}
const complianceCategoryLabels = {
  political_sensitive: '政治敏感',
  terrorism: '涉恐/爆炸物',
  sexual_content: '涉黄/性内容',
  graphic_violence: '极端血腥暴力',
  extremism: '极端主义/仇恨',
  self_harm: '自伤自杀',
  other: '其他',
}
const consoleRoleFilterOptions = [
  'owner',
  'super_admin',
  'admin',
  'member',
  'organization_admin',
  'organization_member',
]
const consoleStatusFilterOptions = ['active', 'disabled']
const organizationAdminTransferInitialState = {
  organizationId: '',
  currentOrganizationAdminUserId: '',
  targetUserId: '',
}
const WEB_ORIGIN = (import.meta.env.VITE_WEB_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '')
const organizationScopedRoles = new Set(['organization_admin', 'organization_member'])
const usageTabIds = new Set(['usage-realtime', 'usage-users', 'usage-organizations'])

function isUsageTab(tabId) {
  return usageTabIds.has(tabId)
}

function roleRequiresOrganization(role) {
  return organizationScopedRoles.has(role)
}

function platformRoleScopeName(role) {
  return role === 'member' ? 'C 端个人空间（自动创建）' : '平台内部系统组织'
}

function invitationUrlFor(token) {
  return `${WEB_ORIGIN}/register?token=${encodeURIComponent(token)}`
}

export function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [loginForm, setLoginForm] = useState(loginInitialState)
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [usageSummary, setUsageSummary] = useState(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState('')
  const [usageRange, setUsageRange] = useState('today')
  const [compliancePrompts, setCompliancePrompts] = useState(null)
  const [complianceLoading, setComplianceLoading] = useState(false)
  const [complianceError, setComplianceError] = useState('')
  const [complianceFilters, setComplianceFilters] = useState(complianceFilterInitialState)
  const [complianceDetailId, setComplianceDetailId] = useState('')
  const [complianceActionTarget, setComplianceActionTarget] = useState(null)
  const [complianceActionForm, setComplianceActionForm] = useState(complianceActionInitialState)
  const [notice, setNotice] = useState('')
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [consoleFilters, setConsoleFilters] = useState(consoleFilterInitialState)
  const [activeTab, setActiveTab] = useState('overview')
  const [busy, setBusy] = useState('')
  const [adjustTarget, setAdjustTarget] = useState(null)
  const [adjustmentForm, setAdjustmentForm] = useState(adjustmentInitialState)
  const [adjustmentPageMembershipId, setAdjustmentPageMembershipId] = useState('')
  const [adjustmentPageForm, setAdjustmentPageForm] = useState(adjustmentInitialState)
  const [grantOpen, setGrantOpen] = useState(false)
  const [grantForm, setGrantForm] = useState(grantInitialState)
  const [organizationBillingTarget, setOrganizationBillingTarget] = useState(null)
  const [organizationBillingSummary, setOrganizationBillingSummary] = useState(null)
  const [organizationBillingLoading, setOrganizationBillingLoading] = useState(false)
  const [organizationBillingError, setOrganizationBillingError] = useState('')
  const [organizationBillingAdjustmentForm, setOrganizationBillingAdjustmentForm] = useState(
    organizationBillingAdjustmentInitialState,
  )
  const [membershipPlanTarget, setMembershipPlanTarget] = useState(null)
  const [membershipPlanForm, setMembershipPlanForm] = useState(membershipPlanInitialState)
  const [auditActionFilter, setAuditActionFilter] = useState('all')
  const [auditResourceFilter, setAuditResourceFilter] = useState('all')
  const [sessionRiskFilter, setSessionRiskFilter] = useState('all')
  const [invitationPageOrganizationId, setInvitationPageOrganizationId] = useState('')
  const [invitationStatusFilter, setInvitationStatusFilter] = useState('all')
  const [reconciliationAlertStatusFilter, setReconciliationAlertStatusFilter] = useState('open')
  const [reconciliationAlertSeverityFilter, setReconciliationAlertSeverityFilter] = useState('all')
  const [reconciliationAlertAction, setReconciliationAlertAction] = useState(null)
  const [reconciliationAlertMessage, setReconciliationAlertMessage] = useState('')
  const [passwordTarget, setPasswordTarget] = useState(null)
  const [passwordForm, setPasswordForm] = useState(passwordInitialState)
  const [createOrganizationOpen, setCreateOrganizationOpen] = useState(false)
  const [createOrganizationForm, setCreateOrganizationForm] = useState(createOrganizationInitialState)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [createUserForm, setCreateUserForm] = useState(createUserInitialState)
  const [addExistingMemberOpen, setAddExistingMemberOpen] = useState(false)
  const [addExistingMemberForm, setAddExistingMemberForm] = useState(addExistingMemberInitialState)
  const [createInvitationOpen, setCreateInvitationOpen] = useState(false)
  const [createInvitationForm, setCreateInvitationForm] = useState(createInvitationInitialState)
  const [createdInvitation, setCreatedInvitation] = useState(null)
  const [invitationManagerTarget, setInvitationManagerTarget] = useState(null)
  const [invitationItems, setInvitationItems] = useState([])
  const [invitationLoading, setInvitationLoading] = useState(false)
  const [invitationError, setInvitationError] = useState('')
  const [userDetailId, setUserDetailId] = useState('')
  const [organizationDetailId, setOrganizationDetailId] = useState('')
  const [membershipDetailId, setMembershipDetailId] = useState('')
  const [auditDetailId, setAuditDetailId] = useState('')
  const [sessionRiskDetailId, setSessionRiskDetailId] = useState('')
  const [sessionRiskAuditContext, setSessionRiskAuditContext] = useState(sessionRiskAuditInitialState)
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
  const canReviewCompliance = isPlatformAdminSession(session)
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => !tab.platformOnly || canReviewCompliance),
    [canReviewCompliance],
  )

  const consoleRequestParams = useMemo(
    () => ({
      limit: consoleFilters.limit,
      offset: consoleFilters.offset,
      ...(query ? { q: query } : {}),
      ...(consoleFilters.tenantId ? { tenantId: consoleFilters.tenantId } : {}),
      ...(consoleFilters.role ? { role: consoleFilters.role } : {}),
      ...(consoleFilters.status ? { status: consoleFilters.status } : {}),
    }),
    [consoleFilters, query],
  )

  const loadConsole = async () => {
    setLoading(true)
    setError('')
    try {
      setSnapshot(await api.adminConsole(consoleRequestParams))
    } catch (requestError) {
      if (requestError.status === 401) setSession(null)
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  const loadUsage = async () => {
    setUsageLoading(true)
    setUsageError('')
    try {
      setUsageSummary(await api.adminUsage({ range: usageRange, limit: 100, offset: 0 }))
    } catch (requestError) {
      if (requestError.status === 401) setSession(null)
      setUsageError(requestError.message)
    } finally {
      setUsageLoading(false)
    }
  }

  const loadCompliancePrompts = async (overrides = {}) => {
    if (!canReviewCompliance) return
    const nextFilters = { ...complianceFilters, ...overrides }
    setComplianceLoading(true)
    setComplianceError('')
    try {
      setCompliancePrompts(
        await api.adminCompliancePrompts({
          limit: nextFilters.limit,
          offset: nextFilters.sample ? 0 : nextFilters.offset,
          sample: nextFilters.sample ? 'true' : undefined,
          ...(nextFilters.q.trim() ? { q: nextFilters.q.trim() } : {}),
          ...(nextFilters.userId.trim() ? { userId: nextFilters.userId.trim() } : {}),
          ...(nextFilters.tenantId.trim() ? { tenantId: nextFilters.tenantId.trim() } : {}),
          ...(nextFilters.source ? { source: nextFilters.source } : {}),
        }),
      )
    } catch (requestError) {
      if (requestError.status === 401) setSession(null)
      setComplianceError(requestError.message)
    } finally {
      setComplianceLoading(false)
    }
  }

  useEffect(() => {
    if (!session || !canReadConsole) return
    void loadConsole()
  }, [session?.account?.id, session?.account?.tenantId, canReadConsole, consoleRequestParams])

  useEffect(() => {
    if (!session || !canReadConsole || !isUsageTab(activeTab)) return
    void loadUsage()
  }, [session?.account?.id, session?.account?.tenantId, canReadConsole, activeTab, usageRange])

  useEffect(() => {
    if (!session || !canReadConsole || activeTab !== 'compliance' || !canReviewCompliance) return
    void loadCompliancePrompts()
  }, [session?.account?.id, canReadConsole, activeTab, canReviewCompliance, complianceFilters])

  useEffect(() => {
    if (activeTab === 'compliance' && !canReviewCompliance) setActiveTab('overview')
  }, [activeTab, canReviewCompliance])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConsoleFilters((current) => (current.offset === 0 ? current : { ...current, offset: 0 }))
      setQuery(queryDraft.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [queryDraft])

  useEffect(() => {
    setConsoleFilters((current) => (current.offset === 0 ? current : { ...current, offset: 0 }))
    setError('')
  }, [activeTab])

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

  const organizationItems = useMemo(
    () => snapshot?.organizations?.items ?? snapshot?.tenants?.items ?? [],
    [snapshot],
  )
  const enterpriseOrganizationItems = useMemo(
    () => organizationItems.filter(isEnterpriseOrganization),
    [organizationItems],
  )
  const personalAccountMemberships = useMemo(
    () => (snapshot?.memberships?.items ?? []).filter(isPersonalAccountMembership),
    [snapshot],
  )
  const compliancePromptItems = useMemo(() => compliancePrompts?.items ?? [], [compliancePrompts])
  const visibleCompliancePromptItems = useMemo(() => {
    if (complianceFilters.category === 'all') return compliancePromptItems
    if (complianceFilters.category === 'none') {
      return compliancePromptItems.filter((item) => item.riskTags.length === 0)
    }
    return compliancePromptItems.filter((item) =>
      item.riskTags.some((tag) => tag.category === complianceFilters.category),
    )
  }, [complianceFilters.category, compliancePromptItems])
  const complianceDetailTarget = useMemo(
    () => compliancePromptItems.find((item) => item.id === complianceDetailId) ?? null,
    [compliancePromptItems, complianceDetailId],
  )
  const organizationDetailTarget = useMemo(
    () => organizationItems.find((organization) => organization.id === organizationDetailId) ?? null,
    [organizationItems, organizationDetailId],
  )
  const userDetailTarget = useMemo(
    () => snapshot?.users?.items.find((user) => user.id === userDetailId) ?? null,
    [snapshot, userDetailId],
  )
  const membershipDetailTarget = useMemo(
    () =>
      snapshot?.memberships?.items.find((membership) => membershipIdFor(membership) === membershipDetailId) ??
      null,
    [snapshot, membershipDetailId],
  )
  const auditDetailTarget = useMemo(
    () => snapshot?.auditLogs?.items.find((entry) => entry.id === auditDetailId) ?? null,
    [snapshot, auditDetailId],
  )
  const sessionRiskDetailTarget = useMemo(
    () =>
      buildSessionRiskRows(snapshot?.sessions?.items ?? []).find(
        (item) => item.sessionId === sessionRiskDetailId,
      ) ?? null,
    [snapshot, sessionRiskDetailId],
  )
  const creatableOrganizations = useMemo(
    () =>
      enterpriseOrganizationItems.filter(
        (item) => item.status === 'active' && canCreateOrganizationUser(session, item),
      ),
    [enterpriseOrganizationItems, session],
  )
  const manageableInvitationOrganizations = useMemo(
    () => enterpriseOrganizationItems.filter((item) => canManageOrganization(session, item)),
    [enterpriseOrganizationItems, session],
  )
  const invitationPageOrganization = useMemo(
    () =>
      manageableInvitationOrganizations.find(
        (organization) => organization.id === invitationPageOrganizationId,
      ) ??
      manageableInvitationOrganizations[0] ??
      null,
    [manageableInvitationOrganizations, invitationPageOrganizationId],
  )

  const filtered = useMemo(() => {
    if (!snapshot) return null
    return {
      users: snapshot.users.items,
      organizations: enterpriseOrganizationItems,
      personalAccounts: personalAccountMemberships,
      memberships: snapshot.memberships.items,
      billingAccounts: snapshot.billingAccounts.items,
      billingLedgerEntries: snapshot.billingLedgerEntries.items,
      billingPaymentReconciliation: snapshot.billingPaymentReconciliation?.items ?? [],
      billingReconciliationAlerts: snapshot.billingReconciliationAlerts?.items ?? [],
      sessions: snapshot.sessions.items,
      auditLogs: snapshot.auditLogs.items,
    }
  }, [snapshot, enterpriseOrganizationItems, personalAccountMemberships])

  const summary = useMemo(() => summarizeConsole(snapshot), [snapshot])
  const createUserOrganization = useMemo(
    () => organizationItems.find((organization) => organization.id === createUserForm.organizationId) ?? null,
    [organizationItems, createUserForm.organizationId],
  )
  const createUserRoleOptions = useMemo(() => assignableRoleOptions(session, null), [session])
  const addExistingMemberOrganization = useMemo(
    () =>
      organizationItems.find((organization) => organization.id === addExistingMemberForm.organizationId) ??
      null,
    [organizationItems, addExistingMemberForm.organizationId],
  )
  const addExistingMemberRoleOptions = useMemo(
    () => addExistingOrganizationMemberRoleOptions(session, addExistingMemberOrganization),
    [session, addExistingMemberOrganization],
  )
  const createInvitationOrganization = useMemo(
    () =>
      organizationItems.find((organization) => organization.id === createInvitationForm.organizationId) ??
      null,
    [organizationItems, createInvitationForm.organizationId],
  )
  const createInvitationRoleOptions = useMemo(() => assignableRoleOptions(session, null), [session])
  const activeListMeta = useMemo(() => {
    if (activeTab === 'organizations') return clientListMeta(enterpriseOrganizationItems.length, consoleFilters)
    if (activeTab === 'personal-accounts') return clientListMeta(personalAccountMemberships.length, consoleFilters)
    return activeConsoleListMeta(snapshot, activeTab)
  }, [snapshot, activeTab, enterpriseOrganizationItems.length, personalAccountMemberships.length, consoleFilters])
  const organizationFilterOptions = useMemo(() => {
    if (activeTab === 'organizations') {
      return organizationOptionsForFilter(enterpriseOrganizationItems, consoleFilters.tenantId)
    }
    if (activeTab === 'personal-accounts') {
      return membershipOrganizationOptionsForFilter(personalAccountMemberships, consoleFilters.tenantId)
    }
    return organizationOptionsForFilter(organizationItems, consoleFilters.tenantId)
  }, [
    activeTab,
    enterpriseOrganizationItems,
    organizationItems,
    personalAccountMemberships,
    consoleFilters.tenantId,
  ])
  const organizationFilterLabel = useMemo(() => {
    if (activeTab === 'organizations') return '全部企业组织'
    if (activeTab === 'personal-accounts') return '全部个人/系统归属'
    return '全部组织/空间'
  }, [activeTab])

  useEffect(() => {
    if (!snapshot || !consoleFilters.tenantId) return
    if (
      activeTab === 'organizations' &&
      !enterpriseOrganizationItems.some((organization) => organization.id === consoleFilters.tenantId)
    ) {
      setConsoleFilters((current) => ({ ...current, tenantId: '', offset: 0 }))
    }
    if (
      activeTab === 'personal-accounts' &&
      !personalAccountMemberships.some(
        (membership) => (membership.tenantId ?? membership.organizationId) === consoleFilters.tenantId,
      )
    ) {
      setConsoleFilters((current) => ({ ...current, tenantId: '', offset: 0 }))
    }
  }, [
    activeTab,
    consoleFilters.tenantId,
    enterpriseOrganizationItems,
    personalAccountMemberships,
    snapshot,
  ])

  const updateConsoleFilters = (patch, { resetOffset = true } = {}) => {
    setConsoleFilters((current) => ({
      ...current,
      ...patch,
      offset: resetOffset ? 0 : (patch.offset ?? current.offset),
    }))
  }

  const clearConsoleFilters = () => {
    setQueryDraft('')
    setQuery('')
    setConsoleFilters(consoleFilterInitialState)
  }

  const updateComplianceFilters = (patch, { resetOffset = true } = {}) => {
    setComplianceFilters((current) => ({
      ...current,
      ...patch,
      offset: resetOffset ? 0 : (patch.offset ?? current.offset),
      sample: patch.sample ?? (resetOffset ? false : current.sample),
    }))
  }

  const clearComplianceFilters = () => {
    setComplianceFilters(complianceFilterInitialState)
  }

  const refreshComplianceSample = () => {
    setComplianceFilters((current) => ({ ...current, sample: true, offset: 0 }))
  }

  const goToComplianceOffset = (offset) => {
    updateComplianceFilters({ offset: Math.max(0, offset), sample: false }, { resetOffset: false })
  }

  const goToConsoleOffset = (offset) => {
    updateConsoleFilters({ offset: Math.max(0, offset) }, { resetOffset: false })
  }

  const changeConsolePageSize = (limit) => {
    updateConsoleFilters({ limit: Number(limit), offset: 0 })
  }

  const refreshActiveData = () => {
    if (isUsageTab(activeTab)) {
      void loadUsage()
      return
    }
    if (activeTab === 'compliance') {
      void loadCompliancePrompts()
      return
    }
    void loadConsole()
  }

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
      if (activeTab === 'compliance') await loadCompliancePrompts()
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
    const organization =
      creatableOrganizations.find((item) => item.id === organizationId) ?? creatableOrganizations[0]
    const roles = assignableRoleOptions(session, null)
    const organizationRoles = organization
      ? assignableRoleOptions(session, organization).filter(roleRequiresOrganization)
      : []
    const role = organizationId
      ? (organizationRoles[0] ?? roles[0])
      : (roles.find((item) => !roleRequiresOrganization(item)) ?? roles[0])
    if (!roles.length || !role) {
      setNotice('当前身份不允许添加账号')
      return
    }
    setCreateUserForm({
      ...createUserInitialState,
      organizationId: roleRequiresOrganization(role) ? (organization?.id ?? '') : '',
      role,
    })
    setCreateUserOpen(true)
  }

  const openCreateOrganization = () => {
    if (!canCreateOrganization(session)) {
      setNotice('当前身份不能创建组织')
      return
    }
    setCreateOrganizationForm(createOrganizationInitialState)
    setCreateOrganizationOpen(true)
  }

  const openAddExistingMember = (organizationId = '') => {
    const organizations = organizationItems.filter((organization) =>
      canAddExistingOrganizationMember(session, organization),
    )
    const organization = organizations.find((item) => item.id === organizationId) ?? organizations[0]
    const roles = addExistingOrganizationMemberRoleOptions(session, organization)
    const role = roles.includes(addExistingMemberInitialState.role)
      ? addExistingMemberInitialState.role
      : roles[0]
    if (!organization || !role) {
      setNotice('当前身份不能加入已有账号')
      return
    }
    setAddExistingMemberForm({
      ...addExistingMemberInitialState,
      organizationId: organization.id,
      role,
    })
    setAddExistingMemberOpen(true)
  }

  const openCreateInvitation = (organizationId = '') => {
    const organization =
      creatableOrganizations.find((item) => item.id === organizationId) ?? creatableOrganizations[0]
    const roles = assignableRoleOptions(session, null)
    const organizationRoles = organization
      ? assignableRoleOptions(session, organization).filter(roleRequiresOrganization)
      : []
    const role = organizationId
      ? (organizationRoles[0] ?? roles[0])
      : (roles.find((item) => !roleRequiresOrganization(item)) ?? roles[0])
    if (!roles.length || !role) {
      setNotice('当前身份不允许创建邀请')
      return
    }
    setCreateInvitationForm({
      ...createInvitationInitialState,
      organizationId: roleRequiresOrganization(role) ? (organization?.id ?? '') : '',
      role,
    })
    setCreateInvitationOpen(true)
  }

  async function loadOrganizationInvitations(organization = invitationManagerTarget) {
    if (!organization) return
    setInvitationLoading(true)
    setInvitationError('')
    try {
      setInvitationItems(await api.listOrganizationInvitations(organization.id))
    } catch (requestError) {
      setInvitationError(requestError.message)
    } finally {
      setInvitationLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab !== 'invitations') return
    const selected = invitationPageOrganization
    if (!selected) {
      setInvitationItems([])
      return
    }
    if (selected.id !== invitationPageOrganizationId) {
      setInvitationPageOrganizationId(selected.id)
      return
    }
    void loadOrganizationInvitations(selected)
  }, [activeTab, invitationPageOrganization, invitationPageOrganizationId])

  const selectInvitationPageOrganization = async (organizationId) => {
    setInvitationPageOrganizationId(organizationId)
    const organization = manageableInvitationOrganizations.find((item) => item.id === organizationId)
    if (organization) await loadOrganizationInvitations(organization)
  }

  const openInvitationManager = async (organization) => {
    if (!canManageOrganization(session, organization)) {
      setNotice('当前身份不能管理该组织邀请')
      return
    }
    setInvitationManagerTarget(organization)
    setInvitationItems([])
    await loadOrganizationInvitations(organization)
  }

  const openOrganizationDetail = (organization) => {
    setUserDetailId('')
    setMembershipDetailId('')
    setOrganizationDetailId(organization.id)
  }

  const openUserDetail = (user) => {
    setOrganizationDetailId('')
    setMembershipDetailId('')
    setUserDetailId(user.id)
  }

  const openMembershipDetail = (membership) => {
    setUserDetailId('')
    setOrganizationDetailId('')
    setMembershipDetailId(membershipIdFor(membership))
  }

  const openComplianceDetail = (item) => {
    setUserDetailId('')
    setOrganizationDetailId('')
    setMembershipDetailId('')
    setComplianceDetailId(item.id)
  }

  const openComplianceAction = (item, action) => {
    setComplianceActionTarget(item)
    setComplianceActionForm({
      action,
      reason: action === 'warned' ? '提示词存在合规风险，已对账号发出人工警告' : '人工抽查已完成',
      category: item.riskTags[0]?.category ?? '',
    })
  }

  const openAuditDetail = (entry) => {
    setAuditDetailId(entry.id)
  }

  const closeAuditDetail = () => {
    setAuditDetailId('')
  }

  const searchConsoleTab = (tabId, value, message) => {
    const searchValue = value || ''
    setAuditDetailId('')
    setActiveTab(tabId)
    setQueryDraft(searchValue)
    setQuery(searchValue)
    setConsoleFilters((current) => ({ ...current, offset: 0 }))
    if (message) setNotice(message)
  }

  const openAuditUserReference = (userId) => {
    if (!userId) return
    const user = snapshot?.users?.items.find((item) => item.id === userId)
    if (!user) {
      searchConsoleTab('users', userId, '当前快照未包含该用户，已切到用户列表并按 ID 搜索')
      return
    }
    setAuditDetailId('')
    setActiveTab('users')
    openUserDetail(user)
  }

  const openAuditOrganizationReference = (organizationId) => {
    if (!organizationId) return
    const organization = organizationItems.find((item) => item.id === organizationId)
    if (!organization) {
      searchConsoleTab('organizations', organizationId, '当前快照未包含该组织，已切到组织列表并按 ID 搜索')
      return
    }
    setAuditDetailId('')
    setActiveTab('organizations')
    openOrganizationDetail(organization)
  }

  const openAuditMembershipReference = (membershipId) => {
    if (!membershipId) return
    const membership = snapshot?.memberships?.items.find((item) => membershipIdFor(item) === membershipId)
    if (!membership) {
      searchConsoleTab('memberships', membershipId, '当前快照未包含该 membership，已切到账号归属列表并按 ID 搜索')
      return
    }
    setAuditDetailId('')
    setActiveTab('memberships')
    openMembershipDetail(membership)
  }

  const openAuditBillingReference = (referenceId) => {
    if (!referenceId) return
    searchConsoleTab('billing', referenceId, '已切到账单页并按关联 ID 搜索')
  }

  const openAuditSessionReference = (sessionId) => {
    if (!sessionId) return
    searchConsoleTab('session-risk', sessionId, '已切到 Session 风险页并按 session ID 搜索')
  }

  const submitCreateUser = async (event) => {
    event.preventDefault()
    const needsOrganization = roleRequiresOrganization(createUserForm.role)
    const organizationName = createUserOrganization?.name ?? createUserForm.organizationId
    const scopeLine = needsOrganization
      ? `组织：${organizationName}`
      : `范围：${platformRoleScopeName(createUserForm.role)}`
    const confirmed = window.confirm(
      `确认创建 ${roleName(createUserForm.role)} 账号？\n\n邮箱：${createUserForm.email.trim()}\n${scopeLine}`,
    )
    if (!confirmed) return
    await runAction('create-user', async () => {
      const payload = {
        email: createUserForm.email.trim(),
        name: createUserForm.name.trim(),
        password: createUserForm.password,
        role: createUserForm.role,
      }
      if (needsOrganization) {
        await api.createOrganizationUser(createUserForm.organizationId, payload)
      } else {
        await api.createPlatformUser(payload)
      }
      setCreateUserOpen(false)
      setCreateUserForm(createUserInitialState)
      await loadConsole()
      setNotice('账号已创建')
    })
  }

  const submitCreateOrganization = async (event) => {
    event.preventDefault()
    const name = createOrganizationForm.name.trim()
    const confirmed = window.confirm(`确认创建组织？\n\n组织名称：${name}\n创建后不会切换当前后台登录组织。`)
    if (!confirmed) return
    await runAction('create-organization', async () => {
      const organization = await api.createOrganization({ name })
      setCreateOrganizationOpen(false)
      setCreateOrganizationForm(createOrganizationInitialState)
      await loadConsole()
      setOrganizationDetailId(organization.id)
      setNotice('组织已创建')
    })
  }

  const submitAddExistingMember = async (event) => {
    event.preventDefault()
    const organization = addExistingMemberOrganization
    if (!organization) return
    const email = addExistingMemberForm.email.trim()
    const confirmed = window.confirm(
      `确认把已有账号加入组织？\n\n组织：${organization.name}\n账号：${email}\n身份：${roleName(addExistingMemberForm.role)}`,
    )
    if (!confirmed) return
    await runAction('add-existing-member', async () => {
      await api.addExistingOrganizationMember(organization.id, {
        email,
        roles: [addExistingMemberForm.role],
      })
      setAddExistingMemberOpen(false)
      setAddExistingMemberForm(addExistingMemberInitialState)
      await loadConsole()
      setNotice('已有账号已加入组织')
    })
  }

  const submitCreateInvitation = async (event) => {
    event.preventDefault()
    const email = createInvitationForm.email.trim()
    const needsOrganization = roleRequiresOrganization(createInvitationForm.role)
    const organizationName = createInvitationOrganization?.name ?? createInvitationForm.organizationId
    const scopeLine = needsOrganization
      ? `组织：${organizationName}`
      : `范围：${platformRoleScopeName(createInvitationForm.role)}`
    const confirmed = window.confirm(
      `确认创建 ${roleName(createInvitationForm.role)} 邀请？\n\n邮箱：${email}\n${scopeLine}\n受邀人注册后会获得该身份。`,
    )
    if (!confirmed) return
    await runAction('create-invitation', async () => {
      const payload = {
        email,
        roles: [createInvitationForm.role],
      }
      const invitation = needsOrganization
        ? await api.createOrganizationInvitation(createInvitationForm.organizationId, payload)
        : await api.createPlatformInvitation(payload)
      setCreateInvitationOpen(false)
      setCreateInvitationForm(createInvitationInitialState)
      setCreatedInvitation(invitation)
      if (needsOrganization && invitationManagerTarget?.id === createInvitationForm.organizationId) {
        await loadOrganizationInvitations(invitationManagerTarget)
      }
      if (
        needsOrganization &&
        activeTab === 'invitations' &&
        invitationPageOrganization?.id === createInvitationForm.organizationId
      ) {
        await loadOrganizationInvitations(invitationPageOrganization)
      }
      await loadConsole()
      setNotice('邀请已创建，请保存邀请码')
    })
  }

  const reissueInvitation = async (invitation, organization = invitationManagerTarget) => {
    if (!organization) return
    const confirmed = window.confirm(
      `确认重新生成邀请码？\n\n邮箱：${invitation.email}\n组织：${organization.name}\n身份：${invitation.roles.map(roleName).join('、')}\n旧邀请码将立即失效。`,
    )
    if (!confirmed) return
    await runAction(`invitation-reissue:${invitation.id}`, async () => {
      const nextInvitation = await api.createOrganizationInvitation(organization.id, {
        email: invitation.email,
        roles: invitation.roles,
      })
      setCreatedInvitation(nextInvitation)
      await loadOrganizationInvitations(organization)
      await loadConsole()
      setNotice('邀请码已重新生成，请保存新邀请码')
    })
  }

  const revokeInvitation = async (invitation, organization = invitationManagerTarget) => {
    if (!organization) return
    const confirmed = window.confirm(
      `确认撤销邀请？\n\n邮箱：${invitation.email}\n组织：${organization.name}\n撤销后该邀请码不能再注册。`,
    )
    if (!confirmed) return
    await runAction(`invitation-revoke:${invitation.id}`, async () => {
      await api.revokeOrganizationInvitation(organization.id, invitation.id)
      await loadOrganizationInvitations(organization)
      await loadConsole()
      setNotice('邀请已撤销')
    })
  }

  const copyText = async (text, successMessage) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(text)
      setNotice(successMessage)
    } catch {
      setError('浏览器不支持自动复制，请手动选择内容复制')
    }
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

  const leaveOrganization = async (organization) => {
    const confirmed = window.confirm(
      `确认退出组织？\n\n组织：${organization.name}\n退出后当前组织下的 session 会失效。`,
    )
    if (!confirmed) return
    await runAction(`organization-leave:${organization.id}`, async () => {
      const nextSession = await api.leaveOrganization(organization.id)
      setOrganizationDetailId('')
      if (nextSession) {
        setSession(nextSession)
        await loadConsole()
        setNotice('已退出组织')
      } else {
        setSession(null)
        setSnapshot(null)
      }
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
      setNotice('账号归属已禁用')
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

  const revokeUserSessions = async (targetSession) => {
    const confirmed = window.confirm(
      `确认踢下线该用户的全部活跃 session？\n\n用户：${targetSession.name}\n账号：${targetSession.email ?? targetSession.userId}\n这个操作会撤销该用户当前所有活跃 session。`,
    )
    if (!confirmed) return
    await runAction(`user-sessions:${targetSession.userId}`, async () => {
      const result = await api.revokeUserSessions(targetSession.userId)
      await loadConsole()
      setNotice(`已踢下线 ${result.revokedSessionCount ?? 0} 个 session`)
    })
  }

  const forcePasswordResetFromSession = async (targetSession) => {
    await forcePasswordReset({
      id: targetSession.userId,
      name: targetSession.name,
      email: targetSession.email,
    })
  }

  const openSessionRiskDetail = async (targetSession) => {
    setSessionRiskDetailId(targetSession.sessionId)
    setSessionRiskAuditContext({
      ...sessionRiskAuditInitialState,
      userId: targetSession.userId,
      loading: true,
    })
    try {
      const result = await api.adminAuditLogs({ userId: targetSession.userId, limit: 50, offset: 0 })
      setSessionRiskAuditContext({
        userId: targetSession.userId,
        items: result.items,
        loading: false,
        error: '',
      })
    } catch (requestError) {
      setSessionRiskAuditContext({
        userId: targetSession.userId,
        items: [],
        loading: false,
        error: requestError.message,
      })
    }
  }

  const openAdjustment = (membership) => {
    setAdjustTarget(membership)
    setAdjustmentForm(adjustmentInitialState)
  }

  const submitAdjustment = async (event) => {
    event.preventDefault()
    if (!adjustTarget) return
    const membershipId = membershipIdFor(adjustTarget)
    if (!canManageBillingAccount(session, adjustTarget)) {
      setNotice('当前角色不能调整该 membership 的账单')
      return
    }
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
    if (!canManageBillingAccount(session, target)) {
      setNotice('当前角色不能调整该 membership 的账单')
      return
    }
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

  const loadOrganizationBillingSummary = async (organization = organizationBillingTarget) => {
    if (!organization) return
    setOrganizationBillingLoading(true)
    setOrganizationBillingError('')
    try {
      const summary = await api.organizationBillingSummary(organization.id)
      setOrganizationBillingSummary(summary)
    } catch (requestError) {
      setOrganizationBillingSummary(null)
      setOrganizationBillingError(requestError.message)
    } finally {
      setOrganizationBillingLoading(false)
    }
  }

  const openOrganizationBilling = async (organization) => {
    if (!canReadOrganizationBilling(session, organization)) {
      setNotice('当前角色不能查看该组织共享积分池')
      return
    }
    setOrganizationBillingTarget(organization)
    setOrganizationBillingSummary(null)
    setOrganizationBillingError('')
    setOrganizationBillingAdjustmentForm(organizationBillingAdjustmentInitialState)
    await loadOrganizationBillingSummary(organization)
  }

  const submitOrganizationBillingAdjustment = async (event) => {
    event.preventDefault()
    if (!organizationBillingTarget) return
    if (!canManageOrganizationBilling(session, organizationBillingTarget)) {
      setNotice('当前角色不能调整该组织共享积分池')
      return
    }
    const amount = Number(organizationBillingAdjustmentForm.amount)
    const reason = organizationBillingAdjustmentForm.reason.trim()
    const confirmed = window.confirm(
      `确认调整组织共享积分池？\n\n组织：${organizationBillingTarget.name}\n积分变化：${formatSignedAmount(amount)}\n原因：${reason}`,
    )
    if (!confirmed) return
    await runAction(`organization-adjust:${organizationBillingTarget.id}`, async () => {
      await api.adjustOrganizationCredits(organizationBillingTarget.id, { amount, reason })
      setOrganizationBillingAdjustmentForm(organizationBillingAdjustmentInitialState)
      await loadOrganizationBillingSummary(organizationBillingTarget)
      await loadConsole()
      setNotice('组织共享池调账已提交')
    })
  }

  const openMembershipPlan = (membership) => {
    setMembershipPlanTarget(membership)
    setMembershipPlanForm({
      ...membershipPlanInitialState,
      plan: membership.plan ?? 'free',
    })
  }

  const submitMembershipPlan = async (event) => {
    event.preventDefault()
    if (!membershipPlanTarget) return
    const membershipId = membershipIdFor(membershipPlanTarget)
    if (!canUpdateMembershipPlan(session, membershipPlanTarget)) {
      setNotice('当前角色不能修改该 membership 的套餐')
      return
    }
    const reason = membershipPlanForm.reason.trim()
    const confirmed = window.confirm(
      `确认修改会员套餐？\n\n成员：${membershipPlanTarget.name}\nMembership：${membershipId}\n套餐：${planName(membershipPlanForm.plan)}\n发放月度积分：${membershipPlanForm.grantMonthlyCredits ? '是' : '否'}`,
    )
    if (!confirmed) return
    await runAction(`membership-plan:${membershipId}`, async () => {
      await api.updateMembershipPlan(membershipId, {
        plan: membershipPlanForm.plan,
        grantMonthlyCredits: membershipPlanForm.grantMonthlyCredits,
        ...(reason ? { reason } : {}),
      })
      setMembershipPlanTarget(null)
      setMembershipPlanForm(membershipPlanInitialState)
      await loadConsole()
      setNotice('会员套餐已更新')
    })
  }

  const openReconciliationAlertAction = (alert, status) => {
    setReconciliationAlertAction({ alert, status })
    setReconciliationAlertMessage(reconciliationAlertMessageDefaults[status] ?? '')
  }

  const submitReconciliationAlertAction = async (event) => {
    event.preventDefault()
    if (!reconciliationAlertAction) return
    const { alert, status } = reconciliationAlertAction
    const statusLabel = status === 'acknowledged' ? '确认' : '解决'
    const message = reconciliationAlertMessage.trim()
    await runAction(`reconciliation-alert:${alert.id}:${status}`, async () => {
      await api.updateReconciliationAlert(alert.id, {
        status,
        ...(message ? { message } : {}),
        metadata: { handledFrom: 'admin_console', handledAction: status },
      })
      setReconciliationAlertAction(null)
      setReconciliationAlertMessage('')
      await loadConsole()
      setNotice(`对账告警已${statusLabel}`)
    })
  }

  const submitComplianceAction = async (event) => {
    event.preventDefault()
    if (!complianceActionTarget) return
    const reason = complianceActionForm.reason.trim()
    if (!reason) return
    const actionLabel = complianceActionForm.action === 'warned' ? '警告' : '已审查'
    await runAction(`compliance:${complianceActionTarget.id}:${complianceActionForm.action}`, async () => {
      await api.recordCompliancePromptAction(
        complianceActionTarget.source,
        complianceActionTarget.sourceId,
        {
          action: complianceActionForm.action,
          reason,
          ...(complianceActionForm.category ? { category: complianceActionForm.category } : {}),
        },
      )
      setComplianceActionTarget(null)
      setComplianceActionForm(complianceActionInitialState)
      await loadCompliancePrompts()
      setNotice(`合规记录已标记为${actionLabel}`)
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
            <strong>序幕TV Admin</strong>
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
          <button
            className="icon-text-button"
            type="button"
            onClick={refreshActiveData}
            disabled={loading || usageLoading || complianceLoading}
          >
            {loading || usageLoading || complianceLoading ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <RefreshCw size={16} />
            )}
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
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon size={17} />
                <span>{tab.label}</span>
                <small>
                  {tabCount(tab.id, summary, {
                    enterpriseOrganizations: enterpriseOrganizationItems.length,
                    personalAccounts: personalAccountMemberships.length,
                  })}
                </small>
              </button>
            ))}
          </nav>
        </aside>

        <main className="admin-main">
          <section className="console-toolbar">
            <div>
              <span className="eyebrow">Admin Console</span>
              <h1>{visibleTabs.find((tab) => tab.id === activeTab)?.label ?? '概览'}</h1>
            </div>
            {activeTab !== 'compliance' && (
              <label className="search-field">
                <Search size={16} />
                <input
                  value={queryDraft}
                  onChange={(event) => setQueryDraft(event.target.value)}
                  placeholder="搜索用户、组织、账单、session 或审计"
                />
              </label>
            )}
          </section>

          {!isUsageTab(activeTab) && activeTab !== 'compliance' && (
            <ConsoleServerControls
              filters={consoleFilters}
              query={queryDraft}
              loading={loading}
              organizations={organizationFilterOptions}
              organizationPlaceholder={organizationFilterLabel}
              activeMeta={activeListMeta}
              onFilterChange={updateConsoleFilters}
              onClear={clearConsoleFilters}
              onPageSizeChange={changeConsolePageSize}
              onPageOffsetChange={goToConsoleOffset}
            />
          )}

          {notice && (
            <DismissibleNotice tone="success" onClose={() => setNotice('')}>
              {notice}
            </DismissibleNotice>
          )}
          {error && (
            <DismissibleNotice tone="error" onClose={() => setError('')}>
              {error}
            </DismissibleNotice>
          )}

          {!snapshot && loading && <LoadingScreen compact label="正在读取 console 快照" />}
          {snapshot && filtered && (
            <>
              {activeTab === 'overview' && (
                <OverviewPanel snapshot={snapshot} summary={summary} setActiveTab={setActiveTab} />
              )}
              {activeTab === 'usage-realtime' && (
                <UsageRealtimePage
                  summary={usageSummary}
                  loading={usageLoading}
                  error={usageError}
                  range={usageRange}
                  onRangeChange={setUsageRange}
                  onRefresh={loadUsage}
                />
              )}
              {activeTab === 'usage-users' && (
                <UsageTablePage
                  title="用户用量"
                  subject="user"
                  rows={usageSummary?.users ?? []}
                  loading={usageLoading}
                  error={usageError}
                  query={query}
                  range={usageRange}
                  onRangeChange={setUsageRange}
                  onRefresh={loadUsage}
                />
              )}
              {activeTab === 'usage-organizations' && (
                <UsageTablePage
                  title="组织用量"
                  subject="organization"
                  rows={usageSummary?.organizations ?? []}
                  loading={usageLoading}
                  error={usageError}
                  query={query}
                  range={usageRange}
                  onRangeChange={setUsageRange}
                  onRefresh={loadUsage}
                />
              )}
              {activeTab === 'users' && (
                <UsersTable
                  users={filtered.users}
                  currentUserId={session.account.id}
                  canManage={canManageAccountStatus}
                  busy={busy}
                  onOpenDetail={openUserDetail}
                  onSetStatus={setUserStatus}
                  onOpenPasswordReset={openPasswordReset}
                  onForcePasswordReset={forcePasswordReset}
                />
              )}
              {activeTab === 'personal-accounts' && (
                <PersonalAccountsTable
                  memberships={filtered.personalAccounts}
                  session={session}
                  currentUserId={session.account.id}
                  canManage={canManageAccountStatus}
                  canAdjustBilling={canAdjustBilling}
                  busy={busy}
                  onOpenDetail={openMembershipDetail}
                  onUpdateRole={updateMembershipRole}
                  onAdjust={openAdjustment}
                  onUpdatePlan={openMembershipPlan}
                  onOpenPasswordReset={openPasswordReset}
                  onSetStatus={setUserStatus}
                />
              )}
              {activeTab === 'organizations' && (
                <OrganizationsTable
                  organizations={filtered.organizations}
                  session={session}
                  busy={busy}
                  onOpenDetail={openOrganizationDetail}
                  onCreateOrganization={openCreateOrganization}
                  onRename={renameOrganization}
                  onDisable={disableOrganization}
                  onTransferOrganizationAdmin={openOrganizationAdminTransfer}
                  onCreateUser={openCreateUser}
                  onAddExistingMember={openAddExistingMember}
                  onCreateInvitation={openCreateInvitation}
                  onManageInvitations={openInvitationManager}
                  onOpenOrganizationBilling={openOrganizationBilling}
                />
              )}
              {activeTab === 'memberships' && (
                <MembershipsTable
                  memberships={filtered.memberships}
                  session={session}
                  canAdjustBilling={canAdjustBilling}
                  busy={busy}
                  onCreateUser={openCreateUser}
                  onCreateInvitation={openCreateInvitation}
                  onOpenDetail={openMembershipDetail}
                  onUpdateRole={updateMembershipRole}
                  onDisableMembership={disableMembership}
                  onAdjust={openAdjustment}
                  onUpdatePlan={openMembershipPlan}
                />
              )}
              {activeTab === 'compliance' && canReviewCompliance && (
                <ComplianceReviewPage
                  prompts={visibleCompliancePromptItems}
                  allPrompts={compliancePromptItems}
                  meta={compliancePrompts?.meta ?? { limit: complianceFilters.limit, offset: 0, total: 0 }}
                  generatedAt={compliancePrompts?.generatedAt ?? null}
                  filters={complianceFilters}
                  loading={complianceLoading}
                  error={complianceError}
                  busy={busy}
                  currentUserId={session.account.id}
                  onFilterChange={updateComplianceFilters}
                  onClear={clearComplianceFilters}
                  onRefresh={() => loadCompliancePrompts()}
                  onSample={refreshComplianceSample}
                  onPageOffsetChange={goToComplianceOffset}
                  onOpenDetail={openComplianceDetail}
                  onOpenUser={(item) => searchConsoleTab('users', item.userId)}
                  onOpenOrganization={(item) =>
                    searchConsoleTab(
                      item.organizationType === 'enterprise' ? 'organizations' : 'memberships',
                      item.tenantId,
                    )
                  }
                  onReview={(item) => openComplianceAction(item, 'reviewed')}
                  onWarn={(item) => openComplianceAction(item, 'warned')}
                  onDisableUser={(item) =>
                    setUserStatus({
                      id: item.userId,
                      name: item.name,
                      email: item.email,
                      status: item.userStatus,
                    })
                  }
                />
              )}
              {activeTab === 'invitations' && (
                <InvitationsPage
                  organizations={manageableInvitationOrganizations}
                  selectedOrganization={invitationPageOrganization}
                  selectedOrganizationId={invitationPageOrganization?.id ?? ''}
                  invitations={invitationItems}
                  loading={invitationLoading}
                  error={invitationError}
                  session={session}
                  busy={busy}
                  query={query}
                  statusFilter={invitationStatusFilter}
                  onStatusFilterChange={setInvitationStatusFilter}
                  onSelectOrganization={selectInvitationPageOrganization}
                  onCreateInvitation={() =>
                    invitationPageOrganization
                      ? openCreateInvitation(invitationPageOrganization.id)
                      : openCreateInvitation()
                  }
                  onRefresh={() => loadOrganizationInvitations(invitationPageOrganization)}
                  onReissue={(invitation) => reissueInvitation(invitation, invitationPageOrganization)}
                  onRevoke={(invitation) => revokeInvitation(invitation, invitationPageOrganization)}
                />
              )}
              {activeTab === 'billing' && (
                <BillingPanel
                  accounts={filtered.billingAccounts}
                  entries={filtered.billingLedgerEntries}
                  reconciliation={filtered.billingPaymentReconciliation}
                  alerts={filtered.billingReconciliationAlerts}
                  organizations={organizationItems}
                  session={session}
                  canManage={canAdjustBilling}
                  busy={busy}
                  onAdjust={openAdjustment}
                  onUpdatePlan={openMembershipPlan}
                  onGrant={() => setGrantOpen(true)}
                  onUpdateAlert={openReconciliationAlertAction}
                  onOpenAlertsPage={() => setActiveTab('reconciliation-alerts')}
                />
              )}
              {activeTab === 'reconciliation-alerts' && (
                <ReconciliationAlertsPage
                  alerts={filtered.billingReconciliationAlerts}
                  reconciliation={filtered.billingPaymentReconciliation}
                  organizations={organizationItems}
                  statusFilter={reconciliationAlertStatusFilter}
                  severityFilter={reconciliationAlertSeverityFilter}
                  canManage={canAdjustBilling}
                  busy={busy}
                  onStatusFilterChange={setReconciliationAlertStatusFilter}
                  onSeverityFilterChange={setReconciliationAlertSeverityFilter}
                  onUpdateAlert={openReconciliationAlertAction}
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
                  onOpenOrganizationBilling={openOrganizationBilling}
                  organizations={organizationItems}
                  session={session}
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
                  currentUserId={session.account.id}
                  onRiskFilterChange={setSessionRiskFilter}
                  onRevoke={revokeSession}
                  onRevokeUserSessions={revokeUserSessions}
                  onForcePasswordReset={forcePasswordResetFromSession}
                  onOpenDetail={openSessionRiskDetail}
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
                  onOpenDetail={openAuditDetail}
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
      {organizationBillingTarget && (
        <OrganizationBillingModal
          organization={organizationBillingTarget}
          summary={organizationBillingSummary}
          loading={organizationBillingLoading}
          error={organizationBillingError}
          form={organizationBillingAdjustmentForm}
          canManage={canManageOrganizationBilling(session, organizationBillingTarget)}
          busy={busy === `organization-adjust:${organizationBillingTarget.id}`}
          onChange={setOrganizationBillingAdjustmentForm}
          onRefresh={() => loadOrganizationBillingSummary(organizationBillingTarget)}
          onClose={() => {
            setOrganizationBillingTarget(null)
            setOrganizationBillingSummary(null)
            setOrganizationBillingError('')
            setOrganizationBillingAdjustmentForm(organizationBillingAdjustmentInitialState)
          }}
          onSubmit={submitOrganizationBillingAdjustment}
        />
      )}
      {membershipPlanTarget && (
        <MembershipPlanModal
          membership={membershipPlanTarget}
          form={membershipPlanForm}
          busy={busy === `membership-plan:${membershipIdFor(membershipPlanTarget)}`}
          onChange={setMembershipPlanForm}
          onClose={() => {
            setMembershipPlanTarget(null)
            setMembershipPlanForm(membershipPlanInitialState)
          }}
          onSubmit={submitMembershipPlan}
        />
      )}
      {reconciliationAlertAction && (
        <ReconciliationAlertActionModal
          alert={reconciliationAlertAction.alert}
          status={reconciliationAlertAction.status}
          message={reconciliationAlertMessage}
          organizationName={organizationNameFor(
            organizationItems,
            organizationIdFromRow(reconciliationAlertAction.alert),
          )}
          busy={
            busy ===
            `reconciliation-alert:${reconciliationAlertAction.alert.id}:${reconciliationAlertAction.status}`
          }
          onMessageChange={setReconciliationAlertMessage}
          onClose={() => {
            setReconciliationAlertAction(null)
            setReconciliationAlertMessage('')
          }}
          onSubmit={submitReconciliationAlertAction}
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
          organizations={creatableOrganizations}
          roleOptions={createUserRoleOptions}
          session={session}
          busy={busy === 'create-user'}
          onChange={setCreateUserForm}
          onClose={() => setCreateUserOpen(false)}
          onSubmit={submitCreateUser}
        />
      )}
      {createOrganizationOpen && (
        <CreateOrganizationModal
          form={createOrganizationForm}
          busy={busy === 'create-organization'}
          onChange={setCreateOrganizationForm}
          onClose={() => setCreateOrganizationOpen(false)}
          onSubmit={submitCreateOrganization}
        />
      )}
      {addExistingMemberOpen && (
        <AddExistingMemberModal
          form={addExistingMemberForm}
          organizations={manageableInvitationOrganizations}
          roleOptions={addExistingMemberRoleOptions}
          session={session}
          busy={busy === 'add-existing-member'}
          onChange={setAddExistingMemberForm}
          onClose={() => setAddExistingMemberOpen(false)}
          onSubmit={submitAddExistingMember}
        />
      )}
      {createInvitationOpen && (
        <CreateInvitationModal
          form={createInvitationForm}
          organizations={creatableOrganizations}
          roleOptions={createInvitationRoleOptions}
          session={session}
          busy={busy === 'create-invitation'}
          onChange={setCreateInvitationForm}
          onClose={() => setCreateInvitationOpen(false)}
          onSubmit={submitCreateInvitation}
        />
      )}
      {createdInvitation && (
        <InvitationResultModal
          invitation={createdInvitation}
          onClose={() => setCreatedInvitation(null)}
          onCopy={copyText}
        />
      )}
      {invitationManagerTarget && (
        <OrganizationInvitationsModal
          organization={invitationManagerTarget}
          invitations={invitationItems}
          loading={invitationLoading}
          error={invitationError}
          session={session}
          busy={busy}
          onCreate={() => openCreateInvitation(invitationManagerTarget.id)}
          onRefresh={() => loadOrganizationInvitations(invitationManagerTarget)}
          onReissue={reissueInvitation}
          onRevoke={revokeInvitation}
          onClose={() => setInvitationManagerTarget(null)}
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
      {userDetailTarget && (
        <UserDetailDrawer
          user={userDetailTarget}
          organizations={organizationItems}
          memberships={snapshot?.memberships?.items ?? []}
          billingAccounts={snapshot?.billingAccounts?.items ?? []}
          ledgerEntries={snapshot?.billingLedgerEntries?.items ?? []}
          sessions={snapshot?.sessions?.items ?? []}
          alerts={snapshot?.billingReconciliationAlerts?.items ?? []}
          reconciliation={snapshot?.billingPaymentReconciliation?.items ?? []}
          auditLogs={snapshot?.auditLogs?.items ?? []}
          currentUserId={session.account.id}
          canManage={canManageAccountStatus}
          busy={busy}
          onClose={() => setUserDetailId('')}
          onSetStatus={setUserStatus}
          onOpenPasswordReset={openPasswordReset}
          onForcePasswordReset={forcePasswordReset}
          onOpenMembership={openMembershipDetail}
        />
      )}
      {membershipDetailTarget && (
        <MembershipDetailDrawer
          membership={membershipDetailTarget}
          billingAccounts={snapshot?.billingAccounts?.items ?? []}
          ledgerEntries={snapshot?.billingLedgerEntries?.items ?? []}
          sessions={snapshot?.sessions?.items ?? []}
          alerts={snapshot?.billingReconciliationAlerts?.items ?? []}
          reconciliation={snapshot?.billingPaymentReconciliation?.items ?? []}
          auditLogs={snapshot?.auditLogs?.items ?? []}
          session={session}
          canAdjustBilling={canAdjustBilling}
          busy={busy}
          onClose={() => setMembershipDetailId('')}
          onUpdateRole={updateMembershipRole}
          onDisableMembership={disableMembership}
          onAdjust={openAdjustment}
          onUpdatePlan={openMembershipPlan}
        />
      )}
      {complianceDetailTarget && (
        <CompliancePromptDetailDrawer
          item={complianceDetailTarget}
          busy={busy}
          currentUserId={session.account.id}
          onClose={() => setComplianceDetailId('')}
          onReview={(item) => openComplianceAction(item, 'reviewed')}
          onWarn={(item) => openComplianceAction(item, 'warned')}
          onDisableUser={(item) =>
            setUserStatus({
              id: item.userId,
              name: item.name,
              email: item.email,
              status: item.userStatus,
            })
          }
        />
      )}
      {complianceActionTarget && (
        <CompliancePromptActionModal
          item={complianceActionTarget}
          form={complianceActionForm}
          busy={busy === `compliance:${complianceActionTarget.id}:${complianceActionForm.action}`}
          onChange={setComplianceActionForm}
          onClose={() => {
            setComplianceActionTarget(null)
            setComplianceActionForm(complianceActionInitialState)
          }}
          onSubmit={submitComplianceAction}
        />
      )}
      {auditDetailTarget && (
        <AuditLogDetailDrawer
          entry={auditDetailTarget}
          users={snapshot?.users?.items ?? []}
          organizations={organizationItems}
          memberships={snapshot?.memberships?.items ?? []}
          billingAccounts={snapshot?.billingAccounts?.items ?? []}
          ledgerEntries={snapshot?.billingLedgerEntries?.items ?? []}
          sessions={snapshot?.sessions?.items ?? []}
          reconciliation={snapshot?.billingPaymentReconciliation?.items ?? []}
          alerts={snapshot?.billingReconciliationAlerts?.items ?? []}
          onClose={closeAuditDetail}
          onOpenUser={openAuditUserReference}
          onOpenOrganization={openAuditOrganizationReference}
          onOpenMembership={openAuditMembershipReference}
          onOpenBilling={openAuditBillingReference}
          onOpenSession={openAuditSessionReference}
        />
      )}
      {sessionRiskDetailTarget && (
        <SessionRiskDetailDrawer
          session={sessionRiskDetailTarget}
          sessions={snapshot?.sessions?.items ?? []}
          auditLogs={sessionRiskAuditContext.items}
          auditLoading={sessionRiskAuditContext.loading}
          auditError={sessionRiskAuditContext.error}
          canManage={canManageAccountStatus}
          busy={busy}
          currentUserId={session.account.id}
          onClose={() => {
            setSessionRiskDetailId('')
            setSessionRiskAuditContext(sessionRiskAuditInitialState)
          }}
          onRevoke={revokeSession}
          onRevokeUserSessions={revokeUserSessions}
          onForcePasswordReset={forcePasswordResetFromSession}
        />
      )}
      {organizationDetailTarget && (
        <OrganizationDetailDrawer
          organization={organizationDetailTarget}
          memberships={snapshot?.memberships?.items ?? []}
          billingAccounts={snapshot?.billingAccounts?.items ?? []}
          sessions={snapshot?.sessions?.items ?? []}
          alerts={snapshot?.billingReconciliationAlerts?.items ?? []}
          reconciliation={snapshot?.billingPaymentReconciliation?.items ?? []}
          auditLogs={snapshot?.auditLogs?.items ?? []}
          session={session}
          busy={busy}
          onClose={() => setOrganizationDetailId('')}
          onRename={renameOrganization}
          onDisable={disableOrganization}
          onTransferOrganizationAdmin={openOrganizationAdminTransfer}
          onCreateUser={openCreateUser}
          onAddExistingMember={openAddExistingMember}
          onCreateInvitation={openCreateInvitation}
          onManageInvitations={openInvitationManager}
          onLeaveOrganization={leaveOrganization}
          onOpenOrganizationBilling={openOrganizationBilling}
          onOpenAlertPage={() => setActiveTab('reconciliation-alerts')}
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

function DismissibleNotice({ tone = 'success', children, onClose }) {
  return (
    <div className={`notice ${tone} dismissible`}>
      <span>{children}</span>
      <button className="notice-dismiss" type="button" onClick={onClose} aria-label="关闭提示">
        <X size={14} />
      </button>
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
            <strong>序幕TV Admin</strong>
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

function UsageRealtimePage({ summary, loading, error, range, onRangeChange, onRefresh }) {
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

function UsageTablePage({ title, subject, rows, loading, error, query, range, onRangeChange, onRefresh }) {
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

function UsageControls({ range, generatedAt, loading, onRangeChange, onRefresh }) {
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

function ConsoleServerControls({
  filters,
  query,
  loading,
  organizations,
  organizationPlaceholder,
  activeMeta,
  onFilterChange,
  onClear,
  onPageSizeChange,
  onPageOffsetChange,
}) {
  const limit = activeMeta?.limit ?? filters.limit
  const offset = activeMeta?.offset ?? filters.offset
  const total = activeMeta?.total ?? 0
  const from = total ? offset + 1 : 0
  const to = Math.min(offset + limit, total)
  const hasPrevious = offset > 0
  const hasNext = offset + limit < total
  const hasActiveList = Boolean(activeMeta)

  return (
    <section className="server-list-controls">
      <div className="server-filter-row">
        <label>
          <Building2 size={14} />
          <select
            value={filters.tenantId}
            onChange={(event) => onFilterChange({ tenantId: event.target.value })}
          >
            <option value="">{organizationPlaceholder}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name} · {organization.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <ShieldCheck size={14} />
          <select value={filters.role} onChange={(event) => onFilterChange({ role: event.target.value })}>
            <option value="">全部身份</option>
            {consoleRoleFilterOptions.map((role) => (
              <option key={role} value={role}>
                {roleName(role)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Power size={14} />
          <select value={filters.status} onChange={(event) => onFilterChange({ status: event.target.value })}>
            <option value="">全部状态</option>
            {consoleStatusFilterOptions.map((status) => (
              <option key={status} value={status}>
                {statusName(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <FileText size={14} />
          <select value={filters.limit} onChange={(event) => onPageSizeChange(event.target.value)}>
            {consolePageSizeOptions.map((size) => (
              <option key={size} value={size}>
                每页 {size}
              </option>
            ))}
          </select>
        </label>
        <button
          className="row-button"
          type="button"
          disabled={!query && !filters.tenantId && !filters.role && !filters.status && filters.limit === 50}
          onClick={onClear}
        >
          <X size={14} />
          清空筛选
        </button>
      </div>

      <div className="server-pagination-row">
        <span>
          {!hasActiveList
            ? '筛选会应用到用户、组织、成员、账单、Session 和审计列表'
            : loading
              ? '正在读取服务端列表'
              : `服务端分页 ${from}-${to} / ${total}`}
        </span>
        {hasActiveList && (
          <div>
            <button
              className="row-button"
              type="button"
              disabled={!hasPrevious || loading}
              onClick={() => onPageOffsetChange(Math.max(0, offset - limit))}
            >
              上一页
            </button>
            <button
              className="row-button"
              type="button"
              disabled={!hasNext || loading}
              onClick={() => onPageOffsetChange(offset + limit)}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function UsersTable({
  users,
  currentUserId,
  canManage,
  busy,
  onOpenDetail,
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
            <th>账号归属</th>
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
                  <button className="row-button" type="button" onClick={() => onOpenDetail(user)}>
                    <FileText size={14} />
                    详情
                  </button>
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

function PersonalAccountsTable({
  memberships,
  session,
  currentUserId,
  canManage,
  canAdjustBilling,
  busy,
  onOpenDetail,
  onUpdateRole,
  onAdjust,
  onUpdatePlan,
  onOpenPasswordReset,
  onSetStatus,
}) {
  return (
    <DataSection title="个人账号" count={memberships.length}>
      <table className="data-table wide">
        <thead>
          <tr>
            <th>账号</th>
            <th>身份</th>
            <th>归属</th>
            <th>套餐</th>
            <th>积分</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {memberships.map((membership) => {
            const userTarget = userTargetForMembership(membership)
            const accountBusy = busy === `user:${membership.userId}`
            const passwordBusy = busy === `password:${membership.userId}`
            return (
              <tr key={membership.id}>
                <td>
                  <IdentityCell name={membership.name} detail={membership.email ?? membership.userId} />
                </td>
                <td>
                  <RoleEditor
                    membership={membership}
                    session={session}
                    busy={busy === `member-role:${membership.id}`}
                    onUpdateRole={onUpdateRole}
                  />
                </td>
                <td>
                  <IdentityCell
                    name={membership.tenantName}
                    detail={organizationTypeName(classifyOrganization(membership).type)}
                    compact
                  />
                </td>
                <td>{planName(membership.plan)}</td>
                <td>{membership.credits}</td>
                <td>
                  <StatusPair
                    primary={membership.userStatus}
                    secondary={membership.membershipStatus ?? membership.status}
                  />
                </td>
                <td>
                  <div className="row-actions">
                    <button className="row-button" type="button" onClick={() => onOpenDetail(membership)}>
                      <FileText size={14} />
                      详情
                    </button>
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
                      className="row-button"
                      type="button"
                      disabled={!canManage || passwordBusy}
                      onClick={() => onOpenPasswordReset(userTarget)}
                    >
                      {passwordBusy ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <KeyRound size={14} />
                      )}
                      设置密码
                    </button>
                    <button
                      className="row-button danger"
                      type="button"
                      disabled={!canManage || membership.userId === currentUserId || accountBusy}
                      onClick={() => onSetStatus(userTarget)}
                    >
                      {accountBusy ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Power size={14} />
                      )}
                      {membership.userStatus === 'active' ? '禁用账号' : '启用账号'}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
          <EmptyRow visible={!memberships.length} columns={7} />
        </tbody>
      </table>
    </DataSection>
  )
}

function userTargetForMembership(membership) {
  return {
    id: membership.userId,
    name: membership.name,
    email: membership.email,
    status: membership.userStatus,
  }
}

function OrganizationsTable({
  organizations,
  session,
  busy,
  onOpenDetail,
  onCreateOrganization,
  onRename,
  onDisable,
  onTransferOrganizationAdmin,
  onCreateUser,
  onAddExistingMember,
  onCreateInvitation,
  onManageInvitations,
  onOpenOrganizationBilling,
}) {
  const visibleOrganizations = organizations
  const canCreateInvitation = organizations.some(
    (organization) => organization.status === 'active' && canCreateOrganizationUser(session, organization),
  )
  const canCreateNewOrganization = canCreateOrganization(session)
  const canAddExistingMember = organizations.some((organization) =>
    canAddExistingOrganizationMember(session, organization),
  )

  return (
    <DataSection title="企业组织列表" count={visibleOrganizations.length}>
      <div className="inline-filter-bar organization-filter-bar">
        <button
          className="primary-button"
          type="button"
          disabled={!canCreateNewOrganization || busy === 'create-organization'}
          onClick={onCreateOrganization}
        >
          {busy === 'create-organization' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Building2 size={14} />
          )}
          创建组织
        </button>
        <button
          className="row-button"
          type="button"
          disabled={!canAddExistingMember || busy === 'add-existing-member'}
          onClick={() => onAddExistingMember()}
        >
          {busy === 'add-existing-member' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <UserPlus size={14} />
          )}
          加入已有账号
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!canCreateInvitation || busy === 'create-invitation'}
          onClick={() => onCreateInvitation()}
        >
          {busy === 'create-invitation' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <MailPlus size={14} />
          )}
          创建邀请
        </button>
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
                    <button className="row-button" type="button" onClick={() => onOpenDetail(organization)}>
                      <FileText size={14} />
                      详情
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      disabled={!canReadOrganizationBilling(session, organization)}
                      onClick={() => onOpenOrganizationBilling(organization)}
                    >
                      <CreditCard size={14} />
                      组织共享池
                    </button>
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
                        organization.status !== 'active' ||
                        !canAddExistingOrganizationMember(session, organization) ||
                        busy === 'add-existing-member'
                      }
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
                      disabled={
                        organization.status !== 'active' ||
                        !canCreateOrganizationUser(session, organization) ||
                        busy === 'create-invitation'
                      }
                      onClick={() => onCreateInvitation(organization.id)}
                    >
                      {busy === 'create-invitation' ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <MailPlus size={14} />
                      )}
                      创建邀请
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      disabled={!canManageOrganization(session, organization)}
                      onClick={() => onManageInvitations(organization)}
                    >
                      <MailPlus size={14} />
                      邀请管理
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
  onCreateInvitation,
  onOpenDetail,
  onUpdateRole,
  onDisableMembership,
  onAdjust,
  onUpdatePlan,
}) {
  return (
    <DataSection title="账号归属查询" count={memberships.length}>
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
        <button
          className="primary-button"
          type="button"
          disabled={!canManageUsers(session) || busy === 'create-invitation'}
          onClick={() => onCreateInvitation()}
        >
          {busy === 'create-invitation' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <MailPlus size={14} />
          )}
          创建邀请
        </button>
      </div>
      <table className="data-table wide">
        <thead>
          <tr>
            <th>账号</th>
            <th>归属</th>
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
                  <button className="row-button" type="button" onClick={() => onOpenDetail(membership)}>
                    <FileText size={14} />
                    详情
                  </button>
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

function ComplianceReviewPage({
  prompts,
  allPrompts,
  meta,
  generatedAt,
  filters,
  loading,
  error,
  busy,
  currentUserId,
  onFilterChange,
  onClear,
  onRefresh,
  onSample,
  onPageOffsetChange,
  onOpenDetail,
  onOpenUser,
  onOpenOrganization,
  onReview,
  onWarn,
  onDisableUser,
}) {
  const offset = filters.sample ? 0 : meta.offset
  const from = meta.total ? offset + 1 : 0
  const to = Math.min(offset + meta.limit, meta.total)
  const hasPrevious = offset > 0
  const hasNext = offset + meta.limit < meta.total && !filters.sample
  const riskCount = allPrompts.filter((item) => item.riskTags.length > 0).length

  return (
    <div className="compliance-page">
      <section className="server-list-controls compliance-controls">
        <div className="server-filter-row">
          <label>
            <Search size={14} />
            <input
              value={filters.q}
              onChange={(event) => onFilterChange({ q: event.target.value })}
              placeholder="搜索 prompt、用户、组织或任务"
            />
          </label>
          <label>
            <UsersRound size={14} />
            <input
              value={filters.userId}
              onChange={(event) => onFilterChange({ userId: event.target.value })}
              placeholder="指定用户 ID"
            />
          </label>
          <label>
            <Building2 size={14} />
            <input
              value={filters.tenantId}
              onChange={(event) => onFilterChange({ tenantId: event.target.value })}
              placeholder="指定组织/空间 ID"
            />
          </label>
          <label>
            <FileText size={14} />
            <select value={filters.source} onChange={(event) => onFilterChange({ source: event.target.value })}>
              <option value="">全部来源</option>
              <option value="generation_task">生成任务</option>
              <option value="ai_job">AI Job</option>
            </select>
          </label>
          <label>
            <ShieldAlert size={14} />
            <select
              value={filters.category}
              onChange={(event) => onFilterChange({ category: event.target.value }, { resetOffset: false })}
            >
              <option value="all">全部风险</option>
              <option value="none">无命中</option>
              {Object.entries(complianceCategoryLabels).map(([category, label]) => (
                <option key={category} value={category}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <FileText size={14} />
            <select
              value={filters.limit}
              onChange={(event) => onFilterChange({ limit: Number(event.target.value) })}
            >
              {consolePageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  每页 {size}
                </option>
              ))}
            </select>
          </label>
          <button className="row-button" type="button" onClick={onClear}>
            <X size={14} />
            清空筛选
          </button>
          <button className="row-button" type="button" disabled={loading} onClick={onRefresh}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新
          </button>
          <button className="primary-button" type="button" disabled={loading} onClick={onSample}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <Filter size={14} />}
            随机抽查
          </button>
        </div>
        <div className="server-pagination-row">
          <span>
            {loading
              ? '正在读取审查样本'
              : filters.sample
                ? `随机抽查 ${allPrompts.length} 条 / 匹配 ${meta.total} 条`
                : `审查分页 ${from}-${to} / ${meta.total}`}
            {generatedAt ? ` · ${formatDate(generatedAt)}` : ''}
            {filters.category !== 'all' ? ` · 当前风险筛选 ${prompts.length} 条` : ''}
            {riskCount ? ` · 风险命中 ${riskCount} 条` : ''}
          </span>
          <div>
            <button
              className="row-button"
              type="button"
              disabled={!hasPrevious || loading}
              onClick={() => onPageOffsetChange(Math.max(0, offset - meta.limit))}
            >
              上一页
            </button>
            <button
              className="row-button"
              type="button"
              disabled={!hasNext || loading}
              onClick={() => onPageOffsetChange(offset + meta.limit)}
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}

      <DataSection title="提示词审查" count={prompts.length}>
        <table className="data-table wide compliance-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>归属</th>
              <th>提示词预览</th>
              <th>风险</th>
              <th>来源</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {prompts.map((item) => {
              const actionBusy = busy.startsWith(`compliance:${item.id}`)
              const accountBusy = busy === `user:${item.userId}`
              return (
                <tr key={item.id}>
                  <td>
                    <IdentityCell name={item.name} detail={item.email ?? item.userId} />
                  </td>
                  <td>
                    <IdentityCell
                      name={item.tenantName ?? item.tenantId}
                      detail={organizationTypeName(item.organizationType ?? 'standard')}
                      compact
                    />
                  </td>
                  <td>
                    <div className="prompt-preview">
                      <strong>{item.label}</strong>
                      <span>{item.promptPreview || '-'}</span>
                    </div>
                  </td>
                  <td>
                    <ComplianceRiskTags tags={item.riskTags} />
                  </td>
                  <td>
                    <div className="source-stack">
                      <strong>{complianceSourceName(item.source)}</strong>
                      <small>
                        {item.kind} · {item.status}
                      </small>
                    </div>
                  </td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="row-button" type="button" onClick={() => onOpenDetail(item)}>
                        <FileText size={14} />
                        详情
                      </button>
                      <button className="row-button" type="button" onClick={() => onOpenUser(item)}>
                        <UsersRound size={14} />
                        账号
                      </button>
                      <button className="row-button" type="button" onClick={() => onOpenOrganization(item)}>
                        <Building2 size={14} />
                        归属
                      </button>
                      <button
                        className="row-button"
                        type="button"
                        disabled={actionBusy}
                        onClick={() => onReview(item)}
                      >
                        {actionBusy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                        已审查
                      </button>
                      <button
                        className="row-button"
                        type="button"
                        disabled={actionBusy}
                        onClick={() => onWarn(item)}
                      >
                        <AlertTriangle size={14} />
                        警告
                      </button>
                      <button
                        className="row-button danger"
                        type="button"
                        disabled={item.userStatus !== 'active' || item.userId === currentUserId || accountBusy}
                        onClick={() => onDisableUser(item)}
                      >
                        {accountBusy ? <LoaderCircle size={14} className="spin" /> : <Power size={14} />}
                        封号
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            <EmptyRow visible={!prompts.length && !loading} columns={7} />
          </tbody>
        </table>
      </DataSection>
    </div>
  )
}

function InvitationsPage({
  organizations,
  selectedOrganization,
  selectedOrganizationId,
  invitations,
  loading,
  error,
  session,
  busy,
  query,
  statusFilter,
  onStatusFilterChange,
  onSelectOrganization,
  onCreateInvitation,
  onRefresh,
  onReissue,
  onRevoke,
}) {
  const canCreate =
    selectedOrganization?.status === 'active' && canCreateOrganizationUser(session, selectedOrganization)
  const statusCounts = summarizeInvitationStatuses(invitations)
  const visibleInvitations = filterRows(
    statusFilter === 'all'
      ? invitations
      : invitations.filter((invitation) => invitation.status === statusFilter),
    query,
  )

  return (
    <div className="invitation-page-layout">
      <DataSection title="邀请管理" count={visibleInvitations.length}>
        <div className="inline-filter-bar invitation-page-toolbar">
          <label>
            <Building2 size={14} />
            <select
              value={selectedOrganizationId}
              onChange={(event) => onSelectOrganization(event.target.value)}
              disabled={!organizations.length}
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name} · {organization.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            <Filter size={14} />
            <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
              <option value="all">全部状态 · {invitations.length}</option>
              <option value="pending">待接受 · {statusCounts.pending}</option>
              <option value="accepted">已接受 · {statusCounts.accepted}</option>
              <option value="revoked">已撤销 · {statusCounts.revoked}</option>
              <option value="expired">已过期 · {statusCounts.expired}</option>
            </select>
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={!canCreate || busy === 'create-invitation'}
            onClick={onCreateInvitation}
          >
            {busy === 'create-invitation' ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <MailPlus size={14} />
            )}
            创建邀请
          </button>
          <button
            className="row-button"
            type="button"
            disabled={!selectedOrganization || loading}
            onClick={onRefresh}
          >
            {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新列表
          </button>
        </div>
        {selectedOrganization ? (
          <section className="organization-detail-head invitation-page-head">
            <IdentityCell name={selectedOrganization.name} detail={selectedOrganization.id} />
            <div>
              <span>待接受</span>
              <strong>{statusCounts.pending}</strong>
            </div>
            <div>
              <span>已接受</span>
              <strong>{statusCounts.accepted}</strong>
            </div>
            <StatusBadge status={selectedOrganization.status} />
          </section>
        ) : (
          <p className="panel-empty">暂无可管理的组织。</p>
        )}
        {error && <div className="notice error">{error}</div>}
        {loading && !invitations.length ? (
          <LoadingScreen compact label="正在读取邀请列表" />
        ) : (
          <InvitationCards
            invitations={visibleInvitations}
            canCreate={canCreate}
            busy={busy}
            onReissue={onReissue}
            onRevoke={onRevoke}
          />
        )}
        <p className="modal-hint">明文邀请码只在创建或重新生成后显示一次；历史列表只保存状态和时间。</p>
      </DataSection>
    </div>
  )
}

function BillingPanel({
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

function BillingAdjustmentPage({
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
              !canManageBillingAccount(session, selectedAccount) ||
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

function ReconciliationAlertsPage({
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

function ReconciliationAlertsTable({
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

function CompliancePromptDetailDrawer({
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
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="side-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="eyebrow">Compliance Review</span>
            <h2>提示词审查详情</h2>
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
        </div>

        <div className="drawer-actions">
          <button className="row-button" type="button" disabled={actionBusy} onClick={() => onReview(item)}>
            {actionBusy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
            标记已审查
          </button>
          <button className="row-button" type="button" disabled={actionBusy} onClick={() => onWarn(item)}>
            <AlertTriangle size={14} />
            发送警告
          </button>
          <button
            className="row-button danger"
            type="button"
            disabled={item.userStatus !== 'active' || item.userId === currentUserId || accountBusy}
            onClick={() => onDisableUser(item)}
          >
            {accountBusy ? <LoaderCircle size={14} className="spin" /> : <Power size={14} />}
            禁用账号
          </button>
        </div>

        <DrawerSection title="风险标签" count={item.riskTags.length}>
          <ComplianceRiskTags tags={item.riskTags} expanded />
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

function UserDetailDrawer({
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
  const activeSessions = userSessionRows.filter((item) => item.status === 'active').length
  const totalCredits = userBillingRows.reduce((total, account) => total + Number(account.credits ?? 0), 0)
  const openAlerts = userAlertRows.filter((alert) => alert.status !== 'resolved').length
  const canEditUser = canManage && user.id !== currentUserId

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="side-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="eyebrow">用户详情</span>
            <h2>{user.name}</h2>
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
            disabled={!canEditUser || busy === `password:${user.id}`}
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
            disabled={!canEditUser || user.passwordResetRequired || busy === `force-password:${user.id}`}
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
            disabled={!canEditUser || busy === `user:${user.id}`}
            onClick={() => onSetStatus(user)}
          >
            {busy === `user:${user.id}` ? <LoaderCircle size={14} className="spin" /> : <Power size={14} />}
            {user.status === 'active' ? '禁用账号' : '启用账号'}
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

function MembershipDetailDrawer({
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

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="side-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="eyebrow">Membership 详情</span>
            <h2>{membership.name}</h2>
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

function OrganizationDetailDrawer({
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
  const canLeaveTarget = canLeaveOrganization(session, organization, memberRows)
  const canReadBillingPool = canReadOrganizationBilling(session, organization)

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="side-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="eyebrow">组织详情</span>
            <h2>{organization.name}</h2>
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
            添加账号
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
            disabled={!canCreate}
            onClick={() => onCreateInvitation(organization.id)}
          >
            <MailPlus size={14} />
            创建邀请
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

function SessionRiskDetailDrawer({
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

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="side-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="eyebrow">Session 风险详情</span>
            <h2>{session.name}</h2>
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

function SessionRiskView({
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
                      <button className="row-button" type="button" onClick={() => onOpenDetail(session)}>
                        <FileText size={14} />
                        详情
                      </button>
                      <button
                        className="row-button danger"
                        type="button"
                        disabled={!canManageTargetUser || session.activeCount < 1 || revokeUserBusy}
                        onClick={() => onRevokeUserSessions(session)}
                      >
                        {revokeUserBusy ? <LoaderCircle size={14} className="spin" /> : <LogOut size={14} />}
                        踢用户
                      </button>
                      <button
                        className="row-button danger"
                        type="button"
                        disabled={!canManageTargetUser || forcePasswordBusy}
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
                        disabled={
                          !canManage || session.current || session.status !== 'active' || revokeSessionBusy
                        }
                        onClick={() => onRevoke(session)}
                      >
                        {revokeSessionBusy ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <LogOut size={14} />
                        )}
                        撤销
                      </button>
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

function AuditLogPage({
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

function AuditLogDetailDrawer({
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

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="side-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="eyebrow">审计日志详情</span>
            <h2>{entry.action}</h2>
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

function AuditReferenceGroup({ title, items, emptyLabel }) {
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

function OrganizationBillingModal({
  organization,
  summary,
  loading,
  error,
  form,
  canManage,
  busy,
  onChange,
  onRefresh,
  onClose,
  onSubmit,
}) {
  const amount = Number(form.amount)
  const validAmount = Number.isInteger(amount) && amount !== 0
  const currentCredits = summary?.credits ?? null
  const projectedBalance = currentCredits !== null && validAmount ? currentCredits + amount : null
  const valid =
    canManage &&
    Boolean(summary) &&
    validAmount &&
    form.reason.trim().length > 0 &&
    projectedBalance !== null &&
    projectedBalance >= 0
  const entries = summary?.entries ?? []

  return (
    <Modal title="组织共享积分池" onClose={onClose} wide>
      <div className="modal-form">
        <div className="section-actions">
          <IdentityCell name={organization.name} detail={organization.id} />
          <button className="row-button" type="button" disabled={loading} onClick={onRefresh}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新余额
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="drawer-summary-grid">
          <div>
            <span>当前组织余额</span>
            <strong>{loading && !summary ? '读取中' : (summary?.credits ?? '-')}</strong>
          </div>
          <div>
            <span>预计余额</span>
            <strong>{projectedBalance === null ? '-' : projectedBalance}</strong>
          </div>
          <div>
            <span>本月净消耗</span>
            <strong>{summary?.monthlyUsage?.netCredits ?? '-'}</strong>
          </div>
          <div>
            <span>本月任务</span>
            <strong>{summary?.monthlyUsage?.generationCount ?? '-'}</strong>
          </div>
        </div>
      </div>
      <form className="modal-form" onSubmit={onSubmit}>
        <div className="adjustment-fields">
          <label>
            <span>组织积分变化</span>
            <input
              type="number"
              value={form.amount}
              onChange={(event) => onChange({ ...form, amount: event.target.value })}
              min="-1000000"
              max="1000000"
              disabled={!canManage || loading}
              required
            />
          </label>
          <label>
            <span>调账原因</span>
            <input
              value={form.reason}
              onChange={(event) => onChange({ ...form, reason: event.target.value })}
              maxLength={200}
              disabled={!canManage || loading}
              required
            />
          </label>
        </div>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="提交组织调账" />
      </form>
      <DataSection title="组织池最近流水" count={entries.length}>
        <table className="data-table ledger">
          <thead>
            <tr>
              <th>类型</th>
              <th>金额</th>
              <th>余额</th>
              <th>Membership</th>
              <th>描述</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, 12).map((entry) => (
              <tr key={entry.id}>
                <td>{ledgerTypeName(entry.type)}</td>
                <td className={entry.amount >= 0 ? 'amount positive' : 'amount negative'}>
                  {formatSignedAmount(entry.amount)}
                </td>
                <td>{entry.balance}</td>
                <td>{shortId(entry.membershipId)}</td>
                <td>{entry.description}</td>
                <td>{formatDate(entry.createdAt)}</td>
              </tr>
            ))}
            <EmptyRow visible={!entries.length} columns={6} />
          </tbody>
        </table>
      </DataSection>
    </Modal>
  )
}

function MembershipPlanModal({ membership, form, busy, onChange, onClose, onSubmit }) {
  const valid = form.plan === 'free' || form.plan === 'member'
  const nextGrantMonthlyCredits = form.plan === 'member' && form.grantMonthlyCredits

  return (
    <Modal title="改套餐 / 冲会员" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell
          name={membership.name}
          detail={`${membership.tenantName ?? membership.tenantId} · ${membership.email ?? membership.userId}`}
        />
        <div className="drawer-summary-grid">
          <div>
            <span>当前套餐</span>
            <strong>{planName(membership.plan)}</strong>
          </div>
          <div>
            <span>当前积分</span>
            <strong>{membership.credits}</strong>
          </div>
        </div>
        <label>
          <span>目标套餐</span>
          <select
            value={form.plan}
            onChange={(event) =>
              onChange({
                ...form,
                plan: event.target.value,
                grantMonthlyCredits: event.target.value === 'member',
              })
            }
            required
          >
            <option value="free">{planName('free')}</option>
            <option value="member">{planName('member')}</option>
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={nextGrantMonthlyCredits}
            disabled={form.plan !== 'member'}
            onChange={(event) => onChange({ ...form, grantMonthlyCredits: event.target.checked })}
          />
          <span>升级/续费会员时发放本月会员积分</span>
        </label>
        <label>
          <span>备注</span>
          <input
            value={form.reason}
            onChange={(event) => onChange({ ...form, reason: event.target.value })}
            maxLength={200}
            placeholder="可选"
          />
        </label>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="保存套餐" />
      </form>
    </Modal>
  )
}

function PasswordResetModal({ target, form, busy, onChange, onClose, onSubmit }) {
  const passwordLength = form.newPassword.length
  const valid = passwordLength >= 8 && passwordLength <= 128
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
            minLength={8}
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

function CreateOrganizationModal({ form, busy, onChange, onClose, onSubmit }) {
  const valid = form.name.trim().length > 0
  return (
    <Modal title="创建组织" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>组织名称</span>
          <input
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            maxLength={80}
            required
          />
        </label>
        <p className="modal-hint">后台创建组织不会切换当前登录 session；创建后可加入已有账号或创建新账号。</p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="创建组织" />
      </form>
    </Modal>
  )
}

function CreateOrganizationUserModal({
  form,
  organizations,
  roleOptions,
  session,
  busy,
  onChange,
  onClose,
  onSubmit,
}) {
  const organizationOptions = organizations.filter(
    (organization) =>
      organization.status === 'active' && assignableRoleOptions(session, organization).includes(form.role),
  )
  const needsOrganization = roleRequiresOrganization(form.role)
  const valid =
    (!needsOrganization || form.organizationId) &&
    form.email.trim().includes('@') &&
    form.name.trim().length > 0 &&
    form.password.length >= 8 &&
    roleOptions.includes(form.role)

  const selectRole = (role) => {
    const nextOrganizations = organizations.filter(
      (organization) =>
        organization.status === 'active' && assignableRoleOptions(session, organization).includes(role),
    )
    onChange({
      ...form,
      role,
      organizationId: roleRequiresOrganization(role)
        ? (nextOrganizations.find((organization) => organization.id === form.organizationId)?.id ??
          nextOrganizations[0]?.id ??
          '')
        : '',
    })
  }

  return (
    <Modal title="添加账号" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
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
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
          />
          <small>创建后交给用户首次登录；系统会立即要求用户设置自己的新密码。</small>
        </label>
        <label>
          <span>身份</span>
          <select value={form.role} onChange={(event) => selectRole(event.target.value)} required>
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {roleName(role)}
              </option>
            ))}
          </select>
        </label>
        {needsOrganization ? (
          <label>
            <span>组织</span>
            <select
              value={form.organizationId}
              onChange={(event) => onChange({ ...form, organizationId: event.target.value })}
              disabled={!organizationOptions.length}
              required
            >
              {organizationOptions.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name} · {organization.id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="modal-hint">范围：{platformRoleScopeName(form.role)}</p>
        )}
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="创建账号" />
      </form>
    </Modal>
  )
}

function AddExistingMemberModal({
  form,
  organizations,
  roleOptions,
  session,
  busy,
  onChange,
  onClose,
  onSubmit,
}) {
  const organizationOptions = organizations.filter((organization) =>
    canAddExistingOrganizationMember(session, organization),
  )
  const selectedOrganization =
    organizationOptions.find((organization) => organization.id === form.organizationId) ?? null
  const roles = roleOptions.length
    ? roleOptions
    : addExistingOrganizationMemberRoleOptions(session, selectedOrganization)
  const valid = Boolean(selectedOrganization) && form.email.trim().includes('@') && roles.includes(form.role)

  const selectOrganization = (organizationId) => {
    const organization = organizationOptions.find((item) => item.id === organizationId)
    const nextRoles = addExistingOrganizationMemberRoleOptions(session, organization)
    onChange({
      ...form,
      organizationId,
      role: nextRoles.includes(form.role) ? form.role : (nextRoles[0] ?? form.role),
    })
  }

  return (
    <Modal title="加入已有账号" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>组织</span>
          <select
            value={form.organizationId}
            onChange={(event) => selectOrganization(event.target.value)}
            disabled={!organizationOptions.length}
            required
          >
            {organizationOptions.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name} · {organization.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>已有账号邮箱</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span>加入后的身份</span>
          <select
            value={form.role}
            onChange={(event) => onChange({ ...form, role: event.target.value })}
            disabled={!roles.length}
            required
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {roleName(role)}
              </option>
            ))}
          </select>
        </label>
        <p className="modal-hint">
          该账号必须已经存在且未被禁用；加入组织不会重置密码或切换当前后台 session。
        </p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="加入组织" />
      </form>
    </Modal>
  )
}

function CreateInvitationModal({
  form,
  organizations,
  roleOptions,
  session,
  busy,
  onChange,
  onClose,
  onSubmit,
}) {
  const organizationOptions = organizations.filter(
    (organization) =>
      organization.status === 'active' && assignableRoleOptions(session, organization).includes(form.role),
  )
  const needsOrganization = roleRequiresOrganization(form.role)
  const valid =
    (!needsOrganization || form.organizationId) &&
    form.email.trim().includes('@') &&
    roleOptions.includes(form.role)

  const selectOrganization = (organizationId) => {
    const organization = organizationOptions.find((item) => item.id === organizationId)
    const nextRoles = assignableRoleOptions(session, organization)
    onChange({
      ...form,
      organizationId,
      role: nextRoles.includes(form.role) ? form.role : (nextRoles[0] ?? form.role),
    })
  }

  const selectRole = (role) => {
    const nextOrganizations = organizations.filter(
      (organization) =>
        organization.status === 'active' && assignableRoleOptions(session, organization).includes(role),
    )
    onChange({
      ...form,
      role,
      organizationId: roleRequiresOrganization(role)
        ? (nextOrganizations.find((organization) => organization.id === form.organizationId)?.id ??
          nextOrganizations[0]?.id ??
          '')
        : '',
    })
  }

  return (
    <Modal title="创建邀请" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>受邀邮箱</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span>注册后身份</span>
          <select value={form.role} onChange={(event) => selectRole(event.target.value)} required>
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {roleName(role)}
              </option>
            ))}
          </select>
        </label>
        {needsOrganization ? (
          <label>
            <span>组织</span>
            <select
              value={form.organizationId}
              onChange={(event) => selectOrganization(event.target.value)}
              disabled={!organizationOptions.length}
              required
            >
              {organizationOptions.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name} · {organization.id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="modal-hint">范围：{platformRoleScopeName(form.role)}</p>
        )}
        <p className="modal-hint">邀请码只在创建后显示一次，同时会按邮件配置发送邀请邮件。</p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="创建邀请" />
      </form>
    </Modal>
  )
}

function InvitationResultModal({ invitation, onClose, onCopy }) {
  const invitationUrl = invitationUrlFor(invitation.token)
  const organizationName = invitation.organizationName ?? invitation.tenantName
  const organizationId = invitation.organizationId ?? invitation.tenantId

  return (
    <Modal title="邀请码已创建" onClose={onClose}>
      <div className="invitation-result">
        <IdentityCell name={organizationName} detail={organizationId} />
        <dl className="invitation-meta">
          <div>
            <dt>受邀邮箱</dt>
            <dd>{invitation.email}</dd>
          </div>
          <div>
            <dt>身份</dt>
            <dd>{invitation.roles.map(roleName).join('、')}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{statusName(invitation.status)}</dd>
          </div>
          <div>
            <dt>过期时间</dt>
            <dd>{formatDate(invitation.expiresAt)}</dd>
          </div>
        </dl>
        <label className="copy-field">
          <span>注册链接</span>
          <div>
            <input value={invitationUrl} readOnly onFocus={(event) => event.target.select()} />
            <button
              type="button"
              className="row-button"
              onClick={() => onCopy(invitationUrl, '注册链接已复制')}
            >
              <Copy size={14} />
              复制链接
            </button>
          </div>
        </label>
        <label className="copy-field">
          <span>邀请码</span>
          <div>
            <input value={invitation.token} readOnly onFocus={(event) => event.target.select()} />
            <button
              type="button"
              className="row-button"
              onClick={() => onCopy(invitation.token, '邀请码已复制')}
            >
              <Copy size={14} />
              复制邀请码
            </button>
          </div>
        </label>
        <p className="modal-hint">明文邀请码关闭后不能从数据库还原；需要再次展示时请重新创建邀请。</p>
        <div className="modal-actions">
          <button className="primary-button" type="button" onClick={onClose}>
            <Check size={15} />
            完成
          </button>
        </div>
      </div>
    </Modal>
  )
}

function InvitationCards({ invitations, canCreate, busy, onReissue, onRevoke }) {
  return (
    <div className="invitation-list">
      {invitations.map((invitation) => (
        <article key={invitation.id} className="invitation-card">
          <header>
            <div>
              <strong>{invitation.email}</strong>
              <small>{invitation.id}</small>
            </div>
            <InvitationStatusBadge status={invitation.status} />
          </header>
          <div className="invitation-card-grid">
            <div>
              <span>身份</span>
              <RolePills roles={invitation.roles} />
            </div>
            <div>
              <span>创建时间</span>
              <strong>{formatDate(invitation.createdAt)}</strong>
            </div>
            <div>
              <span>过期时间</span>
              <strong>{formatDate(invitation.expiresAt)}</strong>
            </div>
            <div>
              <span>完成时间</span>
              <strong>{invitation.acceptedAt ? formatDate(invitation.acceptedAt) : '-'}</strong>
            </div>
            <div>
              <span>撤销时间</span>
              <strong>{invitation.revokedAt ? formatDate(invitation.revokedAt) : '-'}</strong>
            </div>
          </div>
          <footer>
            <button
              className="row-button"
              type="button"
              disabled={
                !canCreate ||
                invitation.status === 'accepted' ||
                busy === `invitation-reissue:${invitation.id}`
              }
              onClick={() => onReissue(invitation)}
            >
              {busy === `invitation-reissue:${invitation.id}` ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              重新生成
            </button>
            <button
              className="row-button danger"
              type="button"
              disabled={invitation.status !== 'pending' || busy === `invitation-revoke:${invitation.id}`}
              onClick={() => onRevoke(invitation)}
            >
              {busy === `invitation-revoke:${invitation.id}` ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Power size={14} />
              )}
              撤销
            </button>
          </footer>
        </article>
      ))}
      {!invitations.length && <p className="panel-empty">暂无邀请记录。</p>}
    </div>
  )
}

function OrganizationInvitationsModal({
  organization,
  invitations,
  loading,
  error,
  session,
  busy,
  onCreate,
  onRefresh,
  onReissue,
  onRevoke,
  onClose,
}) {
  const canCreate = organization.status === 'active' && canCreateOrganizationUser(session, organization)
  const pendingCount = invitations.filter((invitation) => invitation.status === 'pending').length

  return (
    <Modal title="组织详情 / 邀请管理" wide onClose={onClose}>
      <div className="organization-invitations">
        <section className="organization-detail-head">
          <IdentityCell name={organization.name} detail={organization.id} />
          <div>
            <span>成员</span>
            <strong>
              {organization.activeMembershipCount} / {organization.membershipCount}
            </strong>
          </div>
          <div>
            <span>待接受邀请</span>
            <strong>{pendingCount}</strong>
          </div>
          <StatusBadge status={organization.status} />
        </section>
        <div className="invitation-toolbar">
          <button className="primary-button" type="button" disabled={!canCreate} onClick={onCreate}>
            <MailPlus size={14} />
            创建邀请
          </button>
          <button className="row-button" type="button" disabled={loading} onClick={onRefresh}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新列表
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {loading && !invitations.length ? (
          <LoadingScreen compact label="正在读取邀请列表" />
        ) : (
          <InvitationCards
            invitations={invitations}
            canCreate={canCreate}
            busy={busy}
            onReissue={onReissue}
            onRevoke={onRevoke}
          />
        )}
        <p className="modal-hint">历史邀请只显示状态；明文邀请码只会在创建或重新生成后显示一次。</p>
      </div>
    </Modal>
  )
}

function InvitationStatusBadge({ status }) {
  const labels = {
    pending: '待接受',
    accepted: '已接受',
    revoked: '已撤销',
    expired: '已过期',
  }
  return <span className={`invitation-status-badge ${status}`}>{labels[status] ?? statusName(status)}</span>
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

function ReconciliationAlertActionModal({
  alert,
  status,
  message,
  organizationName,
  busy,
  onMessageChange,
  onClose,
  onSubmit,
}) {
  const actionLabel = status === 'acknowledged' ? '确认告警' : '解决告警'
  const valid = message.trim().length > 0 && message.trim().length <= 200
  return (
    <Modal title={actionLabel} onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <dl className="invitation-meta">
          <div>
            <dt>组织</dt>
            <dd>{organizationName}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{reconciliationAlertStatusName(alert.status)}</dd>
          </div>
          <div>
            <dt>严重性</dt>
            <dd>{alertSeverityName(alert.severity)}</dd>
          </div>
          <div>
            <dt>事件</dt>
            <dd>{alert.eventType}</dd>
          </div>
        </dl>
        <div className="alert-action-summary">
          <strong>{alert.alertType}</strong>
          <span>
            {alert.provider} · {shortId(alert.providerEventId)}
          </span>
          <p>{alert.message}</p>
        </div>
        <label>
          <span>处理备注</span>
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            maxLength={200}
            rows={4}
            required
          />
        </label>
        <p className="modal-hint">备注会写回对账告警记录，便于后续审计和复盘。</p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel={actionLabel} />
      </form>
    </Modal>
  )
}

function CompliancePromptActionModal({ item, form, busy, onChange, onClose, onSubmit }) {
  const actionLabel = form.action === 'warned' ? '发送警告' : '标记已审查'
  const valid = form.reason.trim().length > 0
  return (
    <Modal title={actionLabel} onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>处理动作</span>
          <select value={form.action} onChange={(event) => onChange({ ...form, action: event.target.value })}>
            <option value="reviewed">标记已审查</option>
            <option value="warned">发送警告</option>
          </select>
        </label>
        <label>
          <span>风险类别</span>
          <select
            value={form.category}
            onChange={(event) => onChange({ ...form, category: event.target.value })}
          >
            <option value="">不指定</option>
            {Object.entries(complianceCategoryLabels).map(([category, label]) => (
              <option key={category} value={category}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>备注</span>
          <textarea
            value={form.reason}
            onChange={(event) => onChange({ ...form, reason: event.target.value })}
            placeholder="记录人工审查结论或警告原因"
            required
          />
        </label>
        <p className="modal-hint">
          处理记录会写入审计日志；当前阶段不会自动发送站内信。目标账号：{item.email ?? item.userId}
        </p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel={actionLabel} />
      </form>
    </Modal>
  )
}

function Modal({ title, children, onClose, wide = false }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className={wide ? 'modal wide-modal' : 'modal'}
        onMouseDown={(event) => event.stopPropagation()}
      >
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

function DrawerSection({ title, count, children }) {
  return (
    <section className="drawer-section">
      <header>
        <h3>{title}</h3>
        <span>{count}</span>
      </header>
      <div className="drawer-section-body">{children}</div>
    </section>
  )
}

function AuditActivityList({ entries }) {
  return (
    <div className="drawer-activity-list">
      {entries.slice(0, 8).map((entry) => (
        <article key={entry.id} className="drawer-activity">
          <div>
            <strong>{entry.action}</strong>
            <small>
              {entry.resourceType} · {entry.resourceId ? shortId(entry.resourceId) : '-'}
            </small>
            <small>{compactJson(entry.metadata)}</small>
          </div>
          <span>{formatDate(entry.createdAt)}</span>
        </article>
      ))}
      {!entries.length && <p className="panel-empty">暂无审计记录。</p>}
    </div>
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

function ComplianceRiskTags({ tags, expanded = false }) {
  if (!tags.length) return <span className="compliance-risk-empty">未命中</span>
  return (
    <div className={expanded ? 'compliance-risk-tags expanded' : 'compliance-risk-tags'}>
      {tags.map((tag) => (
        <span key={tag.category} className={`compliance-risk-tag ${tag.severity}`}>
          {tag.label}
          <small>
            {complianceSeverityName(tag.severity)} · {tag.hits}
          </small>
        </span>
      ))}
    </div>
  )
}

function StatusBadge({ status }) {
  return <span className={`status-badge ${status}`}>{statusName(status)}</span>
}

function paymentStatusName(status) {
  const labels = {
    processed: '已处理',
    ignored: '已忽略',
    failed: '失败',
  }
  return labels[status] ?? status
}

function PaymentStatusBadge({ status }) {
  return <span className={`payment-status-badge ${status}`}>{paymentStatusName(status)}</span>
}

function AlertStatusBadge({ status }) {
  return <span className={`alert-status-badge ${status}`}>{reconciliationAlertStatusName(status)}</span>
}

function alertSeverityName(severity) {
  const labels = {
    warning: '警告',
    critical: '严重',
  }
  return labels[severity] ?? severity
}

function AlertSeverityBadge({ severity }) {
  return <span className={`alert-severity-badge ${severity}`}>{alertSeverityName(severity)}</span>
}

function complianceSourceName(source) {
  return complianceSourceLabels[source] ?? source
}

function complianceSeverityName(severity) {
  return complianceSeverityLabels[severity] ?? severity
}

function reconciliationAlertStatusName(status) {
  const labels = {
    open: '未处理',
    acknowledged: '已确认',
    resolved: '已解决',
  }
  return labels[status] ?? status
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
    <label className={busy ? 'role-editor loading' : 'role-editor'}>
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
      {busy && <LoaderCircle size={14} className="spin" />}
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

function usageRangeName(range) {
  const labels = {
    today: '今日',
    week: '本周',
    month: '本月',
  }
  return labels[range] ?? range
}

function formatUsageNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number.isFinite(value) ? value : 0)
}

function formatUsageRatio(value) {
  const ratio = Number.isFinite(value) ? value : 0
  return `${Math.round(ratio * 1000) / 10}%`
}

function usageRowKey(row) {
  return row.userId ?? row.organizationId ?? row.subjectType
}

function tabCount(tabId, summary, derivedCounts = {}) {
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

function activeConsoleListMeta(snapshot, activeTab) {
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

function clientListMeta(total, filters) {
  return {
    limit: filters.limit,
    offset: 0,
    total,
  }
}

function organizationOptionsForFilter(organizations, selectedOrganizationId) {
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

function membershipOrganizationOptionsForFilter(memberships, selectedOrganizationId) {
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

function summarizeInvitationStatuses(invitations) {
  return invitations.reduce(
    (summary, invitation) => ({
      ...summary,
      [invitation.status]: (summary[invitation.status] ?? 0) + 1,
    }),
    { pending: 0, accepted: 0, revoked: 0, expired: 0 },
  )
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

function prettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2)
}

function auditRelatedReferences(entry) {
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

function addAuditMetadataReferences(target, metadata, keyLabels) {
  for (const [key, label] of Object.entries(keyLabels)) {
    addAuditReference(target, label, metadata[key])
  }
}

function addAuditReference(target, label, value) {
  if (typeof value !== 'string') return
  const id = value.trim()
  if (!id || target.some((item) => item.id === id && item.label === label)) return
  target.push({ label, id })
}

function referenceCount(references) {
  return Object.values(references).reduce((total, items) => total + items.length, 0)
}

function auditBillingReferenceItems({
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

function organizationAdminTransferCandidates(memberships, tenantId) {
  return memberships.filter(
    (membership) =>
      membership.tenantId === tenantId &&
      membership.status === 'active' &&
      membership.userStatus === 'active' &&
      membership.roles.includes('organization_member'),
  )
}

function organizationNameFor(organizations, organizationId) {
  if (!organizationId) return '-'
  return organizations.find((organization) => organization.id === organizationId)?.name ?? organizationId
}

function organizationIdFromRow(row) {
  return row?.organizationId ?? row?.tenantId ?? ''
}

function objectMetadata(row) {
  return row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}
}

function rowMatchesUser(row, userId) {
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

function rowMatchesMembership(row, membershipId) {
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

function rowMatchesAnyMembership(row, membershipIds) {
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

function sortByRecent(rows) {
  return [...rows].sort((left, right) => recentTime(right) - recentTime(left))
}

function recentTime(row) {
  const value = row?.lastSeenAt ?? row?.updatedAt ?? row?.createdAt ?? row?.expiresAt
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function summarizeReconciliationAlerts(alerts) {
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
