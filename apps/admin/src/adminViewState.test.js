import { describe, expect, it } from 'vitest'
import {
  buildAdminViewSearch,
  createDefaultComplianceFilters,
  createDefaultConsoleFilters,
  readAdminViewState,
} from './adminViewState'

describe('adminViewState', () => {
  it('parses the current admin view from URL search params', () => {
    const state = readAdminViewState(
      '?tab=compliance&q=search&dq=draft&tenantId=tenant-1&role=member&status=active&limit=25&offset=50&cq=prompt&cuserId=user-1&ctenantId=tenant-2&csource=generation_task&ccategory=none&cqueue=pending&climit=100&coffset=200&csample=1',
      { allowedTabIds: ['overview', 'compliance', 'users'] },
    )

    expect(state.activeTab).toBe('compliance')
    expect(state.query).toBe('search')
    expect(state.queryDraft).toBe('draft')
    expect(state.consoleFilters).toMatchObject({
      tenantId: 'tenant-1',
      role: 'member',
      status: 'active',
      limit: 25,
      offset: 50,
    })
    expect(state.complianceFilters).toMatchObject({
      q: 'prompt',
      userId: 'user-1',
      tenantId: 'tenant-2',
      source: 'generation_task',
      category: 'none',
      queue: 'pending',
      limit: 100,
      offset: 200,
      sample: true,
    })
  })

  it('serializes only non-default admin state into the URL', () => {
    const search = buildAdminViewSearch({
      activeTab: 'users',
      query: 'alice',
      queryDraft: 'alice',
      consoleFilters: {
        ...createDefaultConsoleFilters(),
        role: 'member',
        offset: 25,
      },
      complianceFilters: createDefaultComplianceFilters(),
    })

    expect(search).toBe('?tab=users&q=alice&role=member&offset=25')
  })

  it('preserves a draft query even when it differs from the committed query', () => {
    const search = buildAdminViewSearch({
      activeTab: 'users',
      query: 'alice',
      queryDraft: '',
      consoleFilters: createDefaultConsoleFilters(),
      complianceFilters: createDefaultComplianceFilters(),
    })

    expect(search).toBe('?tab=users&dq=&q=alice')
  })

  it('falls back to safe defaults for invalid values', () => {
    const state = readAdminViewState(
      '?tab=unknown&limit=999&offset=-1&ccategory=not-real&cqueue=broken&climit=5&csample=false',
      { allowedTabIds: ['overview', 'users'] },
    )

    expect(state.activeTab).toBe('overview')
    expect(state.consoleFilters.limit).toBe(50)
    expect(state.consoleFilters.offset).toBe(0)
    expect(state.complianceFilters.category).toBe('all')
    expect(state.complianceFilters.queue).toBe('all')
    expect(state.complianceFilters.limit).toBe(50)
    expect(state.complianceFilters.sample).toBe(false)
  })
})
