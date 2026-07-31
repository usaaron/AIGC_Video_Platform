import { describe, expect, it } from 'vitest'
import {
  auditLogTone,
  buildSessionRiskRows,
  canReadAdminConsole,
  filterRows,
  formatSignedAmount,
  summarizeAuditLogs,
  summarizeBillingAdjustments,
  summarizeConsole,
  summarizeSessionRisks,
} from './adminConsole'

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

  it('scores active elevated stale sessions as higher risk', () => {
    const now = new Date('2026-07-31T08:00:00.000Z')
    const rows = buildSessionRiskRows(
      [
        {
          sessionId: 'high',
          userId: 'u1',
          roles: ['owner'],
          status: 'active',
          current: false,
          createdAt: '2026-07-20T08:00:00.000Z',
          lastSeenAt: '2026-07-20T08:00:00.000Z',
          ipAddress: null,
          deviceLabel: null,
          userAgent: null,
        },
        {
          sessionId: 'low',
          userId: 'u2',
          roles: ['member'],
          status: 'active',
          current: false,
          createdAt: '2026-07-31T07:00:00.000Z',
          lastSeenAt: '2026-07-31T07:30:00.000Z',
          ipAddress: '127.0.0.1',
          deviceLabel: 'Chrome on Windows',
          userAgent: 'Chrome',
        },
      ],
      now,
    )

    expect(rows[0].sessionId).toBe('high')
    expect(rows[0].riskLevel).toBe('high')
    expect(rows[1].riskLevel).toBe('low')
    expect(summarizeSessionRisks(rows)).toMatchObject({ high: 1, low: 1, active: 2 })
  })

  it('summarizes audit and billing adjustment activity', () => {
    const auditEntries = [
      { action: 'admin.session.revoked', resourceType: 'session', actorUserId: 'owner' },
      { action: 'admin.account_status.updated', resourceType: 'user', actorUserId: 'owner' },
      { action: 'billing.adjusted', resourceType: 'billing', actorUserId: 'admin' },
    ]
    expect(summarizeAuditLogs(auditEntries)).toEqual({
      total: 3,
      accountEvents: 1,
      sessionEvents: 1,
      billingEvents: 1,
      actors: 2,
    })
    expect(auditLogTone(auditEntries[0])).toBe('high')
    expect(
      summarizeBillingAdjustments([
        { type: 'adjustment', amount: -8 },
        { type: 'grant', amount: 20 },
      ]),
    ).toEqual({ adjustments: 1, grants: 1, positiveCredits: 20, negativeCredits: 8 })
  })
})
