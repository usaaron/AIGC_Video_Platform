import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  CreditCard,
  Crown,
  FileText,
  Gauge,
  IdCard,
  KeyRound,
  LoaderCircle,
  LogOut,
  MailPlus,
  PencilLine,
  RefreshCw,
  Search,
  ShieldAlert,
  UsersRound,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './apiClient'
import {
  DeniedScreen,
  DismissibleNotice,
  LoadingScreen,
  LoginScreen,
  NextStepNotice,
  PermissionBoundaryBanner,
} from './components/AppChrome'
import { ConsolePaginationFooter, ConsoleServerControls } from './components/AdminConsoleControls'
import {
  WEB_ORIGIN,
  accountScopeDescription,
  canCreatePlatformInvitation,
  isUsageTab,
  organizationInvitationRoleOptions,
  personalAccountRoleOptions,
  roleRequiresOrganization,
  systemAccountRoleOptions,
  usesConsoleServerControls,
  workflowTabIds,
} from './components/adminDomain'
import { tooltipProps } from './components/AdminUi'
import {
  tabCount,
  activeConsoleListMeta,
  clientListMeta,
  paginateClientRows,
  organizationOptionsForFilter,
  membershipOrganizationOptionsForFilter,
  complianceQueueMatches,
  parseEmailLines,
} from './components/adminViewHelpers'
import {
  organizationAdminTransferCandidates,
  organizationNameFor,
  organizationIdFromRow,
} from './components/adminDataHelpers'
import {
  buildAdminViewSearch,
  createDefaultComplianceFilters,
  createDefaultConsoleFilters,
  readAdminViewState,
} from './adminViewState'
import {
  assignableRoleOptions,
  addExistingOrganizationMemberRoleOptions,
  buildSessionRiskRows,
  canAddExistingOrganizationMember,
  canCreateOrganization,
  canCreateOrganizationUser,
  canManageBilling,
  canManageBillingAccount,
  canManageOrganization,
  canManageOrganizationBilling,
  canManageUsers,
  canReadAdminConsole,
  canReadOrganizationBilling,
  canUpdateMembershipPlan,
  formatSignedAmount,
  membershipIdFor,
  planName,
  roleName,
  statusName,
  isEnterpriseOrganization,
  isPersonalAccountMembership,
  isPlatformAdminSession,
  summarizeConsole,
} from './adminConsole'

function lazyNamed(loader, name) {
  return lazy(() => loader().then((module) => ({ default: module[name] })))
}
const OverviewPanel = lazyNamed(() => import('./components/AdminOverviewPages'), 'OverviewPanel')
const DeliveryWorkbench = lazyNamed(() => import('./components/AdminOverviewPages'), 'DeliveryWorkbench')
const UsageRealtimePage = lazyNamed(() => import('./components/AdminOverviewPages'), 'UsageRealtimePage')
const UsageTablePage = lazyNamed(() => import('./components/AdminOverviewPages'), 'UsageTablePage')
const UsersTable = lazyNamed(() => import('./components/AdminAccountPages'), 'UsersTable')
const PersonalAccountsTable = lazyNamed(
  () => import('./components/AdminAccountPages'),
  'PersonalAccountsTable',
)
const OrganizationsTable = lazyNamed(() => import('./components/AdminAccountPages'), 'OrganizationsTable')
const MembershipsTable = lazyNamed(() => import('./components/AdminOperationPages'), 'MembershipsTable')
const ComplianceReviewPage = lazyNamed(
  () => import('./components/AdminOperationPages'),
  'ComplianceReviewPage',
)
const InvitationsPage = lazyNamed(() => import('./components/AdminOperationPages'), 'InvitationsPage')
const BillingPanel = lazyNamed(() => import('./components/AdminBillingPages'), 'BillingPanel')
const BillingAdjustmentPage = lazyNamed(
  () => import('./components/AdminBillingPages'),
  'BillingAdjustmentPage',
)
const ReconciliationAlertsPage = lazyNamed(
  () => import('./components/AdminBillingPages'),
  'ReconciliationAlertsPage',
)
const CompliancePromptDetailDrawer = lazyNamed(
  () => import('./components/AdminComplianceUserDrawers'),
  'CompliancePromptDetailDrawer',
)
const UserDetailDrawer = lazyNamed(
  () => import('./components/AdminComplianceUserDrawers'),
  'UserDetailDrawer',
)
const MembershipDetailDrawer = lazyNamed(
  () => import('./components/AdminMembershipOrganizationDrawers'),
  'MembershipDetailDrawer',
)
const OrganizationDetailDrawer = lazyNamed(
  () => import('./components/AdminMembershipOrganizationDrawers'),
  'OrganizationDetailDrawer',
)
const SessionsTable = lazyNamed(() => import('./components/AdminSecurityAuditPages'), 'SessionsTable')
const SessionRiskDetailDrawer = lazyNamed(
  () => import('./components/AdminSecurityAuditPages'),
  'SessionRiskDetailDrawer',
)
const SessionRiskView = lazyNamed(() => import('./components/AdminSecurityAuditPages'), 'SessionRiskView')
const AuditLogPage = lazyNamed(() => import('./components/AdminSecurityAuditPages'), 'AuditLogPage')
const AuditLogDetailDrawer = lazyNamed(
  () => import('./components/AdminSecurityAuditPages'),
  'AuditLogDetailDrawer',
)
const AdjustmentModal = lazyNamed(() => import('./components/AdminBillingModals'), 'AdjustmentModal')
const GrantModal = lazyNamed(() => import('./components/AdminBillingModals'), 'GrantModal')
const OrganizationBillingModal = lazyNamed(
  () => import('./components/AdminBillingModals'),
  'OrganizationBillingModal',
)
const MembershipPlanModal = lazyNamed(() => import('./components/AdminBillingModals'), 'MembershipPlanModal')
const PasswordResetModal = lazyNamed(() => import('./components/AdminAccountModals'), 'PasswordResetModal')
const RenameOrganizationModal = lazyNamed(
  () => import('./components/AdminAccountModals'),
  'RenameOrganizationModal',
)
const CreateOrganizationModal = lazyNamed(
  () => import('./components/AdminAccountModals'),
  'CreateOrganizationModal',
)
const CreateOrganizationWithAdminModal = lazyNamed(
  () => import('./components/AdminAccountModals'),
  'CreateOrganizationWithAdminModal',
)
const CreateOrganizationUserModal = lazyNamed(
  () => import('./components/AdminAccountModals'),
  'CreateOrganizationUserModal',
)
const AddExistingMemberModal = lazyNamed(
  () => import('./components/AdminAccountModals'),
  'AddExistingMemberModal',
)
const CreateInvitationModal = lazyNamed(
  () => import('./components/AdminAccountModals'),
  'CreateInvitationModal',
)
const BatchOrganizationInvitationModal = lazyNamed(
  () => import('./components/AdminInvitationModals'),
  'BatchOrganizationInvitationModal',
)
const InvitationResultModal = lazyNamed(
  () => import('./components/AdminInvitationModals'),
  'InvitationResultModal',
)
const OrganizationInvitationsModal = lazyNamed(
  () => import('./components/AdminInvitationModals'),
  'OrganizationInvitationsModal',
)
const OrganizationAdminTransferModal = lazyNamed(
  () => import('./components/AdminActionModals'),
  'OrganizationAdminTransferModal',
)
const ReconciliationAlertActionModal = lazyNamed(
  () => import('./components/AdminActionModals'),
  'ReconciliationAlertActionModal',
)
const CompliancePromptActionModal = lazyNamed(
  () => import('./components/AdminActionModals'),
  'CompliancePromptActionModal',
)
const ActionConfirmModal = lazyNamed(() => import('./components/AdminActionModals'), 'ActionConfirmModal')

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

const adminTabIds = tabs.map((tab) => tab.id)

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
const consoleFilterInitialState = createDefaultConsoleFilters()
const complianceFilterInitialState = createDefaultComplianceFilters()
const complianceActionInitialState = { action: 'reviewed', reason: '', category: '' }
const organizationAdminTransferInitialState = {
  organizationId: '',
  currentOrganizationAdminUserId: '',
  targetUserId: '',
}
export function App() {
  const initialViewState =
    typeof window === 'undefined'
      ? {
          activeTab: 'overview',
          queryDraft: '',
          query: '',
          consoleFilters: createDefaultConsoleFilters(),
          complianceFilters: createDefaultComplianceFilters(),
        }
      : readAdminViewState(window.location.search, { allowedTabIds: adminTabIds })

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
  const [complianceFilters, setComplianceFilters] = useState(initialViewState.complianceFilters)
  const [complianceDetailId, setComplianceDetailId] = useState('')
  const [complianceActionTarget, setComplianceActionTarget] = useState(null)
  const [complianceActionForm, setComplianceActionForm] = useState(complianceActionInitialState)
  const [notice, setNotice] = useState('')
  const [queryDraft, setQueryDraft] = useState(initialViewState.queryDraft)
  const [query, setQuery] = useState(initialViewState.query)
  const [consoleFilters, setConsoleFilters] = useState(initialViewState.consoleFilters)
  const [activeTab, setActiveTabState] = useState(initialViewState.activeTab)
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
  const hasHydratedUrlRef = useRef(false)
  const pendingHistoryActionRef = useRef('replace')

  const setActiveTab = (tabId, { history = 'push' } = {}) => {
    if (!tabId || tabId === activeTab) return
    pendingHistoryActionRef.current = history
    setActiveTabState(tabId)
  }

  const updateQueryDraft = (value) => {
    setQueryDraft(value)
    setConsoleFilters((current) => (current.offset === 0 ? current : { ...current, offset: 0 }))
  }

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
    if (authLoading) return
    if (activeTab === 'compliance' && !canReviewCompliance) setActiveTab('overview', { history: 'replace' })
  }, [activeTab, authLoading, canReviewCompliance])

  useEffect(() => {
    if (!hasHydratedUrlRef.current) return undefined
    const timer = window.setTimeout(() => {
      setQuery(queryDraft.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [queryDraft])

  useEffect(() => {
    if (!hasHydratedUrlRef.current) return
    setError('')
  }, [activeTab])

  useEffect(() => {
    if (!hasHydratedUrlRef.current) return
    const nextSearch = buildAdminViewSearch({
      activeTab,
      query,
      queryDraft,
      consoleFilters,
      complianceFilters,
    })
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextUrl === currentUrl) {
      pendingHistoryActionRef.current = 'replace'
      return
    }
    const historyMethod = pendingHistoryActionRef.current === 'push' ? 'pushState' : 'replaceState'
    window.history[historyMethod]({ adminView: true }, '', nextUrl)
    pendingHistoryActionRef.current = 'replace'
  }, [activeTab, query, queryDraft, consoleFilters, complianceFilters])

  useEffect(() => {
    const handlePopState = () => {
      const nextViewState = readAdminViewState(window.location.search, { allowedTabIds: adminTabIds })
      pendingHistoryActionRef.current = 'replace'
      setActiveTabState(nextViewState.activeTab)
      setQueryDraft(nextViewState.queryDraft)
      setQuery(nextViewState.query)
      setConsoleFilters(nextViewState.consoleFilters)
      setComplianceFilters(nextViewState.complianceFilters)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    hasHydratedUrlRef.current = true
  }, [])

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
      organizations:
        activeTab === 'organizations'
          ? paginateClientRows(enterpriseOrganizationItems, consoleFilters)
          : enterpriseOrganizationItems,
      personalAccounts:
        activeTab === 'personal-accounts'
          ? paginateClientRows(personalAccountMemberships, consoleFilters)
          : personalAccountMemberships,
      memberships: snapshot.memberships.items,
      billingAccounts: snapshot.billingAccounts.items,
      billingLedgerEntries: snapshot.billingLedgerEntries.items,
      billingPaymentReconciliation: snapshot.billingPaymentReconciliation?.items ?? [],
      billingReconciliationAlerts: snapshot.billingReconciliationAlerts?.items ?? [],
      sessions: snapshot.sessions.items,
      auditLogs: snapshot.auditLogs.items,
    }
  }, [snapshot, activeTab, consoleFilters, enterpriseOrganizationItems, personalAccountMemberships])

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
    if (createUserForm.scope === 'system') return systemAccountRoleOptions(session)
    return personalAccountRoleOptions(session)
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
    if (user.status === 'deleted') {
      setNotice('已删除账号不能重新启用')
      return
    }
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

  const deleteUser = async (user) => {
    if (user.status === 'deleted') {
      setNotice('账号已删除')
      return
    }
    const firstConfirmed = await confirmAction({
      title: '删除账号',
      tone: 'danger',
      summary: '删除后该账号将无法登录，所有账号归属会被停用，现有 session 会被撤销。',
      details: [
        { label: '账号', value: user.email ?? user.id },
        { label: '用户', value: user.name },
        { label: '当前状态', value: statusName(user.status) },
      ],
      impact: '这是运营删除，不会物理清除账单、审计、生成记录等历史数据，但不能直接恢复使用。',
      confirmLabel: '继续删除',
      busyId: `delete-user:${user.id}`,
    })
    if (!firstConfirmed) return
    const secondConfirmed = await confirmAction({
      title: '再次确认删除账号',
      tone: 'danger',
      summary: '请再次确认这是要删除的目标账号。',
      details: [
        { label: '账号', value: user.email ?? user.id },
        { label: '用户', value: user.name },
      ],
      impact: '确认后账号状态会变为已删除，不能再用于登录或继续交付。',
      confirmLabel: '确认删除账号',
      busyId: `delete-user:${user.id}`,
    })
    if (!secondConfirmed) return
    await runAction(`delete-user:${user.id}`, async () => {
      await api.deleteUser(user.id)
      setUserDetailId('')
      await loadConsole()
      if (activeTab === 'compliance') await loadCompliancePrompts()
      setNotice('账号已删除')
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
    let scope = isOrganizationScope ? 'organization' : 'personal'
    let roles = isOrganizationScope
      ? organization
        ? assignableRoleOptions(session, organization).filter(roleRequiresOrganization)
        : []
      : personalAccountRoleOptions(session)
    if (!isOrganizationScope && preferredRole && systemAccountRoleOptions(session).includes(preferredRole)) {
      scope = 'system'
      roles = systemAccountRoleOptions(session)
    }
    if (!isOrganizationScope && !roles.length) {
      scope = 'system'
      roles = systemAccountRoleOptions(session)
    }
    const role = roles.includes(preferredRole) ? preferredRole : roles[0]
    if (!roles.length || !role) {
      setNotice('当前身份不允许添加账号')
      return
    }
    setCreateUserForm({
      ...createUserInitialState,
      scope,
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
    const needsOrganization = createUserForm.scope === 'organization'
    const isSystemScope = createUserForm.scope === 'system'
    const organizationName = createUserOrganization?.name ?? createUserForm.organizationId
    const scopeLine = needsOrganization
      ? `组织：${organizationName}`
      : accountScopeDescription(createUserForm.scope)
    const createdAccountTitle = needsOrganization
      ? '组织账号已创建'
      : isSystemScope
        ? '系统账号已创建'
        : '个人账号已创建'
    const createdAccountDescription = needsOrganization
      ? '继续完成组织账号交付：需要时给成员改套餐，或在组织共享池给企业充值。'
      : isSystemScope
        ? '系统账号已进入平台内部组织；重新登录后可以进入管理后台，也可以进入创作端使用前端功能。'
        : '继续完成个人交付：可以给个人账号充值、改套餐，并把临时密码交付给用户。'
    const createdAccountAction = needsOrganization
      ? { label: '查看企业组织', tabId: 'organizations', icon: Building2 }
      : { label: '查看个人账号', tabId: 'personal-accounts', icon: IdCard }
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
        title: createdAccountTitle,
        description: createdAccountDescription,
        actions: [{ label: '去账单调账', tabId: 'adjustments', icon: PencilLine }, createdAccountAction],
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
          <a className="icon-text-button workbench-return" href={WEB_ORIGIN}>
            <ArrowLeft size={16} />
            返回工作台
          </a>
          <div
            className="operator-chip"
            title={`当前登录账号：${session.account.name}；身份：${session.account.roles.map(roleName).join('、')}`}
          >
            <span>{session.account.name.slice(0, 1)}</span>
            <div>
              <strong>{session.account.name}</strong>
              <small>{session.account.roles.map(roleName).join('、')}</small>
            </div>
          </div>
          <button
            className="icon-text-button"
            type="button"
            {...tooltipProps(
              loading || usageLoading || complianceLoading ? '后台数据正在刷新' : '刷新当前后台页面的数据',
            )}
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
          <button
            className="icon-button"
            type="button"
            {...tooltipProps('退出当前后台账号')}
            onClick={logout}
          >
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
                    title={`打开${tab.label}页面`}
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
                  onChange={(event) => updateQueryDraft(event.target.value)}
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
          <Suspense fallback={<LoadingScreen compact label="正在加载后台模块" />}>
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
                    onDeleteUser={deleteUser}
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
                    onDeleteUser={deleteUser}
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
                {usesConsoleServerControls(activeTab) && activeListMeta && (
                  <ConsolePaginationFooter
                    activeMeta={activeListMeta}
                    loading={loading}
                    onPageOffsetChange={goToConsoleOffset}
                  />
                )}
              </>
            )}
          </Suspense>
        </main>
      </div>

      <Suspense fallback={null}>
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
            onCreate={() =>
              openCreateOrganizationInvitation(invitationManagerTarget.id, 'organization_member')
            }
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
            onDeleteUser={deleteUser}
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
      </Suspense>
    </div>
  )
}
