const DEFAULT_ACTIVE_TAB = 'overview'
const DEFAULT_CONSOLE_LIMIT = 50
const DEFAULT_COMPLIANCE_LIMIT = 50

const CONSOLE_PAGE_SIZES = new Set([25, 50, 100])
const COMPLIANCE_CATEGORY_VALUES = new Set([
  'all',
  'none',
  'political_sensitive',
  'terrorism',
  'sexual_content',
  'graphic_violence',
  'extremism',
  'self_harm',
  'other',
])
const COMPLIANCE_QUEUE_VALUES = new Set(['all', 'high-risk', 'pending', 'warned', 'reviewed', 'disabled'])

function parseInteger(value, fallback, { min = 0, allowedValues = null } = {}) {
  if (value == null || value === '') return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < min) return fallback
  if (allowedValues && !allowedValues.has(parsed)) return fallback
  return parsed
}

function parseString(value) {
  return value == null ? '' : value
}

function parseBooleanFlag(value) {
  if (value == null || value === '') return false
  return value === '1' || value === 'true'
}

function parseTab(tabId, allowedTabIds) {
  return allowedTabIds.includes(tabId) ? tabId : DEFAULT_ACTIVE_TAB
}

export function createDefaultConsoleFilters() {
  return {
    tenantId: '',
    role: '',
    status: '',
    limit: DEFAULT_CONSOLE_LIMIT,
    offset: 0,
  }
}

export function createDefaultComplianceFilters() {
  return {
    q: '',
    userId: '',
    tenantId: '',
    source: '',
    category: 'all',
    queue: 'all',
    limit: DEFAULT_COMPLIANCE_LIMIT,
    offset: 0,
    sample: false,
  }
}

export function readAdminViewState(search, { allowedTabIds = [] } = {}) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const queryDraftParam = params.has('dq') ? parseString(params.get('dq')) : null
  const query = params.has('q') ? parseString(params.get('q')) : (queryDraftParam ?? '')
  const queryDraft = queryDraftParam ?? query

  return {
    activeTab: parseTab(params.get('tab'), allowedTabIds),
    query,
    queryDraft,
    consoleFilters: {
      ...createDefaultConsoleFilters(),
      tenantId: parseString(params.get('tenantId')),
      role: parseString(params.get('role')),
      status: parseString(params.get('status')),
      limit: parseInteger(params.get('limit'), DEFAULT_CONSOLE_LIMIT, {
        allowedValues: CONSOLE_PAGE_SIZES,
      }),
      offset: parseInteger(params.get('offset'), 0),
    },
    complianceFilters: {
      ...createDefaultComplianceFilters(),
      q: parseString(params.get('cq')),
      userId: parseString(params.get('cuserId')),
      tenantId: parseString(params.get('ctenantId')),
      source: parseString(params.get('csource')),
      category: COMPLIANCE_CATEGORY_VALUES.has(parseString(params.get('ccategory')))
        ? parseString(params.get('ccategory'))
        : 'all',
      queue: COMPLIANCE_QUEUE_VALUES.has(parseString(params.get('cqueue')))
        ? parseString(params.get('cqueue'))
        : 'all',
      limit: parseInteger(params.get('climit'), DEFAULT_COMPLIANCE_LIMIT, {
        allowedValues: CONSOLE_PAGE_SIZES,
      }),
      offset: parseInteger(params.get('coffset'), 0),
      sample: parseBooleanFlag(params.get('csample')),
    },
  }
}

function setIfPresent(params, key, value, defaultValue = '') {
  if (value === undefined || value === null || value === defaultValue || value === '') return
  params.set(key, String(value))
}

export function buildAdminViewSearch(viewState) {
  const params = new URLSearchParams()
  const consoleFilters = viewState.consoleFilters ?? createDefaultConsoleFilters()
  const complianceFilters = viewState.complianceFilters ?? createDefaultComplianceFilters()
  const query = viewState.query ?? ''
  const queryDraft = viewState.queryDraft ?? query

  setIfPresent(params, 'tab', viewState.activeTab, DEFAULT_ACTIVE_TAB)
  if (queryDraft !== query) params.set('dq', queryDraft)
  setIfPresent(params, 'q', query)

  setIfPresent(params, 'tenantId', consoleFilters.tenantId)
  setIfPresent(params, 'role', consoleFilters.role)
  setIfPresent(params, 'status', consoleFilters.status)
  setIfPresent(params, 'limit', consoleFilters.limit, DEFAULT_CONSOLE_LIMIT)
  setIfPresent(params, 'offset', consoleFilters.offset, 0)

  setIfPresent(params, 'cq', complianceFilters.q)
  setIfPresent(params, 'cuserId', complianceFilters.userId)
  setIfPresent(params, 'ctenantId', complianceFilters.tenantId)
  setIfPresent(params, 'csource', complianceFilters.source)
  setIfPresent(params, 'ccategory', complianceFilters.category, 'all')
  setIfPresent(params, 'cqueue', complianceFilters.queue, 'all')
  setIfPresent(params, 'climit', complianceFilters.limit, DEFAULT_COMPLIANCE_LIMIT)
  setIfPresent(params, 'coffset', complianceFilters.offset, 0)
  if (complianceFilters.sample) params.set('csample', '1')

  const nextSearch = params.toString()
  return nextSearch ? `?${nextSearch}` : ''
}
