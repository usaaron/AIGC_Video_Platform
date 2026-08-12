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
  MoreHorizontal,
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
  { id: 'delivery', label: '交付', icon: Check },
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

const tabGroups = [
  {
    label: '概览与用量',
    tabIds: ['overview', 'delivery', 'usage-realtime', 'usage-users', 'usage-organizations'],
  },
  {
    label: '账号与组织',
    tabIds: ['users', 'personal-accounts', 'organizations', 'memberships', 'invitations'],
  },
  { label: '账单', tabIds: ['billing', 'reconciliation-alerts', 'adjustments'] },
  { label: '风控审计', tabIds: ['compliance', 'sessions', 'session-risk', 'audit'] },
]

const loginInitialState = { email: '', password: '' }
const adjustmentInitialState = { amount: '', reason: '' }
const grantInitialState = { amount: '', reason: '' }
const organizationBillingAdjustmentInitialState = { amount: '', reason: '' }
const membershipPlanInitialState = { plan: 'free', grantMonthlyCredits: true, reason: '' }
const passwordInitialState = { newPassword: '', requireChange: true, revokeSessions: true }
const renameOrganizationInitialState = { name: '' }
const reconciliationAlertMessageDefaults = {
  acknowledged: '已确认，正在处理',
  resolved: '已解决，已完成对账',
}
const createOrganizationInitialState = { name: '' }
const createOrganizationWithAdminInitialState = {
  organizationName: '',
  adminEmail: '',
  adminName: '',
  adminPassword: '',
}
const createUserInitialState = {
  organizationId: '',
  email: '',
  name: '',
  password: '',
  role: 'member',
  scope: 'personal',
}
const addExistingMemberInitialState = { organizationId: '', email: '', role: 'organization_member' }
const createInvitationInitialState = { kind: 'platform', organizationId: '', email: '', role: 'member' }
const batchOrganizationInvitationInitialState = {
  organizationId: '',
  role: 'organization_member',
  emails: '',
}
const sessionRiskAuditInitialState = { userId: '', items: [], loading: false, error: '' }
const consoleFilterInitialState = { tenantId: '', role: '', status: '', limit: 50, offset: 0 }
const complianceFilterInitialState = {
  q: '',
  userId: '',
  tenantId: '',
  source: '',
  category: 'all',
  queue: 'all',
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
const workflowTabIds = new Set(['delivery'])

function isUsageTab(tabId) {
  return usageTabIds.has(tabId)
}

function usesConsoleServerControls(tabId) {
  return !isUsageTab(tabId) && tabId !== 'compliance' && !workflowTabIds.has(tabId)
}

function roleRequiresOrganization(role) {
  return organizationScopedRoles.has(role)
}

function canCreatePlatformInvitation(session) {
  return assignableRoleOptions(session, null).includes('member')
}

function organizationInvitationRoleOptions(session, organization) {
  if (!organization) return []
  return assignableRoleOptions(session, organization).filter(roleRequiresOrganization)
}

function platformRoleScopeName(role) {
  return role === 'member' ? 'C 端个人空间（自动创建）' : '平台内部系统组织'
}

function invitationScopeName(scope) {
  const labels = {
    platform_registration: '普通成员邀请',
    organization_membership: '企业组织邀请',
    system_account: '系统账号邀请',
  }
  return labels[scope] ?? '邀请'
}

function invitationUrlFor(token) {
  return `${WEB_ORIGIN}/register?token=${encodeURIComponent(token)}`
}

function disabledButtonProps(disabled, reason) {
  return {
    disabled,
    title: disabled ? reason || '当前状态下不可操作' : undefined,
  }
}

function billingAdjustmentDisabledReason({
  canManage,
  selectedAccount,
  canManageTarget,
  validAmount,
  hasReason,
  projectedBalance,
  busy,
}) {
  if (!canManage) return '当前身份不能进行账单调账'
  if (!selectedAccount) return '请先选择调账目标'
  if (!canManageTarget) return '当前身份不能调整该账号归属的账单'
  if (!validAmount) return '积分变化必须是非 0 整数'
  if (!hasReason) return '请填写调账原因'
  if (projectedBalance < 0) return '预计余额不能小于 0'
  if (busy) return '正在提交调账'
  return ''
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
  const [platformInvitationStatusFilter, setPlatformInvitationStatusFilter] = useState('all')
  const [invitationStatusFilter, setInvitationStatusFilter] = useState('all')
  const [reconciliationAlertStatusFilter, setReconciliationAlertStatusFilter] = useState('open')
  const [reconciliationAlertSeverityFilter, setReconciliationAlertSeverityFilter] = useState('all')
  const [reconciliationAlertAction, setReconciliationAlertAction] = useState(null)
  const [reconciliationAlertMessage, setReconciliationAlertMessage] = useState('')
  const [passwordTarget, setPasswordTarget] = useState(null)
  const [passwordForm, setPasswordForm] = useState(passwordInitialState)
  const [renameOrganizationTarget, setRenameOrganizationTarget] = useState(null)
  const [renameOrganizationForm, setRenameOrganizationForm] = useState(renameOrganizationInitialState)
  const [createOrganizationOpen, setCreateOrganizationOpen] = useState(false)
  const [createOrganizationForm, setCreateOrganizationForm] = useState(createOrganizationInitialState)
  const [createOrganizationWithAdminOpen, setCreateOrganizationWithAdminOpen] = useState(false)
  const [createOrganizationWithAdminForm, setCreateOrganizationWithAdminForm] = useState(
    createOrganizationWithAdminInitialState,
  )
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [createUserForm, setCreateUserForm] = useState(createUserInitialState)
  const [addExistingMemberOpen, setAddExistingMemberOpen] = useState(false)
  const [addExistingMemberForm, setAddExistingMemberForm] = useState(addExistingMemberInitialState)
  const [createInvitationOpen, setCreateInvitationOpen] = useState(false)
  const [createInvitationForm, setCreateInvitationForm] = useState(createInvitationInitialState)
  const [createdInvitation, setCreatedInvitation] = useState(null)
  const [batchOrganizationInvitationOpen, setBatchOrganizationInvitationOpen] = useState(false)
  const [batchOrganizationInvitationForm, setBatchOrganizationInvitationForm] = useState(
    batchOrganizationInvitationInitialState,
  )
  const [batchOrganizationInvitationResult, setBatchOrganizationInvitationResult] = useState(null)
  const [invitationManagerTarget, setInvitationManagerTarget] = useState(null)
  const [platformInvitationItems, setPlatformInvitationItems] = useState([])
  const [invitationItems, setInvitationItems] = useState([])
  const [platformInvitationLoading, setPlatformInvitationLoading] = useState(false)
  const [invitationLoading, setInvitationLoading] = useState(false)
  const [platformInvitationError, setPlatformInvitationError] = useState('')
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
  const [nextStepHint, setNextStepHint] = useState(null)
  const [confirmRequest, setConfirmRequest] = useState(null)

  const confirmAction = (request) =>
    new Promise((resolve) => {
      setConfirmRequest({
        tone: 'default',
        confirmLabel: '确认',
        cancelLabel: '取消',
        ...request,
        resolve,
      })
    })

  const closeConfirmAction = (confirmed) => {
    if (confirmRequest?.resolve) confirmRequest.resolve(confirmed)
    setConfirmRequest(null)
  }

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
  const visibleTabGroups = useMemo(() => {
    const visibleTabById = new Map(visibleTabs.map((tab) => [tab.id, tab]))
    return tabGroups
      .map((group) => ({
        ...group,
        tabs: group.tabIds.map((tabId) => visibleTabById.get(tabId)).filter(Boolean),
      }))
      .filter((group) => group.tabs.length > 0)
  }, [visibleTabs])

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
    const categoryFiltered =
      complianceFilters.category === 'all'
        ? compliancePromptItems
        : complianceFilters.category === 'none'
          ? compliancePromptItems.filter((item) => item.riskTags.length === 0)
          : compliancePromptItems.filter((item) =>
              item.riskTags.some((tag) => tag.category === complianceFilters.category),
            )
    return categoryFiltered.filter((item) => complianceQueueMatches(item, complianceFilters.queue))
  }, [complianceFilters.category, complianceFilters.queue, compliancePromptItems])
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
  const invitableOrganizationItems = useMemo(
    () =>
      enterpriseOrganizationItems.filter(
        (item) => item.status === 'active' && organizationInvitationRoleOptions(session, item).length > 0,
      ),
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
  const createUserRoleOptions = useMemo(() => {
    if (createUserForm.scope === 'organization') {
      return createUserOrganization
        ? assignableRoleOptions(session, createUserOrganization).filter(roleRequiresOrganization)
        : []
    }
    return assignableRoleOptions(session, null).filter((role) => role === 'member' || role === 'admin')
  }, [session, createUserForm.scope, createUserOrganization])
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
  const activeListMeta = useMemo(() => {
    if (activeTab === 'organizations')
      return clientListMeta(enterpriseOrganizationItems.length, consoleFilters)
    if (activeTab === 'personal-accounts')
      return clientListMeta(personalAccountMemberships.length, consoleFilters)
    return activeConsoleListMeta(snapshot, activeTab)
  }, [
    snapshot,
    activeTab,
    enterpriseOrganizationItems.length,
    personalAccountMemberships.length,
    consoleFilters,
  ])
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
  }, [activeTab, consoleFilters.tenantId, enterpriseOrganizationItems, personalAccountMemberships, snapshot])

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
    const confirmed = await confirmAction({
      title: `${nextStatus === 'disabled' ? '禁用' : '启用'}账号`,
      tone: nextStatus === 'disabled' ? 'danger' : 'default',
      summary:
        nextStatus === 'disabled' ? '该账号将无法继续登录和使用平台。' : '该账号将恢复登录和使用权限。',
      details: [
        { label: '账号', value: user.email ?? user.id },
        { label: '用户', value: user.name },
        { label: '目标状态', value: statusName(nextStatus) },
      ],
      confirmLabel: nextStatus === 'disabled' ? '确认禁用' : '确认启用',
      busyId: `user:${user.id}`,
    })
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
    const confirmed = await confirmAction({
      title: '强制账号改密',
      tone: 'danger',
      summary: '系统会要求该账号下次登录修改密码，并撤销现有 session。',
      details: [
        { label: '账号', value: user.email ?? user.id },
        { label: '用户', value: user.name },
      ],
      impact: '适用于疑似密码泄露、合规风险或交付临时密码后的安全收尾。',
      confirmLabel: '强制改密',
      busyId: `force-password:${user.id}`,
    })
    if (!confirmed) return
    await runAction(`force-password:${user.id}`, async () => {
      await api.updatePasswordResetRequirement(user.id, { required: true, revokeSessions: true })
      await loadConsole()
      setNotice('已要求账号下次登录修改密码')
    })
  }

  const openCreateUser = (organizationId = '', preferredRole = '') => {
    const isOrganizationScope = Boolean(organizationId)
    const organization = isOrganizationScope
      ? (creatableOrganizations.find((item) => item.id === organizationId) ?? creatableOrganizations[0])
      : null
    const roles = isOrganizationScope
      ? organization
        ? assignableRoleOptions(session, organization).filter(roleRequiresOrganization)
        : []
      : assignableRoleOptions(session, null).filter((item) => item === 'member' || item === 'admin')
    const role = roles.includes(preferredRole) ? preferredRole : roles[0]
    if (!roles.length || !role) {
      setNotice('当前身份不允许添加账号')
      return
    }
    setCreateUserForm({
      ...createUserInitialState,
      scope: isOrganizationScope ? 'organization' : 'personal',
      organizationId: isOrganizationScope ? (organization?.id ?? '') : '',
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

  const openCreateOrganizationWithAdmin = () => {
    if (!canCreateOrganization(session)) {
      setNotice('当前身份不能创建组织')
      return
    }
    if (!assignableRoleOptions(session, null).includes('organization_admin')) {
      setNotice('当前身份不能创建组织管理员')
      return
    }
    setCreateOrganizationWithAdminForm(createOrganizationWithAdminInitialState)
    setCreateOrganizationWithAdminOpen(true)
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

  const openCreatePlatformInvitation = () => {
    if (!canCreatePlatformInvitation(session)) {
      setNotice('当前身份不能创建普通成员邀请')
      return
    }
    setCreateInvitationForm({
      ...createInvitationInitialState,
      kind: 'platform',
      organizationId: '',
      role: 'member',
    })
    setCreateInvitationOpen(true)
  }

  const openCreateOrganizationInvitation = (organizationId = '', role = 'organization_member') => {
    const candidates = invitableOrganizationItems.filter((organization) =>
      organizationInvitationRoleOptions(session, organization).includes(role),
    )
    const organization = candidates.find((item) => item.id === organizationId) ?? candidates[0]
    if (!organization) {
      setNotice(`当前身份不能创建${roleName(role)}邀请`)
      return
    }
    setCreateInvitationForm({
      ...createInvitationInitialState,
      kind: 'organization',
      organizationId: organization.id,
      role,
    })
    setCreateInvitationOpen(true)
  }

  const openBatchOrganizationInvitation = (organizationId = '', role = 'organization_member') => {
    const candidates = invitableOrganizationItems.filter((organization) =>
      organizationInvitationRoleOptions(session, organization).includes(role),
    )
    const organization = candidates.find((item) => item.id === organizationId) ?? candidates[0]
    if (!organization) {
      setNotice(`当前身份不能批量邀请${roleName(role)}`)
      return
    }
    setBatchOrganizationInvitationForm({
      ...batchOrganizationInvitationInitialState,
      organizationId: organization.id,
      role,
    })
    setBatchOrganizationInvitationResult(null)
    setBatchOrganizationInvitationOpen(true)
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

  async function loadPlatformInvitations() {
    if (!canCreatePlatformInvitation(session)) {
      setPlatformInvitationItems([])
      setPlatformInvitationError('')
      return
    }
    setPlatformInvitationLoading(true)
    setPlatformInvitationError('')
    try {
      setPlatformInvitationItems(await api.listPlatformInvitations())
    } catch (requestError) {
      setPlatformInvitationError(requestError.message)
    } finally {
      setPlatformInvitationLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab !== 'invitations') return
    void loadPlatformInvitations()
  }, [activeTab, session?.account?.id, session?.account?.tenantId])

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
      searchConsoleTab(
        'memberships',
        membershipId,
        '当前快照未包含该 membership，已切到账号归属列表并按 ID 搜索',
      )
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
    const confirmed = await confirmAction({
      title: `创建${roleName(createUserForm.role)}账号`,
      summary: '将直接创建账号并设置初始临时密码。',
      details: [
        { label: '邮箱', value: createUserForm.email.trim() },
        { label: '身份', value: roleName(createUserForm.role) },
        {
          label: needsOrganization ? '企业组织' : '范围',
          value: needsOrganization ? organizationName : scopeLine,
        },
      ],
      impact: '直接创建账号适合代建交付；优先让客户通过邀请自行注册以避免运营接触密码。',
      confirmLabel: '创建账号',
      busyId: 'create-user',
    })
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
      setNextStepHint({
        title: needsOrganization ? '组织账号已创建' : '个人账号已创建',
        description: needsOrganization
          ? '继续完成组织账号交付：需要时给成员改套餐，或在组织共享池给企业充值。'
          : '继续完成个人交付：可以给个人账号充值、改套餐，并把临时密码交付给用户。',
        actions: [
          { label: '去账单调账', tabId: 'adjustments', icon: PencilLine },
          needsOrganization
            ? { label: '查看企业组织', tabId: 'organizations', icon: Building2 }
            : { label: '查看个人账号', tabId: 'personal-accounts', icon: IdCard },
        ],
      })
      setNotice('账号已创建')
    })
  }

  const submitCreateOrganization = async (event) => {
    event.preventDefault()
    const name = createOrganizationForm.name.trim()
    const confirmed = await confirmAction({
      title: '创建企业组织',
      summary: '创建后不会切换当前后台登录组织。',
      details: [{ label: '企业组织', value: name }],
      impact: '创建后还需要创建或邀请组织管理员，并给组织共享池充值。',
      confirmLabel: '创建企业组织',
      busyId: 'create-organization',
    })
    if (!confirmed) return
    await runAction('create-organization', async () => {
      const organization = await api.createOrganization({ name })
      setCreateOrganizationOpen(false)
      setCreateOrganizationForm(createOrganizationInitialState)
      await loadConsole()
      setOrganizationDetailId(organization.id)
      setNextStepHint({
        title: '企业组织已创建',
        description: '下一步通常是创建或邀请组织管理员，再给组织共享积分池充值。',
        actions: [
          {
            label: '直接创建组织管理员',
            run: () => openCreateUser(organization.id, 'organization_admin'),
            icon: Crown,
          },
          {
            label: '邀请组织管理员',
            run: () => openCreateOrganizationInvitation(organization.id, 'organization_admin'),
            icon: MailPlus,
          },
          {
            label: '邀请组织成员',
            run: () => openCreateOrganizationInvitation(organization.id),
            icon: MailPlus,
          },
          {
            label: '组织共享池',
            run: () => openOrganizationBilling(organization),
            icon: CreditCard,
          },
        ],
      })
      setNotice('组织已创建')
    })
  }

  const submitCreateOrganizationWithAdmin = async (event) => {
    event.preventDefault()
    const organizationName = createOrganizationWithAdminForm.organizationName.trim()
    const adminEmail = createOrganizationWithAdminForm.adminEmail.trim()
    const adminName = createOrganizationWithAdminForm.adminName.trim()
    const confirmed = await confirmAction({
      title: '创建企业组织和首个管理员',
      summary: '系统会先创建企业组织，再直接创建 organization_admin 账号。',
      details: [
        { label: '企业组织', value: organizationName },
        { label: '管理员', value: `${adminName} <${adminEmail}>` },
      ],
      impact: '如果管理员账号创建失败，已创建的企业组织会保留，需要进入组织详情补建或邀请管理员。',
      confirmLabel: '创建组织和管理员',
      busyId: 'create-organization-with-admin',
    })
    if (!confirmed) return
    await runAction('create-organization-with-admin', async () => {
      const organization = await api.createOrganization({ name: organizationName })
      try {
        await api.createOrganizationUser(organization.id, {
          email: adminEmail,
          name: adminName,
          password: createOrganizationWithAdminForm.adminPassword,
          role: 'organization_admin',
        })
      } catch (requestError) {
        setCreateOrganizationWithAdminOpen(false)
        setCreateOrganizationWithAdminForm(createOrganizationWithAdminInitialState)
        await loadConsole()
        setOrganizationDetailId(organization.id)
        throw new Error(
          `企业组织已创建（${organization.name}），但首个组织管理员创建失败：${requestError.message}`,
        )
      }
      setCreateOrganizationWithAdminOpen(false)
      setCreateOrganizationWithAdminForm(createOrganizationWithAdminInitialState)
      await loadConsole()
      setOrganizationDetailId(organization.id)
      setNextStepHint({
        title: '企业组织和首个管理员已创建',
        description: '继续完成 B 端交付：给组织共享池充值、邀请成员，或查看组织详情核对成员。',
        actions: [
          { label: '组织共享池充值', run: () => openOrganizationBilling(organization), icon: CreditCard },
          {
            label: '邀请组织成员',
            run: () => openCreateOrganizationInvitation(organization.id),
            icon: MailPlus,
          },
          { label: '查看企业组织', tabId: 'organizations', icon: Building2 },
        ],
      })
      setNotice('企业组织和首个组织管理员已创建')
    })
  }

  const submitAddExistingMember = async (event) => {
    event.preventDefault()
    const organization = addExistingMemberOrganization
    if (!organization) return
    const email = addExistingMemberForm.email.trim()
    const confirmed = await confirmAction({
      title: '加入已有账号',
      summary: '会把已有平台账号加入指定企业组织。',
      details: [
        { label: '企业组织', value: organization.name },
        { label: '账号', value: email },
        { label: '身份', value: roleName(addExistingMemberForm.role) },
      ],
      impact: '适合客户已有个人账号或历史账号，不会重复创建同邮箱账号。',
      confirmLabel: '加入组织',
      busyId: 'add-existing-member',
    })
    if (!confirmed) return
    await runAction('add-existing-member', async () => {
      await api.addExistingOrganizationMember(organization.id, {
        email,
        roles: [addExistingMemberForm.role],
      })
      setAddExistingMemberOpen(false)
      setAddExistingMemberForm(addExistingMemberInitialState)
      await loadConsole()
      setNextStepHint({
        title: '已有账号已加入企业组织',
        description: '可以继续邀请成员，或打开组织共享池确认企业共享余额。',
        actions: [
          { label: '组织共享池', run: () => openOrganizationBilling(organization), icon: CreditCard },
          {
            label: '邀请组织成员',
            run: () => openCreateOrganizationInvitation(organization.id),
            icon: MailPlus,
          },
        ],
      })
      setNotice('已有账号已加入组织')
    })
  }

  const submitCreateInvitation = async (event) => {
    event.preventDefault()
    const email = createInvitationForm.email.trim()
    const needsOrganization = createInvitationForm.kind === 'organization'
    const invitationRole = needsOrganization ? createInvitationForm.role : 'member'
    const organizationName = createInvitationOrganization?.name ?? createInvitationForm.organizationId
    const scopeLine = needsOrganization
      ? `企业组织：${organizationName}`
      : '范围：普通成员个人空间（注册后自动创建）'
    const confirmed = await confirmAction({
      title: `创建${roleName(invitationRole)}邀请`,
      summary: '受邀人注册后会获得该身份。',
      details: [
        { label: '受邀邮箱', value: email },
        { label: '身份', value: roleName(invitationRole) },
        {
          label: needsOrganization ? '企业组织' : '范围',
          value: needsOrganization ? organizationName : scopeLine,
        },
      ],
      confirmLabel: '创建邀请',
      busyId: 'create-invitation',
    })
    if (!confirmed) return
    await runAction('create-invitation', async () => {
      const payload = {
        email,
        roles: [invitationRole],
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
      if (!needsOrganization && activeTab === 'invitations') {
        await loadPlatformInvitations()
      }
      await loadConsole()
      setNextStepHint({
        title: needsOrganization ? '企业组织邀请已创建' : '普通成员邀请已创建',
        description: needsOrganization
          ? '把注册链接交给客户，受邀人完成注册后会进入指定企业组织。'
          : '把注册链接交给 C 端用户，注册后会进入自己的个人空间。',
        actions: [
          {
            label: '查看邀请',
            tabId: 'invitations',
            icon: MailPlus,
          },
          needsOrganization
            ? { label: '查看企业组织', tabId: 'organizations', icon: Building2 }
            : { label: '查看个人账号', tabId: 'personal-accounts', icon: IdCard },
        ],
      })
      setNotice('邀请已创建，请保存邀请码')
    })
  }

  const submitBatchOrganizationInvitations = async (event) => {
    event.preventDefault()
    const organization =
      enterpriseOrganizationItems.find(
        (item) => item.id === batchOrganizationInvitationForm.organizationId,
      ) ?? null
    if (!organization) return
    const emails = parseEmailLines(batchOrganizationInvitationForm.emails)
    const roles = organizationInvitationRoleOptions(session, organization)
    const role = roles.includes(batchOrganizationInvitationForm.role)
      ? batchOrganizationInvitationForm.role
      : roles[0]
    if (!role || !emails.valid.length) return
    const confirmed = await confirmAction({
      title: '批量邀请企业成员',
      summary: '系统会逐个生成组织邀请；已经存在或格式错误的邮箱会在结果里单独列出。',
      details: [
        { label: '企业组织', value: organization.name },
        { label: '身份', value: roleName(role) },
        { label: '有效邮箱', value: emails.valid.length },
        { label: '格式错误', value: emails.invalid.length },
      ],
      impact: '批量邀请只发送注册入口，不会直接创建明文密码账号。',
      confirmLabel: '开始批量邀请',
      busyId: 'batch-organization-invitations',
    })
    if (!confirmed) return
    await runAction('batch-organization-invitations', async () => {
      const created = []
      const failed = emails.invalid.map((email) => ({ email, message: '邮箱格式不正确' }))
      for (const email of emails.valid) {
        try {
          const invitation = await api.createOrganizationInvitation(organization.id, {
            email,
            roles: [role],
          })
          created.push(invitation)
        } catch (requestError) {
          failed.push({ email, message: requestError.message })
        }
      }
      setBatchOrganizationInvitationResult({ organization, role, created, failed })
      if (activeTab === 'invitations' && invitationPageOrganization?.id === organization.id) {
        await loadOrganizationInvitations(invitationPageOrganization)
      }
      await loadConsole()
      setNextStepHint({
        title: '批量邀请已处理',
        description: `成功 ${created.length} 个，失败 ${failed.length} 个。请复制成功生成的注册链接并交付给客户。`,
        actions: [
          { label: '查看邀请', tabId: 'invitations', icon: MailPlus },
          { label: '查看企业组织', tabId: 'organizations', icon: Building2 },
        ],
      })
      setNotice(`批量邀请完成：成功 ${created.length} 个，失败 ${failed.length} 个`)
    })
  }

  const reissueInvitation = async (invitation, organization = invitationManagerTarget) => {
    if (!organization) return
    const confirmed = await confirmAction({
      title: '重新生成邀请码',
      tone: 'danger',
      summary: '旧邀请码将立即失效。',
      details: [
        { label: '邮箱', value: invitation.email },
        { label: '企业组织', value: organization.name },
        { label: '身份', value: invitation.roles.map(roleName).join('、') },
      ],
      confirmLabel: '重新生成',
      busyId: `invitation-reissue:${invitation.id}`,
    })
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
    const confirmed = await confirmAction({
      title: '撤销企业组织邀请',
      tone: 'danger',
      summary: '撤销后该邀请码不能再注册。',
      details: [
        { label: '邮箱', value: invitation.email },
        { label: '企业组织', value: organization.name },
      ],
      confirmLabel: '撤销邀请',
      busyId: `invitation-revoke:${invitation.id}`,
    })
    if (!confirmed) return
    await runAction(`invitation-revoke:${invitation.id}`, async () => {
      await api.revokeOrganizationInvitation(organization.id, invitation.id)
      await loadOrganizationInvitations(organization)
      await loadConsole()
      setNotice('邀请已撤销')
    })
  }

  const revokePlatformInvitation = async (invitation) => {
    const confirmed = await confirmAction({
      title: '撤销普通成员邀请',
      tone: 'danger',
      summary: '撤销后该邀请码不能再注册。',
      details: [
        { label: '邮箱', value: invitation.email },
        { label: '范围', value: '普通成员个人空间' },
      ],
      confirmLabel: '撤销邀请',
      busyId: `platform-invitation-revoke:${invitation.id}`,
    })
    if (!confirmed) return
    await runAction(`platform-invitation-revoke:${invitation.id}`, async () => {
      await api.revokePlatformInvitation(invitation.id)
      await loadPlatformInvitations()
      await loadConsole()
      setNotice('普通成员邀请已撤销')
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

  const openRenameOrganization = (organization) => {
    if (!canManageOrganization(session, organization)) {
      setNotice('当前身份不能重命名该组织')
      return
    }
    setRenameOrganizationTarget(organization)
    setRenameOrganizationForm({ name: organization.name })
  }

  const submitRenameOrganization = async (event) => {
    event.preventDefault()
    if (!renameOrganizationTarget) return
    const name = renameOrganizationForm.name.trim()
    if (!name || name === renameOrganizationTarget.name) return
    const confirmed = await confirmAction({
      title: '重命名组织',
      details: [
        { label: '当前名称', value: renameOrganizationTarget.name },
        { label: '新名称', value: name },
      ],
      confirmLabel: '重命名',
      busyId: `organization-rename:${renameOrganizationTarget.id}`,
    })
    if (!confirmed) return
    await runAction(`organization-rename:${renameOrganizationTarget.id}`, async () => {
      await api.updateOrganization(renameOrganizationTarget.id, { name })
      setRenameOrganizationTarget(null)
      setRenameOrganizationForm(renameOrganizationInitialState)
      await loadConsole()
      setNotice('组织已重命名')
    })
  }

  const disableOrganization = async (organization) => {
    const confirmed = await confirmAction({
      title: '禁用组织',
      tone: 'danger',
      summary: '该组织下现有 session 将失效，创作端无法继续访问。',
      details: [
        { label: '组织', value: organization.name },
        { label: '组织 ID', value: organization.id },
      ],
      confirmLabel: '禁用组织',
      busyId: `organization-disable:${organization.id}`,
    })
    if (!confirmed) return
    await runAction(`organization-disable:${organization.id}`, async () => {
      await api.disableOrganization(organization.id)
      await loadConsole()
      setNotice('组织已禁用')
    })
  }

  const leaveOrganization = async (organization) => {
    const confirmed = await confirmAction({
      title: '退出组织',
      tone: 'danger',
      summary: '退出后当前组织下的 session 会失效。',
      details: [{ label: '组织', value: organization.name }],
      confirmLabel: '退出组织',
      busyId: `organization-leave:${organization.id}`,
    })
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
    const confirmed = await confirmAction({
      title: '更换组织负责人',
      tone: 'danger',
      summary: '当前负责人将降为组织成员。',
      details: [
        { label: '组织', value: organizationAdminTransferTarget.name },
        {
          label: '当前负责人',
          value: current?.name ?? organizationAdminTransferForm.currentOrganizationAdminUserId,
        },
        { label: '新负责人', value: target?.name ?? organizationAdminTransferForm.targetUserId },
      ],
      confirmLabel: '更换负责人',
      busyId: `organization-admin-change:${organizationAdminTransferTarget.id}`,
    })
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
    const confirmed = await confirmAction({
      title: '修改成员角色',
      details: [
        { label: '成员', value: membership.name },
        { label: '组织', value: membership.tenantName },
        { label: '新角色', value: roleName(role) },
      ],
      confirmLabel: '修改角色',
      busyId: `member-role:${membership.id}`,
    })
    if (!confirmed) return
    await runAction(`member-role:${membership.id}`, async () => {
      await api.updateMemberRoles(membership.id, [role])
      await loadConsole()
      setNotice('成员角色已更新')
    })
  }

  const disableMembership = async (membership) => {
    const confirmed = await confirmAction({
      title: '禁用账号归属',
      tone: 'danger',
      summary: '该成员在此组织/空间下的归属会被禁用。',
      details: [
        { label: '成员', value: membership.name },
        { label: '组织', value: membership.tenantName },
        { label: '角色', value: membership.roles.map(roleName).join('、') },
      ],
      confirmLabel: '禁用归属',
      busyId: `member-disable:${membership.id}`,
    })
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
    const confirmed = await confirmAction({
      title: '设置临时密码',
      tone: passwordForm.revokeSessions ? 'danger' : 'default',
      details: [
        { label: '账号', value: passwordTarget.email ?? passwordTarget.id },
        { label: '用户', value: passwordTarget.name },
        { label: '登录后改密', value: passwordForm.requireChange ? '必须修改' : '不强制' },
        { label: '现有 session', value: passwordForm.revokeSessions ? '撤销' : '保留' },
      ],
      impact: '代建账号交付后建议要求用户首次登录修改密码，并撤销旧 session。',
      confirmLabel: '设置临时密码',
      busyId: `password:${passwordTarget.id}`,
    })
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
    const confirmed = await confirmAction({
      title: '撤销 Session',
      tone: 'danger',
      details: [
        { label: '用户', value: targetSession.name },
        { label: '设备', value: targetSession.deviceLabel ?? '未记录' },
        { label: 'IP', value: targetSession.ipAddress ?? '未记录' },
      ],
      confirmLabel: '撤销 Session',
      busyId: `session:${targetSession.sessionId}`,
    })
    if (!confirmed) return
    await runAction(`session:${targetSession.sessionId}`, async () => {
      await api.revokeSession(targetSession.sessionId)
      await loadConsole()
      setNotice('Session 已撤销')
    })
  }

  const revokeUserSessions = async (targetSession) => {
    const confirmed = await confirmAction({
      title: '踢用户下线',
      tone: 'danger',
      summary: '这个操作会撤销该用户当前所有活跃 session。',
      details: [
        { label: '用户', value: targetSession.name },
        { label: '账号', value: targetSession.email ?? targetSession.userId },
      ],
      confirmLabel: '踢下线',
      busyId: `user-sessions:${targetSession.userId}`,
    })
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
    const confirmed = await confirmAction({
      title: '提交个人账号调账',
      tone: amount < 0 ? 'danger' : 'default',
      summary: '这是 membership 级调账，只影响该账号归属下的个人余额。',
      details: [
        { label: '账号', value: adjustTarget.name },
        { label: '归属', value: adjustTarget.tenantName },
        { label: 'Membership', value: membershipId },
        { label: '积分变化', value: formatSignedAmount(amount), tone: amount < 0 ? 'negative' : 'positive' },
        { label: '原因', value: reason },
      ],
      impact:
        adjustTarget.organizationType === 'enterprise'
          ? '该目标属于企业组织成员。企业客户公账付款通常应充值到组织共享池，不应充值到成员个人余额。'
          : '请确认该笔款项属于个人账号，而不是企业组织共享池。',
      confirmLabel: '提交调账',
      busyId: `adjust:${membershipId}`,
    })
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
    const confirmed = await confirmAction({
      title: '提交账单调账',
      tone: amount < 0 ? 'danger' : 'default',
      summary: '这是 membership 级调账，只影响选中的账号归属余额。',
      details: [
        { label: '目标', value: target.name },
        { label: '归属', value: target.tenantName },
        { label: 'Membership', value: membershipId },
        { label: '积分变化', value: formatSignedAmount(amount), tone: amount < 0 ? 'negative' : 'positive' },
        { label: '原因', value: reason },
      ],
      impact:
        target.organizationType === 'enterprise'
          ? '该目标属于企业组织成员。企业款项应优先充值组织共享池。'
          : '请确认这是个人账号调账。',
      confirmLabel: '提交调账',
      busyId: `adjust-page:${membershipId}`,
    })
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
    const confirmed = await confirmAction({
      title: '当前后台账号充值',
      summary: '该入口只给当前登录后台账号充值，不会给客户账号或企业组织充值。',
      details: [
        { label: '积分', value: `+${amount}`, tone: 'positive' },
        { label: '原因', value: reason },
      ],
      impact: '客户交付优先使用个人账号调账或企业组织共享池充值。',
      confirmLabel: '提交充值',
      busyId: 'grant',
    })
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
    const confirmed = await confirmAction({
      title: '调整组织共享积分池',
      tone: amount < 0 ? 'danger' : 'default',
      summary: '这是企业组织共享池调账，会影响该组织成员共用额度。',
      details: [
        { label: '企业组织', value: organizationBillingTarget.name },
        { label: '组织 ID', value: organizationBillingTarget.id },
        { label: '积分变化', value: formatSignedAmount(amount), tone: amount < 0 ? 'negative' : 'positive' },
        { label: '原因', value: reason },
      ],
      impact: 'B 端公账付款应在这里给企业组织充值，不能充到组织管理员个人账号。',
      confirmLabel: '提交组织调账',
      busyId: `organization-adjust:${organizationBillingTarget.id}`,
    })
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
    const confirmed = await confirmAction({
      title: '修改会员套餐',
      details: [
        { label: '成员', value: membershipPlanTarget.name },
        { label: 'Membership', value: membershipId },
        { label: '套餐', value: planName(membershipPlanForm.plan) },
        { label: '发放月度积分', value: membershipPlanForm.grantMonthlyCredits ? '是' : '否' },
        { label: '备注', value: reason || '-' },
      ],
      impact: '请确认该套餐变更对应个人账号或指定 membership，不是企业组织共享池充值。',
      confirmLabel: '保存套餐',
      busyId: `membership-plan:${membershipId}`,
    })
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
      await api.recordCompliancePromptAction(complianceActionTarget.source, complianceActionTarget.sourceId, {
        action: complianceActionForm.action,
        reason,
        ...(complianceActionForm.category ? { category: complianceActionForm.category } : {}),
      })
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
            {visibleTabGroups.map((group) => (
              <section className="sidebar-group" key={group.label}>
                <h2>{group.label}</h2>
                {group.tabs.map((tab) => (
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
              </section>
            ))}
          </nav>
        </aside>

        <main className="admin-main">
          <section className="console-toolbar">
            <div>
              <span className="eyebrow">Admin Console</span>
              <h1>{visibleTabs.find((tab) => tab.id === activeTab)?.label ?? '概览'}</h1>
            </div>
            {activeTab !== 'compliance' && !workflowTabIds.has(activeTab) && (
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

          <PermissionBoundaryBanner session={session} />

          {usesConsoleServerControls(activeTab) && (
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
          {nextStepHint && (
            <NextStepNotice
              hint={nextStepHint}
              onAction={(action) => {
                if (action.tabId) setActiveTab(action.tabId)
                if (action.run) action.run()
              }}
              onClose={() => setNextStepHint(null)}
            />
          )}

          {!snapshot && loading && <LoadingScreen compact label="正在读取 console 快照" />}
          {snapshot && filtered && (
            <>
              {activeTab === 'overview' && (
                <OverviewPanel snapshot={snapshot} summary={summary} setActiveTab={setActiveTab} />
              )}
              {activeTab === 'delivery' && (
                <DeliveryWorkbench
                  session={session}
                  organizations={enterpriseOrganizationItems}
                  personalAccounts={personalAccountMemberships}
                  busy={busy}
                  onCreatePersonalAccount={() => openCreateUser()}
                  onInvitePersonalAccount={openCreatePlatformInvitation}
                  onOpenPersonalAccounts={() => setActiveTab('personal-accounts')}
                  onOpenAdjustments={() => setActiveTab('adjustments')}
                  onCreateOrganization={openCreateOrganization}
                  onCreateOrganizationWithAdmin={openCreateOrganizationWithAdmin}
                  onOpenOrganizations={() => setActiveTab('organizations')}
                  onOpenInvitations={() => setActiveTab('invitations')}
                  onOpenBatchOrganizationInvitation={openBatchOrganizationInvitation}
                />
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
                  onCreateUser={openCreateUser}
                  onCreateInvitation={openCreatePlatformInvitation}
                />
              )}
              {activeTab === 'organizations' && (
                <OrganizationsTable
                  organizations={filtered.organizations}
                  session={session}
                  busy={busy}
                  onOpenDetail={openOrganizationDetail}
                  onCreateOrganization={openCreateOrganization}
                  onCreateOrganizationWithAdmin={openCreateOrganizationWithAdmin}
                  onRename={openRenameOrganization}
                  onDisable={disableOrganization}
                  onTransferOrganizationAdmin={openOrganizationAdminTransfer}
                  onCreateUser={openCreateUser}
                  onAddExistingMember={openAddExistingMember}
                  onCreateInvitation={openCreateOrganizationInvitation}
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
                  platformInvitations={platformInvitationItems}
                  platformLoading={platformInvitationLoading}
                  platformError={platformInvitationError}
                  invitations={invitationItems}
                  loading={invitationLoading}
                  error={invitationError}
                  session={session}
                  busy={busy}
                  query={query}
                  platformStatusFilter={platformInvitationStatusFilter}
                  onPlatformStatusFilterChange={setPlatformInvitationStatusFilter}
                  statusFilter={invitationStatusFilter}
                  onStatusFilterChange={setInvitationStatusFilter}
                  onSelectOrganization={selectInvitationPageOrganization}
                  onCreatePlatformInvitation={openCreatePlatformInvitation}
                  onCreateOrganizationInvitation={(role) =>
                    openCreateOrganizationInvitation(invitationPageOrganization?.id ?? '', role)
                  }
                  onBatchOrganizationInvitation={(role) =>
                    openBatchOrganizationInvitation(invitationPageOrganization?.id ?? '', role)
                  }
                  onRefreshPlatform={loadPlatformInvitations}
                  onRevokePlatform={revokePlatformInvitation}
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
      {renameOrganizationTarget && (
        <RenameOrganizationModal
          organization={renameOrganizationTarget}
          form={renameOrganizationForm}
          busy={busy === `organization-rename:${renameOrganizationTarget.id}`}
          onChange={setRenameOrganizationForm}
          onClose={() => {
            setRenameOrganizationTarget(null)
            setRenameOrganizationForm(renameOrganizationInitialState)
          }}
          onSubmit={submitRenameOrganization}
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
      {createOrganizationWithAdminOpen && (
        <CreateOrganizationWithAdminModal
          form={createOrganizationWithAdminForm}
          busy={busy === 'create-organization-with-admin'}
          onChange={setCreateOrganizationWithAdminForm}
          onClose={() => setCreateOrganizationWithAdminOpen(false)}
          onSubmit={submitCreateOrganizationWithAdmin}
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
          organizations={invitableOrganizationItems}
          session={session}
          busy={busy === 'create-invitation'}
          onChange={setCreateInvitationForm}
          onClose={() => setCreateInvitationOpen(false)}
          onSubmit={submitCreateInvitation}
        />
      )}
      {batchOrganizationInvitationOpen && (
        <BatchOrganizationInvitationModal
          form={batchOrganizationInvitationForm}
          organizations={invitableOrganizationItems}
          session={session}
          busy={busy === 'batch-organization-invitations'}
          result={batchOrganizationInvitationResult}
          onChange={setBatchOrganizationInvitationForm}
          onClose={() => {
            setBatchOrganizationInvitationOpen(false)
            setBatchOrganizationInvitationForm(batchOrganizationInvitationInitialState)
            setBatchOrganizationInvitationResult(null)
          }}
          onSubmit={submitBatchOrganizationInvitations}
          onCopy={copyText}
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
          onCreate={() => openCreateOrganizationInvitation(invitationManagerTarget.id, 'organization_member')}
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
      {confirmRequest && (
        <ActionConfirmModal
          request={confirmRequest}
          busy={Boolean(confirmRequest.busyId && busy === confirmRequest.busyId)}
          onCancel={() => closeConfirmAction(false)}
          onConfirm={() => closeConfirmAction(true)}
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
          onRename={openRenameOrganization}
          onDisable={disableOrganization}
          onTransferOrganizationAdmin={openOrganizationAdminTransfer}
          onCreateUser={openCreateUser}
          onAddExistingMember={openAddExistingMember}
          onCreateInvitation={openCreateOrganizationInvitation}
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

function NextStepNotice({ hint, onAction, onClose }) {
  return (
    <section className="next-step-notice">
      <div>
        <strong>{hint.title}</strong>
        <span>{hint.description}</span>
      </div>
      <div>
        {(hint.actions ?? []).map((action) => (
          <button key={action.label} className="row-button" type="button" onClick={() => onAction(action)}>
            {action.icon ? <action.icon size={14} /> : <Check size={14} />}
            {action.label}
          </button>
        ))}
        <button className="icon-button" type="button" aria-label="关闭下一步提示" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </section>
  )
}

function PermissionBoundaryBanner({ session }) {
  const roles = session?.account?.roles ?? []
  const scope = permissionScopeDescription(session)
  const chips = [
    canManageUsers(session) ? '账号管理' : '',
    canManageBilling(session) ? '账单调账' : '',
    isPlatformAdminSession(session) ? '合规审查' : '',
    canCreateOrganization(session) ? '创建企业组织' : '',
  ].filter(Boolean)

  return (
    <section className="permission-boundary">
      <ShieldCheck size={16} />
      <div>
        <strong>当前身份：{roles.map(roleName).join('、')}</strong>
        <span>{scope}</span>
      </div>
      <div>{chips.length ? chips.map((chip) => <span key={chip}>{chip}</span>) : <span>只读</span>}</div>
    </section>
  )
}

function permissionScopeDescription(session) {
  const roles = session?.account?.roles ?? []
  if (roles.includes('owner')) return '可管理全平台账号、企业组织、组织共享池、套餐、合规审查和系统级权限。'
  if (roles.includes('super_admin'))
    return '可管理全平台运营功能，但 owner 等最高权限账号仍受 owner 边界保护。'
  if (roles.includes('admin')) return '主要管理 C 端普通成员和个人空间；企业组织池和组织管理员受限。'
  if (roles.includes('organization_admin'))
    return '只能管理当前企业组织内成员、邀请和组织共享池，不能管理其他企业或平台账号。'
  if (roles.includes('organization_member'))
    return '组织成员通常不能进入后台管理；如可见页面，多数操作为只读。'
  return '普通成员通常不能进入后台管理；如可见页面，多数操作为只读。'
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

function DeliveryWorkbench({
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
            <li>选择邀请普通成员，或直接创建个人账号。</li>
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
              {...disabledButtonProps(!canInvitePersonal, '当前身份不能邀请普通成员')}
              onClick={onInvitePersonalAccount}
            >
              <MailPlus size={14} />
              邀请普通成员
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

function DeliveryRecentTarget({ title, empty, target }) {
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
  onCreateUser,
  onCreateInvitation,
}) {
  const createUserDisabled = !canManageUsers(session) || busy === 'create-user'
  const createUserDisabledReason = !canManageUsers(session) ? '当前身份不能直接创建个人账号' : '正在创建账号'
  const createInvitationDisabled = !canCreatePlatformInvitation(session) || busy === 'create-invitation'
  const createInvitationDisabledReason = !canCreatePlatformInvitation(session)
    ? '当前身份不能邀请普通成员'
    : '正在创建邀请'

  return (
    <DataSection title="个人账号" count={memberships.length}>
      <div className="section-actions">
        <button
          className="row-button"
          type="button"
          {...disabledButtonProps(createUserDisabled, createUserDisabledReason)}
          onClick={() => onCreateUser()}
        >
          {busy === 'create-user' ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
          直接创建个人账号
        </button>
        <button
          className="primary-button"
          type="button"
          {...disabledButtonProps(createInvitationDisabled, createInvitationDisabledReason)}
          onClick={() => onCreateInvitation()}
        >
          {busy === 'create-invitation' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <MailPlus size={14} />
          )}
          邀请普通成员
        </button>
      </div>
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
            const canAdjustTarget = canAdjustBilling && canManageBillingAccount(session, membership)
            const canUpdatePlan = canUpdateMembershipPlan(session, membership)
            const passwordDisabled = !canManage || passwordBusy
            const accountDisabled = !canManage || membership.userId === currentUserId || accountBusy
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
                      {...disabledButtonProps(
                        !canAdjustTarget,
                        !canAdjustBilling ? '当前身份不能调账' : '当前身份不能调整该账号归属的账单',
                      )}
                      onClick={() => onAdjust(membership)}
                    >
                      <PencilLine size={14} />
                      调账
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      {...disabledButtonProps(!canUpdatePlan, '当前身份不能修改该账号归属的套餐')}
                      onClick={() => onUpdatePlan(membership)}
                    >
                      <Crown size={14} />
                      改套餐/冲会员
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      {...disabledButtonProps(
                        passwordDisabled,
                        !canManage ? '当前身份不能设置密码' : '正在设置密码',
                      )}
                      onClick={() => onOpenPasswordReset(userTarget)}
                    >
                      {passwordBusy ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}
                      设置密码
                    </button>
                    <button
                      className="row-button danger"
                      type="button"
                      {...disabledButtonProps(
                        accountDisabled,
                        !canManage
                          ? '当前身份不能变更账号状态'
                          : membership.userId === currentUserId
                            ? '不能禁用或启用当前登录账号'
                            : '正在更新账号状态',
                      )}
                      onClick={() => onSetStatus(userTarget)}
                    >
                      {accountBusy ? <LoaderCircle size={14} className="spin" /> : <Power size={14} />}
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
  onCreateOrganizationWithAdmin,
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
  const canCreateNewOrganization = canCreateOrganization(session)
  const createOrganizationDisabled = !canCreateNewOrganization || busy === 'create-organization'
  const createOrganizationReason = !canCreateNewOrganization
    ? '只有 owner 或 super_admin 可以创建企业组织'
    : '正在创建企业组织'
  const createWithAdminDisabled = !canCreateNewOrganization || busy === 'create-organization-with-admin'
  const createWithAdminReason = !canCreateNewOrganization
    ? '只有 owner 或 super_admin 可以创建企业组织'
    : '正在创建企业组织和管理员'

  return (
    <DataSection title="企业组织列表" count={visibleOrganizations.length}>
      <div className="inline-filter-bar organization-filter-bar">
        <button
          className="primary-button"
          type="button"
          {...disabledButtonProps(createOrganizationDisabled, createOrganizationReason)}
          onClick={onCreateOrganization}
        >
          {busy === 'create-organization' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Building2 size={14} />
          )}
          创建企业组织
        </button>
        <button
          className="row-button"
          type="button"
          {...disabledButtonProps(createWithAdminDisabled, createWithAdminReason)}
          onClick={onCreateOrganizationWithAdmin}
        >
          {busy === 'create-organization-with-admin' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Crown size={14} />
          )}
          创建企业组织+首个管理员
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
            const invitationRoles = organizationInvitationRoleOptions(session, organization)
            const canManageTarget = canManageOrganization(session, organization)
            const canReadBillingPool = canReadOrganizationBilling(session, organization)
            const canRenameTarget = canManageTarget
            const canCreateTarget =
              organization.status === 'active' && canCreateOrganizationUser(session, organization)
            const canAddExistingTarget = canAddExistingOrganizationMember(session, organization)
            const canTransferTarget =
              canTransferOrganizationAdmin(session, organization) &&
              organization.activeOrganizationAdminCount >= 1
            const canDisableTarget =
              organization.status === 'active' && canDisableOrganization(session, organization)
            const canInviteOrganizationMember =
              organization.status === 'active' && invitationRoles.includes('organization_member')
            const canInviteOrganizationAdmin =
              organization.status === 'active' && invitationRoles.includes('organization_admin')
            const inactiveReason = organization.status !== 'active' ? '企业组织已禁用，不能执行该操作' : ''
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
                      {...disabledButtonProps(
                        !canReadBillingPool,
                        organizationType.type !== 'enterprise'
                          ? '只有企业组织有共享积分池'
                          : '当前身份不能查看该组织共享积分池',
                      )}
                      onClick={() => onOpenOrganizationBilling(organization)}
                    >
                      <CreditCard size={14} />
                      组织共享池
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      {...disabledButtonProps(
                        !canCreateTarget,
                        inactiveReason || '当前身份不能在该组织内直接创建账号',
                      )}
                      onClick={() => onCreateUser(organization.id)}
                    >
                      <Plus size={14} />
                      直接创建组织账号
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      {...disabledButtonProps(
                        !canAddExistingTarget || busy === 'add-existing-member',
                        inactiveReason ||
                          (!canAddExistingTarget ? '当前身份不能把已有账号加入该组织' : '正在加入已有账号'),
                      )}
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
                      {...disabledButtonProps(
                        !canInviteOrganizationMember || busy === 'create-invitation',
                        inactiveReason ||
                          (!canInviteOrganizationMember ? '当前身份不能邀请组织成员' : '正在创建邀请'),
                      )}
                      onClick={() => onCreateInvitation(organization.id, 'organization_member')}
                    >
                      {busy === 'create-invitation' ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <MailPlus size={14} />
                      )}
                      邀请组织成员
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      {...disabledButtonProps(
                        !canInviteOrganizationAdmin || busy === 'create-invitation',
                        inactiveReason ||
                          (!canInviteOrganizationAdmin ? '当前身份不能邀请组织管理员' : '正在创建邀请'),
                      )}
                      onClick={() => onCreateInvitation(organization.id, 'organization_admin')}
                    >
                      {busy === 'create-invitation' ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Crown size={14} />
                      )}
                      邀请组织管理员
                    </button>
                    <details className="row-more-menu">
                      <summary title="打开低频组织操作">
                        <MoreHorizontal size={14} />
                        更多
                      </summary>
                      <div>
                        <button
                          className="row-button"
                          type="button"
                          {...disabledButtonProps(
                            !canRenameTarget || busy === `organization-rename:${organization.id}`,
                            !canRenameTarget ? '当前身份不能重命名该组织' : '正在重命名组织',
                          )}
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
                          {...disabledButtonProps(!canManageTarget, '当前身份不能管理该组织邀请')}
                          onClick={() => onManageInvitations(organization)}
                        >
                          <MailPlus size={14} />
                          邀请管理
                        </button>
                        <button
                          className="row-button"
                          type="button"
                          {...disabledButtonProps(
                            !canTransferTarget || busy === `organization-admin-change:${organization.id}`,
                            !canTransferOrganizationAdmin(session, organization)
                              ? '只有平台管理员可以更换组织负责人'
                              : organization.activeOrganizationAdminCount < 1
                                ? '该组织没有可更换的组织管理员'
                                : '正在更换组织负责人',
                          )}
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
                          {...disabledButtonProps(
                            !canDisableTarget || busy === `organization-disable:${organization.id}`,
                            inactiveReason ||
                              (!canDisableOrganization(session, organization)
                                ? '只有 owner 可以禁用企业组织'
                                : '正在禁用组织'),
                          )}
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
                    </details>
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
  onOpenDetail,
  onUpdateRole,
  onDisableMembership,
  onAdjust,
  onUpdatePlan,
}) {
  return (
    <DataSection title="账号归属查询" count={memberships.length}>
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
  const queueSummary = summarizeComplianceQueues(allPrompts)

  return (
    <div className="compliance-page">
      <section className="compliance-queue-grid" aria-label="审查队列">
        {complianceQueueCards(queueSummary).map((card) => (
          <button
            key={card.id}
            type="button"
            className={filters.queue === card.id ? 'compliance-queue-card active' : 'compliance-queue-card'}
            onClick={() => onFilterChange({ queue: card.id }, { resetOffset: false })}
          >
            <card.icon size={16} />
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </button>
        ))}
      </section>
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
            <select
              value={filters.source}
              onChange={(event) => onFilterChange({ source: event.target.value })}
            >
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
            <ShieldCheck size={14} />
            <select
              value={filters.queue}
              onChange={(event) => onFilterChange({ queue: event.target.value }, { resetOffset: false })}
            >
              <option value="all">全部队列</option>
              <option value="high-risk">高风险</option>
              <option value="pending">待审查</option>
              <option value="warned">已警告</option>
              <option value="reviewed">已审查</option>
              <option value="disabled">已封号</option>
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
            {filters.queue !== 'all' ? ` · 队列筛选 ${prompts.length} 条` : ''}
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
              <th>审查</th>
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
                    <ComplianceReviewBadge item={item} />
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
                        {...disabledButtonProps(actionBusy, '正在记录审查动作')}
                        onClick={() => onReview(item)}
                      >
                        {actionBusy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                        已审查
                      </button>
                      <button
                        className="row-button"
                        type="button"
                        {...disabledButtonProps(actionBusy, '正在记录审查动作')}
                        onClick={() => onWarn(item)}
                      >
                        <AlertTriangle size={14} />
                        警告
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
                        封号
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            <EmptyRow visible={!prompts.length && !loading} columns={8} />
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
  platformInvitations,
  platformLoading,
  platformError,
  invitations,
  loading,
  error,
  session,
  busy,
  query,
  platformStatusFilter,
  onPlatformStatusFilterChange,
  statusFilter,
  onStatusFilterChange,
  onSelectOrganization,
  onCreatePlatformInvitation,
  onCreateOrganizationInvitation,
  onBatchOrganizationInvitation,
  onRefreshPlatform,
  onRevokePlatform,
  onRefresh,
  onReissue,
  onRevoke,
}) {
  const canCreateMemberInvitation = canCreatePlatformInvitation(session)
  const organizationRoles = organizationInvitationRoleOptions(session, selectedOrganization)
  const canCreateOrganizationMember =
    selectedOrganization?.status === 'active' && organizationRoles.includes('organization_member')
  const canCreateOrganizationAdmin =
    selectedOrganization?.status === 'active' && organizationRoles.includes('organization_admin')
  const organizationInactiveReason =
    selectedOrganization && selectedOrganization.status !== 'active' ? '企业组织已禁用，不能创建邀请' : ''
  const statusCounts = summarizeInvitationStatuses(invitations)
  const visibleInvitations = filterRows(
    statusFilter === 'all'
      ? invitations
      : invitations.filter((invitation) => invitation.status === statusFilter),
    query,
  )
  const platformStatusCounts = summarizeInvitationStatuses(platformInvitations)
  const visiblePlatformInvitations = filterRows(
    platformStatusFilter === 'all'
      ? platformInvitations
      : platformInvitations.filter((invitation) => invitation.status === platformStatusFilter),
    query,
  )

  return (
    <div className="invitation-page-layout">
      <DataSection title="普通成员邀请" count={visiblePlatformInvitations.length}>
        <div className="inline-filter-bar invitation-page-toolbar">
          <label>
            <Filter size={14} />
            <select
              value={platformStatusFilter}
              onChange={(event) => onPlatformStatusFilterChange(event.target.value)}
            >
              <option value="all">全部状态 · {platformInvitations.length}</option>
              <option value="pending">待接受 · {platformStatusCounts.pending}</option>
              <option value="accepted">已接受 · {platformStatusCounts.accepted}</option>
              <option value="revoked">已撤销 · {platformStatusCounts.revoked}</option>
              <option value="expired">已过期 · {platformStatusCounts.expired}</option>
            </select>
          </label>
          <button
            className="primary-button"
            type="button"
            {...disabledButtonProps(
              !canCreateMemberInvitation || busy === 'create-invitation',
              !canCreateMemberInvitation ? '当前身份不能邀请普通成员' : '正在创建邀请',
            )}
            onClick={onCreatePlatformInvitation}
          >
            {busy === 'create-invitation' ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <MailPlus size={14} />
            )}
            邀请普通成员
          </button>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(platformLoading, '正在刷新普通成员邀请')}
            onClick={onRefreshPlatform}
          >
            {platformLoading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新列表
          </button>
        </div>
        <section className="organization-detail-head invitation-page-head">
          <IdentityCell name="普通成员注册" detail="platform_registration" />
          <div>
            <span>待接受</span>
            <strong>{platformStatusCounts.pending}</strong>
          </div>
          <div>
            <span>已接受</span>
            <strong>{platformStatusCounts.accepted}</strong>
          </div>
          <span className="invitation-scope-badge">个人空间</span>
        </section>
        {platformError && <div className="notice error">{platformError}</div>}
        {platformLoading && !platformInvitations.length ? (
          <LoadingScreen compact label="正在读取普通成员邀请" />
        ) : (
          <InvitationCards
            invitations={visiblePlatformInvitations}
            busy={busy}
            revokeBusyPrefix="platform-invitation-revoke"
            onRevoke={onRevokePlatform}
          />
        )}
        <p className="modal-hint">
          普通成员邀请只创建平台 member 账号；受邀人注册后自动获得个人空间，不进入企业组织列表。
        </p>
      </DataSection>

      <DataSection title="企业组织邀请" count={visibleInvitations.length}>
        <div className="inline-filter-bar invitation-page-toolbar">
          <label>
            <Building2 size={14} />
            <select
              value={selectedOrganizationId}
              onChange={(event) => onSelectOrganization(event.target.value)}
              {...disabledButtonProps(!organizations.length, '暂无当前身份可管理的企业组织')}
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
            {...disabledButtonProps(
              !canCreateOrganizationMember || busy === 'create-invitation',
              organizationInactiveReason ||
                (!canCreateOrganizationMember ? '当前身份不能邀请组织成员' : '正在创建邀请'),
            )}
            onClick={() => onCreateOrganizationInvitation('organization_member')}
          >
            {busy === 'create-invitation' ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <MailPlus size={14} />
            )}
            邀请组织成员
          </button>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(
              !canCreateOrganizationAdmin || busy === 'create-invitation',
              organizationInactiveReason ||
                (!canCreateOrganizationAdmin ? '当前身份不能邀请组织管理员' : '正在创建邀请'),
            )}
            onClick={() => onCreateOrganizationInvitation('organization_admin')}
          >
            {busy === 'create-invitation' ? <LoaderCircle size={14} className="spin" /> : <Crown size={14} />}
            邀请组织管理员
          </button>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(
              !canCreateOrganizationMember || busy === 'batch-organization-invitations',
              organizationInactiveReason ||
                (!canCreateOrganizationMember ? '当前身份不能批量邀请组织成员' : '正在批量邀请'),
            )}
            onClick={() => onBatchOrganizationInvitation('organization_member')}
          >
            {busy === 'batch-organization-invitations' ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <MailPlus size={14} />
            )}
            批量邀请成员
          </button>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(
              !selectedOrganization || loading,
              !selectedOrganization ? '请先选择企业组织' : '正在刷新组织邀请',
            )}
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
          <p className="panel-empty">暂无可管理的企业组织。</p>
        )}
        {error && <div className="notice error">{error}</div>}
        {loading && !invitations.length ? (
          <LoadingScreen compact label="正在读取邀请列表" />
        ) : (
          <InvitationCards
            invitations={visibleInvitations}
            canReissueInvitation={(invitation) =>
              selectedOrganization?.status === 'active' &&
              invitation.roles.every((role) => organizationRoles.includes(role))
            }
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
  const invitationRoles = organizationInvitationRoleOptions(session, organization)
  const canInviteOrganizationMember =
    organization.status === 'active' && invitationRoles.includes('organization_member')
  const canInviteOrganizationAdmin =
    organization.status === 'active' && invitationRoles.includes('organization_admin')
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

function BillingOwnershipHint({ target, scope = 'membership' }) {
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

function AdjustmentModal({ target, form, busy, onChange, onClose, onSubmit }) {
  const amount = Number(form.amount)
  const valid = Number.isInteger(amount) && amount !== 0 && form.reason.trim().length > 0
  return (
    <Modal title="后台调账" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell name={target.name} detail={`${target.tenantName} · ${target.email ?? target.userId}`} />
        <BillingOwnershipHint target={target} />
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
        <BillingOwnershipHint target={organization} scope="organization" />
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
        <BillingOwnershipHint target={membership} />
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

function RenameOrganizationModal({ organization, form, busy, onChange, onClose, onSubmit }) {
  const valid = form.name.trim().length > 0 && form.name.trim() !== organization.name
  return (
    <Modal title="重命名企业组织" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell name={organization.name} detail={organization.id} />
        <label>
          <span>新组织名称</span>
          <input
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            maxLength={80}
            required
          />
        </label>
        <p className="modal-hint">组织名称会影响运营检索和客户后台显示，不会改变组织 ID。</p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="重命名组织" />
      </form>
    </Modal>
  )
}

function CreateOrganizationModal({ form, busy, onChange, onClose, onSubmit }) {
  const valid = form.name.trim().length > 0
  return (
    <Modal title="创建企业组织" onClose={onClose}>
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
        <p className="modal-hint">
          后台创建企业组织不会切换当前登录 session；创建后可加入已有账号或直接创建组织账号。
        </p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="创建企业组织" />
      </form>
    </Modal>
  )
}

function CreateOrganizationWithAdminModal({ form, busy, onChange, onClose, onSubmit }) {
  const valid =
    form.organizationName.trim().length > 0 &&
    form.adminEmail.trim().includes('@') &&
    form.adminName.trim().length > 0 &&
    form.adminPassword.length >= 8

  return (
    <Modal title="创建企业组织+首个管理员" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>企业组织名称</span>
          <input
            value={form.organizationName}
            onChange={(event) => onChange({ ...form, organizationName: event.target.value })}
            maxLength={80}
            required
          />
        </label>
        <label>
          <span>管理员邮箱</span>
          <input
            type="email"
            value={form.adminEmail}
            onChange={(event) => onChange({ ...form, adminEmail: event.target.value })}
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span>管理员姓名</span>
          <input
            value={form.adminName}
            onChange={(event) => onChange({ ...form, adminName: event.target.value })}
            maxLength={80}
            required
          />
        </label>
        <label>
          <span>初始临时密码</span>
          <input
            type="password"
            value={form.adminPassword}
            onChange={(event) => onChange({ ...form, adminPassword: event.target.value })}
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
          />
          <small>管理员首次登录后仍会被要求设置自己的新密码。</small>
        </label>
        <p className="modal-hint">
          该向导会先创建企业组织，再直接创建 organization_admin 账号；如果第二步失败，已创建的企业组织会保留。
        </p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="创建组织和管理员" />
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
  const isOrganizationScope = form.scope === 'organization'
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
    <Modal title={isOrganizationScope ? '直接创建组织账号' : '直接创建个人账号'} onClose={onClose}>
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
            <span>企业组织</span>
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
        <ModalActions
          busy={busy}
          valid={valid}
          onClose={onClose}
          submitLabel={isOrganizationScope ? '直接创建组织账号' : '直接创建个人账号'}
        />
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

function CreateInvitationModal({ form, organizations, session, busy, onChange, onClose, onSubmit }) {
  const needsOrganization = form.kind === 'organization'
  const roleLabel = roleName(form.role)
  const organizationOptions = needsOrganization
    ? organizations.filter((organization) =>
        organizationInvitationRoleOptions(session, organization).includes(form.role),
      )
    : []
  const selectedOrganization =
    organizationOptions.find((organization) => organization.id === form.organizationId) ?? null
  const valid = form.email.trim().includes('@') && (!needsOrganization || Boolean(selectedOrganization))

  const selectOrganization = (organizationId) => {
    onChange({
      ...form,
      organizationId,
    })
  }

  return (
    <Modal title={needsOrganization ? `邀请${roleLabel}` : '邀请普通成员'} onClose={onClose}>
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
        {needsOrganization ? (
          <>
            <p className="modal-hint">身份：{roleLabel}。邀请只面向企业组织，不会进入个人空间入口。</p>
            <label>
              <span>企业组织</span>
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
          </>
        ) : (
          <p className="modal-hint">身份：{roleLabel}。注册后会自动创建个人空间。</p>
        )}
        <p className="modal-hint">邀请码只在创建后显示一次，同时会按邮件配置发送邀请邮件。</p>
        <ModalActions
          busy={busy}
          valid={valid}
          onClose={onClose}
          submitLabel={needsOrganization ? `邀请${roleLabel}` : '邀请普通成员'}
        />
      </form>
    </Modal>
  )
}

function BatchOrganizationInvitationModal({
  form,
  organizations,
  session,
  busy,
  result,
  onChange,
  onClose,
  onSubmit,
  onCopy,
}) {
  const selectedOrganization =
    organizations.find((organization) => organization.id === form.organizationId) ?? organizations[0] ?? null
  const roles = organizationInvitationRoleOptions(session, selectedOrganization)
  const emails = parseEmailLines(form.emails)
  const valid =
    Boolean(selectedOrganization) &&
    roles.includes(form.role) &&
    emails.valid.length > 0 &&
    emails.valid.length <= 100

  const selectOrganization = (organizationId) => {
    const organization = organizations.find((item) => item.id === organizationId)
    const nextRoles = organizationInvitationRoleOptions(session, organization)
    onChange({
      ...form,
      organizationId,
      role: nextRoles.includes(form.role) ? form.role : (nextRoles[0] ?? 'organization_member'),
    })
  }

  return (
    <Modal title="批量邀请组织成员" onClose={onClose} wide>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>企业组织</span>
          <select
            value={form.organizationId}
            onChange={(event) => selectOrganization(event.target.value)}
            disabled={!organizations.length}
            required
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name} · {organization.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>邀请身份</span>
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
        <label>
          <span>邮箱列表</span>
          <textarea
            value={form.emails}
            onChange={(event) => onChange({ ...form, emails: event.target.value })}
            placeholder="每行一个邮箱，最多 100 个"
            rows={8}
            required
          />
        </label>
        <div className="batch-summary">
          <span>有效 {emails.valid.length}</span>
          <span>格式错误 {emails.invalid.length}</span>
          <span>去重后邀请 {emails.valid.length}</span>
        </div>
        <p className="modal-hint">批量邀请不会直接创建账号密码；受邀人通过注册链接完成注册并进入企业组织。</p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="开始批量邀请" />
      </form>
      {result && <BatchInvitationResult result={result} onCopy={onCopy} />}
    </Modal>
  )
}

function BatchInvitationResult({ result, onCopy }) {
  const successfulText = result.created
    .map((invitation) => `${invitation.email} ${invitationUrlFor(invitation.token)}`)
    .join('\n')
  return (
    <section className="batch-result">
      <header>
        <div>
          <strong>{result.organization.name}</strong>
          <span>
            {roleName(result.role)} · 成功 {result.created.length} · 失败 {result.failed.length}
          </span>
        </div>
        <button
          className="row-button"
          type="button"
          {...disabledButtonProps(!result.created.length, '没有成功生成的邀请码')}
          onClick={() => onCopy(successfulText, '已复制批量邀请链接')}
        >
          <Copy size={14} />
          复制成功链接
        </button>
      </header>
      <div className="batch-result-list">
        {result.created.map((invitation) => (
          <article key={invitation.id}>
            <strong>{invitation.email}</strong>
            <code>{invitationUrlFor(invitation.token)}</code>
          </article>
        ))}
        {result.failed.map((item) => (
          <article key={`failed:${item.email}`} className="failed">
            <strong>{item.email}</strong>
            <span>{item.message}</span>
          </article>
        ))}
      </div>
    </section>
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
            <dt>类型</dt>
            <dd>{invitationScopeName(invitation.scope)}</dd>
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

function InvitationCards({
  invitations,
  canReissueInvitation = () => false,
  busy,
  reissueBusyPrefix = 'invitation-reissue',
  revokeBusyPrefix = 'invitation-revoke',
  onReissue,
  onRevoke,
}) {
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
            {onReissue && (
              <button
                className="row-button"
                type="button"
                disabled={
                  !canReissueInvitation(invitation) ||
                  invitation.status === 'accepted' ||
                  busy === `${reissueBusyPrefix}:${invitation.id}`
                }
                onClick={() => onReissue(invitation)}
              >
                {busy === `${reissueBusyPrefix}:${invitation.id}` ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                重新生成
              </button>
            )}
            <button
              className="row-button danger"
              type="button"
              disabled={invitation.status !== 'pending' || busy === `${revokeBusyPrefix}:${invitation.id}`}
              onClick={() => onRevoke(invitation)}
            >
              {busy === `${revokeBusyPrefix}:${invitation.id}` ? (
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
  const organizationRoles = organizationInvitationRoleOptions(session, organization)
  const canCreate = organization.status === 'active' && organizationRoles.includes('organization_member')
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
            邀请组织成员
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
            canReissueInvitation={(invitation) =>
              organization.status === 'active' &&
              invitation.roles.every((role) => organizationRoles.includes(role))
            }
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

function ActionConfirmModal({ request, busy, onCancel, onConfirm }) {
  const details = request.details ?? []
  return (
    <Modal title={request.title} onClose={busy ? () => {} : onCancel}>
      <div className={`confirm-panel ${request.tone ?? 'default'}`}>
        {request.summary && <p>{request.summary}</p>}
        {request.message && <pre>{request.message}</pre>}
        {details.length > 0 && (
          <dl>
            {details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd className={detail.tone ?? ''}>{detail.value ?? '-'}</dd>
              </div>
            ))}
          </dl>
        )}
        {request.impact && <p className="confirm-impact">{request.impact}</p>}
      </div>
      <div className="modal-actions">
        <button className="row-button" type="button" onClick={onCancel} disabled={busy}>
          {request.cancelLabel ?? '取消'}
        </button>
        <button
          className={request.tone === 'danger' ? 'row-button danger solid' : 'primary-button'}
          type="button"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}
          {request.confirmLabel ?? '确认'}
        </button>
      </div>
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

function ComplianceReviewBadge({ item }) {
  const status = item.userStatus !== 'active' ? 'disabled' : (item.reviewStatus ?? 'pending')
  return (
    <span className={`compliance-review-badge ${status}`} title={complianceReviewHint(item)}>
      {complianceReviewStatusName(status)}
    </span>
  )
}

function complianceReviewStatusName(status) {
  const labels = {
    pending: '待审查',
    warned: '已警告',
    reviewed: '已审查',
    disabled: '已封号',
  }
  return labels[status] ?? status
}

function complianceReviewActionName(action) {
  return action === 'warned' ? '发送警告' : '标记已审查'
}

function complianceReviewHint(item) {
  if (item.userStatus !== 'active') return '账号已禁用'
  const action = item.lastReviewAction
  if (!action) return '暂无人工审查动作'
  return `${complianceReviewActionName(action.action)} · ${formatDate(action.createdAt)}`
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

function summarizeComplianceQueues(items) {
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

function complianceQueueCards(summary) {
  return [
    { id: 'all', label: '全部', value: summary.all, icon: FileText },
    { id: 'high-risk', label: '高风险', value: summary.highRisk, icon: ShieldAlert },
    { id: 'pending', label: '待审查', value: summary.pending, icon: Clock },
    { id: 'warned', label: '已警告', value: summary.warned, icon: AlertTriangle },
    { id: 'reviewed', label: '已审查', value: summary.reviewed, icon: ShieldCheck },
    { id: 'disabled', label: '已封号', value: summary.disabled, icon: Power },
  ]
}

function complianceQueueMatches(item, queue) {
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

function parseEmailLines(value) {
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
