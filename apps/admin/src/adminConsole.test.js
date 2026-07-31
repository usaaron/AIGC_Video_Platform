import { describe, expect, it } from 'vitest'
import { canReadAdminConsole, filterRows, formatSignedAmount, summarizeConsole } from './adminConsole'

describe('admin console helpers', () => {
  it('checks admin console permission from the session', () => {
    expect(canReadAdminConsole({ permissions: ['admin.dashboard.read'] })).toBe(true)
    expect(canReadAdminConsole({ permissions: ['project.read'] })).toBe(false)
    expect(canReadAdminConsole(null)).toBe(false)
  })

  it('filters nested console rows', () => {
    const rows = [
      { name: 'Owner', tenant: { name: 'Studio Alpha' }, roles: ['owner'] },
      { name: 'Member', tenant: { name: 'Studio Beta' }, roles: ['member'] },
    ]
    expect(filterRows(rows, 'alpha')).toEqual([rows[0]])
    expect(filterRows(rows, 'member')).toEqual([rows[1]])
  })

  it('summarizes list totals from a console snapshot', () => {
    expect(
      summarizeConsole({
        overview: { users: 1 },
        users: { meta: { total: 4 } },
        tenants: { meta: { total: 2 } },
        memberships: { meta: { total: 5 } },
        sessions: { meta: { total: 6 } },
        billingAccounts: { meta: { total: 3 } },
        auditLogs: { meta: { total: 9 } },
      }),
    ).toEqual({
      users: 4,
      tenants: 2,
      memberships: 5,
      sessions: 6,
      billingAccounts: 3,
      auditLogs: 9,
    })
  })

  it('formats positive ledger amounts with an explicit sign', () => {
    expect(formatSignedAmount(20)).toBe('+20')
    expect(formatSignedAmount(-3)).toBe('-3')
  })
})
